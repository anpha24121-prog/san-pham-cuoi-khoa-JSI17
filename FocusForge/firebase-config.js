// FocusForge — shared Firebase configuration.
// Keep this file as the single source of truth for the existing Firebase project.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

// Existing project values preserved from the supplied FocusForge version.
export const firebaseConfig = {
  apiKey: "AIzaSyB5e7f7qfJ1fFJyhhr0sEv6ARc9edcexUc",
  authDomain: "minitest-f2254.firebaseapp.com",
  projectId: "minitest-f2254",
  storageBucket: "minitest-f2254.firebasestorage.app",
  messagingSenderId: "1000675531113",
  appId: "1:1000675531113:web:9a1f9d3bd2cc35a841c5f8",
  measurementId: "G-6MFN644PNB"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Firestore is optional until enabled in Firebase Console; localStorage remains the fallback.
export const db = getFirestore(app);
