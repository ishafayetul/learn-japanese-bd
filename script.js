// script.js — decks loader + quiz UI + grammar practice + progress UI
// NOTE: All Firebase access is delegated to firebase.js helpers on window.*
// This file contains NO direct Firebase imports.

// ---------------- State ----------------
let allDecks = {};                // { deckName: [{front, back, romaji}] }
let currentDeck = [];
let currentDeckName = "";
let currentIndex = 0;
let mode = "jp-en";
let score = { correct: 0, wrong: 0, skipped: 0 };

let mistakes = JSON.parse(localStorage.getItem("mistakes") || "[]");
let masteryMap = JSON.parse(localStorage.getItem("masteryMap") || "{}");
// --- Mixed Vocab selection state ---
let multiSelectedDecks = new Set(); // deck names chosen for mixing

// ---- Audio (Learn Mode) ----
const AUDIO_BASE = "audio";            // no leading slash (keeps it relative on GitHub Pages)
let audioManifest = [];                // ["Vocab-Lesson-01", ..., "kanji"]
let audioFolders = new Set();          // quick lookup
let currentAudioFolder = null;         // resolved per selected deck
let audioManifestLoaded = false;

// Session buffer (temporary storage; committed on demand/auto via firebase.js)
let sessionBuf = JSON.parse(localStorage.getItem("sessionBuf") || "null") || {
  deckName: "",
  mode: "jp-en",      // 'jp-en' | 'en-jp' | 'grammar'
  correct: 0,
  wrong: 0,
  skipped: 0,
  total: 0,
  jpEnCorrect: 0,
  enJpCorrect: 0,
  grammarCorrect: 0   // NEW: counted for grammar typing
};

let currentSectionId = "deck-select";
let committing = false;

// ---- Make Sentence (free-form, AI-checked) ----
const makeState = {
  round: 0,
  totalRounds: 0,
  group: [],       // array of vocab items (1–3 words)
  answered: false
};
let makeKeyHandler = null;

// Practice Grammar state
const pgState = {
  files: [],          // ['lesson-01.csv', ...]
  setName: "",        // active set file name (no path)
  items: [],          // [{q, a}, ...]
  order: [],          // shuffled indices
  i: 0,               // pointer into order
  correct: 0,
  wrong: 0,
  answered: false     // prevent resubmission until Next
};
let pgKeyHandler = null;

// ---- Write Words (EN -> JP typing) ----
const writeState = {
  order: [],   // indices into currentDeck
  i: 0,        // pointer
  answered: false
};
let writeKeyHandler = null;

// --- Learn Notes state ---
let notesCache = {};         // { [deckName]: { [wordKey]: note } }
let learnNoteTimer = null;   // debounce timer for autosave
let learnNoteLastKey = null; // currently-bound key for textarea

// script.js (global state additions)
let markedWordsList = [];       // Array of marked word objects ({front, back, romaji})
let markedMap = {};             // Lookup map for quick check of marked words (keys are "front|back")

// ---------------- DOM helpers ----------------
// ===== AI Grammar Review (serverless endpoint) =====
const AI_REVIEW_ENDPOINT = '/api/grammar-review';  // change if you host elsewhere

async function reviewWithAI({ question, user, correct, level = 'JLPT N5' }) {
  const res = await fetch(AI_REVIEW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, userAnswer: user, correctAnswer: correct, level })
  });
  if (!res.ok) throw new Error(`AI review HTTP ${res.status}`);
  // { is_correct:boolean, verdict:string, better:string, issues:string[], score:number(0..1) }
  return await res.json();
}

// tiny fallback (only if you don't already have it)
function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }

function renderMistakesUI() {
  const statusEl = document.getElementById("mistakes-status");
  const modeSel = document.getElementById("mistakes-mode-select");
  const n = Array.isArray(mistakes) ? mistakes.length : 0;

  if (statusEl) {
    statusEl.textContent = n > 0
      ? `You have ${n} mistake word${n === 1 ? "" : "s"}.`
      : "No mistakes yet.";
  }
  if (modeSel) {
    modeSel.classList.toggle("hidden", n === 0);
  }
}

const $ = (id) => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.innerText = txt; };
function statusLine(id, msg) {
  const s = $(id);
  if (s) s.textContent = msg;
  console.log(`[status:${id}]`, msg);
}
function persistSession() {
  localStorage.setItem("sessionBuf", JSON.stringify(sessionBuf));
}
// ---- Audio core: try deck MP3 first, fallback to ja-JP TTS
function ensureAudioElement() {
  let a = document.getElementById('__shared-audio');
  if (!a) {
    a = document.createElement('audio');
    a.id = '__shared-audio';
    a.preload = 'none';
    document.body.appendChild(a);
  }
  return a;
}
function pad2(n){ return String(n).padStart(2, '0'); }

