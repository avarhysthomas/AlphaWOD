// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from 'firebase/firestore';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBytuBBaddaY_4SNcD97SlGFRXfAscmjCs",
  authDomain: "alphawod-d1f2f.firebaseapp.com",
  projectId: "alphawod-d1f2f",
  storageBucket: "alphawod-d1f2f.firebasestorage.app",
  messagingSenderId: "674003216841",
  appId: "1:674003216841:web:cfee240659ca55d7622018",
  measurementId: "G-0MTKPBVEHD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

export { db };