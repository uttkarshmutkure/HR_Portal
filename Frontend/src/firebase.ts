import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// TODO: replace with your actual Firebase config values
// (Firebase Console → Project Settings → General → Your apps → SDK setup and configuration)
const firebaseConfig = {
  apiKey: "AIzaSyCEmRDJCcP4zVH5WZbnUU1KMnTXw8rMUnA",
  authDomain: "atgeir-moae-dev.firebaseapp.com",
  projectId: "atgeir-moae-dev",
  storageBucket: "atgeir-moae-dev.firebasestorage.app",
  messagingSenderId: "621913909275",
  appId: "1:621913909275:web:451b3b757ce80395dc30be"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();