function ttsSpeak(text) {
  if (!('speechSynthesis' in window)) { console.warn('No speechSynthesis'); return; }
  if (!ttsSpeak._voice) {
    const voices = speechSynthesis.getVoices() || [];
    ttsSpeak._voice =
      voices.find(v => (v.lang || '').toLowerCase().startsWith('ja')) ||
      voices.find(v => /japanese/i.test(v.name)) || null;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 0.5;
  if (ttsSpeak._voice) u.voice = ttsSpeak._voice;
  if (!ttsSpeak._voice && (speechSynthesis.getVoices() || []).length === 0) {
    speechSynthesis.onvoiceschanged = () => { ttsSpeak(text); speechSynthesis.onvoiceschanged = null; };
    return;
  }
  speechSynthesis.speak(u);
}

/**
 * Play audio for a given deck index.
 * - If the per-deck MP3 exists (AUDIO_BASE/currentAudioFolder/NN_【front】.mp3), play it.
 * - Else speak `front` with ja-JP TTS.
 */
function playWordAudioByIndex(deckIndex) {
  const word = currentDeck[deckIndex];
  if (!word) return;
  
  const canUseFiles = !!(audioManifestLoaded && currentAudioFolder);
  if (canUseFiles) {
    const nn = pad2(deckIndex + 1); // 1-based index
    const fileName = `${nn}_${word.front}.mp3`;
    const url = `${AUDIO_BASE}/${currentAudioFolder}/${fileName}`;
    const audio = ensureAudioElement();
    let triedFile = false;
    audio.oncanplay = () => { triedFile = true; try { audio.play(); } catch {} };
    audio.onerror   = () => { if (!triedFile) ttsSpeak(word.front); };
    audio.src = url;
    audio.load();
    return;
  }
  // Fallback: TTS
  ttsSpeak(word.front);
}

async function loadAudioManifest() {
  try {
    const res = await fetch(`${AUDIO_BASE}/manifest.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    audioManifest = await res.json();
    audioFolders = new Set(audioManifest);
    audioManifestLoaded = true;
    console.log("[audio] manifest loaded:", audioManifest);
  } catch (e) {
    audioManifestLoaded = false;
    console.warn("[audio] manifest failed to load → audio disabled:", e?.message || e);
  }
}

function percent(n, d) {
  if (!d) return 0;
  return Math.floor((n / d) * 100);
}

// ---------------- Deck progress UI ----------------
function updateDeckProgress() {
  const totalQs = currentDeck.length || 0;
  const done = Math.min(currentIndex, totalQs);
  const p = percent(done, totalQs);
  const bar = $("deck-progress-bar");
  const txt = $("deck-progress-text");
  if (bar) bar.style.width = `${p}%`;
  if (txt) txt.textContent = `${done} / ${totalQs} (${p}%)`;
}
function pgSkip() {
  // count as skipped for the session (no correct/wrong)
  sessionBuf.skipped++;
  sessionBuf.total++;
  persistSession();
  updateScore();
  pgNext();
}
window.pgSkip = pgSkip;

// ---------------- Autosave bridge ----------------
async function autoCommitIfNeeded(reason = "") {
  if (!window.__fb_commitSession) return;
  if (committing) return;
  if (!sessionBuf || sessionBuf.total <= 0) return;

  try {
    committing = true;
    console.log("[autosave] committing buffered session", { reason, sessionBuf });
    const payload = {
      deckName: sessionBuf.deckName || 'Unknown Deck',
      mode: sessionBuf.mode,
      correct: sessionBuf.correct,
      wrong: sessionBuf.wrong,
      skipped: sessionBuf.skipped,
      total: sessionBuf.total,
      jpEnCorrect: sessionBuf.jpEnCorrect,
      enJpCorrect: sessionBuf.enJpCorrect,
      grammarCorrect: sessionBuf.grammarCorrect || 0
    };
    await window.__fb_commitSession(payload);

    sessionBuf.correct = 0;
    sessionBuf.wrong = 0;
    sessionBuf.skipped = 0;
    sessionBuf.total = 0;
    sessionBuf.jpEnCorrect = 0;
    sessionBuf.enJpCorrect = 0;
    sessionBuf.grammarCorrect = 0;
    persistSession();

    await renderProgress();
    console.log("[autosave] saved ✔");
  } catch (e) {
    console.warn("[autosave] failed → keeping local buffer:", e?.message || e);
  } finally {
    committing = false;
  }
}

// ---------------- App lifecycle ----------------
window.onload = () => {
  loadAudioManifest();
  loadDeckManifest();
  loadGrammarManifest();      // PDF lessons list
  loadGrammarPracticeManifest(); // Practice grammar sets
  renderProgress();
  updateScore();
  renderMistakesUI();
};

// script.js (__initAfterLogin update)
window.__initAfterLogin = async () => {
  renderProgress();
  // Fetch and cache the user's marked words from Firebase
  if (window.__fb_fetchMarkedWords) {
    const words = await window.__fb_fetchMarkedWords();
    markedWordsList = words;
    markedMap = {};
    for (const w of words) {
      const key = w.front + "|" + w.back;
      markedMap[key] = true;
    }
    renderMarkedList();  // populate the Marked Words section UI with the list
    renderMistakesUI();
  }
};


window.addEventListener('pagehide', () => {
  try {
    if (sessionBuf.total > 0) {
      localStorage.setItem('pendingSession', JSON.stringify(sessionBuf));
    }
  } catch {}
});
window.addEventListener('beforeunload', () => {
  try {
    if (sessionBuf.total > 0) {
      localStorage.setItem('pendingSession', JSON.stringify(sessionBuf));
    }
  } catch {}
});

// ---------------- Section Router ----------------
function showSection(id) {
  if (currentSectionId === "practice" && id !== "practice") {
    autoCommitIfNeeded("leaving vocab practice");
  }
  if (currentSectionId === "practice-grammar" && id !== "practice-grammar") {
    autoCommitIfNeeded("leaving grammar practice");
    const filesBox = $("pg-file-buttons");
    if (filesBox) filesBox.classList.remove('hidden');
    const area = $("pg-area");
    if (area) area.classList.add('hidden');

    if (pgKeyHandler) {
      document.removeEventListener('keydown', pgKeyHandler);
      pgKeyHandler = null;
    }
  }
  if (currentSectionId === "make" && id !== "make") {
    autoCommitIfNeeded("leaving make-sentence");
    if (makeKeyHandler) {
      document.removeEventListener('keydown', makeKeyHandler);
      makeKeyHandler = null;
    }
  }
  // NEW: leaving Write Words => autosave + unbind keys
  if (currentSectionId === "write" && id !== "write") {
    autoCommitIfNeeded("leaving write words");
    if (writeKeyHandler) {
      document.removeEventListener('keydown', writeKeyHandler);
      writeKeyHandler = null;
    }
  }

  document.querySelectorAll('.main-content main > section').forEach(sec => {
    sec.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
  else console.warn('showSection: no element with id:', id);

  currentSectionId = id;
  if (id === "mistakes-section") {
    renderMistakesUI(); // NEW
  }
  if (id === "practice") updateDeckProgress();
  if (id === "practice-grammar") {
    pgUpdateProgress();
    if (!pgKeyHandler) {
      pgKeyHandler = (e) => {
        if (currentSectionId !== "practice-grammar") return;
        const input = $("pg-input");
        const disabled = !input || input.disabled;

        // Ctrl/Cmd + Enter -> Next
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          pgNext();
          return;
        }
        // Esc -> Skip
        if (e.key === "Escape") {
          e.preventDefault();
          pgSkip();
          return;
        }
        // Enter -> Submit (only if input enabled)
        if (e.key === "Enter" && !disabled) {
          e.preventDefault();
          pgSubmit();
          return;
        }
      };
      document.addEventListener("keydown", pgKeyHandler);
    }
  }
  if (id === "write") {
    writeUpdateProgress();
    // NEW: (re)bind keyboard shortcuts when entering write
    if (!writeKeyHandler) {
      writeKeyHandler = (e) => {
        if (currentSectionId !== 'write') return;
        const input = $("write-input");
        const disabled = !input || input.disabled;
        // Ctrl+Enter => Next
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          writeNext();
          return;
        }
        // Esc => Skip
        if (e.key === 'Escape') {
          e.preventDefault();
          writeSkip();
          return;
        }
        // Enter => Submit (only if input enabled)
        if (e.key === 'Enter' && !disabled) {
          e.preventDefault();
          writeSubmit();
          return;
        }
      };
      document.addEventListener('keydown', writeKeyHandler);
    }
  }

  if (id === "make") {
    makeUpdateProgress();
    if (!makeKeyHandler) {
      makeKeyHandler = (e) => {
        if (currentSectionId !== "make") return;
        const input = $("make-input");
        const disabled = !input || input.disabled;

        // Ctrl/Cmd + Enter → Next
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault(); makeNext(); return;
        }
        // Esc → Skip
        if (e.key === "Escape") {
          e.preventDefault(); makeSkip(); return;
        }
        // Enter → Submit (only if input enabled)
        if (e.key === "Enter" && !disabled) {
          e.preventDefault(); makeSubmit(); return;
        }
      };
      document.addEventListener("keydown", makeKeyHandler);
    }
  }
}

window.showSection = showSection;

// ---------------- DECKS (Vocab) ----------------
// Vocab decks (単語デッキ)

async function loadDeckManifest() {
  try {
    statusLine("deck-status", "Loading decks…");
    const res  = await fetch("load_vocab_decks/deck_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status} for load_vocab_decks/deck_manifest.json`);
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("Manifest returned HTML (check folder name/case).");

    /** @type {string[]} */
    const deckList = JSON.parse(text);
    deckList.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    allDecks = {};
    for (const file of deckList) {
      const name = file.replace(/\.csv$/i, "");
      const url = `load_vocab_decks/${file}`;
      statusLine("deck-status", `Loading ${file}…`);
      const rows = await fetchAndParseCSV(url);
      console.debug(`[deck] ${file}: ${rows.length} rows`);
      allDecks[name] = rows;
    }

    renderDeckButtons?.();
    renderDeckMultiSelect?.();
    statusLine("deck-status", `Loaded ${Object.keys(allDecks).length} deck(s).`);
  } catch (err) {
    console.error("Failed to load decks:", err);
    statusLine("deck-status", `Failed to load decks: ${err.message}`);
  }
}


let writeType = 'en->hira';

function startWriteWords(type = 'en->hira') {
  writeType = type; // 'en->hira' | 'kanji->hira'
  if (!currentDeck.length) return alert("Pick a deck first.");
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  sessionBuf = {
    deckName: currentDeckName, mode: 'write',
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0,
    writeEnHiraCorrect: 0, writeKanjiHiraCorrect: 0
  };
  persistSession();
  showSection("write");
  renderWriteCard();
  updateDeckProgress();
}
window.startWriteWords = startWriteWords;

function normalizeKana(s) {
  if (!s) return "";
  // trim + collapse spaces
  s = s.replace(/\s+/g,'').trim();
  // normalize prolonged sound mark and small kana equivalences loosely
  // (keep it simple; IME will produce correct hiragana in practice)
  return s;
}

function writeExpected(w) {
  return (w.hiragana || "").trim();
}

function writePrompt(w) {
  if (writeType === 'en->hira') return w.meaning || w.back || "";
  return w.kanji || w.front || "";
}

function renderWriteCard() {
  const w = currentDeck[currentIndex];
  if (!w) return;
  const card = $("write-card");
  card.innerHTML = `
    <div class="learn-word">${writePrompt(w)}</div>
    <div class="muted">${writeType==='en->hira' ? "Type the HIRAGANA" : "Type the HIRAGANA reading"}</div>
  `;
  setValue("write-input", "");
  setText("write-feedback", "");
}

function writeSubmit() {
  const w = currentDeck[currentIndex];
  if (!w) return;
  const user = normalizeKana(getValue("write-input"));
  const ans  = normalizeKana(writeExpected(w));

  const ok = (user === ans);
  if (ok) {
    score.correct++; sessionBuf.correct++; sessionBuf.total++;
    if (writeType === 'en->hira') sessionBuf.writeEnHiraCorrect++;
    else sessionBuf.writeKanjiHiraCorrect++;
    setText("write-feedback", "✅ Correct!");
  } else {
    score.wrong++; sessionBuf.wrong++; sessionBuf.total++;
    setText("write-feedback", `❌ ${user || "(blank)"} → ${ans}`);
  }
  persistSession();
  updateScore();
}

function writeSkip() {
  score.skipped++; sessionBuf.skipped++; sessionBuf.total++;
  persistSession(); updateScore(); writeNext();
}
function writeNext() {
  currentIndex = Math.min(currentIndex + 1, currentDeck.length - 1);
  renderWriteCard(); updateDeckProgress();
}
function writeShowDetails() {
  const w = currentDeck[currentIndex]; if (!w) return;
  const out = `
    <p><b>Kanji:</b> ${w.kanji || "(n/a)"}</p>
    <p><b>Hiragana:</b> ${w.hiragana || "(n/a)"}</p>
    <p><b>Meaning:</b> ${w.meaning || w.back || "(n/a)"}</p>
    ${w.romaji ? `<p><b>Romaji:</b> ${w.romaji}</p>` : ""}
  `;
  setHtml("write-feedback", out);
}


function parseCSV(text){
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (inQuotes){
      if (ch === '"'){
        if (text[i+1] === '"'){ cur += '"'; i++; }
        else { inQuotes = false; }
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ','){ row.push(cur.trim()); cur = ''; }
      else if (ch === '\n'){ row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r'){ /* ignore */ }
      else cur += ch;
    }
  }
  if (cur.length || inQuotes || row.length){ row.push(cur.trim()); rows.push(row); }
  return rows.filter(r => r.some(c => c && c.length));
}



async function fetchAndParseCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = (await res.text()).replace(/^\uFEFF/, "");
  const table = parseCSV(text);

  const toKey = s => String(s || "").toLowerCase().trim();

  const hasHeader = (row) => {
    if (!row || row.length === 0) return false;
    const h = row.map(toKey);
    const set = new Set(h);
    return (
      set.has("kanji") || set.has("hiragana") || set.has("english") ||
      set.has("english_meaning") || set.has("meaning") ||
      set.has("romaji") || set.has("front") || set.has("back") ||
      set.has("word") || set.has("question") || set.has("answer")
    );
  };

  const isKana  = (s) => /[ぁ-んァ-ンー]/.test(s || "");
  const isKanji = (s) => /[一-龠々]/.test(s || "");
  const isAscii = (s) => !!s && /^[\x00-\x7F]+$/.test(s);

  const mapByHeader = (hdr, cols) => {
    const keyIdx = (keys) => {
      const i = hdr.findIndex(h => keys.some(k => k.test(h)));
      return i >= 0 ? i : -1;
    };
    const idxKanji = keyIdx([/kanji|漢字/]);
    const idxHira  = keyIdx([/hiragana|ひらがな|reading|yomi/]);
    const idxEng   = keyIdx([/english|meaning|english_meaning|gloss/]);
    const idxRoma  = keyIdx([/romaji|roumaji|roma/]);
    const idxFront = keyIdx([/front|word|question/]);
    const idxBack  = keyIdx([/back|answer/]);

    const col = (i) => (i >= 0 && cols[i]) ? String(cols[i]).trim() : "";

    let kanji   = col(idxKanji);
    let hira    = col(idxHira);
    let meaning = col(idxEng);
    let romaji  = col(idxRoma);

    // legacy front/back mapping
    if (!kanji && !hira && (idxFront >= 0)) {
      const f = col(idxFront);
      if (isKanji(f)) kanji = f;
      else if (isKana(f)) hira = f;
    }
    if (!meaning && (idxBack >= 0)) meaning = col(idxBack);

    const front = hira || kanji || col(idxFront) || "";
    const back  = meaning || col(idxBack) || "";

    return { kanji, hiragana: hira, meaning, romaji, front, back };
  };

  const rowsOnly = (table.length && hasHeader(table[0])) ? table.slice(1) : table;
  const header   = (table.length && hasHeader(table[0])) ? table[0].map(toKey) : null;

  const out = rowsOnly.map((cols) => {
    if (header) return mapByHeader(header, cols);

    // Heuristics for no-header CSV
    const a = String(cols[0] || "").trim();
    const b = String(cols[1] || "").trim();
    const c = String(cols[2] || "").trim();
    const cand = [a, b, c].filter(Boolean);

    let kanji = "", hira = "", meaning = "", romaji = "";

    for (const v of cand) {
      if (!hira && isKana(v) && !isKanji(v)) { hira = v; continue; }
      if (!kanji && isKanji(v)) { kanji = v; continue; }
    }
    for (const v of cand) {
      if (!meaning && v !== kanji && v !== hira && isAscii(v)) { meaning = v; continue; }
    }
    for (const v of cand) {
      if (v !== kanji && v !== hira && v !== meaning && isAscii(v)) { romaji = v; }
    }

    const front = hira || kanji || a || "";
    const back  = meaning || ""; // allow kana/kanji-only rows
    return { kanji, hiragana: hira, meaning, romaji, front, back };
  })
  .filter(r => !!(r.front || r.hiragana || r.kanji)); // keep useful rows

  console.debug(`[deck] ${url} → ${out.length} rows`);
  return out;
}


