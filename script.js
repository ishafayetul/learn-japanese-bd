/* === DOM helpers MUST be first === */
/* === DOM helpers (single install) === */
(() => {
  if (typeof window.$ !== 'function') {
    window.$ = function(id){ return document.getElementById(id); };
  }
  if (typeof window.setText !== 'function') {
    window.setText = function(id, txt){
      const el = document.getElementById(id);
      if (el) el.textContent = String(txt ?? '');
    };
  }
  if (typeof window.setHTML !== 'function') {
    window.setHTML = function(id, html){
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    };
  }
})();


///////////////////////
// Global App State //
///////////////////////
const AUDIO_BASE = "audio";

// Decks
let decks = {};              // { deckName: Word[] }
let deckOrder = [];          // display order from manifest
let currentDeckName = "";
let currentDeck = [];        // active pool after filtering for a mode
let currentAudioFolder = null;

// Modes
let mode = "";               // 'learn-hira-en', 'learn-kanji-hira', 'jp-en','en-jp','kanji-hira','hira-kanji','k2hm','hm2k','write-en-hira','write-kanji-hira'
let currentIndex = 0;

// Score/session
let score = { correct: 0, wrong: 0, skipped: 0 };
let committing = false;
let sessionBuf = JSON.parse(localStorage.getItem("sessionBuf") || "null") || {
  deckName: "",
  mode: "",
  correct: 0, wrong: 0, skipped: 0, total: 0,
  // Extra counters (for analytics consistency)
  hiraEnCorrect: 0, enHiraCorrect: 0,
  kanjiHiraCorrect: 0, hiraKanjiCorrect: 0,
  k2hmCorrect: 0, hm2kCorrect: 0,
  writeEnHiraCorrect: 0, writeKanjiHiraCorrect: 0,
  grammarCorrect: 0
};
let currentSectionId = "deck-select";

// Marked Words / Mistakes
let markedWordsList = [];         // array of {front, back, kanji, hiragana, meaning, deck, id}
let markedMap = {};               // key = `${front}|${back}` => true
let mistakes = JSON.parse(localStorage.getItem("mistakes")||"[]");    // same shape as cards


// Audio manifest
let audioManifestLoaded = false;
let audioManifest = [];
let audioFolders = new Set();

// IME helper
let __writeIMEComposing = false;


////////////////////////
// Tiny DOM utilities //
////////////////////////
const $  = (id) => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.textContent = String(txt ?? ""); };
const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };

function statusLine(id, msg) { const el = $(id); if (el) el.textContent = msg; console.log(`[status:${id}]`, msg); }
function persistSession(){ localStorage.setItem("sessionBuf", JSON.stringify(sessionBuf)); }

// Basic helpers
function pad2(n){ return String(n).padStart(2, '0'); }
function percent(n, d){ if (!d) return 0; return Math.floor((n/d) * 100); }
function shuffleArray(arr){
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }

/////////////////
// Audio core  //
/////////////////
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
  u.rate = 0.9;
  if (ttsSpeak._voice) u.voice = ttsSpeak._voice;
  if (!ttsSpeak._voice && (speechSynthesis.getVoices() || []).length === 0) {
    speechSynthesis.onvoiceschanged = () => { ttsSpeak(text); speechSynthesis.onvoiceschanged = null; };
    return;
  }
  speechSynthesis.speak(u);
}

/** Play deck audio if available; fallback to ja-JP TTS */
function playWordAudioByIndex(deckIndex) {
  const word = currentDeck[deckIndex];
  if (!word) return;

  const canUseFiles = !!(audioManifestLoaded && currentAudioFolder);
  if (canUseFiles) {
    const nn = pad2(deckIndex + 1);
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
    console.warn("[audio] manifest failed to load → fallback to TTS:", e?.message || e);
  }
}

/////////////////////////
// CSV & Deck loading //
/////////////////////////
/** tolerant CSV parser (no dependencies) */
function parseCSV(text){
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i+1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') { /* ignore */ }
      else if (c === '"') { inQ = true; }
      else cur += c;
    }
  }
  row.push(cur);
  rows.push(row);
  return rows.filter(r => r.some(x => x && String(x).trim() !== ""));
}

