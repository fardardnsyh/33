'use server'
import { genrateEmbeddingsInPineconeVectorStore } from "@/lib/langchain";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export const genrateEmbeddings = async (docId: string) => {
    auth().protect(); // Protect this route with clerk

    //turn a PDF inot embeddings [0.012293, 0.33394, 0.331134, ...]
    await genrateEmbeddingsInPineconeVectorStore(docId);

    revalidatePath('/dahsboard');

    return { completed: true };
}