function renderDeckButtons() {
  const container = $("deck-buttons");
  if (!container) return;
  container.innerHTML = "";

  Object.keys(allDecks).forEach((name) => {
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.onclick = async () => {
      if (sessionBuf.total > 0 && sessionBuf.deckName && sessionBuf.deckName !== name) {
        await autoCommitIfNeeded("switching decks");
      }
      selectDeck(name);
    };
    container.appendChild(btn);
  });
}

function selectDeck(name) {
  currentDeck = allDecks[name] || [];
  currentDeckName = name;
  currentIndex = 0;
  if (currentDeck.length === 0) {
    alert(`Deck "${name}" is empty or failed to load.`);
    return;
  }

  // Resolve audio folder from deck name
  currentAudioFolder = resolveAudioFolder(name);
  if (audioManifestLoaded && currentAudioFolder && !audioFolders.has(currentAudioFolder)) {
    // Folder not present in manifest → disable audio for this deck
    currentAudioFolder = null;
  }

  sessionBuf = {
    deckName: name,
    mode: "jp-en",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0,
    grammarCorrect: 0
  };
  persistSession();
  showSection("mode-select");
}

// Map "Lesson-01" → "Vocab-Lesson-01"; "kanji" → "kanji"; otherwise pass through.
function resolveAudioFolder(deckName) {
  // e.g., "Lesson-01"
  const m = /^Lesson-(\d{2})$/i.exec(deckName);
  if (m) return `Vocab-Lesson-${m[1]}`;
  // special case
  if (/^kanji$/i.test(deckName)) return "kanji";
  // fallback: exact same name (in case future decks match manifest directly)
  return deckName;
}


// ---------------- PRACTICE (Vocab MCQ) ----------------
function startPractice(selectedMode) {
  mode = selectedMode; // 'jp-en','en-jp','kanji-hira','hira-kanji','hira&mean-kanji','k2hm'
  if (!currentDeck.length) return alert("Pick a deck first.");

  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };

  // reset (and expand) session counters
  sessionBuf = {
    deckName: currentDeckName,
    mode,
    correct: 0, wrong: 0, skipped: 0, total: 0,
    // legacy counters kept for LB compatibility; new ones added below
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0,
    hiraEnCorrect: 0, enHiraCorrect: 0, kanjiHiraCorrect: 0, hiraKanjiCorrect: 0,
    hiraMeanKanjiCorrect: 0, k2hmCorrect: 0
  };
  persistSession();

  showSection("practice");
  showQuestion();
}

function fieldPlanForMode(m) {
  switch (m) {
    case 'jp-en':        return { prompt: 'jp',  answer: 'en' }; // legacy: jp=hiragana|kanji, en=meaning
    case 'en-jp':        return { prompt: 'en',  answer: 'jp' };
    case 'kanji-hira':   return { prompt: 'kanji', answer: 'hiragana' };
    case 'hira-kanji':   return { prompt: 'hiragana', answer: 'kanji' };
    case 'hira&mean-kanji': return { prompt: ['hiragana','meaning'], answer: 'kanji' };
    case 'k2hm':         return { prompt: 'kanji', answer: ['hiragana','meaning'] }; // dual
    default:             return { prompt: 'jp',  answer: 'en' };
  }
}

function getField(w, key) {
  if (key === 'jp') return w.hiragana || w.kanji || w.front;
  if (key === 'en') return w.meaning || w.back;
  return w[key] || '';
}

let dualPick = { hira: null, mean: null };

function showQuestion() {
  const q = currentDeck[currentIndex];
  if (!q) return;

  const plan = fieldPlanForMode(mode);

  // prompt
  const promptText = Array.isArray(plan.prompt)
      ? plan.prompt.map(k => getField(q, k)).join("　/　")
      : getField(q, plan.prompt);

  // build options
  const optsWrap = $("options-wrap");
  const ulSingle = $("options");
  const dualWrap = $("dual-options");
  const ulHira   = $("options-hira");
  const ulMean   = $("options-mean");

  // reset selections
  dualPick = { hira: null, mean: null };

  setText("question-box", promptText); // your flashcard/question element id
  // Single-answer modes
  if (!Array.isArray(plan.answer)) {
    const answer = getField(q, plan.answer);
    const distractors = makeDistractors(plan.answer, answer, 2, currentDeck);
    const all = shuffleArray([answer, ...distractors]);
    // show single
    ulSingle.innerHTML = "";
    all.forEach(opt => {
      const li = document.createElement("li");
      li.textContent = opt;
      li.onclick = () => checkAnswerSingle(opt, answer, q);
      ulSingle.appendChild(li);
    });
    ulSingle.classList.remove("hidden");
    dualWrap.classList.add("hidden");
  } else {
    // Dual-answer: {hiragana, meaning}
    const ansH = getField(q, 'hiragana');
    const ansM = getField(q, 'meaning') || getField(q, 'en');

    const hiraDistr = makeDistractors('hiragana', ansH, 2, currentDeck);
    const meanDistr = makeDistractors('meaning',  ansM, 2, currentDeck);

    const hiraAll = shuffleArray([ansH, ...hiraDistr]);
    const meanAll = shuffleArray([ansM, ...meanDistr]);

    // render dual lists
    ulHira.innerHTML = "";
    hiraAll.forEach(opt => {
      const li = document.createElement("li");
      li.textContent = opt;
      li.onclick = () => {
        dualPick.hira = opt;
        ulHira.querySelectorAll("li").forEach(x => x.classList.toggle("selected", x === li));
        tryGradeDual(q, ansH, ansM);
      };
      ulHira.appendChild(li);
    });

    ulMean.innerHTML = "";
    meanAll.forEach(opt => {
      const li = document.createElement("li");
      li.textContent = opt;
      li.onclick = () => {
        dualPick.mean = opt;
        ulMean.querySelectorAll("li").forEach(x => x.classList.toggle("selected", x === li));
        tryGradeDual(q, ansH, ansM);
      };
      ulMean.appendChild(li);
    });

    ulSingle.classList.add("hidden");
    dualWrap.classList.remove("hidden");
  }

  updateDeckProgress();
}

function makeDistractors(fieldKey, correct, need, pool) {
  const seen = new Set([String(correct)]);
  const arr = [];
  // sample from same deck, same field
  const candidates = shuffleArray(pool.slice());
  for (const w of candidates) {
    const v = String(getField(w, fieldKey)).trim();
    if (!v || seen.has(v)) continue;
    arr.push(v); seen.add(v);
    if (arr.length >= need) break;
  }
  // pad if needed
  while (arr.length < need) arr.push("—");
  return arr;
}

function checkAnswerSingle(selected, answer, wordObj) {
  const correctNow = (selected === answer);
  if (correctNow) {
    score.correct++; sessionBuf.correct++; sessionBuf.total++;
    // per-mode successful counter
    if (mode === 'jp-en') sessionBuf.jpEnCorrect++;
    else if (mode === 'en-jp') sessionBuf.enJpCorrect++;
    else if (mode === 'kanji-hira') sessionBuf.kanjiHiraCorrect++;
    else if (mode === 'hira-kanji') sessionBuf.hiraKanjiCorrect++;
    else if (mode === 'hira&mean-kanji') sessionBuf.hiraMeanKanjiCorrect++;
  } else {
    score.wrong++; sessionBuf.wrong++; sessionBuf.total++;
  }

  persistSession();
  updateScore();
  setTimeout(() => { nextQuestion(); }, 500);
}

function tryGradeDual(wordObj, ansH, ansM) {
  if (!dualPick.hira || !dualPick.mean) return; // wait until both picked

  const hiraLis = Array.from(($("options-hira")||document.createElement('ul')).children);
  const meanLis = Array.from(($("options-mean")||document.createElement('ul')).children);

  // Color feedback
  hiraLis.forEach(li => {
    li.classList.remove("correct","wrong");
    if (li.textContent === ansH) li.classList.add("correct");
    else if (li.classList.contains("selected")) li.classList.add("wrong");
  });
  meanLis.forEach(li => {
    li.classList.remove("correct","wrong");
    if (li.textContent === ansM) li.classList.add("correct");
    else if (li.classList.contains("selected")) li.classList.add("wrong");
  });

  const ok = (dualPick.hira === ansH) && (dualPick.mean === ansM);
  if (ok) {
    score.correct++; sessionBuf.correct++; sessionBuf.total++; sessionBuf.k2hmCorrect++;
  } else {
    score.wrong++; sessionBuf.wrong++; sessionBuf.total++;
  }

  persistSession();
  updateScore();
  setTimeout(() => { nextQuestion(); }, 800);
}


// ---------------- LEARN mode (Flashcard + Prev/Next + Show Romaji) ----------------
// Learn types: 'hira-en' (default) or 'kanji-hira'
let learnType = 'hira-en';

function startLearnMode(type = 'hira-en') {
  learnType = type;
  if (!currentDeck.length) return alert("Pick a deck first!");
  // resume last position per deck + type
  const posKey = `learnPos:${currentDeckName}:${learnType}`;
  const saved = parseInt(localStorage.getItem(posKey) || "0", 10);
  currentIndex = Number.isFinite(saved) ? Math.min(Math.max(saved, 0), currentDeck.length - 1) : 0;

  showSection("learn");
  showLearnCard();
  learnNoteBindForCurrent?.();

  // keyboard shortcuts
  document.onkeydown = (e) => {
    if (currentSectionId !== "learn") return;
    if (e.key === "ArrowLeft") { prevLearn(); }
    if (e.key === "ArrowRight") { nextLearn(); }
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); showLearnRomaji(); }
  };
}
window.startLearnMode = startLearnMode;

