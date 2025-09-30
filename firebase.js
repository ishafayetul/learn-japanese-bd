// firebase.js (ES Module loaded before script.js)
//
// Fresh Firebase wrapper that exposes a single global: window.FB
// - Auth (Google)
// - Firestore helpers with batched writes
// - Minimal read strategy + optional offline persistence
// - Works with old project/collections if you keep same paths
//
// NOTE: Set window.FIREBASE_CONFIG in index.html before this file.
// <script>window.FIREBASE_CONFIG={ apiKey:"...", authDomain:"...", projectId:"...", ... };</script>
// <script type="module" src="firebase.js"></script>

(() => {
  // ---- Guard: single init ----
  if (window.FB) return;

  // ---- Config ----
  const CONFIG = window.FIREBASE_CONFIG || {
    apiKey: "AIzaSyCIAoRM5KuCC6beLAAIHZief0wIiZOcu8I",
    authDomain: "cool-kit-469207-r6.firebaseapp.com",
    projectId: "cool-kit-469207-r6",
    storageBucket: "cool-kit-469207-r6.firebasestorage.app",
    messagingSenderId: "801430687128",
    appId: "1:801430687128:web:d30d5c33ac1b7b06a62fed",
    measurementId: "G-9KB1WBZ847"
  };

  // ---- Load Firebase modules from CDN (v10) ----
  // Using static imports inside an IIFE is fine since this file is type="module"
  const appModuleUrl = "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
  const authModuleUrl = "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
  const fsModuleUrl   = "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

  let app, auth, db;
  let _user = null;
  const _listeners = new Set(); // auth listeners

  const _cache = {
    notes: new Map(),           // key -> {note, updatedAt}
    marked: new Map(),          // key -> data
    signWords: new Map(),       // id -> data
  };

  const Local = {
    get(k, fallback=null) {
      try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
      catch { return fallback; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
    },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  const NS = (suffix) => `lj_${suffix}`;

  const Paths = {
    users: (uid) => `users/${uid}`,
    userNotesCol:   (uid) => `users/${uid}/notes`,
    userMarkedCol:  (uid) => `users/${uid}/marked`,
    userSignCol:    (uid) => `users/${uid}/signWords`,
    attemptsCol:    ()    => `attempts`,                   // root attempts collection (doc contains uid)
    dailyScoresCol: (date) => `daily/${date}/scores`,      // subcollection for today's leaderboard
    overallLBCol:   ()    => `leaderboard_overall`,        // overall leaderboard (aggregate)
  };

  // Small utils
  const todayKey = () => {
    const d = new Date();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  };
  const safeKey = (s) => s.toLowerCase().trim().replace(/\s+/g,'_').replace(/[^\w\-]/g,'');

  const init = async () => {
    if (!CONFIG || !CONFIG.projectId) {
      console.error("[Firebase] Missing window.FIREBASE_CONFIG. Please set your real config.");
    }

    // Dynamic import
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
      import(appModuleUrl),
      import(authModuleUrl),
      import(fsModuleUrl),
    ]);

    const {
      getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
      onAuthStateChanged, setPersistence, browserLocalPersistence, signOut: _signOut
    } = authMod;

    const {
      getFirestore, enableIndexedDbPersistence, collection, doc, setDoc, getDoc, getDocs,
      updateDoc, addDoc, writeBatch, serverTimestamp, increment,
      onSnapshot, query, orderBy, where, limit
    } = fsMod;

    app = initializeApp(CONFIG);
    auth = getAuth(app);
    db   = getFirestore(app);

    // Offline (best effort)
    try {
      await enableIndexedDbPersistence(db);
      console.info("[Firebase] IndexedDB persistence enabled.");
    } catch (e) {
      console.info("[Firebase] Persistence not enabled (multi-tab or unsupported).", e?.code || e);
    }

    // Persist auth in local storage
    await setPersistence(auth, browserLocalPersistence);

    // Auth listener
    onAuthStateChanged(auth, async (user) => {
      _user = user;
      if (user) {
        // Ensure base user doc exists
        await ensureUserDoc(user);
      }
      _listeners.forEach(fn => {
        try { fn(user); } catch {}
      });
    });

    // Expose minimal API
    window.FB = {
      // Ready flag
      isReady: true,

      // Raw refs (if needed)
      _raw: { app, auth, db },

      // ---- Auth API ----
      auth: {
        get currentUser() { return _user; },
        onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); },
        async signInWithGoogle() {
          const provider = new authMod.GoogleAuthProvider();
          try {
            // Prefer popup; fallback to redirect on failure (e.g., in-app browsers)
            await signInWithPopup(auth, provider);
          } catch (e) {
            console.warn("[Firebase] Popup sign-in failed, trying redirect…", e.code || e);
            await signInWithRedirect(auth, provider);
          }
        },
        async signOut() {
          await _signOut(auth);
        }
      },

      // ---- Firestore Helpers ----
      // Batched commit of session attempts + leaderboard bump
      async commitSession({ attempts, points, date = todayKey() }) {
        if (!_user) throw new Error("Not signed in");
        const batch = writeBatch(db);

        const attemptsRef = collection(db, Paths.attemptsCol());
        const dailyRef    = doc(collection(db, Paths.dailyScoresCol(date)), _user.uid);
        const overallRef  = doc(collection(db, Paths.overallLBCol()), _user.uid);

        // Attempts
        const now = serverTimestamp();
        (attempts || []).forEach(a => {
          // a = {level, lesson, deckId, mode, right, wrong, skipped, total}
          const payload = {
            uid: _user.uid,
            displayName: _user.displayName || null,
            photoURL: _user.photoURL || null,
            level: a.level || null,
            lesson: a.lesson || null,
            deckId: a.deckId || null,
            mode: a.mode || null,
            right: a.right|0, wrong: a.wrong|0, skipped: a.skipped|0, total: a.total|0,
            createdAt: now,
          };
          const ref = doc(attemptsRef); // auto-id
          batch.set(ref, payload);
        });

        const delta = Number(points || 0);

        // Daily leaderboard upsert
        batch.set(dailyRef, {
          uid: _user.uid,
          displayName: _user.displayName || null,
          photoURL: _user.photoURL || null,
          score: increment(delta),
          updatedAt: now,
          date,
        }, { merge: true });

        // Overall leaderboard upsert
        batch.set(overallRef, {
          uid: _user.uid,
          displayName: _user.displayName || null,
          photoURL: _user.photoURL || null,
          score: increment(delta),
          updatedAt: now,
        }, { merge: true });

        await batch.commit();
        return { ok: true };
      },

      // Attempts — recent list (global or filtered later in UI)
      async getRecentAttempts({ max = 50 } = {}) {
        const { collection, query, orderBy, limit, getDocs } = await fsMods();
        const q = query(collection(db, Paths.attemptsCol()), orderBy("createdAt", "desc"), limit(max));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      },

      // Write-mode best completion by deck (computed client-side)
      async getWriteBestByDeck({ uid = null, max = 500 } = {}) {
        const list = await this.getRecentAttempts({ max });
        const mine = (uid || _user?.uid) ? list.filter(x => x.uid === (uid || _user.uid) && x.mode === "write") : list.filter(x => x.mode === "write");
        const bestMap = new Map(); // deckId -> record
        mine.forEach(x => {
          const prev = bestMap.get(x.deckId);
          const completion = (x.right|0) + (x.wrong|0) + (x.skipped|0);
          if (!prev || completion > ((prev.right|0)+(prev.wrong|0)+(prev.skipped|0))) {
            bestMap.set(x.deckId, x);
          }
        });
        return Array.from(bestMap.values());
      },

      // Leaderboards
      subscribeTodayLeaderboard(date = todayKey(), cb) {
        return onSnapshot(
          query(collection(db, Paths.dailyScoresCol(date)), orderBy("score", "desc"), limit(100)),
          snap => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            cb(rows);
          },
          err => console.error("[Leaderboard:today] onSnapshot error", err)
        );
      },
      async getOverallLeaderboard({ max = 100 } = {}) {
        const { collection, query, orderBy, limit, getDocs } = await fsMods();
        const q = query(collection(db, Paths.overallLBCol()), orderBy("score","desc"), limit(max));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      },

      // Notes (per-word)
      async getNote(key) {
        if (!_user) throw new Error("Not signed in");
        if (_cache.notes.has(key)) return _cache.notes.get(key);
        const { doc, getDoc } = await fsMods();
        const ref = doc(db, `${Paths.userNotesCol(_user.uid)}/${safeKey(key)}`);
        const s = await getDoc(ref);
        const val = s.exists() ? s.data() : null;
        if (val) _cache.notes.set(key, val);
        return val;
      },
      async setNote(key, note) {
        if (!_user) throw new Error("Not signed in");
        const { doc, setDoc, serverTimestamp } = await fsMods();
        const ref = doc(db, `${Paths.userNotesCol(_user.uid)}/${safeKey(key)}`);
        const val = { note: String(note||""), updatedAt: serverTimestamp() };
        await setDoc(ref, val, { merge: true });
        _cache.notes.set(key, val);
        return val;
      },

      // Marked words
      async listMarked() {
        if (!_user) throw new Error("Not signed in");
        // cache first
        if (_cache.marked.size) return Array.from(_cache.marked.entries()).map(([id, v]) => ({ id, ...v }));
        const { collection, getDocs } = await fsMods();
        const snap = await getDocs(collection(db, Paths.userMarkedCol(_user.uid)));
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.forEach(r => _cache.marked.set(r.id, r));
        return rows;
      },
      async markWord(id, data) {
        if (!_user) throw new Error("Not signed in");
        const { doc, setDoc, serverTimestamp } = await fsMods();
        const ref = doc(db, `${Paths.userMarkedCol(_user.uid)}/${safeKey(id)}`);
        const payload = { ...data, updatedAt: serverTimestamp(), createdAt: data?.createdAt || serverTimestamp() };
        await setDoc(ref, payload, { merge: true });
        _cache.marked.set(safeKey(id), { id: safeKey(id), ...payload });
        return true;
      },
      async unmarkWord(id) {
        if (!_user) throw new Error("Not signed in");
        const { doc, deleteDoc } = await fsMods();
        const key = safeKey(id);
        await deleteDoc(doc(db, `${Paths.userMarkedCol(_user.uid)}/${key}`));
        _cache.marked.delete(key);
        return true;
      },

      // Sign Word (quick personal list)
      async signWordAdd({ front, back, romaji=null }) {
        if (!_user) throw new Error("Not signed in");
        const { collection, addDoc, serverTimestamp } = await fsMods();
        const col = collection(db, Paths.userSignCol(_user.uid));
        const docRef = await addDoc(col, {
          front: String(front||"").trim(),
          back: String(back||"").trim(),
          romaji: romaji ? String(romaji) : null,
          createdAt: serverTimestamp(),
        });
        const item = { id: docRef.id, front, back, romaji, createdAt: new Date() };
        _cache.signWords.set(item.id, item);
        return item;
      },
      async signWordList() {
        if (!_user) throw new Error("Not signed in");
        if (_cache.signWords.size) return Array.from(_cache.signWords.values());
        const { collection, getDocs, orderBy, query } = await fsMods();
        const q = query(collection(db, Paths.userSignCol(_user.uid)), orderBy("createdAt","desc"));
        const snap = await getDocs(q);
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.forEach(r => _cache.signWords.set(r.id, r));
        return rows;
      },
      async signWordRemove(id) {
        if (!_user) throw new Error("Not signed in");
        const { doc, deleteDoc } = await fsMods();
        await deleteDoc(doc(db, `${Paths.userSignCol(_user.uid)}/${id}`));
        _cache.signWords.delete(id);
        return true;
      },

      // Low-level helpers (if you need them in script.js)
      async ensureUser() {
        if (!_user) throw new Error("Not signed in");
        await ensureUserDoc(_user);
        return _user;
      },
    };

    // Helper closures using already-imported modules
    async function ensureUserDoc(user) {
      const { doc, getDoc, setDoc, serverTimestamp } = await fsMods();
      const ref = doc(db, Paths.users(user.uid));
      const s = await getDoc(ref);
      if (!s.exists()) {
        await setDoc(ref, {
          uid: user.uid,
          displayName: user.displayName || null,
          photoURL: user.photoURL || null,
          email: user.email || null,
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, { lastLoginAt: serverTimestamp(), displayName: user.displayName || null, photoURL: user.photoURL || null }, { merge: true });
      }
    }

    // Allow local caches (optional)
    // e.g., keep last 24h leaderboard snapshot to reduce initial flash loads
    try {
      const lbKey = NS(`lb_today_${todayKey()}`);
      window.FB._getCachedTodayLB = () => Local.get(lbKey, null);
      window.FB._setCachedTodayLB = (rows) => Local.set(lbKey, rows);
    } catch {}

    // Convenience to access Firestore methods already imported
    async function fsMods() {
      // destructure from the already-imported module (fsMod)
      return fsMod;
    }
  };

  // Boot
  init().catch(err => {
    console.error("[Firebase init] failed:", err);
  });
})();
