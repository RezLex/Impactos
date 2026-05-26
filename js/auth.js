import { auth, db } from './firebase.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';

const provider = new GoogleAuthProvider();

export function initAuth(onLogin, onLogout) {
  document.getElementById('btn-google-login').addEventListener('click', async () => {
    const btn = document.getElementById('btn-google-login');
    btn.disabled = true;
    btn.textContent = 'Conectando...';
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" alt="Google"> Iniciar sesión con Google`;
    }
  });

  document.getElementById('btn-signout').addEventListener('click', () => signOut(auth));

  onAuthStateChanged(auth, async user => {
    if (!user) { onLogout(); return; }

    try {
      const ownerDoc = await getDoc(doc(db, '_config', 'owner'));

      if (!ownerDoc.exists()) {
        // Primera vez: dejar entrar y mostrar UID para configurar
        onLogin(user);
        showFirstRunBanner(user.uid);
        return;
      }

      if (ownerDoc.data().uid !== user.uid) {
        await signOut(auth);
        showUnauthorizedMessage();
        return;
      }
    } catch (e) {
      // Si no se puede leer la config (ej. reglas aún no publicadas), dejar pasar
      console.warn('No se pudo verificar config de acceso:', e.message);
    }

    onLogin(user);
  });
}

function showUnauthorizedMessage() {
  const btn = document.getElementById('btn-google-login');
  btn.disabled = false;
  btn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" alt="Google"> Iniciar sesión con Google`;
  const card = document.querySelector('.auth-card');
  card.querySelector('.auth-msg')?.remove();
  card.insertAdjacentHTML('beforeend',
    `<p class="auth-msg" style="color:#ff6b6b;font-size:0.8rem;margin-top:12px;margin-bottom:0">
       Acceso no autorizado para esta cuenta.
     </p>`);
}

function showFirstRunBanner(uid) {
  document.getElementById('app-content')?.insertAdjacentHTML('afterbegin', `
    <div class="alert alert-warning d-flex gap-3 align-items-start" id="first-run-banner">
      <i class="bi bi-shield-lock-fill fs-4 flex-shrink-0"></i>
      <div>
        <strong>Configura el acceso exclusivo</strong>
        <p class="mb-1 mt-1" style="font-size:0.85rem">
          Crea el documento <code>_config/owner</code> en
          <a href="https://console.firebase.google.com" target="_blank">Firebase Console → Firestore</a>
          con el siguiente campo para que solo tu cuenta pueda acceder:
        </p>
        <code style="user-select:all;font-size:0.8rem">uid: "${uid}"</code>
        <button class="btn btn-sm btn-warning ms-3" onclick="navigator.clipboard.writeText('${uid}');this.textContent='¡Copiado!'">
          Copiar UID
        </button>
      </div>
    </div>`);
}

export const currentUser = () => auth.currentUser;