function showLearnCard() {
  const word = currentDeck[currentIndex];
  if (!word) return;

  const posKey = `learnPos:${currentDeckName}:${learnType}`;
  localStorage.setItem(posKey, String(currentIndex));

  const box = $("learn-box");
  if (box) {
    const audioEnabled = !!(audioManifestLoaded && currentAudioFolder) || ('speechSynthesis' in window);
    const disabledAttr = audioEnabled ? "" : "disabled title='Audio not available on this device'";

    let mainLine = "";
    let subLine  = "";

    if (learnType === 'hira-en') {
      mainLine = word.hiragana || word.front || "—";
      subLine  = `Meaning: ${word.meaning || word.back || "(no meaning)"}`;
    } else { // 'kanji-hira'
      mainLine = word.kanji || word.front || "—";
      subLine  = `Hiragana: ${word.hiragana || "(n/a)"}`;
    }

    box.className = "flashcard";
    box.innerHTML = `
      <div class="learn-word-row">
        <div class="learn-word">${mainLine}</div>
        <button class="icon-btn" onclick="playWordAudioByIndex(currentIndex)" ${disabledAttr}>🔊</button>
      </div>
      <div class="learn-meaning muted">${subLine}</div>
    `;
  }

  const extra = $("learn-extra");
  if (extra) extra.textContent = "";

  const markBtn = $("learn-mark-btn");
  if (markBtn) {
    const key = (word.front || "") + "|" + (word.back || "");
    markBtn.disabled = false;
    markBtn.classList.toggle("hidden", !!markedMap[key]);
  }
}

function nextLearn() {
  if (learnNoteTimer){ clearTimeout(learnNoteTimer); learnNoteTimer = null; learnNoteSaveNow?.(); }
  if (!currentDeck.length) return;
  currentIndex = Math.min(currentIndex + 1, currentDeck.length - 1);
  showLearnCard();
  learnNoteBindForCurrent?.();
}
window.nextLearn = nextLearn;

function prevLearn() {
  if (learnNoteTimer){ clearTimeout(learnNoteTimer); learnNoteTimer = null; learnNoteSaveNow?.(); }
  if (!currentDeck.length) return;
  currentIndex = Math.max(currentIndex - 1, 0);
  showLearnCard();
  learnNoteBindForCurrent?.();
}
window.prevLearn = prevLearn;

// Reuse existing button id + name for "Show details"
function showLearnRomaji() {
  const w = currentDeck[currentIndex];
  if (!w) return;
  const extra = $("learn-extra");
  if (!extra) return;

  // Show the "remaining columns" based on current learnType
  let html = "";
  if (learnType === 'hira-en') {
    html = `
      <p><b>Kanji:</b> ${w.kanji || "(n/a)"}</p>
      <p><b>Hiragana:</b> ${w.hiragana || "(n/a)"}</p>
      <p><b>Meaning:</b> ${w.meaning || w.back || "(n/a)"}</p>
      ${w.romaji ? `<p><b>Romaji:</b> ${w.romaji}</p>` : ""}
    `;
  } else {
    html = `
      <p><b>Hiragana:</b> ${w.hiragana || "(n/a)"}</p>
      <p><b>Meaning:</b> ${w.meaning || w.back || "(n/a)"}</p>
      ${w.romaji ? `<p><b>Romaji:</b> ${w.romaji}</p>` : ""}
    `;
  }
  extra.innerHTML = html;
}
window.showLearnRomaji = showLearnRomaji;


async function ensureDeckNotesLoaded(deckName){
  if (notesCache[deckName]) return; // already loaded
  // try cloud
  let cloud = {};
  if (window.__fb_fetchNotes){
    try { cloud = await window.__fb_fetchNotes(deckName); } catch {}
  }
  // merge with local (local wins if both present)
  const local = loadLocalNotes(deckName);
  notesCache[deckName] = { ...(cloud || {}), ...(local || {}) };
}

window.startLearnMode = async function(){
  if (!currentDeck.length) return alert("Pick a deck first!");
  mode = "learn";
  sessionBuf.mode = "learn"; // not scored, but keep mode label
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 }; // Learn doesn’t change these

  await ensureDeckNotesLoaded(currentDeckName);
  showSection("learn");
  showLearnCard(); // your existing function that shows word + meaning
  learnNoteBindForCurrent(); // NEW: bind note for current word
};

function learnNoteBindForCurrent(){
  const idx = currentIndex; // or however you reference current in Learn
  const item = currentDeck[idx];
  if (!item) return;

  const key = wordKeyOf(item);
  learnNoteLastKey = key;

  const ta = $("learn-note-text");
  const st = $("learn-note-status");

  // load note from cache
  const deckNotes = notesCache[currentDeckName] || {};
  const note = deckNotes[key] || "";
  if (ta) ta.value = note;

  // light status
  if (st) st.textContent = note ? "Loaded" : "—";

  // set up input handler (debounced autosave)
  if (ta){
    ta.oninput = function(){
      if (st) st.textContent = "Saving…";
      if (learnNoteTimer) clearTimeout(learnNoteTimer);
      learnNoteTimer = setTimeout(() => {
        learnNoteSaveNow(); // will read current textarea value and save
      }, 800);
    };
  }
}
window.learnNoteSaveNow = async function(){
  const ta = $("learn-note-text");
  const st = $("learn-note-status");
  if (!ta) return;

  const idx = currentIndex;
  const item = currentDeck[idx];
  if (!item) return;

  const key = wordKeyOf(item);
  const val = (ta.value || "").trim();

  // update cache immediately
  if (!notesCache[currentDeckName]) notesCache[currentDeckName] = {};
  if (val) notesCache[currentDeckName][key] = val;
  else delete notesCache[currentDeckName][key];

  // persist locally always (for offline safety)
  saveLocalNotes(currentDeckName, notesCache[currentDeckName]);

  // try cloud
  let cloudOk = false;
  if (window.__fb_saveNote){
    const res = await window.__fb_saveNote({ deckName: currentDeckName, wordKey: key, note: val });
    cloudOk = !!(res && res.ok);
  }

  if (st){
    if (cloudOk) st.textContent = "Saved";
    else st.textContent = "Offline (saved locally)";
  }
};

// ---------------- MISTAKES ----------------
// function startMistakePractice() {
//   if (mistakes.length === 0) return alert("No mistakes yet!");
//   currentDeck = mistakes.slice();
//   currentDeckName = "Mistakes";
//   currentIndex = 0;
//   showSection("practice");
//   startPractice(mode);
// }
// window.startMistakePractice = startMistakePractice;

function clearMistakes() {
  if (confirm("Clear all mistake words?")) {
    mistakes = [];
    localStorage.setItem("mistakes", JSON.stringify([]));
    alert("Mistakes cleared.");
    renderMistakesUI(); // NEW
  }
}
window.clearMistakes = clearMistakes;


// ---------------- GRAMMAR (PDF links) ----------------
// Grammar (文法) lesson loader
async function loadGrammarManifest() {
  try {
    const base = "grammar/";
    const res  = await fetch(base + "grammar_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json(); // e.g., ["L1.csv","L2.csv"] or objects

    // Normalize to filenames
    const files = list.map(item => {
      if (typeof item === "string") return item;
      if (item && typeof item.file === "string") return item.file;
      return "";
    }).filter(Boolean);

    let loaded = 0;
    window.allGrammarLessons = {}; // if you keep them in a map

    for (const file of files) {
      const url = file.match(/^https?:\/\//) ? file : (base + file);
      statusLine("grammar-status", `Loading ${file}…`);
      // If you have a dedicated grammar parser, call it here.
      // Otherwise reuse CSV parser to get rows and handle in your grammar UI.
      const rows = await fetchAndParseCSV(url);
      allGrammarLessons[file.replace(/\.csv$/i, "")] = rows;
      loaded++;
    }

    statusLine("grammar-status", `Loaded ${loaded} grammar file(s).`);
    renderGrammarButtons?.(Object.keys(allGrammarLessons));
  } catch (err) {
    console.error("Failed to load grammar:", err);
    statusLine("grammar-status", `Failed to load grammar: ${err.message}`);
  }
}


// ---------------- PRACTICE GRAMMAR (type the answer) ----------------
async function loadGrammarPracticeManifest() {
  try {
    const base = "practice-grammar/";
    const res  = await fetch(base + "manifest.csv");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).replace(/^\uFEFF/, "");
    const table = parseCSV(text);

    // Assume first column holds filenames; drop header if it looks like one
    const looksHeader = (row) => row && row[0] && /file|path|lesson/i.test(String(row[0]));
    const body = table.length && looksHeader(table[0]) ? table.slice(1) : table;

    const files = body.map(r => String((r && r[0]) || "").trim()).filter(Boolean);
    if (files.length === 0) throw new Error("practice-grammar/manifest.csv is empty");

    window.practiceGrammarFiles = files.map(f => f.match(/^https?:\/\//) ? f : (base + f));

    statusLine("grammar-status", `Practice-Grammar manifest OK (${files.length} file(s)).`);
    // If your app autoloads these, iterate and fetch here; otherwise keep only the list.
    // Example autoload:
    /*
    window.allPracticeGrammar = {};
    for (const url of practiceGrammarFiles) {
      const name = url.split("/").pop().replace(/\.csv$/i,"");
      const rows = await fetchAndParseCSV(url);
      allPracticeGrammar[name] = rows;
    }
    */
  } catch (err) {
    console.error("Failed to load practice-grammar manifest:", err);
    statusLine("grammar-status", `Practice-Grammar load failed: ${err.message}`);
  }
}

async function pgStartSet(fileName) {
  try {
    const statusEl = $("pg-status");
    if (statusEl) statusEl.textContent = `Loading ${fileName}…`;

    const res = await fetch(`practice-grammar/${fileName}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for practice-grammar/${fileName}`);
    const text = (await res.text()).replace(/^\uFEFF/, "");

    const rows = parseCSV(text)
      .map(cols => ({ q: (cols[0] || "").trim(), a: (cols[1] || "").trim() }))
      .filter(x => x.q && x.a);
    if (!rows.length) throw new Error("No valid Q/A rows found.");

    pgState.setName = fileName;
    pgState.items = rows;
    pgState.order = [...rows.keys()];
    pgState.i = 0;
    pgState.correct = 0;
    pgState.wrong = 0;
    pgState.answered = false;

    sessionBuf.deckName = `Grammar: ${fileName.replace(/\.csv$/i, "")}`;
    sessionBuf.mode = "grammar";
    persistSession();

    // Hide set buttons like Vocab section behavior
    const filesBox = $("pg-file-buttons");
    if (filesBox) filesBox.classList.add('hidden');

    // Show practice area
    const area = $("pg-area");
    if (area) area.classList.remove("hidden");

    pgRender();
    pgUpdateProgress();

    if (statusEl) statusEl.textContent = `Loaded ${rows.length} questions.`;
    showSection("practice-grammar");
  } catch (e) {
    alert("Failed to start set: " + (e?.message || e));
  }
}

function pgRender() {
  const idx = pgState.order[pgState.i];
  const item = pgState.items[idx];
  const card = $("pg-card");
  if (card) {
    card.className = "flashcard";
    card.textContent = item ? item.q : "(finished)";
  }
  const input = $("pg-input");
  if (input) {
    input.value = "";
    input.disabled = false;
    input.focus();
  }
  const submitBtn = $("pg-submit");
  if (submitBtn) submitBtn.disabled = false;

  const fb = $("pg-feedback");
  if (fb) fb.innerHTML = "";

  pgState.answered = false;
}

function pgUpdateProgress() {
  const total = pgState.items.length || 0;
  const done = Math.min(pgState.i, total);
  const p = percent(done, total);
  const bar = $("pg-progress-bar");
  const txt = $("pg-progress-text");
  if (bar) bar.style.width = `${p}%`;
  if (txt) txt.textContent = `${done} / ${total} (${p}%)`;
}

function normalizeAnswer(s) {
  if (!s) return "";
  // Unicode normalize to fold width variants etc.
  s = s.normalize('NFKC').trim();

  // 1) Unify "tilde/wave dash" variants (treat all as the same)
  //   U+007E ~  ASCII tilde
  //   U+223C ∼  Tilde operator
  //   U+FF5E ～ Fullwidth tilde
  //   U+301C 〜 Wave dash
  s = s.replace(/[~\u223C\uFF5E\u301C]/g, '～');

  // 2) Unify long vowel mark and middle dot variants (optional but handy)
  //   Long vowel: halfwidth ｰ -> ー
  s = s.replace(/[\uFF70]/g, 'ー');
  //   Middle dot variants -> ・
  s = s.replace(/[\u30FB]/g, '・');

  // 3) Strip benign punctuation & whitespace commonly ignored in answers
  //    (commas, periods, Japanese punctuation, spaces)
  s = s.replace(/[。、．，,\.\s]/g, '');

  // 4) OPTIONAL: if your deck uses leading "～" to indicate suffixes,
  //    allow user to omit it by stripping leading "～" for comparison.
  s = s.replace(/^～+/, '');

  // Case-fold for any Latin pieces (romaji cases)
  return s.toLowerCase();
}


function highlightDiff(userRaw, correctRaw) {
  // Work at Unicode codepoint level
  const uArr = [...(userRaw || "")];
  const cArr = [...(correctRaw || "")];
  let i = 0, j = 0;
  let out = "";

  const esc = (s) => (s || "").replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));

  while (i < uArr.length || j < cArr.length) {
    const uc = uArr[i];
    const cc = cArr[j];

    // match
    if (i < uArr.length && j < cArr.length && uc === cc) {
      out += esc(uc);
      i++; j++;
      continue;
    }

    // lookahead to decide: extra typed vs missing char
    const uNextMatches = (i + 1 < uArr.length) && (uArr[i + 1] === cc);
    const cNextMatches = (j + 1 < cArr.length) && (cArr[j + 1] === uc);

    // user typed an extra char not in this position → show that char in red
    if (i < uArr.length && (j >= cArr.length || uNextMatches)) {
      out += `<span class="diff-wrong">${esc(uc)}</span>`;
      i++;
      continue;
    }

    // user is missing a char from the correct answer → insert that char in red
    if (j < cArr.length && (i >= uArr.length || cNextMatches)) {
      out += `<span class="diff-wrong">${esc(cc)}</span>`;
      j++;
      continue;
    }

    // substitution (both differ) → mark the user's char red, advance both
    if (i < uArr.length && j < cArr.length) {
      out += `<span class="diff-wrong">${esc(uc)}</span>`;
      i++; j++;
      continue;
    }

    // leftovers
    if (i < uArr.length) {
      out += `<span class="diff-wrong">${esc(uArr[i++])}</span>`;
    } else if (j < cArr.length) {
      out += `<span class="diff-wrong">${esc(cArr[j++])}</span>`;
    }
  }
  return out;
}


function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
}

