// firebase.js (ES Module loaded before script.js)
//
// Exposes a single global: window.FB
// - Auth (Google)
// - Firestore helpers (per-user data) + batched writes
// - Offline persistence (best effort)
// - Global daily/overall leaderboards remain shared
//
// NOTE: Set window.FIREBASE_CONFIG in index.html before this file.

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
    wordLists: new Map(), // id  -> data
  };

  const Local = {
    get(k, fallback=null) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k)    { try { localStorage.removeItem(k); } catch {} },
  };

  const NS = (suffix) => `lj_${suffix}`;

  const wordListLocalKey = NS("wordlists_v1");
  let wordListsLoadedFromLocal = false;
  let wordListsLastFetch = 0;

  const WORDLIST_CACHE_WINDOW = 60_000; // 60s throttle between remote fetches

  const normalizeWordEntry = (word) => ({
    kanji: word?.kanji ? String(word.kanji).trim() : "—",
    hira:  word?.hira ? String(word.hira).trim()  : "",
    en:    word?.en ? String(word.en).trim()      : "",
  });

  const wordEntryKey = (word) => {
    const w = normalizeWordEntry(word);
    return `${w.kanji.toLowerCase()}|${w.hira.toLowerCase()}|${w.en.toLowerCase()}`;
  };

  function hydrateWordListsFromLocal(){
    if (wordListsLoadedFromLocal) return;
    wordListsLoadedFromLocal = true;
    const cached = Local.get(wordListLocalKey, null);
    if (!cached?.lists?.length) return;
    try {
      cached.lists.forEach(wl => {
        const words = Array.isArray(wl.words) ? wl.words.map(normalizeWordEntry) : [];
        _cache.wordLists.set(wl.id, {
          id: wl.id,
          name: wl.name || "Untitled List",
          words,
          wordCount: Number.isFinite(wl.wordCount) ? wl.wordCount : words.length,
          createdAt: wl.createdAt || null,
          updatedAt: wl.updatedAt || null,
        });
      });
    } catch {}
  }

  function persistWordListsToLocal(){
    try {
      const lists = Array.from(_cache.wordLists.values()).map(wl => ({
        id: wl.id,
        name: wl.name,
        words: (wl.words || []).map(normalizeWordEntry),
        wordCount: Number.isFinite(wl.wordCount) ? wl.wordCount : (wl.words || []).length,
        createdAt: wl.createdAt || null,
        updatedAt: wl.updatedAt || null,
      }));
      Local.set(wordListLocalKey, { lists, ts: Date.now() });
    } catch {}
  }

  function wordListFromDoc(snap){
    const data = snap.data() || {};
    const words = Array.isArray(data.words) ? data.words.map(normalizeWordEntry) : [];
    return {
      id: snap.id,
      name: data.name || "Untitled List",
      words,
      wordCount: Number.isFinite(data.wordCount) ? data.wordCount : words.length,
      createdAt: data.createdAt?.toMillis?.() || null,
      updatedAt: data.updatedAt?.toMillis?.() || null,
      localOnly: false,
    };
  }

  function cloneWordList(list){
    return {
      id: list.id,
      name: list.name,
      words: (list.words || []).map(normalizeWordEntry),
      wordCount: Number.isFinite(list.wordCount) ? list.wordCount : (list.words || []).length,
      createdAt: list.createdAt || null,
      updatedAt: list.updatedAt || null,
    };
  }

  function sortWordListCache(){
    const pairs = Array.from(_cache.wordLists.entries());
    pairs.sort((a, b) => {
      const ta = (a[1]?.updatedAt ?? a[1]?.createdAt ?? 0);
      const tb = (b[1]?.updatedAt ?? b[1]?.createdAt ?? 0);
      return tb - ta; // newest first
    });
    _cache.wordLists = new Map(pairs);
  }

  const Paths = {
    users: (uid) => `users/${uid}`,
    userMarkedCol:   (uid) => `users/${uid}/marked`,
    userNotesCol:    (uid) => `users/${uid}/notes`,
    userSignCol:     (uid) => `users/${uid}/signwords`,
    userAttemptsCol: (uid) => `users/${uid}/attempts`,
    userWriteBestCol:(uid) => `users/${uid}/writeBest`,
    userWordListsCol:(uid) => `users/${uid}/wordLists`,
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

      /* --------------- WORD LISTS (per-user) --------------- */
      wordLists: {
        async list({ force = false } = {}) {
          if (!_user) throw new Error("Not signed in");
          hydrateWordListsFromLocal();
          const now = Date.now();
          if (!force && _cache.wordLists.size && (now - wordListsLastFetch) < WORDLIST_CACHE_WINDOW) {
            return Array.from(_cache.wordLists.values()).map(cloneWordList);
          }
          const snap = await getDocs(collection(db, Paths.userWordListsCol(_user.uid)));
          snap.docs.forEach(docSnap => {
            const wl = wordListFromDoc(docSnap);
            _cache.wordLists.set(wl.id, wl);
          });
          sortWordListCache();
          wordListsLastFetch = Date.now();
          persistWordListsToLocal();
          return Array.from(_cache.wordLists.values()).map(cloneWordList);
        },
        async ensure(id) {
          if (!_user) throw new Error("Not signed in");
          if (!id) throw new Error("Missing list id");
          if (_cache.wordLists.has(id)) return _cache.wordLists.get(id);
          hydrateWordListsFromLocal();
          if (_cache.wordLists.has(id)) return _cache.wordLists.get(id);
          const ref = doc(db, `${Paths.userWordListsCol(_user.uid)}/${id}`);
          const snap = await getDoc(ref);
          if (!snap.exists()) throw new Error("Word list not found");
          const wl = wordListFromDoc(snap);
          _cache.wordLists.set(id, wl);
          sortWordListCache();
          persistWordListsToLocal();
          return wl;
        },
        async create({ name } = {}) {
          if (!_user) throw new Error("Not signed in");
          hydrateWordListsFromLocal();
          const nm = String(name || "New List").trim() || "New List";
          const safeName = nm.slice(0, 80);
          const col = collection(db, Paths.userWordListsCol(_user.uid));
          const stamp = serverTimestamp();
          const payload = {
            name: safeName,
            words: [],
            wordCount: 0,
            createdAt: stamp,
            updatedAt: stamp,
          };
          const docRef = await addDoc(col, payload);
          const now = Date.now();
          const list = { id: docRef.id, name: safeName, words: [], wordCount: 0, createdAt: now, updatedAt: now };
          _cache.wordLists.set(list.id, list);
          sortWordListCache();
          wordListsLastFetch = now;
          persistWordListsToLocal();
          return cloneWordList(list);
        },
        async rename(id, name) {
          if (!_user) throw new Error("Not signed in");
          const nm = String(name || "Untitled List").trim() || "Untitled List";
          const safeName = nm.slice(0, 80);
          const ref = doc(db, `${Paths.userWordListsCol(_user.uid)}/${id}`);
          await setDoc(ref, { name: safeName, updatedAt: serverTimestamp() }, { merge: true });
          const list = _cache.wordLists.get(id);
          const now = Date.now();
          if (list) {
            list.name = safeName;
            list.updatedAt = now;
            _cache.wordLists.set(id, list);
            sortWordListCache();
            wordListsLastFetch = now;
            persistWordListsToLocal();
            return cloneWordList(list);
          }
          sortWordListCache();
          wordListsLastFetch = now;
          return { id, name: safeName };
        },
        async updateWords(id, { add = [], remove = [] } = {}) {
          if (!_user) throw new Error("Not signed in");
          const list = await this.ensure(id);
          const map = new Map();
          (list.words || []).forEach(word => map.set(wordEntryKey(word), normalizeWordEntry(word)));
          add.forEach(word => {
            const normalized = normalizeWordEntry(word);
            if (!normalized.hira && !normalized.en) return;
            map.set(wordEntryKey(normalized), normalized);
          });
          remove.forEach(item => {
            const key = typeof item === "string" ? item : wordEntryKey(item);
            map.delete(key);
          });
          const words = Array.from(map.values()).sort((a, b) => String(a.hira || "").localeCompare(String(b.hira || ""), "ja"));
          const ref = doc(db, `${Paths.userWordListsCol(_user.uid)}/${id}`);
          await setDoc(ref, {
            words,
            wordCount: words.length,
            updatedAt: serverTimestamp(),
          }, { merge: true });
          list.words = words;
          list.wordCount = words.length;
          list.updatedAt = Date.now();
          _cache.wordLists.set(id, list);
          sortWordListCache();
          wordListsLastFetch = Date.now();
          persistWordListsToLocal();
          return cloneWordList(list);
        },
        async clear(id) {
          if (!_user) throw new Error("Not signed in");
          const ref = doc(db, `${Paths.userWordListsCol(_user.uid)}/${id}`);
          await setDoc(ref, { words: [], wordCount: 0, updatedAt: serverTimestamp() }, { merge: true });
          const list = _cache.wordLists.get(id);
          if (list) {
            list.words = [];
            list.wordCount = 0;
            list.updatedAt = Date.now();
            _cache.wordLists.set(id, list);
            sortWordListCache();
            wordListsLastFetch = Date.now();
            persistWordListsToLocal();
            return cloneWordList(list);
          }
          sortWordListCache();
          wordListsLastFetch = Date.now();
          return true;
        },
        async delete(id) {
          if (!_user) throw new Error("Not signed in");
          const ref = doc(db, `${Paths.userWordListsCol(_user.uid)}/${id}`);
          await deleteDoc(ref);
          _cache.wordLists.delete(id);
          sortWordListCache();
          wordListsLastFetch = Date.now();
          persistWordListsToLocal();
          return true;
        }
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
})();
