/* script.js — rebuilt to match new spec:
   - Learn modes (2): Hiragana → English meaning, Kanji → Hiragana
   - MCQ single-answer modes (4 options total): 
       English → Hiragana, Hiragana → English, Kanji → Hiragana, Hiragana → Kanji
   - MCQ “pair” modes:
       Kanji → (Hiragana & Meaning)  → dual list (3+3 options; must select both)
       (Hiragana & Meaning) → Kanji  → single list with 6 options (harder set)
   - Writing modes (2): Kanji → Hiragana, English → Hiragana
   - Remove Today/Weekly/Overall leaderboards (all references)
   - Keep other features: deck loader, mixed multiples, notes, audio, grammar practice, progress
*/

/* =========================
   Global State
========================= */
let allDecks = {};            // { deckName: [{ kanji, hiragana, meaning, romaji, front, back, __src? }] }
let currentDeck = [];
let currentDeckName = "";
let currentIndex = 0;

let mode = "";                // practice mode name
let score = { correct: 0, wrong: 0, skipped: 0 }; // UI counters for current session

// Multi-deck (Mixed Multiples) selection
let multiSelectedDecks = new Set();

// Audio
const AUDIO_BASE = "audio";
let audioManifest = [];
let audioFolders = new Set();
let audioManifestLoaded = false;
let currentAudioFolder = null;

// Learn notes
let notesCache = {};          // { [deckName]: { [wordKey]: note } }
let learnNoteTimer = null;
let learnType = "hira-en";    // 'hira-en' | 'kanji-hira'

// Session buffer for Firebase commit (no leaderboard logic here)
let sessionBuf = JSON.parse(localStorage.getItem("sessionBuf") || "null") || {
  deckName: "",
  mode: "",
  correct: 0, wrong: 0, skipped: 0, total: 0,
  // Per-mode counters (kept generic for analytics)
  hiraEnCorrect: 0, enHiraCorrect: 0,
  kanjiHiraCorrect: 0, hiraKanjiCorrect: 0,
  k2hmCorrect: 0, hm2kCorrect: 0,
  writeEnHiraCorrect: 0, writeKanjiHiraCorrect: 0,
  grammarCorrect: 0
};
let committing = false;
let currentSectionId = "deck-select";

/* =========================
   Tiny DOM Utilities
========================= */
const $ = (id) => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.textContent = String(txt); };
const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
const setValue = (id, v) => { const el = $(id); if (el) el.value = v; };
const getValue = (id) => { const el = $(id); return el ? el.value : ""; };
function statusLine(id, msg) { const el = $(id); if (el) el.textContent = msg; console.log(`[status:${id}]`, msg); }
function persistSession(){ localStorage.setItem("sessionBuf", JSON.stringify(sessionBuf)); }
function percent(n, d){ if (!d) return 0; return Math.floor((n/d) * 100); }

/* =========================
   Audio
========================= */
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
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP'; u.rate = 0.9;
  const voices = speechSynthesis.getVoices() || [];
  const ja = voices.find(v => (v.lang||'').toLowerCase().startsWith('ja')) || null;
  if (ja) u.voice = ja;
  speechSynthesis.speak(u);
}
function pad2(n){ return String(n).padStart(2, '0'); }

