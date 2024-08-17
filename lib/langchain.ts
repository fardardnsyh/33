import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createHistoryAwareRetriever } from "langchain/chains/history_aware_retriever";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import pineconeClient from "./pinecone";
import { PineconeStore } from "@langchain/pinecone";
import { PineconeConflictError } from "@pinecone-database/pinecone/dist/errors";
import { Index, RecordMetadata } from "@pinecone-database/pinecone";
import { adminDb } from "@/firebaseAdmin";
import { auth } from "@clerk/nextjs/server";
import {
    ChatGoogleGenerativeAI,
    GoogleGenerativeAIEmbeddings,
  } from "@langchain/google-genai";
import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { collection } from "firebase/firestore";

// initialize the OpenAI model with API key and model name
// const model = new ChatOpenAI({
//     apiKey: process.env.OPENAI_API_KEY,
//     modelName: "gpt-4o",
// })

const model = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    modelName: "gemini-1.5-flash",
    maxOutputTokens: 2048,
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
      },
    ],
  });
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY,
    modelName: "embedding-001",
  });

export const indexName = "chatwithpdf";

const fetchMessagesFromDB = async (docId: string) => {
    const { userId } = await auth();
    if(!userId) {
        throw new Error("User not found");
    }

    console.log("Fetching chat history from firestore database...");
    // const LIMIT = n; if you want to get last n num of message
    const chats = await adminDb
     .collection('users')
     .doc(userId)
     .collection("files")
     .doc(docId)
     .collection("chat")
     .orderBy("createdAt", "desc")
     //.limit(LIMIT)
     .get();

    const chatHistory = chats.docs.map((doc) => 
        doc.data().role === "human"
          ? new HumanMessage(doc.data().message)
          : new AIMessage(doc.data().message) 
    );

    console.log(`Fetched last ${chatHistory.length} messages successfully`);
    console.log(chatHistory.map((m) => m.content.toString()));

    return chatHistory;
}

export const generateDocs = async (docId: string) => {
    const { userId } = await auth();

    if(!userId){
        throw new Error("User not found");
    }

    console.log("Fetching the download URL from Firebase...");
    const firebaseRef = await adminDb
        .collection("users")
        .doc(userId)
        .collection("files")
        .doc(docId)
        .get();

        const downloadUrl = firebaseRef.data()?.downloadUrl;

        if(!downloadUrl) {
            throw new Error("Download URL not found");
        }

        console.log(`Download URL fetched successfully: ${downloadUrl}---`);

        //Fetch the PDF from the specified URL
        const response = await fetch(downloadUrl);

        // Load the PDF into a PDF Document Obj
        const data = await response.blob();

        //Load the PDF document from the specified path
        console.log("Loading PDF document");
        const loader = new PDFLoader(data);
        const docs = await loader.load();

        //Split the loaded document into smaller parts for easier processing
        console.log("Spliting the loaded document into smaller parts");
        const splitter = new RecursiveCharacterTextSplitter();

        const splitDocs = await splitter.splitDocuments(docs);
        console.log(`Split into ${splitDocs.length} parts`);

        return splitDocs;
}

const namespaceExists = async (
    index: Index<RecordMetadata>,
    namespace: string 
) => {
    if(namespace === null) throw new Error("No namespace value provided.");

    const { namespaces } = await index.describeIndexStats();
    return namespaces?.[namespace] !== undefined;
}

export const genrateEmbeddingsInPineconeVectorStore = async(docId:string) => {
    const { userId } = await auth(); 

    if(!userId){
        throw new Error("User not found");
    }

    let pineconeVectorStore;

    //Genrating embeddings (numerical representation) for the split documents
    console.log("Genrating embeddings...");
    // const embeddings = new OpenAIEmbeddings();

    const index = await pineconeClient.index(indexName);
    const namespaceAlreadyExists = await namespaceExists(index, docId);

    if(namespaceAlreadyExists) {
        console.log(`Namespace ${docId} already exists, reusing existing embeddings...`);

        pineconeVectorStore = await PineconeStore.fromExistingIndex(embeddings, {
            pineconeIndex: index,
            namespace: docId,
        });

        return pineconeVectorStore;
    } else {
        //If the namespace does not exist, download the PDF from firestore via the storerd download URL & genrate the embeddigs and store them in the pinecoe vector store.
        const splitDocs = await generateDocs(docId);
        console.log(`Storing the embeddings in namespace ${docId} in the ${indexName} Pinecone vector store...`);

        pineconeVectorStore = await PineconeStore.fromDocuments(
            splitDocs,
            embeddings,
            {
                pineconeIndex: index,
                namespace: docId,
            }
        );

        return pineconeVectorStore;
    }
}

const generateLangchainCompletion = async (docId: string, question: string) => {
    let pineconeVectorStore;

    pineconeVectorStore = await genrateEmbeddingsInPineconeVectorStore(docId);

    //Create a retriver to search through the vector store
    console.log("creating retriever....");
    const retriever = pineconeVectorStore.asRetriever();

    //Fetch the chat history from the database
    const chatHistory = await fetchMessagesFromDB(docId);

    //Define a prompt templatte for genrating search queries based on conversation history
    console.log("Defining a prompt template....");

    const historyAwarePrompt = ChatPromptTemplate.fromMessages([
        ...chatHistory, //Insert the actual chat history here

      ["user","{input}"],
      [
        "user",
        "Given the above conversation, genrate a search query to look up in order to get information relevant to the conversation",
      ]  
    ]);

    //Create a history-aware ertriver chain that uses the model, retriver, and prompt
    console.log("Creating a history-aware retriver chain...");
    const historyAwareRetriverChain = await createHistoryAwareRetriever({
        llm: model,
        retriever,
        rephrasePrompt: historyAwarePrompt,
    });

    //Define a prompt template or answering questions based on retrieved context
    console.log("Defining a prompt template for answering questions");
    const historyAwareRetrievalPrompt = ChatPromptTemplate.fromMessages([
        [
            "system",
            "Answer the user's questions based on the below context:\n\n{context}",
        ],

        ...chatHistory, // Insert the actial chat history here

        ["user", "{input}"],
    ]);

    //Create a chain to combine the retrieved documents into a concerent response
    console.log("Creating a document chain,...");
    const historyAwareCombineDocsChain = await createStuffDocumentsChain({
        llm: model,
        prompt: historyAwareRetrievalPrompt,
    });

    //Create the main retrival chain that combines the history-aware retriever and document combining chains
    console.log("creating the main retrieval chain");
    const conversationalRetrivalChain = await createRetrievalChain({
        retriever: historyAwareRetriverChain,
        combineDocsChain: historyAwareCombineDocsChain,
    })

    console.log("Running the chain with a simple conversation...");
    const reply = await conversationalRetrivalChain.invoke({
        chat_history: chatHistory,
        input: question,
    });

    // Print the result to the console
    console.log(reply.answer);
    return reply.answer;
}

export { model, generateLangchainCompletion };