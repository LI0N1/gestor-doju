// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// TODO: Reemplaza este objeto con la configuración de tu proyecto Firebase
// Lo encuentras en la configuración de tu proyecto > tus apps > app web.
const firebaseConfig = {
  apiKey: "AIzaSyArzwnslCqhdk4WNREhckarKcQaywxI2jk",
  authDomain: "gestor-doju.firebaseapp.com",
  projectId: "gestor-doju",
  storageBucket: "gestor-doju.firebasestorage.app",
  messagingSenderId: "933106500168",
  appId: "1:933106500168:web:3aeb61808e1d6d8dc04e7d",
  measurementId: "G-SHXKW69ZBB"
};


// Inicializa Firebase y exporta los servicios
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { auth, db, storage };