// function pgSubmit() {
//   const idx = pgState.order[pgState.i];
//   const item = pgState.items[idx];
//   if (!item || pgState.answered) return;

//   const input = $("pg-input");
//   const fb = $("pg-feedback");
//   const userAnsRaw = input ? input.value : "";

//   const ok = normalizeAnswer(userAnsRaw) === normalizeAnswer(item.a);

//   // Show correct answer always, plus mismatch view
//   if (fb) {
//     const userDiffHtml = highlightDiff(userAnsRaw, item.a);
//     fb.innerHTML = ok
//       ? `✅ Correct!<br><b>Answer:</b> ${escapeHtml(item.a)}<br><b>Your answer:</b> ${escapeHtml(userAnsRaw)}`
//       : `❌ Wrong.<br><b>Answer:</b> ${escapeHtml(item.a)}<br><b>Your answer:</b> ${userDiffHtml}`;
//   }

//   if (ok) {
//     pgState.correct++;
//     sessionBuf.correct++;
//     sessionBuf.total++;
//     sessionBuf.grammarCorrect = (sessionBuf.grammarCorrect || 0) + 1;
//   } else {
//     pgState.wrong++;
//     sessionBuf.wrong++;
//     sessionBuf.total++;
//   }
//   persistSession();

//   // Lock input until Next is clicked; question won't auto-advance
//   if (input) input.disabled = true;
//   const submitBtn = $("pg-submit");
//   if (submitBtn) submitBtn.disabled = true;
//   pgState.answered = true;
// }
//window.pgSubmit = pgSubmit;
window.pgSubmit = async function () {
  const input = $("pg-input");
  const fb = $("pg-feedback");
  if (!input || !fb) return;

  const idx = pgState.order[pgState.i];
  const item = pgState.items[idx];
  if (!item || pgState.answered) return;

  const userAnsRaw = input.value || "";
  const question   = item.q || "";         // from your CSV row
  const correctRef = item.a || "";         // model/reference answer (context only)

  // UI: loading state
  fb.className = "pg-feedback loading";
  fb.textContent = "🤖 Checking your answer…";

  try {
    // --- AI decides correctness ---
    const data = await reviewWithAI({
      question, user: userAnsRaw, correct: correctRef, level: 'JLPT N5'
    });

    const isOk   = !!data?.is_correct;
    const verdict= data?.verdict || (isOk ? "Looks correct!" : "Needs improvement.");
    const better = data?.better ? `<div><b>Better:</b> ${escapeHtml(data.better)}</div>` : "";
    const issues = Array.isArray(data?.issues) && data.issues.length
                  ? `<ul>${data.issues.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>` : "";

    // --- show feedback from AI ---
    fb.className = `pg-feedback ${isOk ? 'ok' : 'bad'}`;
    fb.innerHTML = `${escapeHtml(verdict)} ${better} ${issues}`;

    // --- scoring based on AI verdict ---
    if (isOk) {
      pgState.correct++;
      score.correct++;
      sessionBuf.correct++;
      sessionBuf.total++;
      sessionBuf.grammarCorrect++;  // this flows into your Firestore + leaderboards
    } else {
      pgState.wrong++;
      score.wrong++;
      sessionBuf.wrong++;
      sessionBuf.total++;
    }
    persistSession();  // keep your existing buffer lifecycle
    updateScore();

  } catch (e) {
    console.warn("[AI review] error:", e);
    fb.className = "pg-feedback bad";
    fb.textContent = "AI review failed. Please check your connection and try again.";
    // do not advance counters on failure
  }

  // lock input until Next
  input.disabled = true;
  const btn = $("pg-submit"); if (btn) btn.disabled = true;
  pgState.answered = true;
};

function pgShowAnswer() {
  const idx = pgState.order[pgState.i];
  const item = pgState.items[idx];
  const fb = $("pg-feedback");
  if (fb && item) fb.innerHTML = `💡 Answer: ${escapeHtml(item.a)}`;
}
window.pgShowAnswer = pgShowAnswer;

function pgNext() {
  // re-enable input for next question
  const input = $("pg-input");
  if (input) { input.disabled = false; }
  const submitBtn = $("pg-submit");
  if (submitBtn) submitBtn.disabled = false;

  pgState.i++;
  pgUpdateProgress();
  if (pgState.i >= pgState.items.length) {
    alert(`Finished! ✅ ${pgState.correct} ❌ ${pgState.wrong}\nSaving your progress…`);
    autoCommitIfNeeded("finish grammar set");

    // Hide practice area, show files list again
    const area = $("pg-area");
    if (area) area.classList.add("hidden");
    const filesBox = $("pg-file-buttons");
    if (filesBox) filesBox.classList.remove('hidden');

    showSection("practice-grammar");
  } else {
    pgRender();
  }
}
window.pgNext = pgNext;

// ---------------- PROGRESS (reads via firebase.js) ----------------
// async function renderProgress() {
//   if (!window.__fb_fetchAttempts) return;

//   try {
//     const attempts = await window.__fb_fetchAttempts(50);
//     const tbody = $("progress-table")?.querySelector("tbody");
//     if (tbody) {
//       tbody.innerHTML = "";
//       attempts.slice(0, 20).forEach(a => {
//         const tr = document.createElement("tr");
//         const when = a.createdAt ? new Date(a.createdAt).toLocaleString() : "—";
//         tr.innerHTML = `
//           <td>${when}</td>
//           <td>${a.deckName || "—"}</td>
//           <td>${a.mode || "—"}</td>
//           <td>${a.correct ?? 0}</td>
//           <td>${a.wrong ?? 0}</td>
//           <td>${a.skipped ?? 0}</td>
//           <td>${a.total ?? ((a.correct||0)+(a.wrong||0)+(a.skipped||0))}</td>
//         `;
//         tbody.appendChild(tr);
//       });
//     }

//     const last = attempts[0];
//     let prev = null;
//     if (last) {
//       prev = attempts.find(a =>
//         a.deckName === last.deckName && a.createdAt < last.createdAt
//       ) || null;
//     }

//     const lastBox = $("progress-last");
//     const prevBox = $("progress-prev");
//     const deltaBox = $("progress-delta");

//     if (lastBox) {
//       if (last) {
//         lastBox.innerHTML = `
//           <div><b>${last.deckName}</b> (${last.mode})</div>
//           <div>✅ ${last.correct || 0} | ❌ ${last.wrong || 0} | ➖ ${last.skipped || 0}</div>
//           <div class="muted">${new Date(last.createdAt).toLocaleString()}</div>
//         `;
//       } else {
//         lastBox.textContent = "No attempts yet.";
//       }
//     }

//     if (prevBox) {
//       if (prev) {
//         prevBox.innerHTML = `
//           <div><b>${prev.deckName}</b> (${prev.mode})</div>
//           <div>✅ ${prev.correct || 0} | ❌ ${prev.wrong || 0} | ➖ ${prev.skipped || 0}</div>
//           <div class="muted">${new Date(prev.createdAt).toLocaleString()}</div>
//         `;
//       } else {
//         prevBox.textContent = "—";
//       }
//     }