async function loadAudioManifest() {
  try {
    const res = await fetch(`${AUDIO_BASE}/manifest.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    audioManifest = await res.json();
    audioFolders = new Set(audioManifest);
    audioManifestLoaded = true;
    console.log("[audio] manifest loaded:", audioManifest);
  } catch(e) {
    audioManifestLoaded = false;
    console.warn("[audio] manifest not available:", e?.message || e);
  }
}
function resolveAudioFolder(deckName){
  // "Vocab-Lesson-01" etc; fallback to exact deckName
  return deckName;
}
function playWordAudioByIndex(i) {
  const w = currentDeck[i]; if (!w) return;
  const textToSpeak = w.hiragana || w.front || "";
  if (audioManifestLoaded && currentAudioFolder && audioFolders.has(currentAudioFolder)) {
    const nn = pad2(i + 1);
    const file = `${AUDIO_BASE}/${currentAudioFolder}/${nn}_${w.front}.mp3`;
    const a = ensureAudioElement();
    let usedFile = false;
    a.oncanplay = () => { usedFile = true; try{ a.play(); }catch{} };
    a.onerror   = () => { if (!usedFile) ttsSpeak(textToSpeak); };
    a.src = file; a.load();
  } else {
    ttsSpeak(textToSpeak);
  }
}

let __writeIMEComposing = false;

function bindWriteKeys() {
  const input = document.getElementById("write-input");
  if (input) {
    input.addEventListener("compositionstart", () => { __writeIMEComposing = true; });
    input.addEventListener("compositionend",   () => { __writeIMEComposing = false; });
  }

  document.onkeydown = (e) => {
    if (currentSectionId !== "write") return;

    const isInInput = e.target && (e.target.id === "write-input");
    if ((e.isComposing || e.keyCode === 229) && isInInput) return;

    // Enter = Submit
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      writeSubmit();
      // Ctrl/Cmd + Enter => Submit + Next
      if (e.ctrlKey || e.metaKey) writeNext();
      return;
    }

    // Shift+Enter = Show details
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      writeShowDetails();
      return;
    }

    // → / ←
    if (e.key === "ArrowRight") { e.preventDefault(); writeNext(); return; }
    if (e.key === "ArrowLeft")  { e.preventDefault(); writePrev(); return; }

    // Esc = Skip（スキップ）
    if (e.key === "Escape") {
      e.preventDefault();
      writeSkip();
      return;
    }
  };
}
function bindPracticeKeys() {
  document.onkeydown = (e) => {
    if (currentSectionId !== "practice") return;

    // Esc = Skip（スキップ）
    if (e.key === "Escape") { e.preventDefault(); skipQuestion(); return; }

    // → = Next (optional helper)
    if (e.key === "ArrowRight") { e.preventDefault(); nextQuestion(); return; }
  };
}

/* =========================
   CSV parsing + Deck loading
========================= */
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
      else if (ch === ','){ row.push(cur); cur = ''; }
      else if (ch === '\n'){ row.push(cur); rows.push(row.map(s=>s.trim())); row=[]; cur=''; }
      else if (ch !== '\r'){ cur += ch; }
    }
  }
  if (cur.length || inQuotes || row.length){ row.push(cur); rows.push(row.map(s=>s.trim())); }
  return rows.filter(r => r.some(x => x && x.length));
}
async function fetchAndParseCSV(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = (await res.text()).replace(/^\uFEFF/, "");
  const table = parseCSV(text);

  const toKey = s => String(s||"").toLowerCase().trim();
  const isKana  = s => /[ぁ-んァ-ンー]/.test(s||"");
  const isKanji = s => /[一-龠々]/.test(s||"");
  const isAscii = s => !!s && /^[\x00-\x7F]+$/.test(s);

  const hasHeader = (row) => {
    if (!row || !row.length) return false;
    const h = row.map(toKey);
    const set = new Set(h);
    return set.has("kanji") || set.has("hiragana") || set.has("english") ||
           set.has("english_meaning") || set.has("meaning") ||
           set.has("romaji") || set.has("front") || set.has("back") ||
           set.has("word") || set.has("question") || set.has("answer");
  };

  const mapByHeader = (hdr, cols) => {
    const idx = (reList)=>hdr.findIndex(h=>reList.some(re=>re.test(h)));
    const col = (i)=> (i>=0 && cols[i]) ? String(cols[i]).trim() : "";
    const iK=idx([/kanji|漢字/]), iH=idx([/hiragana|ひらがな|reading|yomi/]),
          iE=idx([/english|meaning|english_meaning|gloss/]), iR=idx([/romaji|roumaji|roma/]),
          iF=idx([/front|word|question/]), iB=idx([/back|answer/]);
    let kanji=col(iK), hira=col(iH), meaning=col(iE), romaji=col(iR);
    if (!kanji && !hira && iF>=0) {
      const f = col(iF);
      if (isKanji(f)) kanji=f; else if (isKana(f)) hira=f;
    }
    if (!meaning && iB>=0) meaning=col(iB);
    const front = hira || kanji || col(iF) || "";
    const back  = meaning || col(iB) || "";
    return { kanji, hiragana: hira, meaning, romaji, front, back };
  };

  const body  = (table.length && hasHeader(table[0])) ? table.slice(1) : table;
  const header= (table.length && hasHeader(table[0])) ? table[0].map(toKey) : null;

  const out = body.map(cols => {
    if (header) return mapByHeader(header, cols);
    const a = String(cols[0]||"").trim(), b = String(cols[1]||"").trim(), c = String(cols[2]||"").trim();
    const cand = [a,b,c].filter(Boolean);
    let kanji="", hira="", meaning="", romaji="";
    for (const v of cand){ if (!hira && isKana(v) && !isKanji(v)) {hira=v; continue;} if (!kanji && isKanji(v)) {kanji=v; continue;} }
    for (const v of cand){ if (!meaning && v!==kanji && v!==hira && isAscii(v)) { meaning=v; continue; } }
    for (const v of cand){ if (v!==kanji && v!==hira && v!==meaning && isAscii(v)) { romaji=v; break; } }
    const front = hira || kanji || a || "";    // allow JP-only decks
    const back  = meaning || "";               // meaning may be blank
    return { kanji, hiragana:hira, meaning, romaji, front, back };
  }).filter(r => !!(r.front || r.hiragana || r.kanji));

  console.debug(`[deck] ${url} → ${out.length} rows`);
  return out;
}

async function loadDeckManifest(){
  try{
    statusLine("deck-status","Loading decks…");
    const res = await fetch("load_vocab_decks/deck_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status} for load_vocab_decks/deck_manifest.json`);
    const deckList = await res.json();
    deckList.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));

    allDecks = {};
    for (const file of deckList){
      const name = file.replace(/\.csv$/i,"");
      statusLine("deck-status",`Loading ${file}…`);
      const rows = await fetchAndParseCSV(`load_vocab_decks/${file}`);
      allDecks[name] = rows;
      console.debug(`[deck] ${file}: ${rows.length} rows`);
    }
    renderDeckButtons();
    renderDeckMultiSelect();
    statusLine("deck-status",`Loaded ${Object.keys(allDecks).length} deck(s).`);
  }catch(e){
    console.error("Failed to load decks:", e);
    statusLine("deck-status",`Failed to load decks: ${e?.message||e}`);
  }
}

