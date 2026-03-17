// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDS4GQWwwl15mEEUbCfPATIYe4LUxj4r5g",
    authDomain: "planning-with-ai-6ca2b.firebaseapp.com",
    projectId: "planning-with-ai-6ca2b",
    storageBucket: "planning-with-ai-6ca2b.firebasestorage.app",
    messagingSenderId: "595215667619",
    appId: "1:595215667619:web:76b56d3eff7ee8d0ab4a16"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

export { db, storage };
export default app;