//     if (deltaBox) {
//       if (last && prev) {
//         const d = (last.correct || 0) - (prev.correct || 0);
//         const cls = d >= 0 ? "delta-up" : "delta-down";
//         const sign = d > 0 ? "+" : (d < 0 ? "" : "±");
//         deltaBox.innerHTML = `<span class="${cls}">${sign}${d} correct vs previous (same deck)</span>`;
//       } else if (last && !prev) {
//         deltaBox.textContent = "No previous attempt for this deck.";
//       } else {
//         deltaBox.textContent = "—";
//       }
//     }
//   } catch (e) {
//     console.warn("renderProgress failed:", e);
//   }
// }

async function renderProgress() {
  if (!window.__fb_fetchAttempts) return;

  // Hoist so it's visible to the write-words table block below
  let attempts = [];

  try {
    attempts = await window.__fb_fetchAttempts(50);

    const tbody = $("progress-table")?.querySelector("tbody");
    if (tbody) {
      tbody.innerHTML = "";
      attempts.slice(0, 20).forEach(a => {
        const tr = document.createElement("tr");
        const when = a.createdAt ? new Date(a.createdAt).toLocaleString() : "—";
        tr.innerHTML = `
          <td>${when}</td>
          <td>${a.deckName || "—"}</td>
          <td>${a.mode || "—"}</td>
          <td>${a.correct ?? 0}</td>
          <td>${a.wrong ?? 0}</td>
          <td>${a.skipped ?? 0}</td>
          <td>${a.total ?? ((a.correct||0)+(a.wrong||0)+(a.skipped||0))}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    const last = attempts[0];
    let prev = null;
    if (last) {
      prev = attempts.find(a =>
        a.deckName === last.deckName && a.createdAt < last.createdAt
      ) || null;
    }

    const lastBox = $("progress-last");
    const prevBox = $("progress-prev");
    const deltaBox = $("progress-delta");

    if (lastBox) {
      if (last) {
        lastBox.innerHTML = `
          <div><b>${last.deckName}</b> (${last.mode})</div>
          <div>✅ ${last.correct || 0} | ❌ ${last.wrong || 0} | ➖ ${last.skipped || 0}</div>
          <div class="muted">${new Date(last.createdAt).toLocaleString()}</div>
        `;
      } else {
        lastBox.textContent = "No attempts yet.";
      }
    }

    if (prevBox) {
      if (prev) {
        prevBox.innerHTML = `
          <div><b>${prev.deckName}</b> (${prev.mode})</div>
          <div>✅ ${prev.correct || 0} | ❌ ${prev.wrong || 0} | ➖ ${prev.skipped || 0}</div>
          <div class="muted">${new Date(prev.createdAt).toLocaleString()}</div>
        `;
      } else {
        prevBox.textContent = "—";
      }
    }

    if (deltaBox) {
      if (last && prev) {
        const d = (last.correct || 0) - (prev.correct || 0);
        const cls = d >= 0 ? "delta-up" : "delta-down";
        const sign = d > 0 ? "+" : (d < 0 ? "" : "±");
        deltaBox.innerHTML = `<span class="${cls}">${sign}${d} correct vs previous (same deck)</span>`;
      } else if (last && !prev) {
        deltaBox.textContent = "No previous attempt for this deck.";
      } else {
        deltaBox.textContent = "—";
      }
    }
  } catch (e) {
    console.warn("renderProgress failed (attempts table):", e);
  }

  // --- NEW: Write Words per-deck completion (best single session) ---
  try {
    const tbodyW = $("write-progress-table")?.querySelector("tbody");
    if (tbodyW) {
      tbodyW.innerHTML = "";

      // Bail fast if no attempts yet
      if (!Array.isArray(attempts) || attempts.length === 0) return;

      // group write attempts by deckName
      const byDeck = new Map();
      attempts
        .filter(a => a && a.mode === 'write') // only Write Words sessions
        .forEach(a => {
          const key = a.deckName || '(Unknown Deck)';
          if (!byDeck.has(key)) byDeck.set(key, []);
          byDeck.get(key).push(a);
        });

      const rows = [];
      byDeck.forEach((arr, deckName) => {
        let best = null;
        for (const a of arr) {
          if (!best || (a.total || 0) > (best.total || 0)) best = a;
        }
        if (!best) return;

        // deck size from loaded decks (if available)
        const deckKey = deckName.replace(/^Grammar:\s*/i, "").trim();
        const size =
          (allDecks && allDecks[deckKey] && allDecks[deckKey].length) ||
          (allDecks && allDecks[deckName] && allDecks[deckName].length) ||
          null;

        const bestAttempted = best.total ?? ((best.correct || 0) + (best.wrong || 0) + (best.skipped || 0));
        const pct = (size && size > 0) ? Math.min(100, Math.floor((bestAttempted / size) * 100)) : null;
        const when = best.createdAt ? new Date(best.createdAt).toLocaleString() : "—";

        rows.push({
          deckName,
          bestAttempted,
          size,
          pctText: (pct === null) ? "—" : `${pct}%`,
          when
        });
      });

      // Sort rows by deck name natural order
      rows.sort((a, b) => a.deckName.localeCompare(b.deckName, undefined, { numeric: true }));

      // Render rows
      rows.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.deckName}</td>
          <td>${r.bestAttempted}</td>
          <td>${r.size ?? "—"}</td>
          <td>${r.pctText}</td>
          <td>${r.when}</td>
        `;
        tbodyW.appendChild(tr);
      });

      // If sizes aren't ready yet, retry once decks likely loaded
      if (rows.length && rows.some(r => r.size === null)) {
        setTimeout(() => { try { renderProgress(); } catch {} }, 800);
      }
    }
  } catch (e) {
    console.warn("write-progress-table render failed:", e);
  }
}

window.renderProgress = renderProgress;

// ---------------- Utilities ----------------
function isLikelyVerb(item){
  const s = (item?.back || "").toLowerCase();
  return /^to\s/.test(s) || /\bverb\b/.test(s) || /\(v\)/.test(s);
}
function pickMakeGroup(){
  const pool = currentDeck || [];
  if (!pool.length) return [];
  // 1 word (60%), 2 words (30%), 3 words (10%)
  const r = Math.random();
  const k = r < 0.6 ? 1 : (r < 0.9 ? 2 : 3);
  const want = Math.min(k, pool.length);

  const idxs = new Set();
  while (idxs.size < want) idxs.add(Math.floor(Math.random() * pool.length));
  let group = [...idxs].map(i => pool[i]);

  // If multi-word but no verb, try inject a verb to help form a full sentence.
  if (group.length > 1 && !group.some(isLikelyVerb)) {
    const verbs = pool.filter(isLikelyVerb);
    if (verbs.length) group[0] = verbs[Math.floor(Math.random() * verbs.length)];
  }
  return group;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function showRomaji() {
  const card = currentDeck[currentIndex];
  if (!card) return;
  const romaji = card.romaji || "(no romaji)";
  setText("extra-info", `Romaji: ${romaji}`);
}
window.showRomaji = showRomaji;

function showMeaning() {
  const card = currentDeck[currentIndex];
  if (!card) return;
  const correct = mode === "jp-en" ? card.back : card.front;
  setText("extra-info", `Meaning: ${correct}`);
}
window.showMeaning = showMeaning;

function pad2(n){ return String(n).padStart(2, '0'); }

function ensureAudioElement() {
  let a = document.getElementById("__learn_audio");
  if (!a) {
    a = document.createElement("audio");
    a.id = "__learn_audio";
    a.preload = "auto";
    document.body.appendChild(a);
  }
  return a;
}

function showToast(msg, ms = 2200) {
  let t = document.getElementById("__toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "__toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), ms);
}

// window.playLearnAudio = function () {
//   const word = currentDeck[currentIndex];
//   if (!word) return;

//   if (!audioManifestLoaded || !currentAudioFolder) {
//     showToast("Audio not available for this word.");
//     return;
//   }

//   const nn = pad2(currentIndex + 1); // 1-based index in learn sequence
//   const fileName = `${nn}_${word.front}.mp3`;
//   const url = `${AUDIO_BASE}/${currentAudioFolder}/${fileName}`;

//   const audio = ensureAudioElement();
//   // Clean up any previous listeners
//   audio.oncanplay = null;
//   audio.onerror = null;

//   audio.src = url;
//   audio.oncanplay = () => { try { audio.play(); } catch {} };
//   audio.onerror = () => {
//     showToast("Audio not available for this word.");
//   };
//   // Kick it off
//   audio.load();
// };
// ---- Hybrid audio: try MP3 by deck, else fall back to ja-JP TTS
window.playLearnAudio = function () {
  const word = currentDeck[currentIndex];
  if (!word) return;

  // If we have an audio folder for this deck, try to play the MP3 first
  const canUseFiles = !!(audioManifestLoaded && currentAudioFolder);
  if (canUseFiles) {
    const nn = pad2(currentIndex + 1); // 1-based index in learn sequence
    const fileName = `${nn}_${word.front}.mp3`;
    const url = `${AUDIO_BASE}/${currentAudioFolder}/${fileName}`;

    const audio = ensureAudioElement();
    audio.oncanplay = null;
    audio.onerror = null;

    let triedFile = false;

    audio.src = url;
    audio.oncanplay = () => { triedFile = true; try { audio.play(); } catch {} };
    audio.onerror = () => {
      // If the specific MP3 is missing, gracefully fall back to TTS
      if (!triedFile) ttsSpeak(word.front);
      else showToast("Audio not available for this word.");
    };
    audio.load();
    return;
  }

  // No file-based audio configured → use TTS if available
  ttsSpeak(word.front);
};

// ---- Simple ja-JP TTS helper (fallback)
function ttsSpeak(text) {
  if (!('speechSynthesis' in window)) {
    showToast("Audio not available on this device.");
    return;
  }
  // Try to pick a Japanese voice once and cache it
  if (!ttsSpeak._voice) {
    const voices = speechSynthesis.getVoices() || [];
    ttsSpeak._voice =
      voices.find(v => v.lang && v.lang.toLowerCase().startsWith('ja')) ||
      voices.find(v => /japanese/i.test(v.name)) ||
      null;
  }

  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 0.95;   // slightly slower for clarity
  u.pitch = 1.0;
  if (ttsSpeak._voice) u.voice = ttsSpeak._voice;

  // Some browsers load voices asynchronously — retry once if empty
  if (!ttsSpeak._voice && (speechSynthesis.getVoices() || []).length === 0) {
    speechSynthesis.onvoiceschanged = () => {
      const voices = speechSynthesis.getVoices() || [];
      ttsSpeak._voice =
        voices.find(v => v.lang && v.lang.toLowerCase().startsWith('ja')) ||
        voices.find(v => /japanese/i.test(v.name)) ||
        null;
      speechSynthesis.speak(u);
      speechSynthesis.onvoiceschanged = null;
    };
  } else {
    speechSynthesis.speak(u);
  }
}