/* =========================
   Deck selection / UI
========================= */
function renderDeckButtons(){
  const box = $("deck-buttons"); if (!box) return;
  box.innerHTML = "";
  Object.keys(allDecks).forEach(name=>{
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.onclick = () => selectDeck(name);
    box.appendChild(btn);
  });
}
function selectDeck(name){
  currentDeck = allDecks[name] || [];
  currentDeckName = name; currentIndex = 0;
  if (!currentDeck.length){ alert(`Deck "${name}" is empty or failed to load.`); return; }
  currentAudioFolder = resolveAudioFolder(name);
  // reset session buffer (no leaderboards)
  sessionBuf = {
    deckName: name, mode: "", correct:0, wrong:0, skipped:0, total:0,
    hiraEnCorrect:0, enHiraCorrect:0, kanjiHiraCorrect:0, hiraKanjiCorrect:0,
    k2hmCorrect:0, hm2kCorrect:0, writeEnHiraCorrect:0, writeKanjiHiraCorrect:0,
    grammarCorrect:0
  };
  persistSession();
  showSection("mode-select");
}

/* =========================
   Learn Mode (2 types)
========================= */
function startLearnMode(type="hira-en"){
  learnType = type; // 'hira-en' (ひらがな→英語) | 'kanji-hira' (漢字→ひらがな)
  if (!currentDeck.length) return alert("Pick a deck first!");
  showSection("learn");
  showLearnCard();
  bindLearnKeys();
  bindLearnNotes();
}
function showLearnCard(){
  const w = currentDeck[currentIndex]; if (!w) return;
  const main = (learnType === "hira-en") ? (w.hiragana || "—") : (w.kanji || "—");
  const sub  = (learnType === "hira-en")
              ? `Meaning (いみ): ${w.meaning || w.back || "(n/a)"}`
              : `Hiragana（ひらがな）: ${w.hiragana || "(n/a)"}`;
  const box = $("learn-box");
  if (box) {
    const audioBtn = `<button class="icon-btn" onclick="playWordAudioByIndex(${currentIndex})" title="Audio">🔊</button>`;
    box.className = "flashcard";
    box.innerHTML = `
      <div class="learn-word-row">
        <div class="learn-word">${main}</div>
        ${audioBtn}
      </div>
      <div class="learn-meaning muted">${sub}</div>`;
  }
  setHtml("learn-extra","");
  updateDeckProgress();
}
function showLearnDetails(){
  const w = currentDeck[currentIndex]; if (!w) return;
  const html = `
    <p><b>Kanji（漢字）:</b> ${w.kanji || "(n/a)"}</p>
    <p><b>Hiragana（ひらがな）:</b> ${w.hiragana || "(n/a)"}</p>
    <p><b>Meaning（いみ）:</b> ${w.meaning || w.back || "(n/a)"}</p>
    ${w.romaji ? `<p><b>Romaji:</b> ${w.romaji}</p>` : ""}`;
  setHtml("learn-extra", html);
}
function nextLearn(){ currentIndex = Math.min(currentIndex+1, currentDeck.length-1); showLearnCard(); bindLearnNotes(); }
function prevLearn(){ currentIndex = Math.max(currentIndex-1, 0); showLearnCard(); bindLearnNotes(); }
function bindLearnKeys(){
  document.onkeydown = (e)=>{
    if (currentSectionId !== "learn") return;
    if (e.key === "ArrowRight") nextLearn();
    if (e.key === "ArrowLeft")  prevLearn();
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); showLearnDetails(); }
  };
}
function wordKeyOf(w){ return `${w.kanji || ""}|${w.hiragana || ""}|${w.meaning || ""}`; }
async function ensureDeckNotesLoaded(deckName){
  if (notesCache[deckName]) return;
  let cloud = {};
  if (window.__fb_fetchNotes){
    try{ cloud = await window.__fb_fetchNotes(deckName); }catch{}
  }
  const local = JSON.parse(localStorage.getItem(`notes:${deckName}`) || "{}");
  notesCache[deckName] = { ...(cloud||{}), ...(local||{}) };
}
function saveLocalNotes(deckName, obj){ localStorage.setItem(`notes:${deckName}`, JSON.stringify(obj||{})); }
async function bindLearnNotes(){
  await ensureDeckNotesLoaded(currentDeckName);
  const ta = $("learn-note-text"); const st = $("learn-note-status");
  if (!ta) return;
  const key = wordKeyOf(currentDeck[currentIndex]||{});
  ta.value = (notesCache[currentDeckName]||{})[key] || "";
  if (st) st.textContent = ta.value ? "Loaded" : "—";
  ta.oninput = ()=>{
    if (st) st.textContent = "Saving…";
    clearTimeout(learnNoteTimer);
    learnNoteTimer = setTimeout(async ()=>{
      const val = (ta.value||"").trim();
      if (!notesCache[currentDeckName]) notesCache[currentDeckName] = {};
      if (val) notesCache[currentDeckName][key] = val;
      else delete notesCache[currentDeckName][key];
      saveLocalNotes(currentDeckName, notesCache[currentDeckName]);
      if (window.__fb_saveNote){
        try{ await window.__fb_saveNote({deckName:currentDeckName, wordKey:key, note:val}); if (st) st.textContent = "Saved"; }
        catch{ if (st) st.textContent = "Offline (saved locally)"; }
      } else {
        if (st) st.textContent = "Saved locally";
      }
    }, 700);
  };
}