/** Normalize a row to canonical fields */
function toCard(row){
  // supports both new schema (no headers): kanji,hiragana,english_meaning
  // and older variants (front/back/romaji or hiragana/meaning/kanji order)
  let kanji="", hiragana="", meaning="", front="", back="";
  if (row.length >= 3){
    // guess: [kanji, hira, meaning]
    kanji = (row[0]||"").trim();
    hiragana = (row[1]||"").trim();
    meaning = (row[2]||"").trim();
    front = hiragana || kanji;    // default "front" for audio naming
    back = meaning;
  } else if (row.length === 2) {
    // [jp, en]
    hiragana = (row[0]||"").trim();
    meaning = (row[1]||"").trim();
    front = hiragana;
    back = meaning;
  } else {
    // fallback
    front = (row[0]||"").trim();
    back  = (row[1]||"").trim();
  }
  return { kanji, hiragana, meaning, front, back };
}

async function loadDeckCSV(name, path){
  try {
    statusLine("deck-status", `Loading ${name}…`);
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);
    const cards = rows.map(toCard).filter(c =>
      (c.front && c.back) || (c.hiragana && c.meaning) || (c.kanji && c.hiragana)
    );
    decks[name] = cards;
    console.log("[deck]", path, "→", cards.length, "rows");
  } catch (e) {
    console.warn(`[deck] failed to load ${path}:`, e);
    decks[name] = [];
  }
}

