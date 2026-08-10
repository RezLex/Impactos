import { initializeApp }  from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
import { getFirestore }   from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';
import { getAuth }        from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js';

const firebaseConfig = {
  apiKey:            "AIzaSyAyDy1kqANwfUSbWEeIELm7PSk6ODIi-2g",
  authDomain:        "impactos-b4307.firebaseapp.com",
  projectId:         "impactos-b4307",
  storageBucket:     "impactos-b4307.firebasestorage.app",
  messagingSenderId: "1087836294078",
  appId:             "1:1087836294078:web:67910afd3904a848ab07ef"
};

// Se exporta porque `push.js` necesita la instancia para `getMessaging(app)`;
// el SDK de messaging se carga aparte, solo si el dispositivo lo soporta.
export const app = initializeApp(firebaseConfig);

export const db   = getFirestore(app);
export const auth = getAuth(app);