/* =========================
   Practice (MCQ) Modes
========================= */
// Allowed modes:
// 'hira-en' (Hiragana→English)      [4 options]
// 'en-hira' (English→Hiragana)       [4 options]
// 'kanji-hira'(Kanji→Hiragana)       [4 options]
// 'hira-kanji'(Hiragana→Kanji)       [4 options]
// 'k2hm'    (Kanji→[Hiragana & Meaning]) dual columns, 3+2 distractors => 3 each (6 total)
// 'hm2k'    ([Hiragana & Meaning]→Kanji) single list, 6 options total

let dualPick = { hira:null, mean:null };

function startPractice(selectedMode){
  if (!currentDeck.length) return alert("Pick a deck first.");
  mode = selectedMode;
  currentIndex = 0;
  score = { correct:0, wrong:0, skipped:0 };
  sessionBuf = {
    deckName: currentDeckName, mode,
    correct:0, wrong:0, skipped:0, total:0,
    hiraEnCorrect:0, enHiraCorrect:0, kanjiHiraCorrect:0, hiraKanjiCorrect:0,
    k2hmCorrect:0, hm2kCorrect:0, writeEnHiraCorrect:0, writeKanjiHiraCorrect:0,
    grammarCorrect:0
  };
  persistSession();
  showSection("practice");
  bindPracticeKeys();
  showQuestion();
}

function getField(w, key){
  if (key === "en") return w.meaning || w.back || "";
  if (key === "jp") return w.hiragana || w.kanji || w.front || "";
  return w[key] || "";
}
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }

function buildDistractors(pool, fieldKey, correctValue, distractorCount){
  const seen = new Set([String(correctValue)]);
  const out = [];
  for (const w of shuffle(pool.slice())){
    const v = String(getField(w, fieldKey)).trim();
    if (!v || seen.has(v)) continue;
    out.push(v); seen.add(v);
    if (out.length >= distractorCount) break;
  }
  while (out.length < distractorCount) out.push("—");
  return out;
}