// ---------------- Navbar actions ----------------
window.saveCurrentScore = async function () {
  try {
    await autoCommitIfNeeded("manual save");
    alert('Progress saved ✅');
  } catch {
  }
};

window.resetSite = async function () {
  const sure = confirm("⚠️ This will erase ALL your progress (attempts, daily aggregates, leaderboard rows, tasks) from the database. Your sign‑in will remain.\n\nProceed?");
  if (!sure) return;

  const btn = event?.target;
  if (btn) btn.disabled = true;

  try {
    if (!window.__fb_fullReset) throw new Error("__fb_fullReset is not available.");
    await window.__fb_fullReset();

    localStorage.removeItem("mistakes");
    localStorage.removeItem("masteryMap");
    localStorage.removeItem("sessionBuf");
    localStorage.removeItem("pendingSession");

    alert("✅ All progress erased. You are still signed in.");
    location.reload();
  } catch (e) {
    console.error("Full reset failed:", e);
    alert("Reset failed: " + (e?.message || e));
  } finally {
    if (btn) btn.disabled = false;
  }
};

function wordKeyOf(item){
  // stable unique key per vocab row
  return (item?.front || "") + "|" + (item?.back || "");
}
function lsNotesKey(deckName){
  const uid = (window.__fb_getUid && window.__fb_getUid()) || "local";
  return `notes:${uid}:${deckName}`;
}
function loadLocalNotes(deckName){
  try{
    const raw = localStorage.getItem(lsNotesKey(deckName));
    return raw ? JSON.parse(raw) : {};
  }catch(e){ return {}; }
}
function saveLocalNotes(deckName, obj){
  try{
    localStorage.setItem(lsNotesKey(deckName), JSON.stringify(obj || {}));
  }catch(e){}
}

// script.js (Marked Words list rendering)
function renderMarkedList() {
  const container = $("marked-container");
  const statusEl = $("marked-status");
  const modeSelectEl = $("marked-mode-select");
  if (!container || !statusEl) return;
  
  container.innerHTML = "";  // clear current list
  if (markedWordsList.length === 0) {
    // No marked words
    statusEl.textContent = "No words marked yet.";
    if (modeSelectEl) modeSelectEl.classList.add("hidden");
    return;
  }
  
  statusEl.textContent = `You have ${markedWordsList.length} marked word(s).`;
  if (modeSelectEl) modeSelectEl.classList.remove("hidden");
  
  // Create a card for each marked word
  markedWordsList.forEach(word => {
    const wordKey = word.front + "|" + word.back;
    const card = document.createElement("div");
    card.className = "card marked-card";
    card.innerHTML = `<b>${word.front}</b> — ${word.back}`;
    // "Unmark" button for this word
    const btn = document.createElement("button");
    btn.textContent = "Unmark";
    btn.className = "unmark-btn";
    btn.onclick = () => unmarkWord(wordKey);
    card.appendChild(btn);
    container.appendChild(card);
  });
}

// script.js (Mark current word logic)
window.markCurrentWord = async function () {
  // figure out current word by mode
  let word;
  if (mode === "write") {
    const idx = writeState.order[writeState.i];
    word = currentDeck[idx];
  } else {
    word = currentDeck[currentIndex];
  }
  if (!word) return;

  const key = word.front + "|" + word.back;
  if (markedMap[key]) return; // already marked

  // pick the active Mark button by current section
  let activeBtn = null;
  if (currentSectionId === "learn") activeBtn = $("learn-mark-btn");
  else if (currentSectionId === "practice") activeBtn = $("practice-mark-btn");
  else if (currentSectionId === "write") activeBtn = $("write-mark-btn");

  if (activeBtn) activeBtn.disabled = true; // disable only the visible one

  const res = window.__fb_markWord ? await window.__fb_markWord(word) : { ok: false };

  if (res.ok) {
    // update local cache
    markedWordsList.push({ front: word.front, back: word.back, romaji: word.romaji || "" });
    markedMap[key] = true;

    // toast confirm
    const toast = $("toast");
    if (toast) {
      toast.textContent = "Marked!";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2000);
    }

    // hide this button for the just-marked word
    if (activeBtn) {
      activeBtn.classList.add("hidden");
      activeBtn.disabled = false; // safety: clear disabled state
    }

    renderMarkedList(); // refresh the Marked page
  } else {
    // failure → re-enable so user can retry
    if (activeBtn) activeBtn.disabled = false;

    const toast = $("toast");
    if (toast) {
      toast.textContent = "Failed to mark. Please try again.";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2000);
    }
    console.error("Mark Word error:", res.error);
  }
};


// script.js (Unmark a word)
window.unmarkWord = async function(wordKey) {
  if (!wordKey) return;
  // Confirmation prompt to avoid accidental removal
  const confirmMsg = "Remove this word from Marked Words?";
  if (!confirm(confirmMsg)) {
    return;
  }
  // Remove from Firebase
  const res = window.__fb_unmarkWord ? await window.__fb_unmarkWord(wordKey) : { ok: false };
  if (res.ok) {
    // Update local data: filter out the removed word
    markedWordsList = markedWordsList.filter(w => (w.front + "|" + w.back) !== wordKey);
    delete markedMap[wordKey];
    // Re-render the list and update status
    renderMarkedList();
  } else {
    console.error("Unmark Word error:", res.error);
    // (Optional: show a toast or alert for failure, not implemented for brevity)
  }
};

// script.js (start practice with Marked Words deck)
window.startMarkedLearn = async function() {
  if (markedWordsList.length === 0) {
    alert("No marked words to learn!");
    return;
  }
  // Treat markedWordsList as the current deck
  currentDeck = markedWordsList.slice();  // use a copy of the array
  currentDeckName = "Marked Words";
  currentIndex = 0;
  mode = "learn";
  // Reset session buffer for this "deck"
  sessionBuf = {
    deckName: "Marked Words",
    mode: "learn",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0
  };
  persistSession();
  // (Optional: disable audio for mixed deck, since audio folder cannot be resolved)
  currentAudioFolder = null;
  // Start Learn mode similar to a normal deck
  await ensureDeckNotesLoaded(currentDeckName);
  showSection("learn");
  showLearnCard();
  learnNoteBindForCurrent();
};

window.startMarkedPractice = function(selectedMode) {
  if (markedWordsList.length === 0) {
    alert("No marked words to practice!");
    return;
  }
  currentDeck = markedWordsList.slice();
  currentDeckName = "Marked Words";
  currentIndex = 0;
  // Prepare session buffer for this practice session
  sessionBuf = {
    deckName: "Marked Words",
    mode: selectedMode,
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0
  };
  persistSession();
  // Use existing startPractice flow (shuffles deck and shows questions)
  startPractice(selectedMode);
};

window.startMarkedWrite = function() {
  if (markedWordsList.length === 0) {
    alert("No marked words to practice!");
    return;
  }
  currentDeck = markedWordsList.slice();
  currentDeckName = "Marked Words";
  currentIndex = 0;
  // Set up session buffer
  sessionBuf = {
    deckName: "Marked Words",
    mode: "write",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0
  };
  persistSession();
  // Reuse the existing startWriteWords logic
  window.startWriteWords();
};


window.startMistakeLearn = async function () {
  if (mistakes.length === 0) return alert("No mistakes yet!");
  currentDeck = mistakes.slice();
  currentDeckName = "Mistakes";
  currentIndex = 0;
  mode = "learn";
  sessionBuf = {
    deckName: "Mistakes",
    mode: "learn",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0
  };
  persistSession();
  currentAudioFolder = null; // mixed deck → disable per-deck audio
  await ensureDeckNotesLoaded(currentDeckName);
  showSection("learn");
  showLearnCard();
  learnNoteBindForCurrent();
};

window.startMistakePractice = function (selectedMode) {
  if (mistakes.length === 0) return alert("No mistakes yet!");
  currentDeck = mistakes.slice();
  currentDeckName = "Mistakes";
  currentIndex = 0;
  sessionBuf = {
    deckName: "Mistakes",
    mode: selectedMode,
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0
  };
  persistSession();
  startPractice(selectedMode); // reuses your MCQ flow
};

window.startMistakeWrite = function () {
  if (mistakes.length === 0) return alert("No mistakes yet!");
  currentDeck = mistakes.slice();
  currentDeckName = "Mistakes";
  currentIndex = 0;
  sessionBuf = {
    deckName: "Mistakes",
    mode: "write",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0
  };
  persistSession();
  window.startWriteWords();   // reuses your typing mode
};
window.startMakeSentence = function () {
  if (!currentDeck.length) return alert("Pick a deck first!");
  mode = "make-sentence";
  sessionBuf.mode = "make-sentence";
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };

  makeState.round = 0;
  makeState.totalRounds = Math.min(currentDeck.length, 15); // short focused set
  makeState.answered = false;
  makeState.group = pickMakeGroup();

  showSection("make");
  makeRender();
  makeUpdateProgress();
  updateScore();
};

window.startMixedMake = function () {
  if (multiSelectedDecks.size === 0) return alert("Pick at least one deck.");
  currentDeck = buildMixedVocabDeck();
  if (!currentDeck.length) return alert("Selected decks are empty.");
  shuffleArray(currentDeck);
  currentDeckName = `Mixed (${multiSelectedDecks.size})`;

  mode = "make-sentence";
  sessionBuf = {
    deckName: currentDeckName,
    mode: "make-sentence",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0
  };
  persistSession();

  score = { correct: 0, wrong: 0, skipped: 0 };
  makeState.round = 0;
  makeState.totalRounds = Math.min(currentDeck.length, 15);
  makeState.answered = false;
  makeState.group = pickMakeGroup();

  showSection("make");
  makeRender();
  makeUpdateProgress();
  updateScore();
};

function renderDeckMultiSelect() {
  const wrap = $("deck-multi-list");
  const status = $("deck-multi-status");
  if (!wrap) return;

  wrap.innerHTML = ""; // reset
  Object.keys(allDecks)
    .sort((a,b)=>a.localeCompare(b, undefined, {numeric:true}))
    .forEach(name => {
      const id = "ms-" + name;
      const label = document.createElement("label");
      label.style.display = "inline-flex";
      label.style.alignItems = "center";
      label.style.gap = "8px";
      label.style.margin = "4px 10px 4px 0";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.checked = multiSelectedDecks.has(name);
      cb.onchange = () => {
        if (cb.checked) multiSelectedDecks.add(name);
        else multiSelectedDecks.delete(name);
        updateDeckMultiStatus();
      };

      label.appendChild(cb);
      label.appendChild(document.createTextNode(name));
      wrap.appendChild(label);
    });

  updateDeckMultiStatus();
}

