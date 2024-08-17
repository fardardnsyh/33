import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: "AIzaSyBsVegezPvOVyfgJRKPx9KQ05MJqJelNuc",
    authDomain: "chat--with-pdf.firebaseapp.com",
    projectId: "chat--with-pdf",
    storageBucket: "chat--with-pdf.appspot.com",
    messagingSenderId: "905228167350",
    appId: "1:905228167350:web:89dd6fe0a415e9cc4ade17",
    measurementId: "G-53S1KQ3YGB"
  };

  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

  const db = getFirestore(app);
  const storage = getStorage(app);


export { db, storage }; 
  