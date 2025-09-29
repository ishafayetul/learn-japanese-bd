// firebase.js — minimal integrations used by script.js
// Loads as: <script type="module" src="firebase.js"></script>

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, writeBatch, serverTimestamp,
  collection, query, orderBy, limit, getDocs, increment
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* =========================
   Config (keep your existing project)
   ========================= */
const firebaseConfig = {
  apiKey: "AIzaSyCIAoRM5KuCC6beLAAIHZief0wIiZOcu8I",
  authDomain: "cool-kit-469207-r6.firebaseapp.com",
  projectId: "cool-kit-469207-r6",
  storageBucket: "cool-kit-469207-r6.firebasestorage.app",
  messagingSenderId: "801430687128",
  appId: "1:801430687128:web:d30d5c33ac1b7b06a62fed",
  measurementId: "G-9KB1WBZ847"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const provider = new GoogleAuthProvider();

/* =========================
   Small DOM helpers
   ========================= */
const $ = (id) => document.getElementById(id);
const gate   = $('auth-gate');
const root   = $('app-root');
const btn    = $('auth-btn');
const errEl  = $('auth-error');
const showErr = (m) => { if (errEl){ errEl.textContent = m; errEl.style.display='block'; } };
const hideErr = () => { if (errEl){ errEl.style.display='none'; } };

/* =========================
   Auth
   ========================= */
btn?.addEventListener('click', async () => {
  try {
    hideErr();
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.warn('[auth] sign-in failed:', e?.message || e);
    showErr(e?.message || 'Sign-in failed');
  }
});

onAuthStateChanged(auth, async (user) => {
  try {
    if (user) {
      // ensure base doc
      const uref = doc(db, 'users', user.uid);
      const us = await getDoc(uref);
      if (!us.exists()) {
        await setDoc(uref, {
          displayName: user.displayName || 'Anonymous',
          photoURL: user.photoURL || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(uref, { updatedAt: serverTimestamp() }, { merge: true });
      }

      // show app
      gate?.classList.add('hidden'); if (gate) gate.style.display='none';
      root?.classList.remove('hidden'); if (root) root.style.display='block';

      // let app continue
      window.__initAfterLogin?.();
    } else {
      root?.classList.add('hidden'); if (root) root.style.display='none';
      gate?.classList.remove('hidden'); if (gate) gate.style.display='';
    }
  } catch (e) {
    console.error('[auth] state error:', e);
    showErr(e?.message || 'Unexpected error');
  }
});

// expose for header button
window.__signOut = () => signOut(auth);

/* =========================
   Helpers
   ========================= */
function todayKey(d = new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

/* =========================================================
   Public API used by script.js
   - __fb_commitSession(payload)
   - __fb_fetchAttempts(limit)
   - __fb_markWord(wordObj)
   - __fb_fetchMarkedWords()
   - (optional notes) __fb_fetchNotes(deckName), __fb_saveNote({deckName, wordKey, note})
   ========================================================= */

/**
 * Store one practice session summary.
 * Score = payload.correct (generic across modes).
 */
window.__fb_commitSession = async function(payload){
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const {
    deckName = 'Unknown Deck',
    mode = 'jp-en',
    correct = 0, wrong = 0, skipped = 0, total = 0,
    // optional per-mode counters (safe if missing)
    hiraEnCorrect = 0, enHiraCorrect = 0, kanjiHiraCorrect = 0, hiraKanjiCorrect = 0,
    hm2kCorrect = 0, k2hmCorrect = 0,
    writeEnHiraCorrect = 0, writeKanjiHiraCorrect = 0,
  } = payload || {};

  const attemptsCol = collection(db, 'users', user.uid, 'attempts');
  const dayRef = doc(db, 'users', user.uid, 'daily', todayKey());

  const batch = writeBatch(db);

  // attempt record
  const attemptDoc = doc(attemptsCol);
  batch.set(attemptDoc, {
    deckName, mode, correct, wrong, skipped, total,
    counts: {
      hiraEnCorrect, enHiraCorrect, kanjiHiraCorrect, hiraKanjiCorrect,
      hm2kCorrect, k2hmCorrect, writeEnHiraCorrect, writeKanjiHiraCorrect
    },
    createdAt: Date.now(), createdAtServer: serverTimestamp()
  });

  // daily aggregates (simple counters)
  batch.set(dayRef, {
    date: todayKey(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  // increment per-mode counters + generic score
  batch.set(dayRef, {
    hiraEnCorrect: increment(hiraEnCorrect || 0),
    enHiraCorrect: increment(enHiraCorrect || 0),
    kanjiHiraCorrect: increment(kanjiHiraCorrect || 0),
    hiraKanjiCorrect: increment(hiraKanjiCorrect || 0),
    hm2kCorrect: increment(hm2kCorrect || 0),
    k2hmCorrect: increment(k2hmCorrect || 0),
    writeEnHiraCorrect: increment(writeEnHiraCorrect || 0),
    writeKanjiHiraCorrect: increment(writeKanjiHiraCorrect || 0),
    score: increment(correct || 0)
  }, { merge: true });

  await batch.commit();
};

/** Fetch recent attempts for Progress table */
window.__fb_fetchAttempts = async function(limitN = 50){
  const user = auth.currentUser;
  if (!user) return [];
  const col = collection(db, 'users', user.uid, 'attempts');
  const qy = query(col, orderBy('createdAt','desc'), limit(limitN));
  const snap = await getDocs(qy);
  const out = [];
  snap.forEach(s => {
    const d = s.data() || {};
    const ts = d.createdAt || (d.createdAtServer?.toMillis ? d.createdAtServer.toMillis() : Date.now());
    out.push({ id: s.id, ...d, createdAt: ts });
  });
  return out;
};

/** Mark word (favorites) */
window.__fb_markWord = async function(wordObj){
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const { front="", back="", hiragana="", meaning="", kanji="" } = wordObj || {};
  const key = (front || hiragana) + '|' + (back || meaning);
  const ref = doc(db, 'users', user.uid, 'markedWords', key);
  await setDoc(ref, { front, back, hiragana, meaning, kanji, createdAt: serverTimestamp() }, { merge: true });
  return { ok: true };
};

/** Fetch marked words */
window.__fb_fetchMarkedWords = async function(){
  const user = auth.currentUser;
  if (!user) return [];
  const col = collection(db, 'users', user.uid, 'markedWords');
  const snap = await getDocs(col);
  const arr = [];
  snap.forEach(s => {
    const d = s.data() || {};
    if (d.front || d.hiragana) arr.push(d);
  });
  return arr;
};

/** Optional: Notes per vocab (used by Learn notes UI if you wire it) */
window.__fb_fetchNotes = async function(deckName){
  try{
    const user = auth.currentUser; if (!user) return {};
    const ref = doc(db, 'users', user.uid, 'notes', deckName);
    const s = await getDoc(ref);
    return s.exists() ? (s.data() || {}) : {};
  }catch{ return {}; }
};
window.__fb_saveNote = async function({ deckName, wordKey, note }){
  try{
    const user = auth.currentUser; if (!user) throw new Error('not-signed-in');
    const ref = doc(db, 'users', user.uid, 'notes', deckName);
    await setDoc(ref, { [wordKey]: note || "" }, { merge: true });
    return { ok:true };
  }catch(e){ return { ok:false, error: e?.message || String(e) }; }
};