function fieldPlan(modeName){
  switch(modeName){
    case "hira-en":     return { prompt:"hiragana", answer:"en", options:4 };
    case "en-hira":     return { prompt:"en",       answer:"hiragana", options:4 };
    case "kanji-hira":  return { prompt:"kanji",    answer:"hiragana", options:4 };
    case "hira-kanji":  return { prompt:"hiragana", answer:"kanji",    options:4 };
    case "k2hm":        return { prompt:"kanji",    answer:["hiragana","en"]    }; // dual
    case "hm2k":        return { prompt:["hiragana","en"], answer:"kanji", options:6 };
    default:            return { prompt:"hiragana", answer:"en", options:4 };
  }
}

function showQuestion(){
  const q = currentDeck[currentIndex]; if (!q) return;

  const plan = fieldPlan(mode);
  // Prompt text
  const promptText = Array.isArray(plan.prompt)
    ? plan.prompt.map(k => getField(q,k)).join(" / ")
    : getField(q, plan.prompt);
  setText("question-box", promptText);

  const ulSingle = $("options");
  const dualWrap = $("dual-options");
  const ulHira   = $("options-hira");
  const ulMean   = $("options-mean");

  dualPick = { hira:null, mean:null };

  if (!Array.isArray(plan.answer)) {
    // ------- Single-answer modes -------
    const answer = getField(q, plan.answer);
    const need = (mode === "hm2k") ? 5 : (plan.options ? (plan.options-1) : 3); // hm2k → 6 total; others → 4 total
    const distractors = buildDistractors(currentDeck, plan.answer, answer, need);
    const all = shuffle([answer, ...distractors]);
    if (ulSingle){ ulSingle.innerHTML = ""; }
    all.forEach(opt=>{
      const li = document.createElement("li");
      li.textContent = opt;
      li.onclick = ()=> gradeSingle(opt, answer);
      ulSingle.appendChild(li);
    });
    ulSingle.classList.remove("hidden");
    dualWrap?.classList.add("hidden");
  } else {
    // ------- Dual-answer (k2hm) -------
    const ansH = getField(q,"hiragana");
    const ansM = getField(q,"en");

    const hiraChoices = shuffle([ansH, ...buildDistractors(currentDeck, "hiragana", ansH, 2)]);
    const meanChoices = shuffle([ansM, ...buildDistractors(currentDeck, "en",       ansM, 2)]);

    ulHira.innerHTML = "";
    hiraChoices.forEach(opt=>{
      const li = document.createElement("li");
      li.textContent = opt;
      li.onclick = ()=>{
        dualPick.hira = opt;
        ulHira.querySelectorAll("li").forEach(x=>x.classList.toggle("selected", x===li));
        tryGradeDual(ansH, ansM);
      };
      ulHira.appendChild(li);
    });

    ulMean.innerHTML = "";
    meanChoices.forEach(opt=>{
      const li = document.createElement("li");
      li.textContent = opt;
      li.onclick = ()=>{
        dualPick.mean = opt;
        ulMean.querySelectorAll("li").forEach(x=>x.classList.toggle("selected", x===li));
        tryGradeDual(ansH, ansM);
      };
      ulMean.appendChild(li);
    });

    ulSingle.classList.add("hidden");
    dualWrap.classList.remove("hidden");
  }

  updateDeckProgress();
}

function gradeSingle(selected, answer){
  const ok = (selected === answer);
  if (ok){
    score.correct++; sessionBuf.correct++; sessionBuf.total++;
    if (mode === "hira-en") sessionBuf.hiraEnCorrect++;
    if (mode === "en-hira") sessionBuf.enHiraCorrect++;
    if (mode === "kanji-hira") sessionBuf.kanjiHiraCorrect++;
    if (mode === "hira-kanji") sessionBuf.hiraKanjiCorrect++;
    if (mode === "hm2k") sessionBuf.hm2kCorrect++;
  } else {
    score.wrong++; sessionBuf.wrong++; sessionBuf.total++;
  }
  persistSession(); updateScore();
  setTimeout(()=> nextQuestion(), 400);
}

