// firebase.js (ES Module loaded before script.js)
//
// Exposes a single global: window.FB
// - Auth (Google)
// - Firestore helpers (per-user data) + batched writes
// - Offline persistence (best effort)
// - Global daily/overall leaderboards remain shared
//
// NOTE: Set window.FIREBASE_CONFIG in index.html before this file.
import {
  getFirestore, collection, doc, getDocs, setDoc, addDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

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

  // ---- Load Firebase v10 modules from CDN ----
  const appModuleUrl = "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
  const authModuleUrl = "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
  const fsModuleUrl   = "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

  let app, auth, db;
  let _user = null;
  const _listeners = new Set(); // auth listeners

  const _cache = {
    notes: new Map(),     // key -> {note, updatedAt}
    marked: new Map(),    // id  -> data
    signWords: new Map(), // id  -> data
  };

  const Local = {
    get(k, fallback=null) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k)    { try { localStorage.removeItem(k); } catch {} },
  };

  const NS = (suffix) => `lj_${suffix}`;

  const Paths = {
    users: (uid) => `users/${uid}`,
    userMarkedCol:   (uid) => `users/${uid}/marked`,
    userNotesCol:    (uid) => `users/${uid}/notes`,
    userSignCol:     (uid) => `users/${uid}/signwords`,
    userAttemptsCol: (uid) => `users/${uid}/attempts`,
    userWriteBestCol:(uid) => `users/${uid}/writeBest`,
    dailyScoresCol:  (date) => `daily/${date}/scores`,      // shared daily leaderboard
    overallLBCol:    ()    => `leaderboard_overall`,        // shared overall leaderboard
  };

  // Normalize attempts collection path (handles both function or string)
  const attemptsPath = () =>
    (typeof Paths.attemptsCol === "function"
      ? Paths.attemptsCol()
      : (Paths.attemptsCol || "attempts"));

  // Utilities
  const todayKey = () => {
    const d = new Date();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  };

  // Base64 of UTF-8 for safe uniqueness with Japanese text
  const safeKey = (s) => {
    try { return btoa(unescape(encodeURIComponent(String(s)))).replace(/=+$/,""); }
    catch { return String(s).toLowerCase().replace(/\W+/g,'_'); }
  };

  const init = async () => {
    if (!CONFIG || !CONFIG.projectId) {
      console.error("[Firebase] Missing window.FIREBASE_CONFIG. Please set your real config.");
    }

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
      onSnapshot, query, orderBy, where, limit, deleteDoc
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
      if (user) await ensureUserDoc(user);
      _listeners.forEach(fn => { try { fn(user); } catch {} });
    });

    // Expose API
    window.FB = {
      isReady: true,
      _raw: { app, auth, db },

      /* --------------- AUTH --------------- */
      auth: {
        get currentUser() { return _user; },
        onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); },
        async signInWithGoogle() {
          const provider = new GoogleAuthProvider();
          try { await signInWithPopup(auth, provider); }
          catch (e) { console.warn("[Firebase] Popup sign-in failed, trying redirect…", e.code || e); await signInWithRedirect(auth, provider); }
        },
        async signOut() { await _signOut(auth); }
      },

      /* --------------- SESSIONS / PROGRESS (per-user) --------------- */
      // ---- Firestore Helpers ----
      async commitSession({ attempts, points, date = todayKey() }) {
        if (!_user) throw new Error("Not signed in");
        const batch = writeBatch(db);

        const attemptsRef = collection(db, attemptsPath());
        const dailyRef    = doc(collection(db, Paths.dailyScoresCol(date)), _user.uid);
        const overallRef  = doc(collection(db, Paths.overallLBCol()), _user.uid);

        // One server timestamp for the batch (for indexing),
        // plus a unique client time for each row (for stable display order).
        const now = serverTimestamp();
        const batchMs = Date.now();

        (attempts || []).forEach((a, i) => {
          const clientAtMs = batchMs + i;
          const payload = {
            uid: _user.uid,
            displayName: _user.displayName || null,
            photoURL: _user.photoURL || null,
            level: a.level || null,
            lesson: a.lesson || null,
            deckId: a.deckId || null,
            mode: a.mode || null,
            right: a.right|0, wrong: a.wrong|0, skipped: a.skipped|0, total: a.total|0,

            // timestamps
            createdAt: now,                 // server time (same for the whole batch)
            clientAtMs,                     // unique client time (millis)
            clientAtISO: new Date(clientAtMs).toISOString()
          };
          const ref = doc(attemptsRef);     // auto-id
          batch.set(ref, payload);
        });

        const delta = Number(points || 0);

        // Leaderboards
        batch.set(dailyRef, {
          uid: _user.uid,
          displayName: _user.displayName || null,
          photoURL: _user.photoURL || null,
          score: increment(delta),
          updatedAt: now,
          date,
        }, { merge: true });

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

      // Attempts — recent list (per current user)
      async getRecentAttempts({ max = 10 } = {}) {
        if (!_user) throw new Error("Not signed in");
        const { collection, query, where, getDocs } = await fsMods();

        // Fetch only your docs; we’ll sort by clientAtMs/createdAt locally.
        const col = collection(db, attemptsPath());
        const snap = await getDocs(query(col, where("uid", "==", _user.uid)));

        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Prefer clientAtMs (stable, unique), else createdAt
        rows.sort((a, b) => {
          const ta = (a.clientAtMs || (a.createdAt?.toMillis?.() || 0));
          const tb = (b.clientAtMs || (b.createdAt?.toMillis?.() || 0));
          return tb - ta;
        });

        return rows.slice(0, max);
      },


      async getWriteBestByDeck({ max = 300 } = {}) {
        if (!_user) throw new Error("Not signed in");
        const q = query(
          collection(db, Paths.userWriteBestCol(_user.uid)),
          orderBy("updatedAt","desc"),
          limit(max)
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      },

      /* --------------- LEADERBOARD (shared) --------------- */
      subscribeTodayLeaderboard(date = todayKey(), cb) {
        return onSnapshot(
          query(collection(db, Paths.dailyScoresCol(date)), orderBy("score", "desc"), limit(100)),
          snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
          err  => console.error("[Leaderboard:today] onSnapshot error", err)
        );
      },
      async getOverallLeaderboard({ max = 100 } = {}) {
        const q = query(collection(db, Paths.overallLBCol()), orderBy("score","desc"), limit(max));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      },

      /* --------------- NOTES (per-user) --------------- */
      notes: {
        async get(key) {
          if (!_user) throw new Error("Not signed in");
          if (_cache.notes.has(key)) return _cache.notes.get(key);
          const ref = doc(db, `${Paths.userNotesCol(_user.uid)}/${safeKey(key)}`);
          const s = await getDoc(ref);
          const val = s.exists() ? s.data().note || "" : "";
          _cache.notes.set(key, val);
          return val;
        },
        async set(key, text) {
          if (!_user) throw new Error("Not signed in");
          const ref = doc(db, `${Paths.userNotesCol(_user.uid)}/${safeKey(key)}`);
          const payload = { note: String(text||""), updatedAt: serverTimestamp() };
          await setDoc(ref, payload, { merge: true });
          _cache.notes.set(key, payload.note);
          return true;
        }
      },
      // compatibility shims used by script.js
      getNoteForKey(key){ return this.notes.get(key); },
      setNoteForKey(key, text){ return this.notes.set(key, text); },

      /* --------------- MARKED WORDS (per-user) --------------- */
      async listMarked() {
        if (!_user) throw new Error("Not signed in");
        if (_cache.marked.size) return Array.from(_cache.marked.values());
        const snap = await getDocs(collection(db, Paths.userMarkedCol(_user.uid)));
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.forEach(r => _cache.marked.set(r.id, r));
        return rows;
      },
      async markWord(id, data) {
        if (!_user) throw new Error("Not signed in");
        const key = safeKey(id);
        const ref = doc(db, `${Paths.userMarkedCol(_user.uid)}/${key}`);
        const payload = {
          kanji: data?.kanji || null,
          hira:  data?.hira  || "",
          en:    data?.en    || "",
          front: data?.front || data?.hira || "",
          back:  data?.back  || data?.en   || "",
          updatedAt: serverTimestamp(),
          createdAt: data?.createdAt || serverTimestamp(),
        };
        await setDoc(ref, payload, { merge: true });
        _cache.marked.set(key, { id: key, ...payload });
        return true;
      },
      async unmarkWord(id) {
        if (!_user) throw new Error("Not signed in");
        const raw = String(id);
        const key1 = raw;                 // maybe already the doc id (safe)
        const key2 = safeKey(raw);        // definitely the doc id if raw was "front::back"

        const path = (key) => doc(db, `${Paths.userMarkedCol(_user.uid)}/${key}`);

        // Firestore delete is idempotent; deleting a non-existent doc is fine.
        try { await deleteDoc(path(key1)); } catch {}
        try { if (key2 !== key1) await deleteDoc(path(key2)); } catch {}

        _cache.marked.delete(key1);
        _cache.marked.delete(key2);
        return true;
      },
 // Return array of lists, including the special "Flash Mark"
  async list() {
    if (!_user) throw new Error("Not signed in");
    const rows = [];

    // 1) Always include the special Flash list (count derived quickly by cache size or a single fetch)
    let flashCount = _cache.marked?.size || 0;
    if (!flashCount) {
      try {
        const snap = await getDocs(collection(db, Paths.userMarkedCol(_user.uid)));
        flashCount = snap.size;
      } catch {}
    }
    rows.push({
      id: "flash",
      name: "Flash Mark",
      privacy: "private",
      count: flashCount,
      _special: true,
    });

    // 2) Real custom lists
    const col = collection(db, `users/${_user.uid}/markedLists`);
    const snap = await getDocs(col);
    snap.forEach(d => {
      const data = d.data() || {};
      rows.push({
        id: d.id,
        name: data.name || "Untitled",
        privacy: data.privacy || "private",
        count: data.count || 0,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    });
    // Sort: Flash first, then recent
    rows.sort((a,b) => (a._special ? -1 : b._special ? 1 : 0));
    return rows;
  },

  async create({ name, privacy = "private" }) {
    if (!_user) throw new Error("Not signed in");
    const ref = doc(collection(db, `users/${_user.uid}/markedLists`)); // auto-id
    const payload = {
      name: String(name || "Untitled"),
      privacy: privacy === "public" ? "public" : "private",
      count: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload);
    return { id: ref.id, ...payload };
  },

  async delete(listId) {
    if (!_user) throw new Error("Not signed in");
    if (listId === "flash") throw new Error("Flash Mark cannot be deleted.");
    const base = `users/${_user.uid}/markedLists/${listId}`;
    // delete subcollection words (batch)
    const wordsCol = collection(db, `${base}/words`);
    const wordsSnap = await getDocs(wordsCol);
    const batch = writeBatch(db);
    wordsSnap.forEach(d => batch.delete(d.ref));
    await batch.commit().catch(()=>{});

    await deleteDoc(doc(db, base)).catch(()=>{});
    return true;
  },

  async words(listId) {
    if (!_user) throw new Error("Not signed in");
    // Flash is proxied to legacy Marked
    if (listId === "flash") {
      const rows = await window.FB.listMarked(); // legacy API
      return rows.map(r => ({
        id: r.id,
        kanji: r.kanji || null,
        hira:  r.hira  || r.front || "",
        en:    r.en    || r.back  || "",
        front: r.front || r.hira  || "",
        back:  r.back  || r.en    || "",
      }));
    }
    const wordsCol = collection(db, `users/${_user.uid}/markedLists/${listId}/words`);
    const snap = await getDocs(wordsCol);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async addWords(listId, words = []) {
    if (!_user) throw new Error("Not signed in");
    // For Flash → just reuse legacy markWord for each (small batches)
    if (listId === "flash") {
      for (const w of words) {
        const front = w.front || w.hira || "";
        const back  = w.back  || w.en   || "";
        if (front && back) {
          await window.FB.markWord(`${front}::${back}`, {
            kanji: w.kanji || null, hira: w.hira || front, en: w.en || back, front, back
          });
        }
      }
      return true;
    }
    // For custom lists → batch write
    const base = `users/${_user.uid}/markedLists/${listId}`;
    const wordsCol = collection(db, `${base}/words`);
    const batch = writeBatch(db);
    let addCount = 0;
    for (const w of words) {
      const front = w.front || w.hira || "";
      const back  = w.back  || w.en   || "";
      if (!front || !back) continue;
      const id = safeKey(`${front}::${back}`);
      const ref = doc(db, `${base}/words/${id}`);
      batch.set(ref, {
        kanji: w.kanji || null,
        hira:  w.hira  || front,
        en:    w.en    || back,
        front, back,
        createdAt: serverTimestamp(),
      }, { merge: true });
      addCount++;
    }
    if (addCount > 0) {
      // Update list count optimistically
      const listRef = doc(db, base);
      batch.set(listRef, { count: increment(addCount), updatedAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    return true;
  },

  async removeWords(listId, ids = []) {
    if (!_user) throw new Error("Not signed in");
    if (!ids.length) return true;
    if (listId === "flash") {
      // ids are safeKeys; remove via legacy unmark
      for (const id of ids) { try { await window.FB.unmarkWord(id); } catch {} }
      return true;
    }
    const base = `users/${_user.uid}/markedLists/${listId}`;
    const batch = writeBatch(db);
    ids.forEach(id => batch.delete(doc(db, `${base}/words/${id}`)));
    // shrink count
    batch.set(doc(db, base), { count: increment(-1 * ids.length), updatedAt: serverTimestamp() }, { merge: true });
    await batch.commit();
    return true;
  },
      /* --------------- SIGN WORDS (per-user) --------------- */
      async signWordAdd({ front, back, romaji=null }) {
        if (!_user) throw new Error("Not signed in");
        const col = collection(db, Paths.userSignCol(_user.uid));
        const markedId = safeKey(`${front}::${back}`);
        const docRef = await addDoc(col, {
          front: String(front||"").trim(),
          back:  String(back||"").trim(),
          romaji: romaji ? String(romaji) : null,
          markedId,
          createdAt: serverTimestamp(),
        });
        const item = { id: docRef.id, front, back, romaji, markedId, createdAt: new Date() };
        _cache.signWords.set(item.id, item);

        // also mark it
        try {
          await this.markWord(`${front}::${back}`, {
            hira: front, en: back, front, back
          });
        } catch {}

        return item;
      },
      async signWordList() {
        if (!_user) throw new Error("Not signed in");
        if (_cache.signWords.size) return Array.from(_cache.signWords.values());
        const q = query(collection(db, Paths.userSignCol(_user.uid)), orderBy("createdAt","desc"));
        const snap = await getDocs(q);
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.forEach(r => _cache.signWords.set(r.id, r));
        return rows;
      },
      async signWordRemove(id) {
        if (!_user) throw new Error("Not signed in");
        const ref = doc(db, `${Paths.userSignCol(_user.uid)}/${id}`);
        const s = await getDoc(ref);
        if (s.exists()) {
          const data = s.data();
          // also unmark corresponding marked word
          const mk = data.markedId || safeKey(`${data.front}::${data.back}`);
          try { await this.unmarkWord(mk); } catch {}
        }
        await deleteDoc(ref);
        _cache.signWords.delete(id);
        return true;
      },

      /* --------------- Low-level helper --------------- */
      async ensureUser() {
        if (!_user) throw new Error("Not signed in");
        await ensureUserDoc(_user);
        return _user;
      },
    };

    async function ensureUserDoc(user) {
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

    // Optional cached daily leaderboard accessor
    try {
      const lbKey = NS(`lb_today_${todayKey()}`);
      window.FB._getCachedTodayLB = () => Local.get(lbKey, null);
      window.FB._setCachedTodayLB = (rows) => Local.set(lbKey, rows);
    } catch {}

    // Keep a handle to Firestore module if needed elsewhere
    async function fsMods() { return fsMod; }
  };
// Back-compat namespace so script.js can call fb.markedLists.*
window.FB.markedLists = {
  list:      (...a) => window.FB.list(...a),
  create:    (...a) => window.FB.create(...a),
  delete:    (...a) => window.FB.delete(...a),
  words:     (...a) => window.FB.words(...a),
  addWords:  (...a) => window.FB.addWords(...a),
  removeWords:(...a) => window.FB.removeWords(...a),
};

  // Boot
  init().catch(err => {
    console.error("[Firebase init] failed:", err);
  });

  /* -------- Local-only Mistakes helper (as requested) -------- */
  // script.js sometimes calls this to build a deck from local mistakes
  window.fbListMistakesAsDeck = async function(){
    try{
      const raw = JSON.parse(localStorage.getItem("lj_mistakes_v1")) || [];
      return raw.map(x => ({ kanji: x.kanji || "—", hira: x.hira || "", en: x.en || "" }))
                .filter(w => w.hira && w.en);
    } catch { return []; }
  };
  // ================= Marked Lists API =================
// Put this AFTER window.FB is created and Firestore/Auth are ready.
(function attachMarkedLists(FB){
  if (!FB || FB.markedLists) return;            // don't double-attach

  const db   = FB.db;
  const auth = FB.auth;

  const FLASH_LIST_ID = "flash";                // used by script.js

  // Same safe key scheme you use in script.js (base64 without '=')
  function safeKey(s){
    try { return btoa(unescape(encodeURIComponent(String(s)))).replace(/=+$/,""); }
    catch { return String(s).toLowerCase().replace(/\W+/g,'_'); }
  }

  // ----- Legacy "Marked" helpers (already exist in your app) -----
  // If your file already defines these, keep them — we just re-use them:
  // FB.listMarked(): Promise<Array<{id, kanji?, hira?, en?, front?, back?}>> 
  // FB.unmarkWord(id): Promise<void>

  // ----- New Lists collection -----
  // users/{uid}/marked_lists/{listId} (doc: {name, privacy, count?, createdAt})
  // users/{uid}/marked_lists/{listId}/words/{wordId} (doc: {kanji?, hira?, en?, front?, back?, createdAt})
  function listsCol(uid){ return collection(db, `users/${uid}/marked_lists`); }
  function listDoc(uid, listId){ return doc(db, `users/${uid}/marked_lists/${listId}`); }
  function wordsCol(uid, listId){ return collection(db, `users/${uid}/marked_lists/${listId}/words`); }
  function wordDoc(uid, listId, wordId){ return doc(db, `users/${uid}/marked_lists/${listId}/words/${wordId}`); }

  async function requireUID(){
    const u = auth.currentUser;
    if (!u) throw new Error("Not signed in");
    return u.uid;
  }

  FB.markedLists = {
    // 1) List all lists (includes the special "Flash Mark")
    async list(){
      const uid = await requireUID();

      // Special: Flash Mark (legacy)
      let flashCount = 0;
      try {
        const rows = await FB.listMarked();     // legacy collection you already have
        flashCount = Array.isArray(rows) ? rows.length : 0;
      } catch {}

      // Custom lists from Firestore
      const qSnap = await getDocs(listsCol(uid));
      const out = [];
      qSnap.forEach(d => {
        const v = d.data() || {};
        out.push({
          id: d.id,
          name: v.name || "Untitled",
          privacy: v.privacy || "private",
          count: Number(v.count || 0),
          _special: false
        });
      });

      // Put Flash first
      out.unshift({
        id: FLASH_LIST_ID,
        name: "Flash Mark",
        privacy: "private",
        count: flashCount,
        _special: true
      });

      return out;
    },

    // 2) Create a new custom list
    async create({ name="Untitled", privacy="private" } = {}){
      const uid = await requireUID();
      const ref = await addDoc(listsCol(uid), {
        name, privacy, count: 0, createdAt: serverTimestamp()
      });
      return { id: ref.id };
    },

    // 3) Delete a custom list (and its words)
    async delete(listId){
      if (listId === FLASH_LIST_ID) throw new Error("Cannot delete Flash Mark");
      const uid = await requireUID();

      // delete all words in subcollection
      const ws = await getDocs(wordsCol(uid, listId));
      const batchDeletes = [];
      ws.forEach(w => batchDeletes.push(deleteDoc(wordDoc(uid, listId, w.id))));
      await Promise.all(batchDeletes);

      await deleteDoc(listDoc(uid, listId));
      return true;
    },

    // 4) Get words in a list
    async words(listId){
      const uid = await requireUID();

      if (listId === FLASH_LIST_ID){
        // Read from your legacy Marked collection
        const legacy = await FB.listMarked();
        // normalize fields
        return (legacy || []).map(r => ({
          id: r.id,
          kanji: r.kanji ?? null,
          hira:  r.hira  ?? (r.front || ""),
          en:    r.en    ?? (r.back  || ""),
          front: r.front ?? r.hira ?? "",
          back:  r.back  ?? r.en   ?? ""
        }));
      }

      const qs = await getDocs(wordsCol(uid, listId));
      const items = [];
      qs.forEach(d=>{
        const v = d.data() || {};
        items.push({
          id: d.id,
          kanji: v.kanji ?? null,
          hira:  v.hira  ?? (v.front || ""),
          en:    v.en    ?? (v.back  || ""),
          front: v.front ?? v.hira ?? "",
          back:  v.back  ?? v.en   ?? ""
        });
      });
      return items;
    },

    // 5) Add words to a list (bulk)
    //    words: Array<{kanji?, hira?, en?, front?, back?}>
    async addWords(listId, words){
      if (!Array.isArray(words) || !words.length) return 0;
      const uid = await requireUID();

      if (listId === FLASH_LIST_ID){
        // We DO NOT add into Flash — Flash is fed by legacy "marked" flow
        // (marking happens from Learn/Write/MCQ via FB.markWord / your existing logic).
        throw new Error("Flash Mark is read-only here. Use 📌 Mark during practice.");
      }

      let added = 0;
      await Promise.all(words.map(async (wRaw)=>{
        const w = wRaw || {};
        const front = w.front ?? w.hira ?? "";
        const back  = w.back  ?? w.en   ?? "";
        const k = w.kanji ?? null;

        if (!front || !back) return;

        const id = safeKey(`${front}::${back}`);
        await setDoc(wordDoc(uid, listId, id), {
          kanji: k, hira: w.hira ?? front, en: w.en ?? back,
          front, back, createdAt: serverTimestamp()
        }, { merge: true });
        added++;
      }));

      // best-effort: update count on the list doc
      try {
        const all = await getDocs(wordsCol(uid, listId));
        await setDoc(listDoc(uid, listId), { count: all.size }, { merge: true });
      } catch {}

      return added;
    },

    // 6) Remove words from a list (bulk)
    //    ids: array of word doc ids (safe keys). For Flash → unmark legacy.
    async removeWords(listId, ids){
      const uid = await requireUID();
      if (!Array.isArray(ids) || !ids.length) return 0;

      if (listId === FLASH_LIST_ID){
        // Legacy unmark
        await Promise.all(ids.map(id => FB.unmarkWord(id)));
        return ids.length;
      }

      await Promise.all(ids.map(id => deleteDoc(wordDoc(uid, listId, id))));

      // best-effort: update count
      try {
        const all = await getDocs(wordsCol(uid, listId));
        await setDoc(listDoc(uid, listId), { count: all.size }, { merge: true });
      } catch {}

      return ids.length;
    }
  };
})(window.FB);

})();
