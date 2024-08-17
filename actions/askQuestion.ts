"use server"

import { Message } from "@/components/Chat";
import { adminDb } from "@/firebaseAdmin";
import { generateLangchainCompletion } from "@/lib/langchain";
import { auth } from "@clerk/nextjs/server";

const FREE_LIMIT = 3;
const PRO_LIMIT = 100;

export const askQuestion = async (id: string, question: string) => {
    auth().protect();
    const { userId } = await auth();

    const chatRef = adminDb
       .collection("users")
       .doc(userId!)
       .collection("files")
       .doc(id)
       .collection("chat");

    //Check how many user message are inthe chat 
    const chatSnapshot = await chatRef.get();
    const userMessages = chatSnapshot.docs.filter(
        (doc) => doc.data().role === "human"
    );
    // tommorow limit the pro/free userss

    const userMessage: Message = {
        role: 'human',
        message: question,
        createdAt: new Date(),
    };

    await chatRef.add(userMessage);

    //Genrate AI response
    const reply = await generateLangchainCompletion(id,question);

    const AIMessage: Message = {
        role: 'ai',
        message: reply,
        createdAt: new Date(),
    };

    await chatRef.add(AIMessage); 

    return { success: true, message: null }
}