function updateDeckMultiStatus() {
  const status = $("deck-multi-status");
  if (status) {
    const n = multiSelectedDecks.size;
    status.textContent = n ? `${n} deck(s) selected.` : "Select decks to enable.";
  }
}

window.multiSelectDeckAll = function(){
  Object.keys(allDecks).forEach(n => multiSelectedDecks.add(n));
  renderDeckMultiSelect();
};
window.multiSelectDeckNone = function(){
  multiSelectedDecks.clear();
  renderDeckMultiSelect();
};
function buildMixedVocabDeck() {
  const names = [...multiSelectedDecks];
  const merged = [];
  names.forEach(n => {
    const arr = allDecks[n] || [];
    // tag each row with its source deck (optional, for future UX)
    arr.forEach(x => merged.push({ ...x, __src: n }));
  });
  return merged;
}

window.startMixedLearn = async function(){
  if (multiSelectedDecks.size === 0) return alert("Pick at least one deck.");
  currentDeck = buildMixedVocabDeck();
  if (!currentDeck.length) return alert("Selected decks are empty.");
  shuffleArray(currentDeck); // mixed order
  currentDeckName = `Mixed (${multiSelectedDecks.size})`;
  currentIndex = 0;
  mode = "learn";
  sessionBuf = {
    deckName: currentDeckName,
    mode: "learn",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0
  };
  persistSession();
  currentAudioFolder = null; // mixed → disable per-deck audio mapping
  await ensureDeckNotesLoaded(currentDeckName);
  showSection("learn");
  showLearnCard();
  learnNoteBindForCurrent();
};

window.startMixedPractice = function(selectedMode){
  if (multiSelectedDecks.size === 0) return alert("Pick at least one deck.");
  currentDeck = buildMixedVocabDeck();
  if (!currentDeck.length) return alert("Selected decks are empty.");
  shuffleArray(currentDeck);
  currentDeckName = `Mixed (${multiSelectedDecks.size})`;
  currentIndex = 0;
  sessionBuf = {
    deckName: currentDeckName,
    mode: selectedMode,
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0
  };
  persistSession();
  startPractice(selectedMode);
};

window.startMixedWrite = function(){
  if (multiSelectedDecks.size === 0) return alert("Pick at least one deck.");
  currentDeck = buildMixedVocabDeck();
  if (!currentDeck.length) return alert("Selected decks are empty.");
  shuffleArray(currentDeck);
  currentDeckName = `Mixed (${multiSelectedDecks.size})`;
  currentIndex = 0;
  sessionBuf = {
    deckName: currentDeckName,
    mode: "write",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    jpEnCorrect: 0, enJpCorrect: 0, grammarCorrect: 0
  };
  persistSession();
  startWriteWords();
};
// --- Mixed Grammar selection state ---
let pgMultiSelected = new Set();

// Call this at the end of loadGrammarPracticeManifest()
function renderPgMultiList() {
  const listEl = $("pg-multi-list");
  const status = $("pg-multi-status");
  if (!listEl || !Array.isArray(pgState.files)) return;

  listEl.innerHTML = "";
  pgState.files.forEach(file => {
    const id = "pgms-" + file;
    const label = document.createElement("label");
    label.className = "checkbox-pill";
    label.style.display = "inline-flex";
    label.style.gap = "8px";
    label.style.alignItems = "center";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.checked = pgMultiSelected.has(file);
    cb.onchange = () => {
      if (cb.checked) pgMultiSelected.add(file);
      else pgMultiSelected.delete(file);
      updatePgMultiStatus();
    };

    label.appendChild(cb);
    label.appendChild(document.createTextNode(file.replace(/\.csv$/i,"")));
    listEl.appendChild(label);
  });

  updatePgMultiStatus();
}

function updatePgMultiStatus() {
  const status = $("pg-multi-status");
  if (status) {
    const n = pgMultiSelected.size;
    status.textContent = n ? `${n} set(s) selected.` : "Pick sets to combine.";
  }
}

window.pgMultiSelectAll = function(){
  (pgState.files || []).forEach(f => pgMultiSelected.add(f));
  renderPgMultiList();
};
window.pgMultiSelectNone = function(){
  pgMultiSelected.clear();
  renderPgMultiList();
};
window.pgStartMixed = async function(){
  if (pgMultiSelected.size === 0) {
    alert("Select at least one grammar set.");
    return;
  }
  try {
    // Load all selected CSVs, concatenate, then shuffle
    const all = [];
    for (const file of pgMultiSelected) {
      const res = await fetch(`practice-grammar/${file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
      const text = (await res.text()).replace(/^\uFEFF/, "");
      const rows = parseCSV(text)
        .map(cols => ({ q: (cols[0]||"").trim(), a: (cols[1]||"").trim() }))
        .filter(x => x.q && x.a);
      rows.forEach(r => all.push(r));
    }
    if (!all.length) throw new Error("No valid rows in selected sets.");

    // Prepare pgState
    pgState.setName = `Mixed (${pgMultiSelected.size})`;
    pgState.items = all;
    pgState.order = [...all.keys()];
    shuffleArray(pgState.order);
    pgState.i = 0;
    pgState.correct = 0;
    pgState.wrong = 0;
    pgState.answered = false;

    sessionBuf.deckName = `Grammar Mixed (${pgMultiSelected.size})`;
    sessionBuf.mode = "grammar";
    sessionBuf.correct = 0; sessionBuf.wrong = 0; sessionBuf.skipped = 0; sessionBuf.total = 0;
    sessionBuf.jpEnCorrect = 0; sessionBuf.enJpCorrect = 0; sessionBuf.grammarCorrect = 0;
    persistSession();

    // Show practice area
    const filesBox = $("pg-file-buttons");
    if (filesBox) filesBox.classList.add('hidden');
    const area = $("pg-area");
    if (area) area.classList.remove("hidden");

    showSection("practice-grammar");
    pgRender();
    pgUpdateProgress();

    const statusEl = $("pg-status");
    if (statusEl) statusEl.textContent = `Loaded ${all.length} questions from ${pgMultiSelected.size} set(s).`;
  } catch (e) {
    alert("Failed to start mixed grammar: " + (e?.message || e));
  }
};
function makeRender() {
  const words = makeState.group || [];
  const card = $("make-card");
  if (card) {
    const jp = words.map(w => w.front).join(" ・ ");
    card.className = "flashcard";
    card.innerHTML = `
      <div class="learn-word-row">
        <div class="learn-word">${jp || "—"}</div>
      </div>
    `;
  }
  const input = $("make-input");
  if (input) { input.value = ""; input.disabled = false; input.focus(); }

  const submitBtn = $("make-submit"); if (submitBtn) submitBtn.disabled = false;
  const fb = $("make-feedback"); if (fb) { fb.className = "pg-feedback muted"; fb.innerHTML = ""; }

  makeState.answered = false;
}

function makeUpdateProgress() {
  const total = makeState.totalRounds || 0;
  const done = Math.min(makeState.round, total);
  const p = percent(done, total || 1);
  const bar = $("make-progress-bar");
  const txt = $("make-progress-text");
  if (bar) bar.style.width = `${p}%`;
  if (txt) txt.textContent = `${done} / ${total} (${p}%)`;
}

window.makeSubmit = async function () {
  const input = $("make-input");
  const fb = $("make-feedback");
  if (!input || !fb || makeState.answered) return;

  const userSentence = (input.value || "").trim();
  if (!userSentence) return;

  const words = (makeState.group || []).map(w => w.front);
  fb.className = "pg-feedback loading";
  fb.textContent = "🤖 Checking your sentence…";

  // We reuse your existing serverless checker; we encode the 'rules' in the prompt.
  const question = `Make one simple JLPT N5-level Japanese sentence using ALL of these word(s): ${words.join(", ")}.`;
  const correctRef = `Must include all: ${words.join(", ")}. Allow inflections and particles; kana/kanji both okay.`;

  try {
    const data = await reviewWithAI({
      question, user: userSentence, correct: correctRef, level: 'JLPT N5'
    });

    const ok = !!data?.is_correct;
    const verdict = data?.verdict || (ok ? "Good sentence!" : "Needs improvement.");
    const better  = data?.better ? `<div><b>Better:</b> ${escapeHtml(data.better)}</div>` : "";
    const issues  = Array.isArray(data?.issues) && data.issues.length
      ? `<ul>${data.issues.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : "";

    fb.className = `pg-feedback ${ok ? "ok" : "bad"}`;
    fb.innerHTML = `${escapeHtml(verdict)} ${better} ${issues}`;

    if (ok) {
      score.correct++; sessionBuf.correct++; sessionBuf.total++; sessionBuf.grammarCorrect++;
    } else {
      score.wrong++;   sessionBuf.wrong++;   sessionBuf.total++;
    }
    persistSession();
    updateScore();

    input.disabled = true;
    const submitBtn = $("make-submit"); if (submitBtn) submitBtn.disabled = true;
    makeState.answered = true;
  } catch (e) {
    console.warn("[make] AI check failed:", e);
    fb.className = "pg-feedback bad";
    fb.textContent = "AI review failed. Please try again.";
  }
};

window.makeSkip = function () {
  score.skipped++; sessionBuf.skipped++; sessionBuf.total++;
  persistSession(); updateScore();
  makeNext();
};

window.makeShowHints = function () {
  const fb = $("make-feedback"); if (!fb) return;
  const words = makeState.group || [];
  const lines = words.map(w => `• ${escapeHtml(w.front)} — ${escapeHtml(w.back)}`).join("<br>");
  const romaji = words.map(w => w.romaji).filter(Boolean).join(" ・ ");
  fb.className = "pg-feedback";
  fb.innerHTML = `💡 Hints:<br>${lines}${romaji ? `<div style="margin-top:4px;">(${escapeHtml(romaji)})</div>` : ""}`;
};

window.makeNext = function () {
  makeState.round++;
  makeUpdateProgress();
  if (makeState.round >= makeState.totalRounds) {
    alert(`Finished! ✅ ${score.correct} ❌ ${score.wrong} ➖ ${score.skipped}\nSaving your progress…`);
    autoCommitIfNeeded("finish make-sentence");
    showSection("deck-select");
  } else {
    makeState.group = pickMakeGroup();
    makeRender();
  }
};

document.addEventListener("DOMContentLoaded", () => {
  loadDeckManifest();
  loadGrammarManifest();
  loadPracticeGrammarManifest();
});