async function loadDeckManifest(){
  try {
    statusLine("deck-status", "Loading decks…");
    const res = await fetch("load_vocab_decks/deck_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();       // [{name, path}] or ["Vocab-Lesson-01.csv", ...]
    deckOrder = [];
    const manifest = Array.isArray(list) ? list : [];
    for (const item of manifest) {
      let name, path;
      if (typeof item === "string") { name = item.replace(/^.*\//,"").replace(/\.csv$/i,""); path = `load_vocab_decks/${item}`; }
      else { name = item.name; path = item.path || `load_vocab_decks/${name}.csv`; }
      deckOrder.push(name);
      await loadDeckCSV(name, path);
    }
    statusLine("deck-status", `Loaded ${Object.keys(decks).length} deck(s).`);
    renderDeckButtons();
  } catch (e) {
    console.error("loadDeckManifest failed", e);
    statusLine("deck-status", `Failed to load decks: ${e?.message||e}`);
  }
}

function renderDeckButtons(){
  const box = $("deck-buttons");
  if (!box) return;
  box.innerHTML = "";
  for (const name of deckOrder){
    const btn = document.createElement("button");
    btn.className = "deck-btn";
    btn.textContent = name;
    btn.onclick = () => pickDeck(name);
    box.appendChild(btn);
  }
}

function pickDeck(name){
  currentDeckName = name;
  currentDeck = decks[name] ? [...decks[name]] : [];
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  // Resolve audio folder by deck name; only enable if in manifest
  currentAudioFolder = name;
  if (audioManifestLoaded && currentAudioFolder && !audioFolders.has(currentAudioFolder)) {
    currentAudioFolder = null;
  }
  sessionBuf = {
    deckName: name,
    mode: "",
    correct: 0, wrong: 0, skipped: 0, total: 0,
    hiraEnCorrect: 0, enHiraCorrect: 0,
    kanjiHiraCorrect: 0, hiraKanjiCorrect: 0,
    k2hmCorrect: 0, hm2kCorrect: 0,
    writeEnHiraCorrect: 0, writeKanjiHiraCorrect: 0,
    grammarCorrect: 0
  };
  persistSession();
  showSection("mode-select");
}

/////////////////////
// Mode filtering  //
/////////////////////
function filterDeckForMode(deck, m){
  const needKanji = (m === 'kanji-hira' || m === 'hira-kanji' || m === 'k2hm' || m === 'hm2k' || m === 'write-kanji-hira' || m === 'learn-kanji-hira');
  if (!needKanji) return deck;
  return deck.filter(c => {
    const k = (c.kanji||"").trim();
    return k && k !== "—";
  });
}

/////////////////
// Learn Mode  //
/////////////////
function startLearn(type){ // 'learn-hira-en' or 'learn-kanji-hira'
  mode = type;
  currentDeck = filterDeckForMode(decks[currentDeckName]||[], type);
  if (!currentDeck.length) { alert("This deck has no valid items for the selected Learn mode."); return; }
  currentIndex = 0;
  showSection("learn");
  renderLearnCard();
  updateDeckProgress();
  updateScore();
}
window.startLearn = startLearn;

function renderLearnCard(){
  const w = currentDeck[currentIndex];
  if (!w) return;
  const prompt = (mode === 'learn-hira-en') ? (w.hiragana || "—") : (w.kanji || "—");
  const answer = (mode === 'learn-hira-en') ? (w.meaning || "—") : (w.hiragana || "—");

  setHTML("learn-card", `
    <div class="flashcard">
      <div class="learn-word-row">
        <div class="learn-word">${escapeHtml(prompt)}</div>
        <button class="icon-btn" aria-label="Play" onclick="playWordAudioByIndex(currentIndex)">🔊</button>
      </div>
      <div id="learn-answer" class="learn-answer hidden"></div>
      <div class="learn-actions">
        <button id="learn-show" class="btn" onclick="learnShowDetails()">Show details（しょうさい）</button>
        <button id="learn-prev" class="btn" onclick="learnPrev()">← Prev</button>
        <button id="learn-next" class="btn" onclick="learnNext()">Next →</button>
        <button id="learn-mark-btn" class="btn" onclick="markCurrentWord()">Mark Word（マーク）</button>
      </div>
    </div>
  `);
  // Hide details initially
  $("learn-answer").classList.add("hidden");
  updateDeckProgress();
}

function learnShowDetails(){
  const w = currentDeck[currentIndex];
  const extra = `
    <div><b>Hiragana:</b> ${escapeHtml(w.hiragana||"—")}</div>
    <div><b>Meaning:</b> ${escapeHtml(w.meaning||"—")}</div>
    <div><b>Kanji:</b> ${escapeHtml(w.kanji||"—")}</div>
  `;
  const ans = $("learn-answer");
  if (ans) { ans.innerHTML = extra; ans.classList.remove("hidden"); }
}
window.learnShowDetails = learnShowDetails;

function learnNext(){ if (++currentIndex >= currentDeck.length) currentIndex = 0; renderLearnCard(); }
function learnPrev(){ if (--currentIndex < 0) currentIndex = currentDeck.length - 1; renderLearnCard(); }
window.learnNext = learnNext;
window.learnPrev = learnPrev;

/////////////////////////////
// Practice (MCQ) Modes   //
/////////////////////////////
function startPractice(selectedMode){
  mode = selectedMode;
  currentDeck = filterDeckForMode(decks[currentDeckName]||[], mode);
  if (!currentDeck.length) { alert("This deck has no valid items for that mode."); return; }
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  sessionBuf.mode = mode;
  showSection("practice");
  showQuestion();
  updateDeckProgress();
  updateScore();
}
window.startPractice = startPractice;

function fieldPlanForMode(m){
  switch (m) {
    case 'jp-en':             return { prompt: 'hiragana', answer: 'meaning', kind: 'single', count: 4 };
    case 'en-jp':             return { prompt: 'meaning',  answer: 'hiragana', kind: 'single', count: 4 };
    case 'kanji-hira':        return { prompt: 'kanji',     answer: 'hiragana', kind: 'single', count: 4 };
    case 'hira-kanji':        return { prompt: 'hiragana',  answer: 'kanji',    kind: 'single', count: 4 };
    case 'hm2k':              return { prompt: ['hiragana','meaning'], answer: 'kanji', kind: 'single', count: 6 };
    case 'k2hm':              return { prompt: 'kanji', answer: ['hiragana','meaning'], kind: 'dual', count: 6 }; // 3+3
    default:                  return { prompt: 'hiragana', answer: 'meaning', kind: 'single', count: 4 };
  }
}
function getField(w, key){ return key === 'jp' ? (w.hiragana||w.kanji||w.front) : (key==='en' ? (w.meaning||w.back) : (w[key] || "")); }

let dualPick = { hira: null, mean: null };

function showQuestion(){
  const w = currentDeck[currentIndex];
  if (!w) return nextQuestion();

  setText("extra-info", "");

  // mark button visibility
  const markBtn = $("practice-mark-btn");
  if (markBtn) {
    const qKey = w.front + "|" + w.back;
    markBtn.classList.toggle("hidden", !!markedMap[qKey]);
  }

  const plan = fieldPlanForMode(mode);
  const qb = $("question-box");
  const optionsList = $("options");
  if (!qb || !optionsList) return;

  // prompt text
  let promptHTML = "";
  if (Array.isArray(plan.prompt)) {
    promptHTML = `
      <div class="prompt-pair">
        <div><b>Hiragana:</b> ${escapeHtml(w.hiragana||"—")}</div>
        <div><b>Meaning:</b> ${escapeHtml(w.meaning||"—")}</div>
      </div>`;
  } else {
    const promptText = getField(w, plan.prompt) || "—";
    promptHTML = `<div class="learn-word-row">
      <div class="learn-word">${escapeHtml(promptText)}</div>
      <button class="icon-btn" aria-label="Play" onclick="playWordAudioByIndex(currentIndex)">🔊</button>
    </div>`;
  }

  qb.className = "flashcard";
  qb.innerHTML = promptHTML;

  // build options
  optionsList.innerHTML = "";

  if (plan.kind === "single") {
    const correct = Array.isArray(plan.answer) ? (getField(w, 'kanji')||"—") : (getField(w, plan.answer) || "—");
    const poolField = Array.isArray(plan.answer) ? 'kanji' : plan.answer;
    const options = buildSingleOptions(poolField, correct, plan.count);
    options.forEach(opt => {
      const li = document.createElement("li");
      li.className = "option";
      li.textContent = opt || "—";
      li.onclick = () => checkAnswerSingle(li, opt, correct, w);
      optionsList.appendChild(li);
    });
  } else {
    // dual: 3 hira + 3 meaning
    dualPick = { hira: null, mean: null };
    const hiraCorrect = w.hiragana || "—";
    const meanCorrect = w.meaning  || "—";
    const hiraOpts = buildSingleOptions('hiragana', hiraCorrect, 3);
    const meanOpts = buildSingleOptions('meaning',  meanCorrect, 3);

    // section headers
    const hHeader = document.createElement("li");
    hHeader.className = "option-header";
    hHeader.textContent = "Pick Hiragana（ひらがな）";
    optionsList.appendChild(hHeader);

    hiraOpts.forEach(opt => {
      const li = document.createElement("li");
      li.className = "option dual hira";
      li.textContent = opt || "—";
      li.onclick = () => {
        if (li.classList.contains("disabled")) return;
        [...optionsList.querySelectorAll("li.dual.hira")].forEach(x => x.classList.remove("selected"));
        li.classList.add("selected");
        dualPick.hira = opt;
        tryGradeDual(w, hiraCorrect, meanCorrect);
      };
      optionsList.appendChild(li);
    });

    const mHeader = document.createElement("li");
    mHeader.className = "option-header";
    mHeader.textContent = "Pick Meaning（いみ）";
    optionsList.appendChild(mHeader);

    meanOpts.forEach(opt => {
      const li = document.createElement("li");
      li.className = "option dual mean";
      li.textContent = opt || "—";
      li.onclick = () => {
        if (li.classList.contains("disabled")) return;
        [...optionsList.querySelectorAll("li.dual.mean")].forEach(x => x.classList.remove("selected"));
        li.classList.add("selected");
        dualPick.mean = opt;
        tryGradeDual(w, hiraCorrect, meanCorrect);
      };
      optionsList.appendChild(li);
    });
  }

  updateDeckProgress();
}

function buildSingleOptions(field, correct, count){
  const pool = currentDeck.map(x => (x[field]||"—")).filter(Boolean);
  const uniq = [...new Set(pool.filter(v => v !== correct))];
  shuffleArray(uniq);
  const distractors = uniq.slice(0, Math.max(0, count-1));
  const options = shuffleArray([correct, ...distractors]);
  return options;
}

function checkAnswerSingle(li, chosen, correct, word){
  const list = $("options");
  if (!list) return;

  // Color the clicked option and the correct option
  [...list.querySelectorAll("li.option")].forEach(x => x.classList.add("disabled"));
  li.classList.add(chosen === correct ? "correct" : "wrong");
  const trueLi = [...list.querySelectorAll("li.option")].find(x => x.textContent === String(correct));
  if (trueLi) trueLi.classList.add("correct");

  // Update score/session/mistakes
  sessionBuf.total++;
  if (chosen === correct) {
    score.correct++; sessionBuf.correct++;
    switch (mode) {
      case 'jp-en': sessionBuf.hiraEnCorrect++; break;
      case 'en-jp': sessionBuf.enHiraCorrect++; break;
      case 'kanji-hira': sessionBuf.kanjiHiraCorrect++; break;
      case 'hira-kanji': sessionBuf.hiraKanjiCorrect++; break;
      case 'hm2k': sessionBuf.hm2kCorrect++; break;
    }
  } else {
    score.wrong++; sessionBuf.wrong++;
    pushMistake(word);
  }
  persistSession();
  updateScore();

  setTimeout(nextQuestion, 700);
}

function tryGradeDual(word, hiraCorrect, meanCorrect){
  if (!dualPick.hira || !dualPick.mean) return;
  const list = $("options");
  if (!list) return;

  // Disable further clicks
  [...list.querySelectorAll("li.option.dual")].forEach(x => x.classList.add("disabled"));

  const hiraOK = dualPick.hira === hiraCorrect;
  const meanOK = dualPick.mean === meanCorrect;

  // colorize
  list.querySelectorAll("li.dual.hira").forEach(li => {
    if (li.textContent === hiraCorrect) li.classList.add("correct");
  });
  list.querySelectorAll("li.dual.mean").forEach(li => {
    if (li.textContent === meanCorrect) li.classList.add("correct");
  });
  const selH = list.querySelector("li.dual.hira.selected");
  const selM = list.querySelector("li.dual.mean.selected");
  if (selH && !hiraOK) selH.classList.add("wrong");
  if (selM && !meanOK) selM.classList.add("wrong");

  sessionBuf.total++;
  if (hiraOK && meanOK) { score.correct++; sessionBuf.correct++; sessionBuf.k2hmCorrect++; }
  else { score.wrong++; sessionBuf.wrong++; pushMistake(word); }
  persistSession();
  updateScore();

  setTimeout(nextQuestion, 900);
}

function nextQuestion(){
  currentIndex++;
  if (currentIndex >= currentDeck.length) {
    autoCommitIfNeeded("end-of-deck");
    currentIndex = 0; // loop
  }
  showQuestion();
}
window.nextQuestion = nextQuestion;
function skipQuestion(){
  sessionBuf.total++;
  sessionBuf.skipped++;
  score.skipped++;
  persistSession();
  updateScore();
  nextQuestion();
}
window.skipQuestion = skipQuestion;

// Key helpers for practice (ESC = skip)
function bindPracticeKeys(){
  document.addEventListener("keydown", (e) => {
    if (currentSectionId !== "practice") return;
    if (e.key === "Escape") { e.preventDefault(); skipQuestion(); }
    if (e.key === "ArrowRight") { e.preventDefault(); nextQuestion(); }
  });
}

/////////////////////////
// Writing (2 modes)   //
/////////////////////////
function startWrite(selectedMode){ // 'write-en-hira' or 'write-kanji-hira'
  mode = selectedMode;
  currentDeck = filterDeckForMode(decks[currentDeckName]||[], mode);
  if (!currentDeck.length) { alert("This deck has no valid items for the selected Writing mode."); return; }
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  sessionBuf.mode = mode;
  showSection("write");
  renderWriteItem();
  updateDeckProgress();
  updateScore();
}
window.startWrite = startWrite;

function normalizeHira(s){
  return (s||"").trim()
    .replace(/\s+/g, "")
    .replace(/ゃ/g,"ゃ").replace(/ゅ/g,"ゅ").replace(/ょ/g,"ょ")
    .replace(/っ/g,"っ"); // leave as is but trimmed
}

function renderWriteItem(){
  const w = currentDeck[currentIndex];
  if (!w) return;
  const prompt = (mode === 'write-en-hira') ? (w.meaning||"—") : (w.kanji||"—");
  setHTML("write-area", `
    <div class="flashcard">
      <div class="learn-word-row">
        <div class="learn-word">${escapeHtml(prompt)}</div>
        <button class="icon-btn" aria-label="Play" onclick="playWordAudioByIndex(currentIndex)">🔊</button>
      </div>
      <input id="write-input" class="write-input" placeholder="type hiragana（ひらがな）" autocomplete="off" />
      <div id="write-feedback" class="write-feedback"></div>
      <div class="learn-actions">
        <button class="btn" onclick="writeSubmit()">Submit（けってい）</button>
        <button class="btn" onclick="writeShowDetails()">Show details</button>
        <button class="btn" onclick="writePrev()">← Prev</button>
        <button class="btn" onclick="writeNext()">Next →</button>
        <button class="btn" onclick="writeSkip()">Skip（スキップ）</button>
        <button class="btn" onclick="markCurrentWord()">Mark Word</button>
      </div>
    </div>
  `);
  const input = $("write-input");
  if (input) {
    input.addEventListener("compositionstart", () => { __writeIMEComposing = true; });
    input.addEventListener("compositionend",   () => { __writeIMEComposing = false; });
    input.focus();
  }
}

function writeSubmit(){
  const w = currentDeck[currentIndex];
  const correct = w.hiragana || "";
  const input = $("write-input");
  if (!input) return;
  const user = normalizeHira(input.value);
  const ok = normalizeHira(correct) === user;

  const fb = $("write-feedback");
  fb.textContent = ok ? "Correct（せいかい）" : `Wrong（まちがい） → ${correct}`;
  fb.className = "write-feedback " + (ok ? "correct" : "wrong");

  sessionBuf.total++;
  if (ok) { score.correct++; sessionBuf.correct++; if (mode==='write-en-hira') sessionBuf.writeEnHiraCorrect++; else sessionBuf.writeKanjiHiraCorrect++; }
  else { score.wrong++; sessionBuf.wrong++; pushMistake(w); }
  persistSession();
  updateScore();
}
window.writeSubmit = writeSubmit;

function writeShowDetails(){
  const w = currentDeck[currentIndex];
  const fb = $("write-feedback");
  if (fb) fb.innerHTML = `
    <div><b>Hiragana:</b> ${escapeHtml(w.hiragana||"—")}</div>
    <div><b>Meaning:</b> ${escapeHtml(w.meaning||"—")}</div>
    <div><b>Kanji:</b> ${escapeHtml(w.kanji||"—")}</div>
  `;
}
window.writeShowDetails = writeShowDetails;

function writeNext(){ if (++currentIndex >= currentDeck.length) currentIndex = 0; renderWriteItem(); updateDeckProgress(); }
function writePrev(){ if (--currentIndex < 0) currentIndex = currentDeck.length - 1; renderWriteItem(); updateDeckProgress(); }
function writeSkip(){
  sessionBuf.total++; sessionBuf.skipped++; score.skipped++;
  persistSession(); updateScore(); writeNext();
}
window.writeNext = writeNext;
window.writePrev = writePrev;
window.writeSkip = writeSkip;

// Key helpers for writing: Enter submit, Ctrl+Enter next, Shift+Enter details, ESC skip
function bindWriteKeys(){
  document.addEventListener("keydown", (e) => {
    if (currentSectionId !== "write") return;
    const input = $("write-input");
    const typing = e.target === input;
    if (typing && (e.isComposing || e.keyCode === 229)) return;

    if (e.key === "Enter" && !e.shiftKey && !e.altKey) { e.preventDefault(); writeSubmit(); if (e.ctrlKey||e.metaKey) writeNext(); }
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); writeShowDetails(); }
    if (e.key === "ArrowRight") { e.preventDefault(); writeNext(); }
    if (e.key === "ArrowLeft")  { e.preventDefault(); writePrev(); }
    if (e.key === "Escape")     { e.preventDefault(); writeSkip(); }
  });
}

///////////////////////////
// Marked Words & Notes  //
///////////////////////////
function markCurrentWord(){
  const w = currentDeck[currentIndex];
  if (!w) return;
  const key = (w.front||w.hiragana||"") + "|" + (w.back||w.meaning||"");
  if (markedMap[key]) return;
  const payload = {
    front: w.front, back: w.back, hiragana: w.hiragana, meaning: w.meaning, kanji: w.kanji,
    deck: currentDeckName, id: currentIndex
  };
  markedWordsList.push(payload);
  markedMap[key] = true;
  if (window.__fb_markWord) { window.__fb_markWord(payload).catch(()=>{}); }
  localStorage.setItem("markedWordsLocal", JSON.stringify(markedWordsList));
  renderMarkedList();
  renderMistakesUI();
  const btn = $("practice-mark-btn") || $("learn-mark-btn");
  if (btn) btn.classList.add("hidden");
}
window.markCurrentWord = markCurrentWord;

function renderMarkedList(){
  // optional UI: if you have a <div id="marked-list"> somewhere
  const list = $("marked-list");
  if (!list) return;
  list.innerHTML = "";
  if (!markedWordsList.length) { list.textContent = "No marked words."; return; }
  for (const w of markedWordsList){
    const div = document.createElement("div");
    div.className = "marked-item";
    div.textContent = `${w.hiragana||w.front||"—"} — ${w.meaning||w.back||"—"}`;
    list.appendChild(div);
  }
}

// Marked/Mistakes practice
function startMarkedMode(selectedMode){
  if (!markedWordsList.length) { alert("No marked words."); return; }
  mode = selectedMode;
  currentDeckName = "Marked";
  currentDeck = filterDeckForMode(markedWordsList, selectedMode);
  if (!currentDeck.length) { alert("No valid marked items for that mode."); return; }
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  sessionBuf.mode = selectedMode;
  showSection("practice");
  showQuestion();
  updateDeckProgress();
  updateScore();
}
window.startMarkedMode = startMarkedMode;

function startMistakesMode(selectedMode){
  if (!mistakes.length) { alert("No mistakes yet."); return; }
  mode = selectedMode;
  currentDeckName = "Mistakes";
  currentDeck = filterDeckForMode(mistakes, selectedMode);
  if (!currentDeck.length) { alert("No valid mistakes for that mode."); return; }
  currentIndex = 0;
  score = { correct: 0, wrong: 0, skipped: 0 };
  sessionBuf.mode = selectedMode;
  showSection("practice");
  showQuestion();
  updateDeckProgress();
  updateScore();
}
window.startMistakesMode = startMistakesMode;

function pushMistake(w){
  try {
    mistakes.unshift(w);
    if (mistakes.length > 300) mistakes.length = 300;
    localStorage.setItem("mistakes", JSON.stringify(mistakes));
    renderMistakesUI();
  } catch {}
}

function renderMistakesUI(){
  const statusEl = $("mistakes-status");
  const modeSel = $("mistakes-mode-select");
  const n = Array.isArray(mistakes) ? mistakes.length : 0;
  if (statusEl) statusEl.textContent = n ? `You have ${n} mistake word${n===1?"":"s"}.` : "No mistakes yet.";
  if (modeSel) modeSel.classList.toggle("hidden", n === 0);
}

/////////////////
// Progress    //
/////////////////
function updateDeckProgress(){
  const totalQs = currentDeck.length || 0;
  const done = Math.min(currentIndex, totalQs);
  const p = percent(done, totalQs);
  const bar = $("deck-progress-bar");
  const txt = $("deck-progress-text");
  if (bar) bar.style.width = `${p}%`;
  if (txt) txt.textContent = `${done} / ${totalQs} (${p}%)`;
}

function updateScore(){
  setText("score-correct", score.correct);
  setText("score-wrong", score.wrong);
  setText("score-skipped", score.skipped);
}
window.updateScore = updateScore;

async function autoCommitIfNeeded(reason=""){
  if (!window.__fb_commitSession) return;
  if (committing) return;
  if (!sessionBuf || sessionBuf.total <= 0) return;
  try {
    committing = true;
    console.log("[autosave] committing buffered session", {reason, sessionBuf});
    await window.__fb_commitSession({
      deckName: sessionBuf.deckName || currentDeckName || "Unknown",
      mode: sessionBuf.mode,
      correct: sessionBuf.correct,
      wrong: sessionBuf.wrong,
      skipped: sessionBuf.skipped,
      total: sessionBuf.total,
      hiraEnCorrect: sessionBuf.hiraEnCorrect,
      enHiraCorrect: sessionBuf.enHiraCorrect,
      kanjiHiraCorrect: sessionBuf.kanjiHiraCorrect,
      hiraKanjiCorrect: sessionBuf.hiraKanjiCorrect,
      k2hmCorrect: sessionBuf.k2hmCorrect,
      hm2kCorrect: sessionBuf.hm2kCorrect,
      writeEnHiraCorrect: sessionBuf.writeEnHiraCorrect,
      writeKanjiHiraCorrect: sessionBuf.writeKanjiHiraCorrect,
      grammarCorrect: sessionBuf.grammarCorrect
    });
    // reset buffer
    sessionBuf.correct = sessionBuf.wrong = sessionBuf.skipped = sessionBuf.total = 0;
    persistSession();
    await renderProgress();
  } catch(e){
    console.warn("[autosave] failed:", e?.message||e);
  } finally { committing = false; }
}

async function renderProgress(){
  const table = $("progress-table"); if (!table) return;
  table.innerHTML = "";
  let rows = [];
  try {
    if (window.__fb_fetchAttempts) rows = await window.__fb_fetchAttempts(50);
  } catch {
    // local fallback view
    rows = JSON.parse(localStorage.getItem("attemptsLocal")||"[]");
  }
  if (!Array.isArray(rows) || rows.length === 0){
    table.innerHTML = `<div class="muted">No progress yet.</div>`;
    return;
  }
  const header = document.createElement("div");
  header.className = "table-row header";
  header.innerHTML = `<div>Time</div><div>Deck</div><div>Mode</div><div>Correct</div><div>Wrong</div><div>Skipped</div><div>Total</div>`;
  table.appendChild(header);
  for (const r of rows){
    const row = document.createElement("div");
    row.className = "table-row";
    const dt = new Date(r.ts || r.time || Date.now()).toLocaleString();
    row.innerHTML = `
      <div>${escapeHtml(dt)}</div>
      <div>${escapeHtml(r.deckName||"")}</div>
      <div>${escapeHtml(r.mode||"")}</div>
      <div>${r.correct|0}</div>
      <div>${r.wrong|0}</div>
      <div>${r.skipped|0}</div>
      <div>${r.total|0}</div>`;
    table.appendChild(row);
  }
}
window.renderProgress = renderProgress;

/////////////////////
// Grammar loading //
/////////////////////
async function loadGrammarManifest(){
  try {
    statusLine("grammar-status", "Loading Grammar manifest…");
    const res = await fetch("grammar/grammar_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json(); // e.g. ["Grammar-Lesson-1.pdf", ...]
    renderGrammarButtons(list);
    statusLine("grammar-status", `Loaded ${list.length} grammar file(s).`);
  } catch(e){
    statusLine("grammar-status", `Failed to load grammar: ${e?.message||e}`);
  }
}
function renderGrammarButtons(files){
  const box = $("grammar-list"); if (!box) return;
  box.innerHTML = "";
  for (const f of files){
    const btn = document.createElement("button");
    btn.className = "deck-btn";
    btn.textContent = f.replace(/^.*\//,"");
    btn.onclick = () => window.open(`grammar/${f}`,'_blank');
    box.appendChild(btn);
  }
}

async function loadGrammarPracticeManifest(){
  try {
    const res = await fetch("practice-grammar/manifest.csv");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCSV(await res.text());
    const files = rows.flat().map(s => String(s||"").trim()).filter(Boolean);
    renderPracticeGrammarButtons(files);
    statusLine("practice-grammar-status", `Practice-Grammar manifest OK (${files.length} file(s)).`);
  } catch(e){
    statusLine("practice-grammar-status", `Practice Grammar failed: ${e?.message||e}`);
  }
}
function renderPracticeGrammarButtons(files){
  const box = $("practice-grammar-list"); if (!box) return;
  box.innerHTML = "";
  for (const f of files){
    const btn = document.createElement("button");
    btn.className = "deck-btn";
    btn.textContent = f.replace(/^.*\//,"");
    btn.title = "Opens the CSV set in a new tab";
    btn.onclick = () => window.open(`practice-grammar/${f}`,'_blank');
    box.appendChild(btn);
  }
}

/////////////////////////
// Section navigation  //
/////////////////////////
function showSection(id){
  currentSectionId = id;
  const ids = ["deck-select","mode-select","learn","practice","write","progress",
               "marked-section","mistakes-section","grammar-section","practice-grammar-section"];
  for (const x of ids){
    const el = $(x);
    if (el) el.style.display = (x === id) ? "block" : "none";
  }
  if (id === "progress") renderProgress();
}
window.showSection = showSection;

//////////////////
// Navbar hooks //
//////////////////
window.saveCurrentScore = async function(){
  try { await autoCommitIfNeeded("manual save"); alert("Progress saved ✅"); } catch {}
};

// Keyboard bindings
bindPracticeKeys();
bindWriteKeys();

/////////////////////
// App boot        //
/////////////////////
window.onload = () => {
  loadAudioManifest();
  loadDeckManifest();
  loadGrammarManifest();
  loadGrammarPracticeManifest();
  renderProgress();
  updateScore();
  renderMistakesUI();
};

// Firebase auth bridge (optional)
window.__initAfterLogin = async () => {
  renderProgress();
  // fetch marked words if available
  if (window.__fb_fetchMarkedWords) {
    try {
      const words = await window.__fb_fetchMarkedWords();
      markedWordsList = Array.isArray(words) ? words : [];
      markedMap = {};
      for (const w of markedWordsList) {
        markedMap[(w.front||w.hiragana||"")+"|"+(w.back||w.meaning||"")] = true;
      }
      renderMarkedList();
      renderMistakesUI();
    } catch {}
  }
};
