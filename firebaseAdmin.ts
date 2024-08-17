import { initializeApp, App, getApp,getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
 
// const serviceKey = require('@/service_key.json');

const serviceKey = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_KEY_BASE64!, 'base64').toString('utf-8')
  );

let app: App;

if(getApps().length === 0) {
    app = initializeApp({
        credential: cert(serviceKey), 
    });
} else {
    app = getApp();
}

const adminDb = getFirestore(app);

export  { app as adminApp, adminDb };