function tryGradeDual(ansH, ansM){
  if (!dualPick.hira || !dualPick.mean) return;
  // UI feedback colors
  const paint = (ul, correctVal) => {
    Array.from(ul.children).forEach(li=>{
      li.classList.remove("correct","wrong");
      if (li.textContent === correctVal) li.classList.add("correct");
      else if (li.classList.contains("selected")) li.classList.add("wrong");
    });
  };
  paint($("options-hira"), ansH);
  paint($("options-mean"), ansM);

  const ok = (dualPick.hira === ansH) && (dualPick.mean === ansM);
  if (ok){ score.correct++; sessionBuf.correct++; sessionBuf.total++; sessionBuf.k2hmCorrect++; }
  else    { score.wrong++;   sessionBuf.wrong++;   sessionBuf.total++; }
  persistSession(); updateScore();
  setTimeout(()=> nextQuestion(), 650);
}

function nextQuestion(){
  if (!currentDeck.length) return;
  if (currentIndex >= currentDeck.length - 1){
    // End of deck
    updateDeckProgress();
    autoCommitIfNeeded("end of practice");
    setHtml("extra-info","🎉 Finished this deck.");
    return;
  }
  currentIndex++;
  setHtml("extra-info","");
  showQuestion();
}
function skipQuestion(){
  score.skipped++; sessionBuf.skipped++; sessionBuf.total++;
  persistSession(); updateScore(); nextQuestion();
}
window.skipQuestion = skipQuestion;

/* =========================
   Write Modes (2)
========================= */
let writeType = "en->hira"; // 'en->hira' | 'kanji->hira'

function startWriteWords(type='en->hira'){
  if (!currentDeck.length) return alert("Pick a deck first.");
  writeType = type;
  currentIndex = 0;
  score = { correct:0, wrong:0, skipped:0 };
  sessionBuf = {
    deckName: currentDeckName, mode:"write",
    correct:0, wrong:0, skipped:0, total:0,
    writeEnHiraCorrect:0, writeKanjiHiraCorrect:0,
    hiraEnCorrect:0, enHiraCorrect:0, kanjiHiraCorrect:0, hiraKanjiCorrect:0,
    k2hmCorrect:0, hm2kCorrect:0, grammarCorrect:0
  };
  persistSession();
  showSection("write");
  renderWriteCard();
  writeUpdateProgress();
}
function normalizeKana(s){ if (!s) return ""; return s.replace(/\s+/g,"").trim(); }
function writePrompt(w){ return (writeType === "en->hira") ? (w.meaning || w.back || "") : (w.kanji || w.front || ""); }
function writeExpected(w){ return (w.hiragana || "").trim(); }
function renderWriteCard(){
  const w = currentDeck[currentIndex]; if (!w) return;
  setHtml("write-card", `<div class="learn-word">${writePrompt(w)}</div>
                         <div class="muted">${writeType === 'en->hira' ? 'Type the HIRAGANA' : 'Type the HIRAGANA reading'}</div>`);
  setValue("write-input","");
  setHtml("write-feedback","");
}
function writeSubmit(){
  const w = currentDeck[currentIndex]; if (!w) return;
  const user = normalizeKana(getValue("write-input"));
  const ans  = normalizeKana(writeExpected(w));
  const ok = (user === ans);
  if (ok){
    score.correct++; sessionBuf.correct++; sessionBuf.total++;
    if (writeType === "en->hira") sessionBuf.writeEnHiraCorrect++; else sessionBuf.writeKanjiHiraCorrect++;
    setHtml("write-feedback","✅ Correct!");
  } else {
    score.wrong++; sessionBuf.wrong++; sessionBuf.total++;
    setHtml("write-feedback",`❌ ${user || "(blank)"} → ${ans}`);
  }
  persistSession(); updateScore();
}
function writeSkip(){ score.skipped++; sessionBuf.skipped++; sessionBuf.total++; persistSession(); updateScore(); writeNext(); }
function writeNext(){
  currentIndex = Math.min(currentIndex+1, currentDeck.length-1);
  renderWriteCard(); writeUpdateProgress();
}
function writeShowDetails(){
  const w = currentDeck[currentIndex]; if (!w) return;
  setHtml("write-feedback", `
    <p><b>Kanji（漢字）:</b> ${w.kanji || "(n/a)"}</p>
    <p><b>Hiragana（ひらがな）:</b> ${w.hiragana || "(n/a)"}</p>
    <p><b>Meaning（いみ）:</b> ${w.meaning || w.back || "(n/a)"}</p>
    ${w.romaji ? `<p><b>Romaji:</b> ${w.romaji}</p>`: ""}`);
}
function writeUpdateProgress(){
  const total = currentDeck.length || 0;
  const done  = Math.min(currentIndex, total);
  const p = percent(done, total);
  const bar = $("write-progress-bar"); const txt = $("write-progress-text");
  if (bar) bar.style.width = `${p}%`;
  if (txt) txt.textContent = `${done} / ${total} (${p}%)`;
}

/* =========================
   Progress (lightweight, no leaderboards)
========================= */
async function autoCommitIfNeeded(reason=""){
  if (!window.__fb_commitSession) return;
  if (committing) return;
  if (!sessionBuf || sessionBuf.total <= 0) return;
  try {
    committing = true;
    console.log("[autosave] committing", { reason, sessionBuf });
    await window.__fb_commitSession({ ...sessionBuf });
    // reset counters after commit
    sessionBuf.correct=0; sessionBuf.wrong=0; sessionBuf.skipped=0; sessionBuf.total=0;
    persistSession();
    await renderProgress();
  } catch(e){ console.warn("[autosave] failed:", e?.message||e); }
  finally{ committing = false; }
}

async function renderProgress(){
  // optional UI: table of last attempts (firebase.js provides __fb_fetchAttempts)
  if (!window.__fb_fetchAttempts) return;
  try {
    const attempts = await window.__fb_fetchAttempts(50);
    const tbody = $("progress-table")?.querySelector("tbody");
    if (tbody){
      tbody.innerHTML = "";
      attempts.slice(0, 20).forEach(a=>{
        const tr = document.createElement("tr");
        const when = a.createdAt ? new Date(a.createdAt).toLocaleString() : "—";
        tr.innerHTML = `
          <td>${when}</td>
          <td>${a.deckName || "—"}</td>
          <td>${a.mode || "—"}</td>
          <td>${a.correct ?? 0}</td>
          <td>${a.wrong ?? 0}</td>
          <td>${a.skipped ?? 0}</td>
          <td>${a.total ?? ((a.correct||0)+(a.wrong||0)+(a.skipped||0))}</td>`;
        tbody.appendChild(tr);
      });
    }
  }catch(e){ console.warn("renderProgress failed:", e?.message||e); }
}

/* =========================
   Mixed Multiples (global)
========================= */
function renderDeckMultiSelect(){
  const box = $("mix-deck-list"); if (!box) return;
  box.innerHTML = "";
  Object.keys(allDecks).forEach(name=>{
    const lbl = document.createElement("label");
    lbl.className = "mix-item";
    const cb = document.createElement("input"); cb.type="checkbox";
    cb.onchange = ()=> { if (cb.checked) multiSelectedDecks.add(name); else multiSelectedDecks.delete(name); };
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(" " + name));
    box.appendChild(lbl);
  });
}
function startMixedPractice(selectedMode){
  // build mixed pool
  const chosen = [...multiSelectedDecks];
  if (!chosen.length) return alert("Select decks to mix first.");
  const pool = [];
  chosen.forEach(name=>{
    (allDecks[name]||[]).forEach(r => pool.push({ ...r, __src:name }));
  });
  if (!pool.length) return alert("Selected decks are empty.");
  currentDeck = shuffle(pool);
  currentDeckName = `Mixed(${chosen.length})`;
  startPractice(selectedMode);
}
window.startMixedPractice = startMixedPractice;

/* =========================
   Grammar (optional)
========================= */
async function loadGrammarManifest(){
  try{
    const res = await fetch("grammar/grammar_manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json(); // may include PDFs / CSVs; we just show status
    statusLine("grammar-status", `Loaded ${Array.isArray(list)? list.length : 0} grammar file(s).`);
    // no UI binding required now; avoids undefined function errors
  }catch(e){
    statusLine("grammar-status", `Failed to load grammar: ${e?.message||e}`);
  }
}
async function loadGrammarPracticeManifest(){
  try{
    const res = await fetch("practice-grammar/manifest.csv");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const table = parseCSV((await res.text()).replace(/^\uFEFF/,""));
    const looksHeader = r => r && r[0] && /file|path|lesson/i.test(String(r[0]));
    const body = table.length && looksHeader(table[0]) ? table.slice(1) : table;
    const files = body.map(r => String((r && r[0]) || "").trim()).filter(Boolean);
    statusLine("grammar-status", `Practice-Grammar manifest OK (${files.length} file(s)).`);
  }catch(e){
    statusLine("grammar-status", `Practice-Grammar load failed: ${e?.message||e}`);
  }
}

/* =========================
   Shared UI helpers
========================= */
function updateScore(){
  setText("correct", score.correct);
  setText("wrong",   score.wrong);
  setText("skipped", score.skipped);
}
function updateDeckProgress(){
  const total = currentDeck.length || 0;
  const done  = Math.min(currentIndex, total);
  const p = percent(done, total);
  const bar = $("deck-progress-bar"); const txt = $("deck-progress-text");
  if (bar) bar.style.width = `${p}%`;
  if (txt) txt.textContent = `${done} / ${total} (${p}%)`;
}
function showSection(id){
  // autosave when leaving practice/write
  if (currentSectionId === "practice" && id !== "practice") autoCommitIfNeeded("leave practice");
  if (currentSectionId === "write" && id !== "write")       autoCommitIfNeeded("leave write");

  document.querySelectorAll(".main-content main > section").forEach(sec => sec.classList.add("hidden"));
  const el = $(id); if (el) el.classList.remove("hidden");
  currentSectionId = id;

  // per-section one-off updates
  if (id === "practice") updateDeckProgress();
  if (id === "write")    writeUpdateProgress();
}
window.showSection = showSection;

/* =========================
   App bootstrap
========================= */
window.onload = () => {
  loadAudioManifest();
  loadDeckManifest();
  loadGrammarManifest();
  loadGrammarPracticeManifest();
  renderProgress();
  updateScore();
};

// (optional) expose some starters globally for HTML onclick
window.startPractice = startPractice;
window.startLearnMode = startLearnMode;
window.prevLearn = prevLearn;
window.nextLearn = nextLearn;
window.showLearnDetails = showLearnDetails;
window.startWriteWords = startWriteWords;
window.writeSubmit = writeSubmit;
window.writeSkip = writeSkip;
window.writeNext = writeNext;
/* === Compatibility shims & helpers === */

// 1) Learn details: keep existing HTML calling showLearnRomaji()
if (typeof showLearnDetails === "function") {
  window.showLearnRomaji = showLearnDetails;
}

// 2) Practice: “Show Details / Show Meaning” buttons -> fill #extra-info
function showRomaji() {
  const w = (window.currentDeck || [])[window.currentIndex || 0];
  if (!w) return;
  const html = `
    <b>Details:</b>
    Kanji: ${w.kanji || "(n/a)"} ・
    Hiragana: ${w.hiragana || "(n/a)"} ・
    Meaning: ${w.meaning || w.back || "(n/a)"}
  `;
  const el = document.getElementById("extra-info");
  if (el) el.innerHTML = html;
}
function showMeaning() {
  const w = (window.currentDeck || [])[window.currentIndex || 0];
  if (!w) return;
  const el = document.getElementById("extra-info");
  if (el) el.innerHTML = `Meaning: <b>${w.meaning || w.back || "(n/a)"}</b>`;
}
window.showRomaji = showRomaji;
window.showMeaning = showMeaning;

// 3) Learn notes: Save button calls learnNoteSaveNow()
function learnNoteSaveNow() {
  // flush debounced saver used in Learn textarea
  const ta = document.getElementById("learn-note-text");
  if (!ta) return;
  // Reuse the oninput handler that bindLearnNotes() sets up
  const ev = new Event("input", { bubbles: true });
  ta.dispatchEvent(ev);
}
window.learnNoteSaveNow = learnNoteSaveNow;

// 4) Mix: Select All / None
function multiSelectDeckAll() {
  const list = document.querySelectorAll("#mix-deck-list input[type=checkbox]");
  window.multiSelectedDecks = new Set(Object.keys(window.allDecks || {}));
  list.forEach(cb => { cb.checked = true; });
}
function multiSelectDeckNone() {
  const list = document.querySelectorAll("#mix-deck-list input[type=checkbox]");
  window.multiSelectedDecks = new Set();
  list.forEach(cb => { cb.checked = false; });
}
window.multiSelectDeckAll = multiSelectDeckAll;
window.multiSelectDeckNone = multiSelectDeckNone;

// 5) Mark current word (local persistence + small toast)
function wordKeyOfLocal(w) { return `${w?.kanji || ""}|${w?.hiragana || ""}|${w?.meaning || ""}`; }
function showToast(msg){
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1200);
}
function markCurrentWord() {
  const deck = window.currentDeckName || "Unknown";
  const w = (window.currentDeck || [])[window.currentIndex || 0];
  if (!w) return;
  const storeKey = "markedWords";
  const key = `${deck}::${wordKeyOfLocal(w)}`;
  const bag = JSON.parse(localStorage.getItem(storeKey) || "{}");
  bag[key] = { deck, item: w, ts: Date.now() };
  localStorage.setItem(storeKey, JSON.stringify(bag));
  showToast("📌 Marked this vocab ✓");
}
window.markCurrentWord = markCurrentWord;
