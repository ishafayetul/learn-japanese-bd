/* =========================================================
   Learn Japanese — App Script (no-manifest, folder scan)
   - Scans ${LEVEL_BASE}/{N5|N4|N3}/Lesson-XX/
   - Video: loads ALL CSV rows into cards; click → large player
   - Vocab: loads canonical CSV(s) only (no part-* probing)
   - Grammar: lesson-XX.pdf or Lesson.pdf
   - Firebase calls are gated by whenFBReady()
   - Clean view switching: always clears previous pane
   - Write shortcuts: Enter=Submit, Ctrl+Enter=Next, Esc=Skip,
     Right Arrow=Next, Left-Shift+M=Mark
   ========================================================= */

// Wait until firebase.js finished and window.FB is ready
// --- bootstrap so navigateLevel() never touches undefined ---
window.App = window.App || {};
// Relative base for all lesson assets
const LEVEL_BASE = window.APP_LEVEL_BASE || "level";

async function whenFBReady(timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (window.FB && window.FB.isReady) return window.FB;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Firebase not ready");
}

(() => {
  "use strict";

  // ---------- DOM ----------
  const D = (sel) => document.querySelector(sel);
  const A = (sel) => Array.from(document.querySelectorAll(sel));

  // Auth
  const elAuthGate = D("#auth-gate");
  const elAuthBtn = D("#auth-btn");
  const elAuthErr = D("#auth-error");
  const elSignOut = D("#signout-btn");

  // Shell
  const elApp = D("#app-root");
  const elBack = D("#back-btn");
  const elCrumbLevel = D("#crumb-level");
  const elCrumbLesson = D("#crumb-lesson");
  const elCrumbMode = D("#crumb-mode");

  const elLevelShell = D("#level-shell");
  const elLessonList = D("#lesson-list");
  const elLessonStatus = D("#lesson-status");
  const elLessonArea = D("#lesson-area");
  const elLessonTitle = D("#lesson-title");
  const elLessonAvail = D("#lesson-availability");

  // Tabs
  const elTabVideos = D("#tab-videos");
  const elTabVocab = D("#tab-vocab");
  const elTabGrammar = D("#tab-grammar");
  const elVideoStatus = D("#video-status");
  const elVideoCards = D("#video-cards");

  const elVocabStatus = D("#vocab-status");

  // Practice shared
  const elQuestionBox = D("#question-box");
  const elOptions = D("#options");
  const elExtraInfo = D("#extra-info");
  const elDeckBar = D("#deck-progress-bar");
  const elDeckText = D("#deck-progress-text");

  // Learn
  const elLearn = D("#learn");
  const elLearnBox = D("#learn-box");

  // Write
  const elWrite = D("#write");
  const elWriteCard = D("#write-card");
  const elWriteInput = D("#write-input");
  const elWriteFeedback = D("#write-feedback");
  const elWriteBar = D("#write-progress-bar");
  const elWriteText = D("#write-progress-text");

  // Make sentence
  const elMake = D("#make");
  const elMakeCard = D("#make-card");
  const elMakeInput = D("#make-input");
  const elMakeFeedback = D("#make-feedback");
  const elMakeBar = D("#make-progress-bar");
  const elMakeText = D("#make-progress-text");

  // Grammar
  const elOpenGrammarPDF = D("#open-grammar-pdf");
  const elPgArea = D("#pg-area");
  const elPgCard = D("#pg-card");
  const elPgInput = D("#pg-input");
  const elPgBar = D("#pg-progress-bar");
  const elPgText = D("#pg-progress-text");
  const elPgFeedback = D("#pg-feedback");
  const elPgFiles = D("#pg-file-buttons");
  const elPgStatus = D("#pg-status");

  // Score
  const elCorrect = D("#correct");
  const elWrong = D("#wrong");
  const elSkipped = D("#skipped");

  // Sections
  const elProgressSection = D("#progress-section");
  const elLeaderboardSection = D("#leaderboard-section");
  const elMistakesSection = D("#mistakes-section");
  const elMarkedSection = D("#marked-section");
  const elSignWordSection = D("#signword-section");

  // Progress tables
  const elProgressLast = D("#progress-last");
  const elProgressPrev = D("#progress-prev");
  const elProgressDelta = D("#progress-delta");
  const elProgressTable = D("#progress-table tbody");
  const elWriteProgressTable = D("#write-progress-table tbody");

  // Leaderboard
  const elOverallLB = D("#overall-leaderboard-list");

  // Marked + SignWord
  const elMistakesStatus = D("#mistakes-status");
  const elMarkedStatus = D("#marked-status");
  const elMarkedContainer = D("#marked-container");
  const elSWFront = D("#sw-front");
  const elSWBack = D("#sw-back");
  const elSWRomaji = D("#sw-romaji");
  const elSWList = D("#signword-list");

  // Word List section
  const elWordListSection = document.querySelector("#wordlist-section");
  const elWLCreateBtn = document.querySelector("#wl-create-btn");
  const elWLNameInput = document.querySelector("#wl-new-name");
  const elWLRefreshBtn = document.querySelector("#wl-refresh-btn");
  const elWLListUL = document.querySelector("#wl-list-ul");
  const elWLEmpty = document.querySelector("#wl-empty");
  const elWLFlow = document.querySelector("#wl-flow");
  const elWLMix = document.querySelector("#wl-mix");
  const elWLTitleMix = document.querySelector("#wl-list-title-mix");
  const elWLTitleTable = document.querySelector("#wl-list-title-table");
  const elWLMixPicker = document.querySelector("#wl-mix-picker");
  const elWLBuildFromMix = document.querySelector("#wl-build-from-mix");
  const elWLCancelMix = document.querySelector("#wl-cancel-mix");
  const elWLWordTable = document.querySelector("#wl-wordtable");
  const elWLTableWrap = document.querySelector("#wl-table-wrap");
  const elWLSearch = document.querySelector("#wl-search");
  const elWLAddSelected = document.querySelector("#wl-add-selected");
  const elWLBulkCsv = document.querySelector("#wl-bulk-csv");
  const elWLBulkAdd = document.querySelector("#wl-add-bulk");
  const elWLCloseWordTable = document.querySelector("#wl-close-wordtable");

  setupDeployToast();

  // Toast
  const elToast = D("#toast");
// Mobile nav controls
const elSidebar   = D("#sidebar");
const elNavToggle = D("#nav-toggle");
const elNavScrim  = D("#nav-scrim");

function setNavOpen(open){
  if (!elSidebar) return;
  const on = !!open;
  document.body.classList.toggle("nav-open", on);
  elSidebar.classList.toggle("open", on);
  if (elNavToggle) elNavToggle.setAttribute("aria-expanded", on ? "true" : "false");
}


elNavToggle?.addEventListener("click", () => {
  setNavOpen(!document.body.classList.contains("nav-open"));
});

elNavScrim?.addEventListener("click", () => setNavOpen(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setNavOpen(false); });

// Close the menu after a nav click (any button inside the sidebar)
elSidebar?.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn) setNavOpen(false);
});

// If the viewport crosses the breakpoint, ensure the drawer is closed
window.matchMedia("(max-width: 900px)")
  .addEventListener("change", () => setNavOpen(false));

  // --- Landing page helpers (auth gate) ---
function landingGreeting() {
  const h = new Date().getHours();
  if (h < 11)  return "おはよう — Good morning!";
  if (h < 18)  return "こんにちは — Good afternoon!";
  return "こんばんは — Good evening!";
}

let __kanaTimer = null;
  function startKanaSparks() {
    const host = document.querySelector(".device-screen");   // the phone-like panel
    if (!host || __kanaTimer) return;                        // don’t start twice / if not found
    __kanaTimer = setInterval(() => spawnKanaSpark(host), 220); // add one floating kana every 220ms
  }

  window.WLAddCtx = { active:false, listId:null, listName:null, staged:[] };


function spawnKanaSpark(host){
  const chars = ["あ","い","う","え","お","日","本","語","学","習","読","書","話","早","速","力"];
  const s = document.createElement("div");
  s.className = "kana-spark";
  s.textContent = chars[Math.floor(Math.random()*chars.length)];
  const x = 18 + Math.random() * (host.clientWidth - 36);
  const y = host.clientHeight - 22 - Math.random()*6;
  const dur = 1200 + Math.random()*1200;
  s.style.left = x + "px";
  s.style.top  = y + "px";
  s.style.animationDuration = dur + "ms";
  host.appendChild(s);
  setTimeout(() => s.remove(), dur + 60);
}

function burstKanaSparks(count = 28){
  const host = document.querySelector(".device-screen");
  if (!host) return;
  for (let i = 0; i < count; i++){
    setTimeout(() => spawnKanaSpark(host), i * 18);
  }
}

function stopKanaSparks(){
  if (__kanaTimer) { clearInterval(__kanaTimer); __kanaTimer = null; }
}

function initLanding() {
  const gate = document.getElementById("auth-gate");
  if (!gate) return;
  const yEl = document.getElementById("landing-year");
  const aEl = document.getElementById("landing-author");
  const gEl = document.getElementById("landing-greeting");
  if (yEl) yEl.textContent = String(new Date().getFullYear());
  if (aEl) aEl.textContent = String(window.SITE_AUTHOR || "Your Name");
  if (gEl) gEl.textContent = landingGreeting();
  startKanaSparks();
}

// visibility helper
const isVisible = (sel) => !document.querySelector(sel)?.classList.contains("hidden");
function prevLearn(){
  if (App.qIndex > 0){ App.qIndex--; renderLearnCard(); }
}
function nextLearn(){
  if (App.qIndex < App.deckFiltered.length - 1){ App.qIndex++; renderLearnCard(); }
}

function removeListActions(){
  document.querySelector("#list-actions")?.remove();
}

function injectListActions(source, payload){
  removeListActions();
  const hostCard = document.querySelector("#tab-vocab .card"); // the big “Vocabulary” card
  if (!hostCard) return;

  const row = document.createElement("div");
  row.id = "list-actions";
  row.className = "action-row"; // small toolbar above the card

  if (source === "mistakes"){
    row.innerHTML = `<button id="btn-clear-mistakes" class="danger">🗑️ Clear Mistakes</button>`;
    row.querySelector("#btn-clear-mistakes").addEventListener("click", ()=>{
      setMistakes([]);
      toast("Mistakes cleared");

      // 👇 leave the Vocab view and hide the action row
      removeListActions();
      hideContentPanes();
      document.querySelector("#mistakes-section")?.classList.remove("hidden");
      renderMistakesLanding();
      updateBackVisibility();
    });

  }else if (source === "wordlist"){
    const { listId, listName } = payload || {};
    row.innerHTML = `
      <div class="row" style="gap:.5rem; flex-wrap:wrap;">
        <strong>List:</strong> <span>${escapeHTML(listName||listId)}</span>
        <span class="muted">—</span>
        <button id="btn-wl-add">➕ Add words</button>
        <button id="btn-wl-rename">✏️ Rename</button>
        <button id="btn-wl-manage">⚙️ Unselect individually</button>
        <button id="btn-wl-delete" class="danger">🗑 Delete list</button>
      </div>
    `;
    row.querySelector("#btn-wl-add").addEventListener("click", ()=>{
    hideContentPanes();
    document.querySelector("#wordlist-section")?.classList.remove("hidden");
    openWLAddWords(listId, listName);
    });
    row.querySelector("#btn-wl-rename").addEventListener("click", async ()=>{
      const nn = prompt("Rename list to:", listName||""); if (!nn) return;
      const fb = await whenFBReady(); await fb.lists.renameList(listId, nn);
      toast("Renamed."); openWordListAsVocab(listId, nn);
    });
    row.querySelector("#btn-wl-manage").addEventListener("click", ()=> openWLManage(listId, listName));
    row.querySelector("#btn-wl-delete").addEventListener("click", async ()=>{
      if (!confirm("Delete this list and all its words?")) return;
      const fb = await whenFBReady(); await fb.lists.deleteList(listId);
      toast("List deleted."); openSection("wordlist");
    });
  }
 
  else { // marked
      row.innerHTML = `<button id="btn-unmark-some" class="danger">❌ Unmark Words</button>`;
      row.querySelector("#btn-unmark-some").addEventListener("click", openUnmarkModal);
    }
  // place the toolbar just above the vocab card
  hostCard.parentNode.insertBefore(row, hostCard);
}

// show only the lesson tabs (no tab content)
function showLessonTabsOnly(){
  ["#tab-videos","#tab-vocab","#tab-grammar"].forEach(s => document.querySelector(s)?.classList.add("hidden"));
  document.querySelector("#lesson-area")?.classList.remove("hidden");
  hideLessonsHeaderAndList();
  showLessonBar();
  updateBackVisibility();
}

// show only the lesson list (default right pane)
function showLessonListOnly(){
  showLessonsHeaderAndList();
  document.querySelector("#lesson-area")?.classList.add("hidden");
  document.querySelector("#level-shell")?.classList.remove("hidden");
  updateBackVisibility();
}

// ---------- State (safe bootstrap) ----------
const App = Object.assign(window.App, {
  level: null, lesson: null, tab: "videos", mode: null,
  learnVariant: null,
  deck: [], deckFiltered: [], qIndex: 0,
  stats: { right: 0, wrong: 0, skipped: 0 },
  write: { order: [], idx: 0, variant: "en2h" },
  make: { order: [], idx: 0 },
  pg:   { rows: [], idx: 0 },
  buffer: { points: 0, lastSavedSig: null },
  mix: { active:false, selection:[], deck: [] },
  cache: { lessons: new Map(), vocab: new Map(), vocabCsvFiles: new Map() },
  match: {
    active: false,
    variant: null,                 // "eh" or "keh"
    roundWords: [],                // current slice (up to 5)
    solved: new Set(),             // solved keys within the current round
    picks: { kanji:null, hira:null, en:null },   // current selection by column

    // NEW – full-deck round scheduler
    queue: [],                     // full unique, de-duped deck for this mode
    pos: 0,                        // index of next slice start
    total: 0,                      // total items in queue
    solvedTotal: 0,                // how many have been solved across all rounds (no repeats)
    dom: null                      // cached DOM refs for keyboard targeting
  }

});
// keep a stable global reference
window.App = App;

function attemptSig(){
  return JSON.stringify({
    level:  App.level || null,
    lesson: App.lesson || null,
    deckId: currentDeckId(),
    mode:   App.mode || null,
    right:  App.stats.right|0,
    wrong:  App.stats.wrong|0,
    skipped:App.stats.skipped|0
  });
}


function setupDeployToast(){
  const KEY = "lj_app_version";

  // Read version from the <script> tag (data-version or ?v= param)
  function readAppVersion(){
    try{
      // Prefer the script tag that loaded this file
      const thisScript =
        document.currentScript ||
        Array.from(document.scripts).find(s => (s.src || "").includes("/script.js"));

      if (!thisScript) return null;

     
      // 1) data-version wins
      const dv = thisScript.dataset?.version;
      if (dv) return dv;

      // 2) fallback to the query param ?v=...
      const u = new URL(thisScript.src, location.href);
      return u.searchParams.get("v");
    }catch{ return null; }
  }

  function notifyOnNewDeploy(){
    const ver = readAppVersion() || "dev";
    try{
      const prev = localStorage.getItem(KEY);
      if (prev !== ver){
        // Show only when the version changed since last load
        setTimeout(() => toast(`You are Updated 🚀`), 450);
        localStorage.setItem(KEY, ver);
      }
    }catch{
      // If localStorage is blocked (e.g., private mode), still show once
      setTimeout(() => toast(`You are Updated 🚀`), 450);
    }
  }

  // Run after DOM is ready so toast can render
  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", notifyOnNewDeploy, { once:true });
  } else {
    notifyOnNewDeploy();
  }
}
  // ---------- Utils ----------
  const pad2 = (n) => String(n).padStart(2, "0");
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function toast(msg, ms = 1800) { elToast.textContent = msg; elToast.classList.add("show"); setTimeout(()=>elToast.classList.remove("show"), ms); }
  function escapeHTML(s){ return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }
  function setCrumbs(){ elCrumbLevel.textContent = App.level || "—"; elCrumbLesson.textContent = App.lesson || "—"; elCrumbMode.textContent = App.mode || "—"; }
  function updateScorePanel(){ elCorrect.textContent = App.stats.right; elWrong.textContent = App.stats.wrong; elSkipped.textContent = App.stats.skipped; }
  function incrementPoints(n=1){ App.buffer.points += n; updateScorePanel(); }
  function parseCSV(text){
    const rows=[]; let i=0,field="",inQ=false,row=[];
    if (text && text.charCodeAt && text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    while(i<text.length){ const c=text[i];
      if(inQ){ if(c==='"'){ if(text[i+1]==='"'){field+='"'; i++;} else inQ=false; } else field+=c; }
      else { if(c==='"') inQ=true;
        else if(c===','){ row.push(field); field=""; }
        else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n') i++; row.push(field); field=""; if(row.length>1||(row.length===1&&row[0].trim()!=="")) rows.push(row); row=[]; }
        else field+=c; }
      i++;
    }
    if(field!==""||row.length){ row.push(field); rows.push(row); }
    return rows.map(r=>r.map(v=>v.trim()));
  }
  function shuffle(a){ const x=a.slice(); for(let i=x.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [x[i],x[j]]=[x[j],x[i]]; } return x; }
  function keyForWord(w){ return `${w.kanji || "—"}|${w.hira}|${w.en}`.toLowerCase(); }
  function speakJa(t){ try{ const u=new SpeechSynthesisUtterance(t); u.lang="ja-JP"; speechSynthesis.cancel(); speechSynthesis.speak(u);}catch{} }
  function pct(a,b){ if(!b) return "0%"; return Math.round((a/b)*100)+"%"; }
  function currentDeckId(){
    if (App.mix?.active && App.mix.selection?.length){
      const list = App.mix.selection.map(s => `${s.level}/${s.lesson}`).join(",");
      return `Mix:${list}`;
    }
    return (App.level && App.lesson) ? `${App.level}/${App.lesson}` : (App.lesson || App.level || "-");
  }
  function sampleFiveForMatch(variant){
    // base pool depends on variant: "keh" requires actual kanji
    const hasKanji = w => {
      const k = (w.kanji || "").trim();
      return k && k !== "—" && k !== "?";
    };
    const pool = (variant === "keh") ? (App.deck || []).filter(hasKanji) : (App.deck || []);
    const uniq = [];
    const seen = new Set();
    for (const w of shuffle(pool)){
      const k = keyForWord(w);
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(w);
      if (uniq.length === 5) break;
    }
    return uniq;
  }

  async function buildPickerRowsMerged(){
  let remote = [], local = [], signed = [];
  const fb = await whenFBReady().catch(()=>null);

  try { if (fb) remote = await fb.listMarked(); } catch {}
  try { local = getLocalMarked() || []; } catch {}
  try { if (fb) signed = await fb.signWordList(); } catch {}

  const byKey = new Map();
  const ensure = (k) => {
    if (!byKey.has(k)){
      byKey.set(k, { key:k, front:"", back:"", signId:null, hasRemote:false, hasLocal:false, localId:null });
    }
    return byKey.get(k);
  };

  // Firestore Marked (ids are already safe)
  for (const r of remote){
    const row = ensure(r.id);
    row.hasRemote = true;
    row.front ||= r.front || r.hira || "";
    row.back  ||= r.back  || r.en   || "";
  }

  // Sign Words (share the same safe key via markedId)
  for (const s of signed){
    const k = s.markedId || toSafeKey(`${s.front}::${s.back}`);
    const row = ensure(k);
    row.signId = s.id;
    if (!row.front){ row.front = s.front; row.back = s.back; }
  }

  // Local Marked (offline)
  for (const l of local){
    const f = l.front || l.hira || "";
    const b = l.back  || l.en   || "";
    const k = toSafeKey(`${f}::${b}`);
    const row = ensure(k);
    row.hasLocal = true;
    row.localId = l.id || row.localId;
    if (!row.front){ row.front = f; row.back = b; }
  }

  return Array.from(byKey.values());
}

  // encode segments but preserve slashes
  function encodePath(p){
    return p.split('/').map(s => s === '' ? '' : encodeURIComponent(s)).join('/')
            .replace(/%3A/g, ':');
  }

  // Mirror of firebase.js safeKey so we can match Marked <-> SignWords
function toSafeKey(s){
  try { return btoa(unescape(encodeURIComponent(String(s)))).replace(/=+$/,""); }
  catch { return String(s).toLowerCase().replace(/\W+/g,'_'); }
}

async function cascadeRemoveByKey({ key, signId=null, hasRemote=false, hasLocal=false, localId=null }){
  try {
    const fb = await whenFBReady().catch(()=>null);
    if (signId && fb)   { try { await fb.signWordRemove(signId); } catch {} }
    if (hasRemote && fb){ try { await fb.unmarkWord(key); } catch {} }
    if (hasLocal)       { try { removeLocalMarked(localId || key); } catch {} }
  } catch (e) { console.error(e); }
}
// Remove from Marked and also clean up Sign Words if linked
async function cascadeUnmark({ src, id, markedId }){
  const fb = await whenFBReady();

  if (src === "remote"){
    // 1) unmark this Marked doc
    await fb.unmarkWord(id);

    // 2) if there is a matching Sign Word (by markedId), remove it too
    if (markedId){
      try{
        const mkey = toSafeKey(markedId);
        const signs = await fb.signWordList();
        const hit = signs.find(x => x.markedId === mkey);
        if (hit) await fb.signWordRemove(hit.id); // also unmarks again internally; safe if already removed
      }catch{}
    }

  } else if (src === "local"){
    // local-only Marked
    removeLocalMarked(id);

    // best-effort: if signed in and this local item also exists in Sign Words, remove it
    if (markedId){
      try{
        const mkey = toSafeKey(markedId);
        const signs = await fb.signWordList();
        const hit = signs.find(x => x.markedId === mkey);
        if (hit) await fb.signWordRemove(hit.id);
      }catch{}
    }

  } else if (src === "sign"){
    // id looks like "sign::<signId>" — remove Sign Word; that will also unmark its Marked twin
    const signId = id.startsWith("sign::") ? id.split("::")[1] : id;
    if (signId) await fb.signWordRemove(signId);

    // extra safety: also try to unmark the paired Marked id
    if (markedId){ try { await fb.unmarkWord(markedId); } catch {} }
  }
}

// ---- Manifest URL resolver (works on subpaths too) ----
  function manifestCandidates(level){
    return [`${LEVEL_BASE}/${level}/manifest.json`];
  }


// Build many possible filename variants for the vocab CSV
  function buildVocabCandidates(level, lesson){
    const num2 = (lesson.split("-")[1] || "").padStart(2, "0"); // "01"
    const num  = String(Number(num2));                           // "1"
    const dir  = `${LEVEL_BASE}/${level}/${lesson}/Vocabulary/`;

    const names = [
      // canonical
      `lesson-${num2}.csv`, `Lesson-${num2}.csv`, `lesson.csv`, `Lesson.csv`,
      // no zero-pad
      `lesson-${num}.csv`, `Lesson-${num}.csv`,
      // glued number
      `lesson${num2}.csv`, `Lesson${num2}.csv`,
      // space variants
      `lesson ${num2}.csv`, `Lesson ${num2}.csv`,
      // generic names
      `Vocab-Lesson-${num2}.csv`, `Vocabulary.csv`, `vocab.csv`, `Vocab.csv`,
      `words.csv`, `Words.csv`
    ];

    // Try inside Vocabulary/ first, then also at lesson root (some repos put CSV there)
    const inFolder = names.map(n => dir + n);
    const atRoot   = names.map(n => `${LEVEL_BASE}/${level}/${lesson}/` + n);
    return [...inFolder, ...atRoot];
  }

  // Try all candidates until one exists
  // Return ONE absolute CSV path or null, based solely on manifest.json
  // Replace your current findVocabCsv with this:
async function findVocabCsv(level, lesson){
  // Try manifest first
  const ent = getManifestEntry(level, lesson);
    if (ent && ent.vocab) {
      const rel = Array.isArray(ent.vocab) ? ent.vocab[0] : ent.vocab;
      return `${LEVEL_BASE}/${level}/${lesson}/${rel}`;
    }
    // Fallback: guess common filenames
    const candidates = buildVocabCandidates(level, lesson);
    const hit = await firstOk(candidates);
    return hit; // absolute or null
  }



  async function loadDeckFor(level, lesson){
    const url = await findVocabCsv(level, lesson);
    const deck = [];
    if (!url) return deck;
    try{
      const txt = await (await fetch(encodePath(url), { cache:"no-cache" })).text();
      const csv = parseCSV(txt);
      for (const r of csv){
        const kanji = (r[0]||"").trim();
        const hira  = (r[1]||"").trim();
        const en    = (r[2]||"").trim();
        if (!hira || !en) continue;
        deck.push({ kanji, hira, en });
      }
    } catch {}
    return deck;
  }


  // Directory lister: only returns names if directory indexes are enabled (rare on Vercel)
  async function listCsvFiles(dirUrl){
    dirUrl = dirUrl.endsWith("/") ? dirUrl : dirUrl + "/";
    try{
      const r = await fetch(encodePath(dirUrl), { cache: "no-cache" });
      if (!r.ok) return [];
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("text/html")) return [];
      const html = await r.text();
      const names = new Set();
      for (const m of html.matchAll(/href="([^"]+\.csv)"/gi)){
        const url = new URL(m[1], location.origin + dirUrl).pathname;
        const name = decodeURIComponent(url.split("/").pop());
        if (!name.includes("..")) names.add(name);
      }
      return [...names];
    }catch{ return []; }
  }

  // REPLACE firstOk + anyExists with this HEAD→GET variant
  async function firstOk(urls){
    for (const raw of urls){
      const u = encodePath(raw);
      try {
        let r = await fetch(u, { method: "HEAD", cache: "no-cache" });
        if (r.ok) return raw;
        if (r.status === 405) { // hosts that don't allow HEAD
          r = await fetch(u, { method: "GET", cache: "no-cache" });
          if (r.ok) return raw;
        }
      } catch {}
    }
    return null;
  }
  async function anyExists(urls){ return !!(await firstOk(urls)); }

  document.querySelector("#mistakes-clear-all")
    ?.addEventListener("click", () => {
      window.clearMistakes();
      // If the user was inside a Mistakes practice deck, bounce back to the landing
      try {
        document.querySelector("#learn")?.classList.add("hidden");
        document.querySelector("#practice")?.classList.add("hidden");
        document.querySelector("#write")?.classList.add("hidden");
        document.querySelector("#make")?.classList.add("hidden");
        document.querySelector("#mistakes-section")?.classList.remove("hidden");
        renderMistakesLanding();
        toast("Mistakes cleared");
      } catch {}
    });

  // Global Back button logic
  document.querySelector("#back-btn")?.addEventListener("click", () => {
    // 0) Video lightbox → back to Videos tab
    if (window.__videoLightboxOpen) {
      closeVideoLightbox();
      document.querySelector("#level-shell")?.classList.remove("hidden");
      document.querySelector("#lesson-area")?.classList.remove("hidden");
      openLessonTab("videos");
      updateBackVisibility();
      return;
    }

    // 1) Inside Vocab tab? handle nested steps first
    const inVocabTab = isVisible("#tab-vocab");
    if (inVocabTab) {
      //const learnOpen    = isVisible("#learn");
      const learnOpen    = isVisible("#learn") || isVisible("#learn-table");
      const practiceOpen = isVisible("#practice");
      const writeOpen    = isVisible("#write");
      const makeOpen     = isVisible("#make");

      const learnMenu = isVisible("#vocab-learn-menu");
      const mcqMenu   = isVisible("#vocab-mcq-menu");
      const writeMenu = isVisible("#vocab-write-menu");

      const rootCardVisible = !!document.querySelector("#vocab-mode-select")
        && !document.querySelector("#vocab-mode-select")?.closest(".card")?.classList.contains("hidden");

      // final → submenu
      if (learnOpen)    { openVocabLearnMenu(); updateBackVisibility(); return; }
      if (practiceOpen) { openVocabMCQMenu();   updateBackVisibility(); return; }
      if (writeOpen)    { openVocabWriteMenu(); updateBackVisibility(); return; }
      if (makeOpen)     { showVocabRootMenu();  updateBackVisibility(); return; }

      // submenu → root
      if (learnMenu || mcqMenu || writeMenu) {
        showVocabRootMenu(); updateBackVisibility(); return;
      }
      // root → lesson tabs (or Mix picker if Mix is active)
      if (rootCardVisible) {
        document.querySelector("#tab-vocab")?.classList.add("hidden");
        if (App.mix?.active){
          // Go back to the Mix picker
          document.querySelector("#mix-section")?.classList.remove("hidden");
          hideLessonBar();
        } else {
          showLessonTabsOnly();
        }
        return;
      }
      removeListActions();

    }

    // 2) Any other tab (Videos/Grammar) open → go back to lesson tabs
    if (isVisible("#tab-videos") || isVisible("#tab-grammar")) {
      ["#tab-videos","#tab-grammar"].forEach(s => document.querySelector(s)?.classList.add("hidden"));
      showLessonTabsOnly();
      return;
    }

    // 3) If lesson tabs area is visible (no tab content) → go back to lesson list
    const lessonAreaVisible = isVisible("#lesson-area");
    const noTabContent = !isVisible("#tab-videos") && !isVisible("#tab-vocab") && !isVisible("#tab-grammar");
    if (lessonAreaVisible && noTabContent) {
      showLessonListOnly();
      return;
    }

    // 4) If in any non-level section (Progress, etc.) → return to lesson list
    if (isVisible("#progress-section") || isVisible("#leaderboard-section") ||
        isVisible("#mistakes-section") || isVisible("#marked-section") || isVisible("#signword-section")) {
      hideContentPanes();
      showLessonListOnly();
      return;
    }

    // 5) Fallback: ensure lesson list is visible
    showLessonListOnly();
  });


  // ---------- Auth ----------
  elAuthBtn.addEventListener("click", async () => {
    const screen = document.querySelector(".device-screen");
    screen?.classList.add("signing");
    burstKanaSparks(36);
    try { const fb = await whenFBReady(); await fb.auth.signInWithGoogle(); }
    catch (e) { console.error(e); elAuthErr.style.display="block"; elAuthErr.textContent = e.message || "Sign-in failed."; }
  });
  elSignOut.addEventListener("click", async () => {
    try { await flushSession(); } catch {}
    const fb = await whenFBReady(); await fb.auth.signOut();
  });
  whenFBReady().then(fb=>{
    fb.auth.onChange(user=>{
      if(user){
        // signed in → hide landing, show app
        stopKanaSparks();
        elAuthGate.style.display="none";
        elApp.classList.remove("hidden");
        navigateLevel("N5");
        document.querySelector(".device-screen")?.classList.remove("signing");

      } else {
        // signed out → show landing
        elApp.classList.add("hidden");
        elAuthGate.style.display="";
        initLanding(); // <-- add this
        document.querySelector(".device")?.addEventListener("mouseenter", () => burstKanaSparks(12), { passive:true });
      }
    });
  }).catch(()=>{ elAuthGate.style.display=""; 
    initLanding(); 
    document.querySelector(".device")?.addEventListener("mouseenter", () => burstKanaSparks(12), { passive:true });
  });


  // ---------- Routing & view cleanup ----------
  function hideContentPanes(){
  // Hide the entire level shell so non-level sections (Progress, etc.) are truly alone
    document.querySelector("#level-shell")?.classList.add("hidden");
    document.querySelector("#lesson-area")?.classList.add("hidden");
    document.querySelector("#progress-section")?.classList.add("hidden");
    document.querySelector("#leaderboard-section")?.classList.add("hidden");
    document.querySelector("#mistakes-section")?.classList.add("hidden");
    document.querySelector("#marked-section")?.classList.add("hidden");
    document.querySelector("#signword-section")?.classList.add("hidden");
    document.querySelector("#mix-section")?.classList.add("hidden");
    document.querySelector("#wordlist-section")?.classList.add("hidden");
    clearVideosPane();
    clearVocabPane();
    clearGrammarPane();
  }
  window.hideContentPanes = hideContentPanes;          // ← add this


  function hideVocabMenus(){
    hideVocabRootCard();
    document.querySelector("#vocab-learn-menu")?.classList.add("hidden");
    document.querySelector("#vocab-mcq-menu")?.classList.add("hidden");
    document.querySelector("#vocab-write-menu")?.classList.add("hidden");
  }

  // Hide/show the whole Vocabulary root card (not just the buttons)
  function hideVocabRootCard(){
    document.querySelector("#vocab-mode-select")?.closest(".card")?.classList.add("hidden");
  }
  function showVocabRootCard(){
    document.querySelector("#vocab-mode-select")?.closest(".card")?.classList.remove("hidden");
  }

  // Show/hide the global Back button depending on what's visible
  function updateBackVisibility(){
  const elBack = document.querySelector("#back-btn");
  const onLessonList = !document.querySelector("#level-shell")?.classList.contains("hidden")
                    &&  document.querySelector("#lesson-area")?.classList.contains("hidden")
                    &&  
                      [
                        "#progress-section",
                        "#leaderboard-section",
                        "#mistakes-section",
                        "#marked-section",
                        "#signword-section",
                        "#mix-section",
                        "#wordlist-section"
                      ]
                          .every(sel => document.querySelector(sel)?.classList.contains("hidden"));
  if (elBack) elBack.classList.toggle("hidden", onLessonList && !window.__videoLightboxOpen);
}
window.updateBackVisibility = updateBackVisibility;
  function clearVideosPane(){ 
    const elVideoCards = document.querySelector("#video-cards");
    const elVideoStatus = document.querySelector("#video-status");
    if (elVideoCards) elVideoCards.innerHTML = "";
    if (elVideoStatus) elVideoStatus.textContent = "";
    closeVideoLightbox();
  }
  function clearVocabPane(){
  const practice = document.querySelector("#practice");
  const learn = document.querySelector("#learn");
  const write = document.querySelector("#write");
  const make = document.querySelector("#make");
  const learnTbl = document.querySelector("#learn-table");
  if (practice) practice.classList.add("hidden");
  if (learn) learn.classList.add("hidden");
  if (write) write.classList.add("hidden");
  if (make) make.classList.add("hidden");
  if (learnTbl) learnTbl.classList.add("hidden");
  const elVocabStatus = document.querySelector("#vocab-status"); 
  const subA = document.querySelector("#vocab-learn-menu"); 
  const subB = document.querySelector("#vocab-mcq-menu"); 
  const subC = document.querySelector("#vocab-write-menu");
  if (elVocabStatus) elVocabStatus.textContent = "";
  const elQuestionBox = document.querySelector("#question-box");
  const elOptions = document.querySelector("#options");
  const elExtraInfo = document.querySelector("#extra-info");
  const elWriteFeedback = document.querySelector("#write-feedback");
  const elMakeFeedback = document.querySelector("#make-feedback");
  if (elQuestionBox) elQuestionBox.textContent = "";
  if (elOptions) elOptions.innerHTML = "";
  if (elExtraInfo) elExtraInfo.textContent = "";
  if (elWriteFeedback) elWriteFeedback.textContent = "";
  if (elMakeFeedback) elMakeFeedback.textContent = "";
  // hide any vocab submenus
  subA?.classList.add("hidden");
  subB?.classList.add("hidden");
  subC?.classList.add("hidden");
  showVocabRootCard();
  document.querySelector("#vocab-mode-select")?.classList.remove("hidden");

  }

function clearGrammarPane(){
  const elPgArea = document.querySelector("#pg-area");
  const elPgCard = document.querySelector("#pg-card");
  const elPgInput = document.querySelector("#pg-input");
  const elPgFeedback = document.querySelector("#pg-feedback");
  const elPgFiles = document.querySelector("#pg-file-buttons");
  const elPgStatus = document.querySelector("#pg-status");
  if (elPgArea) elPgArea.classList.add("hidden");
  if (elPgCard) elPgCard.textContent = "";
  if (elPgInput) elPgInput.value = "";
  if (elPgFeedback) elPgFeedback.textContent = "";
  if (elPgFiles) elPgFiles.innerHTML = "";
  if (elPgStatus) elPgStatus.textContent = "";
}

  window.unmarkAllMarked = async () => {
    try {
      const fb = await whenFBReady();
      const rows = await fb.listMarked();
      for (const r of rows) { await fb.unmarkWord(r.id); }
      await renderMarkedList();
      toast("All marked words have been unmarked.");
    } catch (e) {
      console.error(e);
      toast("Failed to unmark all.");
    }
  };
  document.querySelector("#marked-unmark-all")
    ?.addEventListener("click", () => window.unmarkAllMarked());

// Hide/show the "Level —" header + the entire Lessons card
function hideLessonsHeaderAndList(){
  document.querySelector(".level-head")?.classList.add("hidden");
  document.querySelector("#lesson-list")?.closest(".card")?.classList.add("hidden");
}
function showLessonsHeaderAndList(){
  document.querySelector(".level-head")?.classList.remove("hidden");
  document.querySelector("#lesson-list")?.closest(".card")?.classList.remove("hidden");
}

// Hide/show the Lesson tab bar (Video/Vocab/Grammar)
function hideLessonBar(){ document.querySelector("#lesson-area .lesson-bar")?.classList.add("hidden"); }
function showLessonBar(){ document.querySelector("#lesson-area .lesson-bar")?.classList.remove("hidden"); }

  function hideAllSections(){
    [elLevelShell, elProgressSection, elLeaderboardSection, elMistakesSection, elMarkedSection, elSignWordSection]
      .forEach(x=>x.classList.add("hidden"));
  }

 // HARD RESET: always bring user to the lesson list for the chosen level
window.navigateLevel = async (level) => {
  try { await flushSession?.(); } catch {}

  // keep using the same App object everywhere
  if (!window.App) window.App = {};
  const App = window.App;
  closeVideoLightbox?.();
  hideContentPanes?.(); 
  // reset high-level state
  App.level = level;
  App.lesson = null;
  App.tab = "videos";
  App.mode = null;
  App.stats = { right: 0, wrong: 0, skipped: 0 };
  App.mix = { active:false, selection:[], deck: [] };   // <-- NEW
  
  // crumbs
  document.querySelector("#mix-section")?.classList.add("hidden");
  document.querySelector("#crumb-level").textContent  = level || "—";
  document.querySelector("#crumb-lesson").textContent = "—";
  document.querySelector("#crumb-mode").textContent   = "—";
  
  

  // nuke any right-side content completely
  closeVideoLightbox?.();
  ["#tab-videos", "#tab-vocab", "#tab-grammar"].forEach(sel => document.querySelector(sel)?.classList.add("hidden"));
  // clear per-tab panes so no stale text remains
  (function hardClear(){
    // videos
    const vc = document.querySelector("#video-cards");
    const vs = document.querySelector("#video-status");
    if (vc) vc.innerHTML = "";
    if (vs) vs.textContent = "";
    removeListActions();
    // vocab
    ["#learn","#practice","#write","#make","#vocab-learn-menu","#vocab-mcq-menu","#vocab-write-menu"].forEach(s => document.querySelector(s)?.classList.add("hidden"));
    document.querySelector("#vocab-status") && (document.querySelector("#vocab-status").textContent = "");
    document.querySelector("#vocab-mode-select")?.closest(".card")?.classList.remove("hidden");

    // grammar
    ["#pg-area"].forEach(s => document.querySelector(s)?.classList.add("hidden"));
    ["#pg-card","#pg-feedback"].forEach(s => { const el=document.querySelector(s); if (el) el.textContent=""; });
    const pgi = document.querySelector("#pg-input"); if (pgi) pgi.value="";
    const pgb = document.querySelector("#pg-file-buttons"); if (pgb) pgb.innerHTML="";
    const pgs = document.querySelector("#pg-status"); if (pgs) pgs.textContent="";
  })();

  // show only the lesson list (hide the lesson tab bar & meta)
  document.querySelector("#lesson-area")?.classList.add("hidden");
  document.querySelector("#level-shell")?.classList.remove("hidden");
  document.querySelector(".lesson-head")?.classList?.remove?.("hidden");
  document.querySelector(".lesson-meta")?.classList.add("hidden");
  document.querySelector("#lesson-list")?.closest(".card")?.classList.remove("hidden"); // make sure list card is visible
  // explicitly hide the tab bar (the “Video/Vocab/Grammar” buttons) while on the list
  document.querySelector("#lesson-area .lesson-bar")?.classList.add("hidden");

  // status + load lessons
  const st = document.querySelector("#lesson-status");
  if (st) {
    st.classList.remove("coming-soon");
    st.textContent = "Scanning lessons…";
  }
  await showLessonList(level);
  // If manifest didn't load, tell the user exactly what's missing
  // After: await showLessonList(level);
  const sts = document.querySelector("#lesson-status");
  const status = App.cache.manifestStatus?.get?.(`m/${level}`);

  // If the file existed but JSON was invalid, surface the parse error.
  // If the file was missing (404), we leave the default "Coming Soon".
  if (sts && status && status.found && status.error) {
    sts.classList.remove("coming-soon");
    sts.textContent = status.error; // e.g., "Error in manifest.json: Unexpected token …"
  }


  updateBackVisibility?.();
  // bring viewport up for fresh context
  try { document.querySelector(".main-content")?.scrollTo({ top: 0, behavior: "instant" }); } catch {}
};

  async function openWordListAsVocab(listId, listName){
    // 1) Build deck from FB.lists
    const fb = await whenFBReady();
    const rows = await fb.lists.listWords(listId); // [{id,kanji,hira,en},…]
    const deck = rows.map(x => ({ kanji:x.kanji||"—", hira:x.hira||"", en:x.en||"" })).filter(x=> x.hira && x.en);

    const isEmpty = deck.length === 0;

    // 2) Drive the UI like a lesson's Vocab tab
    hideContentPanes();
    document.querySelector("#level-shell")?.classList.remove("hidden");
    document.querySelector("#lesson-area")?.classList.remove("hidden");
    hideLessonsHeaderAndList(); hideLessonBar();

    ["#tab-videos","#tab-grammar"].forEach(s => document.querySelector(s)?.classList.add("hidden"));
    document.querySelector("#tab-vocab")?.classList.remove("hidden");

    App.level = "Word List";
    App.lesson = listName || "Custom";
    App.tab = "vocab"; App.mode = null;

    document.querySelector("#crumb-level").textContent  = App.level;
    document.querySelector("#crumb-lesson").textContent = App.lesson;
    document.querySelector("#crumb-mode").textContent   = "vocab";
    document.querySelector(".lesson-meta")?.classList.add("hidden");

    App.deck = deck.slice();
    document.querySelector("#vocab-status").textContent = "Pick an option.";
    showVocabRootMenu(); showVocabRootCard();

    injectListActions("wordlist", { listId, listName });  // extend existing toolbar
    document.querySelector("#vocab-mode-select")?.classList.remove("hidden");
    updateBackVisibility();
  }

// Open a "lesson-like" Vocab view, but the deck comes from Mistakes or Marked
async function openVocabDeckFromList(source) {
  // 1) Build the deck
  let deck = [];
  if (source === "mistakes") {
    const list = getMistakes(); // [{kanji,hira,en},...]
    deck = list.map(x => ({ kanji: x.kanji || "—", hira: x.hira || "", en: x.en || "" }))
               .filter(x => x.hira && x.en);
  } else {
    deck = await getMarkedAsDeck(); // already maps front/back into hira/en
  }
  // define emptiness once; we use it below for the status text
  const isEmpty = deck.length === 0;
  // Empty state → keep the old landing card so user sees a message
  if (isEmpty) {
    hideContentPanes();
    if (source === "mistakes") {
      document.querySelector("#mistakes-section")?.classList.remove("hidden");
      renderMistakesLanding();
    } else {
      document.querySelector("#marked-section")?.classList.remove("hidden");
      await renderMarkedList();
    }
    updateBackVisibility();
    return;
  }

  // 2) Drive the UI exactly like a lesson's Vocab tab (NO auto-enter of a final mode)
  hideContentPanes();                        // clear right panes
  document.querySelector("#level-shell")?.classList.remove("hidden");
  document.querySelector("#lesson-area")?.classList.remove("hidden");
  hideLessonsHeaderAndList();
  hideLessonBar();

  // Show only Vocab tab pane (keep the tab buttons visible)
  ["#tab-videos","#tab-grammar"].forEach(s => document.querySelector(s)?.classList.add("hidden"));
  document.querySelector("#tab-vocab")?.classList.remove("hidden");

  // Breadcrumbs/title indicate we’re in a list, but hide meta line as per your spec
  App.level = source === "mistakes" ? "Mistakes" : "Marked";
  App.lesson = source === "mistakes" ? "From Mistakes" : "From Marked Words";
  App.tab = "vocab";
  App.mode = null;
  document.querySelector("#crumb-level").textContent  = App.level;
  document.querySelector("#crumb-lesson").textContent = App.lesson;
  document.querySelector("#crumb-mode").textContent   = "vocab";
  document.querySelector(".lesson-meta")?.classList.add("hidden");

  // 3) Load the deck and show the Vocab root menus (Learn / MCQ / Write / Make)
  App.deck = deck.slice();
  document.querySelector("#vocab-status").textContent = "Pick an option.";
  showVocabRootMenu();
  showVocabRootCard();
  injectListActions(source === "mistakes" ? "mistakes" : "marked");
  document.querySelector("#vocab-mode-select")?.classList.remove("hidden");

  updateBackVisibility();
}

window.openSection = async (name) => {
  try { await flushSession?.(); } catch {}
  closeVideoLightbox?.();
  hideContentPanes?.();          // always clear the right pane first

  // Mistakes / Marked behave like a lesson's Vocab tab using the shared helper
  if (name === "mistakes") { await openVocabDeckFromList("mistakes"); return; }
  if (name === "marked")   { await openVocabDeckFromList("marked");   return; }

  // Word List landing
  if (name === "wordlist") {
    hideContentPanes?.();
    document.querySelector("#wordlist-section")?.classList.remove("hidden");
    await window.renderWordListLanding();
    updateBackVisibility?.();
    return;
  }
  // Other sections keep their own pages
  const map = {
    progress:    "#progress-section",
    leaderboard: "#leaderboard-section",
    signword:    "#signword-section",
  };
  const sel = map[name];
  if (sel) document.querySelector(sel)?.classList.remove("hidden");

  if (name === "progress")    await renderProgress();
  if (name === "leaderboard") await renderOverallLeaderboard();
  if (name === "signword")    await renderSignWordList();

  updateBackVisibility?.();
};



  // ---------- Lesson discovery ----------
  async function showLessonList(level){
    let lessons = App.cache.lessons.get(level);
    if (!lessons) { lessons = await discoverLessons(level); App.cache.lessons.set(level, lessons); }

    elLessonList.innerHTML = "";
    if (!lessons.length) {
      // keep right content visible, just show the message
      document.querySelector("#level-shell")?.classList.remove("hidden");

      elLessonList.innerHTML = "";
      elLessonStatus.textContent = "Coming Soon";
      elLessonStatus.classList.add("coming-soon");   // add style class for nicer look

      // make sure the Back button hides on lesson-list state
      updateBackVisibility?.();
      return;
    }

    // If we DO have lessons, clear the coming-soon style
    elLessonStatus.classList.remove("coming-soon");
    elLessonStatus.textContent = `${lessons.length} lesson(s) found.`;
    for (const name of lessons){
      const item = document.createElement("div");
      item.className = "lesson-item"; item.setAttribute("role","listitem");
      item.textContent = name.replace(/-/g," ");
      item.addEventListener("click", ()=> openLesson(level, name));
      elLessonList.appendChild(item);
    }
  }
 
  // Build a deck from local "Mistakes" (localStorage)
  async function fbListMistakesAsDeck(){
    const list = getMistakes(); // [{kanji,hira,en,...}]
    return list
      .map(x => ({ kanji: x.kanji || "—", hira: x.hira || "", en: x.en || "" }))
      .filter(x => x.hira && x.en);
  }
  window.fbListMistakesAsDeck = fbListMistakesAsDeck;
// ---- Local Marked (offline/signed-out) ----
const LMKEY = "lj_marked_v1";
function getLocalMarked(){ try { return JSON.parse(localStorage.getItem(LMKEY)) || []; } catch { return []; } }
function setLocalMarked(a){ try { localStorage.setItem(LMKEY, JSON.stringify(a)); } catch {} }
function addLocalMarked(w){
  const list = getLocalMarked();
  const id = (w.kanji && w.kanji !== "—" ? w.kanji : w.hira) + "::" + w.en;
  if (!list.some(x => x.id === id)) list.push({ id, ...w });
  setLocalMarked(list);
}
function removeLocalMarked(id){
  setLocalMarked(getLocalMarked().filter(x => x.id !== id));
}

// ===== Manifest helpers =====
// Cache manifests per level + keep fetch/parse status
async function loadLevelManifest(level){
  const key = `m/${level}`;
  App.cache.manifest = App.cache.manifest || new Map();
  App.cache.manifestStatus = App.cache.manifestStatus || new Map();

  if (App.cache.manifest.has(key)) return App.cache.manifest.get(key);

  const [url] = manifestCandidates(level);
  let data = null;
  const status = { found: false, error: null };

  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (r.ok) {
      status.found = true;
      const txt = await r.text();
      try {
        data = JSON.parse(txt);
      } catch (e) {
        status.error = `Error in manifest.json: ${e.message}`;
      }
    } else if (r.status !== 404) {
      // Non-404 fetch error (e.g., 500). Keep "Coming Soon" unless we want to surface it.
      status.error = `Failed to load manifest.json (HTTP ${r.status}).`;
    }
  } catch (e) {
    // Network or other fetch issue
    status.error = `Failed to load manifest.json (${e.message || "network error"}).`;
  }

  App.cache.manifest.set(key, data);
  App.cache.manifestStatus.set(key, status);
  return data;
}

function getManifestEntry(level, lesson){
  const m = App.cache.manifest?.get?.(`m/${level}`);
  if (!m || !m.lessons) return null;
  const k1 = lesson;
  const k2 = lesson.toLowerCase();
  return m.lessons[k1] || m.lessons[k2] || null;
}

// Lessons come ONLY from manifest; otherwise show "Coming soon"
async function discoverLessons(level){
  const m = await loadLevelManifest(level);
  return (m && Array.isArray(m.allLessons) && m.allLessons.length) ? m.allLessons.slice() : [];
}






// --- Replace openLesson with this ---
async function openLesson(level, lesson){
  try { await flushSession?.(); } catch {}

  // Blank out all right-side tab panes
  ["#tab-videos","#tab-vocab","#tab-grammar"].forEach(sel=>document.querySelector(sel)?.classList.add("hidden"));
  clearVideosPane(); clearVocabPane(); clearGrammarPane(); closeVideoLightbox?.();
  hideContentPanes(); // keep sidebar/topbar visible

  // Set state + reveal the lesson tabs area
  App.level = level;
  App.lesson = lesson;
  document.querySelector("#crumb-level").textContent  = level || "—";
  document.querySelector("#crumb-lesson").textContent = lesson || "—";
  document.querySelector("#crumb-mode").textContent   = "—";

  document.querySelector("#level-shell")?.classList.remove("hidden");
  document.querySelector("#lesson-area")?.classList.remove("hidden");
  hideLessonsHeaderAndList();
  showLessonBar(); // <-- show the three choices
  document.querySelector(".lesson-meta")?.classList.add("hidden"); // keep meta hidden

  // Header text above the tabs
  document.querySelector("#lesson-title").textContent = `${lesson.replace(/-/g," ")} — ${level}`;

  // Just show availability info; DO NOT navigate to a tab automatically
  const hasVocabUrl = await findVocabCsv(level, lesson);
  document.querySelector("#lesson-availability").textContent = hasVocabUrl ? "Vocab: Yes" : "Vocab: No";

  updateBackVisibility();
}

// --- Replace openLessonTab with this ---
window.openLessonTab = async (tab)=>{
  // Keep lesson area + tabs visible for all tabs
  document.querySelector("#level-shell")?.classList.remove("hidden");
  document.querySelector("#lesson-area")?.classList.remove("hidden");
  showLessonBar();
  document.querySelector(".lesson-meta")?.classList.add("hidden"); // keep meta hidden

  try { await flushSession?.(); } catch {}
  App.tab = tab;
  document.querySelector("#crumb-mode").textContent = tab;

  // Clear all panes, then open the requested one
  ["#tab-videos","#tab-vocab","#tab-grammar"].forEach(sel=>document.querySelector(sel)?.classList.add("hidden"));
  clearVideosPane(); clearVocabPane(); clearGrammarPane(); closeVideoLightbox?.();
  hideLessonsHeaderAndList();removeListActions();

  if (tab === "videos") {
    document.querySelector("#tab-videos")?.classList.remove("hidden");
    await renderVideos();
  } else if (tab === "vocab") {
      document.querySelector("#tab-vocab")?.classList.remove("hidden");

      // keep the tabs visible on Vocab
      showLessonBar();
      document.querySelector(".lesson-meta")?.classList.add("hidden");

      await ensureDeckLoaded();
      const has = (App.deck?.length || 0) > 0;
      document.querySelector("#vocab-status").textContent = has ? "Pick an option." : "No vocabulary found.";
      showVocabRootMenu();
      showVocabRootCard();
      document.querySelector("#vocab-mode-select")?.classList.remove("hidden");
  } else if (tab === "grammar") {
    document.querySelector("#tab-grammar")?.classList.remove("hidden");
    wireGrammarTab();
  }

  updateBackVisibility();
};
  // ---------- Video Module (no extra file buttons) ----------
async function loadAllVideoRows(level, lesson){
  const ent = getManifestEntry(level, lesson);
  if (!ent) return [];

  // Option A: inline videos in manifest
  if (Array.isArray(ent.videos) && ent.videos.length){
    return ent.videos.filter(v => v && v.title && v.url).map(v => ({ title: v.title, url: v.url }));
  }

  // Option B: CSV path in manifest (e.g., "Video Lecture/video.csv")
  if (ent.videoCsv){
    const file = `${LEVEL_BASE}/${level}/${lesson}/${ent.videoCsv}`;
    try {
      const txt = await (await fetch(file, { cache:"no-cache" })).text();
      const csv = parseCSV(txt);
      const rows = [];
      for (const r of csv) if (r[0] && r[1]) rows.push({ title: r[0], url: r[1] });
      return rows;
    } catch { return []; }
  }
  return [];
}




async function renderVideos(){
  const elVideoCards = document.querySelector("#video-cards");
  const elVideoStatus = document.querySelector("#video-status");
  elVideoCards.innerHTML = "";
  elVideoStatus.textContent = "Loading videos…";

  const rows = await loadAllVideoRows(window.App.level, window.App.lesson);
  if (!rows.length){ elVideoStatus.textContent = "No videos found (expected: Video Lecture/Lesson.csv)."; return; }

  elVideoStatus.textContent = `Loaded ${rows.length} lecture(s). Click a card to play.`;
  for (const { title, url } of rows){
    const id = extractYouTubeId(url);
    const card = document.createElement("button");
    card.className = "video-card";
    card.innerHTML = `
      <div class="video-thumb">
        <img alt="${escapeHTML(title)}" loading="lazy" src="https://img.youtube.com/vi/${id}/hqdefault.jpg">
        <span class="play-badge">▶</span>
      </div>
      <h4>${escapeHTML(title)}</h4>`;
    card.addEventListener("click", ()=> openVideoLightbox(id, title));
    elVideoCards.appendChild(card);
  }
}

function extractYouTubeId(u){
  try{ const url=new URL(u);
    if(url.hostname.includes("youtu.be")) return url.pathname.slice(1);
    return url.searchParams.get("v") || "";
  } catch { return ""; }
}

let videoLightboxEl = null;
window.__videoLightboxOpen = false;

function openVideoLightbox(yid, title){
  hideContentPanes(); // hide right-side panes
  closeVideoLightbox();
  window.__videoLightboxOpen = true;

  videoLightboxEl = document.createElement("div");
  videoLightboxEl.className = "lightbox";
  videoLightboxEl.innerHTML = `
    <div class="lightbox-backdrop"></div>
    <div class="lightbox-inner card">
      <div class="lightbox-head">
        <button class="lightbox-close" aria-label="Back">← Back</button>
        <h4 style="margin-left:8px">${escapeHTML(title)}</h4>
      </div>
      <div class="yt-wrap" style="height:56vw; max-height:520px;">
        <iframe loading="lazy" width="100%" height="100%"
          src="https://www.youtube-nocookie.com/embed/${yid}?autoplay=1"
          title="${escapeHTML(title)}" frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
      </div>
    </div>`;
  document.body.appendChild(videoLightboxEl);

  const goBack = () => {
    closeVideoLightbox();
    document.querySelector("#level-shell")?.classList.remove("hidden");
    document.querySelector("#lesson-area")?.classList.remove("hidden");
    openLessonTab("videos");
    updateBackVisibility();
  };

  videoLightboxEl.querySelector(".lightbox-backdrop")?.addEventListener("click", goBack, { passive:true });
  videoLightboxEl.querySelector(".lightbox-close")?.addEventListener("click", goBack);
  window.addEventListener("keydown", function escOnce(e){ if(e.key==="Escape"){ goBack(); } }, { once:true });

  updateBackVisibility();
}

function closeVideoLightbox(){
  if (videoLightboxEl){ videoLightboxEl.remove(); videoLightboxEl = null; }
  window.__videoLightboxOpen = false;
}
// make lightbox helpers available globally for other modules/handlers
window.openVideoLightbox = openVideoLightbox;
window.closeVideoLightbox = closeVideoLightbox;


  
  function escCloseOnce(e){ if (e.key==="Escape") closeVideoLightbox(); }

  // ---------- Vocabulary ----------
 
  async function listVocabCsvFiles(level, lesson){
    const key = `v/${level}/${lesson}`;
    if (App.cache.vocabCsvFiles.has(key)) return App.cache.vocabCsvFiles.get(key);

    const url = await findVocabCsv(level, lesson);
    const files = url ? [url] : [];       // cache the **absolute URL**
    App.cache.vocabCsvFiles.set(key, files);
    return files;
  }

  // treat Word List like a list-sourced deck
function inListVocabContext(){
  return ["Mistakes","Marked","Mix","Word List"].includes(App.level);
}


  async function ensureDeckLoaded(){
      // If Mix deck is active, just use it.
      if (App.level === "Word List") {
        if (elVocabStatus) {
          elVocabStatus.textContent = (App.deck?.length)
            ? `Loaded ${App.deck.length} words.`
            : "This list is empty. Click ‘Add words’ to start.";
        }
        return;
      }
      if (App.mix?.active && App.mix.deck?.length){
        App.deck = App.mix.deck.slice();
        if (elVocabStatus) elVocabStatus.textContent = `Loaded ${App.deck.length} words.`;
        return;
      }

      // If user is on Mistakes/Marked, prefer in-memory or load from their sources.
      if (App.level === "Mistakes"){
        if (!App.deck?.length) App.deck = await fbListMistakesAsDeck();
        if (elVocabStatus) elVocabStatus.textContent = App.deck.length
          ? `Loaded ${App.deck.length} words.`
          : "No words found.";
        return;
      }
      if (App.level === "Marked"){
        if (!App.deck?.length) App.deck = await getMarkedAsDeck(); // merged sources below
        if (elVocabStatus) elVocabStatus.textContent = App.deck.length
          ? `Loaded ${App.deck.length} words.`
          : "No words found.";
        return;
      }

      // Normal lesson path (CSV by manifest)
      const key = `${App.level}/${App.lesson}`;
      if (App.cache.vocab.has(key)) { App.deck = App.cache.vocab.get(key).slice(); return; }
      elVocabStatus.textContent = "Loading vocabulary…";

      const files = await listVocabCsvFiles(App.level, App.lesson); // absolute URLs
      const deck = [];
      for (const url of files){
        try{
          const txt = await (await fetch(encodePath(url), { cache:"no-cache" })).text();
          const csv = parseCSV(txt);
          for (const r of csv){
            const kanji = (r[0]||"").trim();
            const hira  = (r[1]||"").trim();
            const en    = (r[2]||"").trim();
            if (!hira || !en) continue;
            deck.push({ kanji, hira, en });
          }
        } catch {}
      }

      App.deck = deck;
      App.cache.vocab.set(key, deck);
      elVocabStatus.textContent = deck.length ? `Loaded ${deck.length} words.` : "No words found.";
    }

  function showVocabRootMenu(){
  // keep the top 3 tabs visible while you're inside Vocab
  if (inListVocabContext()) hideLessonBar(); else showLessonBar();
  document.querySelector(".lesson-meta")?.classList.add("hidden");

  // ✅ make sure the whole card reappears (this was missing)
  showVocabRootCard();

  // show the root buttons; hide submenus + finals
  document.querySelector("#vocab-mode-select")?.classList.remove("hidden");
  document.querySelector("#learn-table")?.classList.add("hidden");
  document.querySelector("#vocab-learn-menu")?.classList.add("hidden");
  document.querySelector("#vocab-mcq-menu")?.classList.add("hidden");
  document.querySelector("#vocab-write-menu")?.classList.add("hidden");
  document.querySelector("#learn")?.classList.add("hidden");
  document.querySelector("#practice")?.classList.add("hidden");
  document.querySelector("#write")?.classList.add("hidden");
  document.querySelector("#make")?.classList.add("hidden");
}


  window.openVocabLearnMenu = ()=>{
    if (inListVocabContext()) hideLessonBar(); else showLessonBar();
    document.querySelector(".lesson-meta")?.classList.add("hidden"); // keep meta hidden

    hideVocabRootCard();
    document.querySelector("#vocab-learn-menu")?.classList.remove("hidden");
    document.querySelector("#learn-table")?.classList.add("hidden");
    document.querySelector("#vocab-mcq-menu")?.classList.add("hidden");
    document.querySelector("#vocab-write-menu")?.classList.add("hidden");
    document.querySelector("#learn")?.classList.add("hidden");
    document.querySelector("#practice")?.classList.add("hidden");
    document.querySelector("#write")?.classList.add("hidden");
    document.querySelector("#make")?.classList.add("hidden");
    updateBackVisibility();

  };

  window.openVocabMCQMenu = ()=>{
    if (inListVocabContext()) hideLessonBar(); else showLessonBar();
    document.querySelector(".lesson-meta")?.classList.add("hidden"); // keep meta hidden

    hideVocabRootCard();
    document.querySelector("#vocab-learn-menu")?.classList.add("hidden");
    document.querySelector("#learn-table")?.classList.add("hidden");
    document.querySelector("#vocab-mcq-menu")?.classList.remove("hidden");
    document.querySelector("#vocab-write-menu")?.classList.add("hidden");
    document.querySelector("#learn")?.classList.add("hidden");
    document.querySelector("#practice")?.classList.add("hidden");
    document.querySelector("#write")?.classList.add("hidden");
    document.querySelector("#make")?.classList.add("hidden");
    updateBackVisibility();

  };

  window.openVocabWriteMenu = ()=>{
    if (inListVocabContext()) hideLessonBar(); else showLessonBar();
    document.querySelector(".lesson-meta")?.classList.add("hidden"); // keep meta hidden

    hideVocabRootCard();
    document.querySelector("#vocab-learn-menu")?.classList.add("hidden");
    document.querySelector("#vocab-mcq-menu")?.classList.add("hidden");
    document.querySelector("#vocab-write-menu")?.classList.remove("hidden");
    document.querySelector("#learn")?.classList.add("hidden");
    document.querySelector("#learn-table")?.classList.add("hidden");
    document.querySelector("#practice")?.classList.add("hidden");
    document.querySelector("#write")?.classList.add("hidden");
    document.querySelector("#make")?.classList.add("hidden");
    updateBackVisibility();

  };

  function filterDeckForMode(mode){
  const hasKanji = (w) => {
    const k = (w.kanji || "").trim();
    return k && k !== "—" && k !== "?";
  };
  switch (mode){
    case "kanji-hira":
    case "hira-kanji":
    case "k2h-e":
    case "e2h-k":
    case "write-k2h":
      return App.deck.filter(hasKanji);
    default:
      return App.deck.slice();
  }
}


  // --- Learn Mode (sequential) ---
  window.startLearnMode = async (variant = "k2h") => {
  await ensureDeckLoaded();
  App.learnVariant = (variant === "h2e") ? "h2e" : "k2h";
  try{ await flushSession(); }catch{}
  App.mode = "learn"; setCrumbs();

  // ⬇️ Only include words that actually have Kanji when doing Kanji→Hiragana
  if (App.learnVariant === "k2h") {
    const hasKanji = (w) => {
      const k = (w.kanji || "").trim();
      return k && k !== "—" && k !== "?";
    };
    App.deckFiltered = App.deck.filter(hasKanji);
  } else {
    App.deckFiltered = App.deck.slice();
  }

  App.qIndex = 0;
  App.stats = { right: 0, wrong: 0, skipped: 0 };
  updateScorePanel();

  hideLessonsHeaderAndList();
  hideLessonBar();
  hideVocabRootCard();
  hideVocabMenus();

  document.querySelector("#practice")?.classList.add("hidden");
  document.querySelector("#write")?.classList.add("hidden");
  document.querySelector("#make")?.classList.add("hidden");

  hideLearnNoteCard();
  document.querySelector("#learn").classList.remove("hidden");
  renderLearnCard();
  updateBackVisibility();
};


  function renderLearnCard(){
  const w = App.deckFiltered[App.qIndex];
  const actionsHost = document.querySelector("#learn-actions");

  if (!w){
    document.querySelector("#learn-box").textContent = "No words.";
    if (actionsHost) actionsHost.innerHTML = "";
    return;
  }

  const isK2H = App.learnVariant !== "h2e";
  const head  = isK2H ? "Kanji → Hiragana (Learn)" : "Hiragana → English (Learn)";
  const big   = isK2H ? (w.kanji && w.kanji!=="—" ? w.kanji : w.hira) : w.hira;
  const sub   = isK2H ? w.hira : w.en;

  // flashcard body (🔊 stays here)
  document.querySelector("#learn-box").innerHTML = `
    <div class="flashcard">
      <div class="muted" style="font-size:1.1em;">${escapeHTML(head)}</div>
      <div style="margin:8px 0;font-size:2em;">${escapeHTML(big)}</div>
      <div class="muted" style="margin-top:6px;">${escapeHTML(sub)}</div>
      <div style="margin-top:10px; display:flex; gap:8px; justify-content:center;">
        <button id="btn-audio" title="Play audio">🔊</button>
      </div>
    </div>`;

  // single controls row under the flashcard
  if (actionsHost){
    actionsHost.innerHTML = `
      <button id="learn-prev">⬅️ Previous</button>
      <button id="learn-next">➡️ Next</button>
      <button id="learn-mark">📌 Mark</button>
      <button id="learn-note-toggle">📝 Add Note</button>
    `;
  }

  // wire handlers
  const btnAudio = document.querySelector("#btn-audio");
  btnAudio && btnAudio.addEventListener("click", ()=>speakJa(w.hira), { passive:true });

  const btnPrev = document.querySelector("#learn-prev");
  const btnNext = document.querySelector("#learn-next");
  const btnMark = document.querySelector("#learn-mark");
  const btnNote = document.querySelector("#learn-note-toggle");

  btnPrev && btnPrev.addEventListener("click", prevLearn);
  btnNext && btnNext.addEventListener("click", nextLearn);
  btnMark && btnMark.addEventListener("click", markCurrentWord);
  btnNote && btnNote.addEventListener("click", learnNoteAddOrSave);

  // ensure the note card is hidden when a new item renders
  hideLearnNoteCard();
}

const NOTE_LS_KEY = "lj_notes_v1";
function noteKeyFor(w){ return "note::" + keyForWord(w); }

function getNoteFromLS(k){
  try{ const all = JSON.parse(localStorage.getItem(NOTE_LS_KEY)) || {}; return all[k] || ""; }
  catch{ return ""; }
}
function setNoteToLS(k, v){
  try{
    const all = JSON.parse(localStorage.getItem(NOTE_LS_KEY)) || {};
    all[k] = v;
    localStorage.setItem(NOTE_LS_KEY, JSON.stringify(all));
  }catch{}
}

function showLearnNoteCard(){
  const card = document.querySelector("#learn-note-card");
  card && card.classList.remove("hidden");
}
function hideLearnNoteCard(){
  const card = document.querySelector("#learn-note-card");
  const st   = document.querySelector("#learn-note-status");
  const btn  = document.querySelector("#learn-note-toggle");

  card && card.classList.add("hidden");
  st && (st.textContent = "—");
  if (btn){
    btn.classList.remove("saving");
    btn.textContent = "📝 Add Note";
  }
}

async function loadNoteIfNeeded(){
  const card = document.querySelector("#learn-note-card");
  if (!card || !card.classList.contains("hidden")) return;

  const w = App.deckFiltered[App.qIndex]; if (!w) return;
  const key = noteKeyFor(w);

  // try firebase first; fallback to LS
  let txt = "";
  try {
    const fb = await whenFBReady();
    if (fb?.getNoteForKey){ txt = await fb.getNoteForKey(key) || ""; }
    else if (fb?.notes?.get){ txt = await fb.notes.get(key) || ""; }
    else { txt = getNoteFromLS(key); }
  } catch { txt = getNoteFromLS(key); }

  const ta = document.querySelector("#learn-note-text");
  const st = document.querySelector("#learn-note-status");
  if (ta) ta.value = txt;
  if (st) st.textContent = txt ? "Loaded" : "—";
}

async function saveNoteNow(){
  const w = App.deckFiltered[App.qIndex]; if (!w) return;
  const key = noteKeyFor(w);
  const ta = document.querySelector("#learn-note-text");
  const txt = (ta?.value || "").trim();

  // try firebase; fallback to LS
  let ok = false;
  try {
    const fb = await whenFBReady();
    if (fb?.setNoteForKey){ await fb.setNoteForKey(key, txt); ok = true; }
    else if (fb?.notes?.set){ await fb.notes.set(key, txt); ok = true; }
  } catch {}
  if (!ok) setNoteToLS(key, txt);

  const st = document.querySelector("#learn-note-status");
  st && (st.textContent = "Saved ✓");
}

async function learnNoteAddOrSave(){
  const card = document.querySelector("#learn-note-card");
  const btn  = document.querySelector("#learn-note-toggle");
  const isClosed = card?.classList.contains("hidden");

  if (isClosed){
    // first click → open and lazy-load
    showLearnNoteCard();
    if (btn) btn.textContent = "💾 Save Note";
    await loadNoteIfNeeded();
    document.querySelector("#learn-note-text")?.focus();
  } else {
    // second click → save and close
    btn && btn.classList.add("saving");
    await saveNoteNow();
    hideLearnNoteCard();
  }
}
// === Learn: Table view =========================================
window.startLearnTable = async () => {
  await ensureDeckLoaded(); try{ await flushSession(); }catch{}
  App.mode = "learn-table"; setCrumbs();

  hideLessonsHeaderAndList();
  hideLessonBar();
  hideVocabRootCard();
  hideVocabMenus();

  // hide other finals
  document.querySelector("#learn")?.classList.add("hidden");
  document.querySelector("#practice")?.classList.add("hidden");
  document.querySelector("#write")?.classList.add("hidden");
  document.querySelector("#make")?.classList.add("hidden");

  document.querySelector("#learn-table")?.classList.remove("hidden");
  buildLearnTable();
  wireLearnTableOnce();
  updateBackVisibility();
};

// wire the Word Table button now + as a fallback after DOM ready
function wireLearnTableBtn(){
  const btn = document.querySelector("#btn-learn-table");
  if (btn && !btn.dataset.wired){
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => window.startLearnTable());
  }
}
wireLearnTableBtn();
document.addEventListener("DOMContentLoaded", wireLearnTableBtn);

  function buildLearnTable(){
    const tb = document.querySelector("#lt-table tbody");
    const q  = (document.querySelector("#lt-filter")?.value || "").trim().toLowerCase();
    if (!tb) return;

    const rows = (App.deck || []).filter(w => {
      if (!q) return true;
      return [w.kanji || "", w.hira || "", w.en || ""].join(" ").toLowerCase().includes(q);
    });

    tb.innerHTML = "";
    for (const w of rows){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="kanji">${escapeHTML(w.kanji || "—")}</td>
        <td class="hira">${escapeHTML(w.hira || "")}</td>
        <td class="en">${escapeHTML(w.en || "")}</td>
        <td class="acts">
          <button class="lt-audio-btn" title="Play">🔊</button>
          <button class="lt-mark-btn"  title="Mark this word">📌</button>
        </td>
      `;
      tr.querySelector(".lt-audio-btn")?.addEventListener("click", () => speakJa(w.hira));
      tr.querySelector(".lt-mark-btn")?.addEventListener("click", () => markCurrentWord(w));
      tb.appendChild(tr);
    }
  }

// function buildLearnTable(){
//   const tb = document.querySelector("#lt-table tbody");
//   const q  = (document.querySelector("#lt-filter")?.value || "").trim().toLowerCase();
//   if (!tb) return;

//   // filter on kanji/hira/en
//   const rows = (App.deck || []).filter(w => {
//     if (!q) return true;
//     return [w.kanji || "", w.hira || "", w.en || ""].join(" ").toLowerCase().includes(q);
//   });

//   tb.innerHTML = "";
//   for (const w of rows){
//     const tr = document.createElement("tr");
//     tr.innerHTML = `
//       <td class="kanji">${escapeHTML(w.kanji || "—")}</td>
//       <td class="hira">${escapeHTML(w.hira || "")}</td>
//       <td class="en">${escapeHTML(w.en || "")}</td>
//       <td class="acts">
//         <button class="lt-audio-btn" title="Play">🔊</button>
//         <button class="lt-mark-btn"  title="Mark">📌</button>
//       </td>
//     `;
//     tr.querySelector(".lt-audio-btn")?.addEventListener("click", () => speakJa(w.hira));
//     tr.querySelector(".lt-mark-btn")?.addEventListener("click", () => markCurrentWord(w));
//     tb.appendChild(tr);
//   }
// }

  function wireLearnTableOnce(){
    if (window.__ltWired) return;
    window.__ltWired = true;

    // filter-as-you-type
    document.querySelector("#lt-filter")?.addEventListener("input", buildLearnTable);

    // sort by clicking headers
    let sortKey = null, dir = 1;
    document.querySelector("#lt-table thead")?.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-k]");
      if (!th) return;
      const k = th.dataset.k;
      dir = (sortKey === k ? -dir : 1);
      sortKey = k;
      // locale-aware for Japanese
      App.deck = (App.deck || []).slice()
        .sort((a,b) => String(a[k]||"").localeCompare(String(b[k]||""), "ja") * dir);
      buildLearnTable();
    });

    // shuffle
    document.querySelector("#lt-shuffle")?.addEventListener("click", () => {
      App.deck = shuffle(App.deck || []);
      buildLearnTable();
    });

    // play all (current filtered order)
    document.querySelector("#lt-playall")?.addEventListener("click", async () => {
      const items = Array.from(document.querySelectorAll("#lt-table tbody td.hira"))
        .map(td => (td.textContent || "").trim()).filter(Boolean);
      for (const hira of items){
        speakJa(hira);
        await sleep(600); // small gap between words
      }
    });
    // Column visibility toggles
    // Column visibility toggles (safe if .lt-cols is missing)
    (function wireLtColumns(){
      const host = document.querySelector("#learn-table");
      const controls = document.querySelector(".lt-cols");  // <— might not exist
      if (!host || !controls) return;

      function applyCols(){
        ["kanji","hira","en","audio"].forEach(k=>{
          const ch = controls.querySelector(`input[data-col="${k}"]`);
          const on = ch ? ch.checked : true;                // <— default to visible
          host.classList.toggle(`hide-col-${k}`, !on);
        });
      }

      controls.querySelectorAll("input[type='checkbox']").forEach(ch=>{
        ch.addEventListener("change", applyCols);
      });
      applyCols();
    })();


  }

  // --- MCQ Modes ---
  function requeueWrongItem(w, list, fromIdx){
    const key = keyForWord(w);
    const map = App.mastery.wrongs;
    const n = (map.get(key) || 0) + 1;
    map.set(key, n);

    // Progressive spacing: min gap grows with wrong count (caps at +10)
    const minGap = Math.min(3 + n, 10);
    const len = list.length;
    const insertAt = Math.min(fromIdx + minGap + Math.floor(Math.random() * Math.max(1, len - minGap)), len);

    // Optional nudges
    if (n === 2) toast("Hint: Watch for small vowel/long vowel differences.");
    if (n === 4) toast(`Try focusing on: ${w.hira} — ${w.en}`);

    list.splice(insertAt, 0, w);
  }

  window.startPractice = async (mode)=>{
    await ensureDeckLoaded(); try{ await flushSession(); }catch{}
    App.mode = mode; setCrumbs();

    // Build Mastery Lists
    const unique = [];
    const seen = new Set();
    for (const w of filterDeckForMode(mode)) {
      const k = keyForWord(w);
      if (!seen.has(k)) { seen.add(k); unique.push(w); }
    }
    App.mastery = { pending: shuffle(unique), mastered: [] };
    App.mastery.wrongs = new Map(); // key -> count this session
    App.deckFiltered = unique.slice();
    App.qIndex = 0;
    App.stats = { right: 0, wrong: 0, skipped: 0 };
    updateScorePanel();

    hideLessonsHeaderAndList();
    hideLessonBar();
    hideVocabRootCard();
    hideVocabMenus();
    elLearn.classList.add("hidden");
    elWrite.classList.add("hidden");
    elMake.classList.add("hidden");

    D("#practice").classList.remove("hidden");
    elQuestionBox.textContent="";
    elOptions.innerHTML="";
    elExtraInfo.textContent="";
    updateDeckProgress();
    renderQuestion();
    updateBackVisibility();

    toast("🎯 Mastery Mode — you’ll see wrong/skipped items again until all are correct!");
  };

  function updateDeckProgress(){
    const total = (App.mastery?.pending?.length || 0) + (App.mastery?.mastered?.length || 0);
    const done  = (App.mastery?.mastered?.length || 0);
    elDeckBar.style.width = pct(done, total);
    elDeckText.textContent = `${done} / ${total} (${pct(done, total)})`;
  }

  function renderQuestion(){
    const w = App.mastery?.pending?.[App.qIndex];
    if (!w){
      if (App.mastery && App.mastery.pending.length === 0) {
        elQuestionBox.textContent = "🎉 All done! Every word mastered.";
        elOptions.innerHTML="";
        try { flushSession(); }catch{}
        return;
      }
      App.qIndex = 0;
      return renderQuestion();
    }

    const mode = App.mode; let prompt="", correct="", poolField="";
    if (mode === "k2h-e") return renderDualQuestion(w, "k2h-e");
    else if (mode === "e2h-k") return renderDualQuestion(w, "e2h-k");
    else if (mode==="jp-en"){ prompt=w.hira; correct=w.en; poolField="en"; }
    else if (mode==="en-jp"){ prompt=w.en; correct=w.hira; poolField="hira"; }
    else if (mode==="kanji-hira"){ prompt=w.kanji; correct=w.hira; poolField="hira"; }
    else if (mode==="hira-kanji"){ prompt=w.hira; correct=w.kanji; poolField="kanji"; }
    else { prompt=w.hira; correct=w.en; poolField="en"; }

    elQuestionBox.textContent = prompt;
    const opts = buildOptions(correct, poolField);
    elOptions.innerHTML="";
    for (const opt of opts){
      const li=document.createElement("li");
      const btn=document.createElement("button");
      btn.textContent = opt;

      // mark which one is the correct answer for reveal-on-wrong
      if (opt === correct) btn.dataset.correct = "1";

      btn.addEventListener("click", ()=> onPickOption(btn, opt===correct, w));
      li.appendChild(btn);
      elOptions.appendChild(li);
    }

  }

  function onPickOption(btn, ok, w){
    const buttons = Array.from(document.querySelectorAll("#options button"));
    buttons.forEach(b=>b.disabled=true);

    let delayMs = 450; // default fast advance

    if (ok){
      btn.classList.add("is-correct");
      App.stats.right++; incrementPoints(1);
      App.mastery.mastered.push(w);
      App.mastery.pending.splice(App.qIndex,1);
    } else {
      btn.classList.add("is-wrong");
      App.stats.wrong++; recordMistake(w);

      // Also highlight the correct option in green
      const correctBtn = buttons.find(b => b.dataset.correct === "1");
      if (correctBtn) correctBtn.classList.add("is-correct");

      // Requeue wrong item with spacing
      requeueWrongItem(w, App.mastery.pending, App.qIndex);

      // Wait 5 seconds so the learner can see both markings
      delayMs = 3000;
    }

    updateScorePanel();

    setTimeout(()=>{
      const len = App.mastery.pending.length;
      App.qIndex = len ? ((App.qIndex + 1) % len) : 0;
      updateDeckProgress();
      renderQuestion();
    }, delayMs);
  }


  function buildOptions(correct, field, n=4){
    const pool =
      (App.deckFiltered && App.deckFiltered.length) ? App.deckFiltered :
      (App.mastery ? App.mastery.pending.concat(App.mastery.mastered) : App.deck || []);
    const vals = pool.map(w=>w[field]).filter(v => v && v !== correct);
    const picks = shuffle(vals).slice(0, n-1);
    picks.push(correct);
    return shuffle(picks);
  }

  window.skipQuestion = ()=>{
    const w = App.mastery?.pending?.[App.qIndex];
    if (!w) return;
    recordMistake(w);
    App.stats.skipped++; updateScorePanel();
    // reinsert later randomly
    //const insertAt = Math.min(App.qIndex + 3 + Math.floor(Math.random()*App.mastery.pending.length), App.mastery.pending.length);
    //App.mastery.pending.splice(insertAt, 0, w);
    requeueWrongItem(w, App.mastery.pending, App.qIndex);
    App.qIndex = (App.qIndex + 1) % App.mastery.pending.length;
    updateDeckProgress(); renderQuestion();
  };


  window.showRomaji = ()=> toast("Romaji: (not available)");
  window.showMeaning = ()=>{ const w=App.deckFiltered[App.qIndex]; if(w) toast(`Meaning: ${w.en}`); };

  window.startWordMatching = async (variant /* "eh" | "keh" */) => {
    await ensureDeckLoaded(); try{ await flushSession(); }catch{}

    App.mode = (variant === "keh") ? "match-keh" : "match-eh";
    App.match.active  = true;
    App.match.variant = (variant === "keh") ? "keh" : "eh";

    // Build the full queue once (de-duped), filtered per variant
    const hasKanji = w => {
      const k = (w.kanji || "").trim();
      return k && k !== "—" && k !== "?";
    };
    const base = (variant === "keh") ? (App.deck || []).filter(hasKanji) : (App.deck || []);
    const seen = new Set();
    const unique = [];
    for (const w of base){
      const k = keyForWord(w);
      if (seen.has(k)) continue;
      seen.add(k); unique.push(w);
    }
    // shuffle once for the whole session
    App.match.queue = shuffle(unique);
    App.match.pos = 0;
    App.match.total = App.match.queue.length;
    App.match.solvedTotal = 0;

    App.stats = { right:0, wrong:0, skipped:0 }; updateScorePanel();

    // strict linear like other finals
    hideLessonsHeaderAndList();
    hideLessonBar();
    hideVocabRootCard();
    hideVocabMenus();
    elLearn.classList.add("hidden");
    elWrite.classList.add("hidden");
    elMake.classList.add("hidden");
    D("#practice").classList.remove("hidden");

    // build first round
    newMatchRound();
    updateDeckProgressForMatch();
    updateBackVisibility();
  };


  function newMatchRound(){
    // if finished, show all done + persist
    if (App.match.pos >= App.match.total) {
      elQuestionBox.textContent = "All done.";
      elOptions.innerHTML = "";
      updateDeckProgressForMatch();
      // best-effort save
      try { flushSession(); } catch {}
      return;
    }

    const end = Math.min(App.match.pos + 5, App.match.total);
    App.match.roundWords = App.match.queue.slice(App.match.pos, end);
    App.match.solved.clear();
    App.match.picks = { kanji:null, hira:null, en:null };
    renderMatchRound();
  }


  function updateDeckProgressForMatch(){
    const done = App.match.solvedTotal;
    const total = App.match.total || 0;
    elDeckBar.style.width = pct(done, total);
    elDeckText.textContent = `${done} / ${total} (${pct(done, total)})`;
  }


  function renderMatchRound(){
    const v = App.match.variant; // "eh" or "keh"
    const list = App.match.roundWords.slice();

    // No header/flashcard for Word Matching modes (as requested)
    elQuestionBox.textContent = "";


    // Prepare per-column arrays (shuffle independently)
    const colHira = shuffle(list.map(w => ({key:keyForWord(w), label:w.hira, col:"hira"})));
    const colEn   = shuffle(list.map(w => ({key:keyForWord(w), label:w.en,   col:"en"  })));
    const colKan  = (v === "keh")
      ? shuffle(list.map(w => ({key:keyForWord(w), label:(w.kanji||"—"), col:"kanji"})))
      : null;

    // Build grid
    elOptions.innerHTML = "";
    // Keep DOM refs for keyboard control
    const dom = {
      cols: { kanji: [], hira: [], en: [] },
      order: (v === "keh") ? ["kanji","hira","en"] : ["hira","en"],
      step: 0  // which column the keyboard is currently targeting
    };

    const grid = document.createElement("div");
    grid.className = "match-grid " + (v === "keh" ? "cols-3" : "cols-2");

    function makeCol(items, colName){
      const col = document.createElement("div");
      col.className = "match-col";
      for (const item of items){
        const b = document.createElement("button");
        b.className = "match-btn";
        b.textContent = item.label || "—";
        b.dataset.key = item.key;
        b.dataset.col = colName;

        if (App.match.solved.has(item.key)){
          b.classList.add("is-solved");
          b.disabled = true;
        }

        b.addEventListener("click", () => onMatchPick(b), { passive:true });
        col.appendChild(b);

        // NEW: store for keyboard access
        (dom.cols[colName] || (dom.cols[colName] = [])).push(b);
      }
      return col;
    }


    if (v === "keh"){
      grid.appendChild(makeCol(colKan,  "kanji"));
      grid.appendChild(makeCol(colHira, "hira"));
      grid.appendChild(makeCol(colEn,   "en"));
    } else {
      grid.appendChild(makeCol(colHira, "hira"));
      grid.appendChild(makeCol(colEn,   "en"));
    }

    elOptions.appendChild(grid);
    App.match.dom = dom;

    // Practice action row (reuse your existing)
    // nothing extra here; skip/romaji buttons continue to work
  }

  function advanceMatchStep(){
  if (!App.match?.dom) return;
  const order = App.match.dom.order || [];
  // Jump to the first column that hasn't been picked yet
  for (let i = 0; i < order.length; i++){
    if (!App.match.picks[order[i]]) {
      App.match.dom.step = i;
      return;
    }
  }
  // If all picked (finalize will run), reset targeting back to first
  App.match.dom.step = 0;
}

function clearSelection(col){
  // unselect currently picked button in a column
  const prev = App.match.picks[col];
  if (!prev) return;
  prev.classList.remove("is-selected");
  App.match.picks[col] = null;
}

function onMatchPick(btn){
  if (btn.classList.contains("is-solved")) return;
  const col = btn.dataset.col;
  if (!col) return;

  // toggle select/deselect
  if (btn.classList.contains("is-selected")) {
    btn.classList.remove("is-selected");
    App.match.picks[col] = null;
    return;
  }

  // ensure only one selection per column
  clearSelection(col);
  btn.classList.add("is-selected");
  App.match.picks[col] = btn;
  advanceMatchStep();

  // evaluate when all required columns selected
  const need3 = (App.match.variant === "keh");
  const hasH = !!App.match.picks.hira;
  const hasE = !!App.match.picks.en;
  const hasK = !!App.match.picks.kanji;

  if ((!need3 && hasH && hasE) || (need3 && hasH && hasE && hasK)){
    finalizeMatchTry();
  }
}

function finalizeMatchTry(){
  const picks = App.match.picks;
  const chosen = Object.values(picks).filter(Boolean);
  const keys = chosen.map(b => b.dataset.key);
  const allSame = keys.length && keys.every(k => k === keys[0]);

  if (allSame){
    // ✓ correct — add green, then lock & count once
    App.stats.right++; incrementPoints(1); updateScorePanel();

    chosen.forEach(b=>{
      b.classList.remove("is-selected");
      b.classList.add("is-correct");
      // small delay so the green shows, then freeze as solved
      setTimeout(()=>{
        b.classList.add("is-solved");
        b.disabled = true;
      }, 120);
    });

    // mark this key as solved in the current round
    App.match.solved.add(keys[0]);
    App.match.picks = { kanji:null, hira:null, en:null };
    // increment full-deck solved count
    App.match.solvedTotal++;
    updateDeckProgressForMatch();

    // when the current slice is done, advance to the next slice
    if (App.match.solved.size >= App.match.roundWords.length){
      App.match.pos += App.match.roundWords.length;
      setTimeout(() => {
        newMatchRound();
        updateDeckProgressForMatch();
      }, 220);
    }
  } else {
    // ✗ wrong → record mistake (for the representative first key), flash red
    App.stats.wrong++; updateScorePanel();
    try {
      const k0 = keys[0];
      const w = (App.match.roundWords || []).find(w => keyForWord(w) === k0);
      if (w) recordMistake(w);
    } catch {}

    chosen.forEach(b=>{
      b.classList.add("is-wrong");
      setTimeout(()=> b.classList.remove("is-wrong"), 350);
      b.classList.remove("is-selected");
    });
    App.match.picks = { kanji:null, hira:null, en:null };
  }
}


// ==== Keyboard shortcuts for Word Matching ====
// 0 = Skip round; 1..5 select row in the current column (then auto-advance to next column)
window.addEventListener("keydown", (e) => {
  if (!App.match?.active || !isVisible("#practice")) return;

  // ignore while typing or with modifiers
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const k = e.key;

  // 0 → Skip = reshuffle a fresh 5-word round
  if (k === "0") {
    e.preventDefault();
    window.mcqSkip();
    return;
  }

  // Only 1..5 are valid
  if (!/^[1-5]$/.test(k)) return;
  e.preventDefault();

  const idx = k.charCodeAt(0) - 49; // '1'..'5' → 0..4
  const dom = App.match.dom;
  if (!dom) return;

  // Determine which column to target:
  // follow fixed order: KEH = Kanji→Hiragana→English, EH = Hiragana→English
  const order = dom.order || [];
  // Ensure step points at the first unpicked column
  advanceMatchStep();
  const colName = order[dom.step] || order[0];

  // Find the Nth enabled button in that column
  const list = (dom.cols[colName] || []);
  const btn = list[idx];
  if (btn && !btn.disabled) {
    btn.click(); // delegates to onMatchPick(...)
  }
});

  function renderDualQuestion(w,mode){
    elOptions.innerHTML = "";
    // const mode = App.mode; // "k2h-e" or "e2h-k"

    // Skip rows that have no kanji (both dual modes would break without a kanji candidate set)
    if (!w.kanji || !w.kanji.trim()){
      App.qIndex++; updateDeckProgress(); return renderQuestion();
    }

    const grid = document.createElement("div"); grid.className = "dual-grid";
    const leftCol  = document.createElement("div");
    const rightCol = document.createElement("div");
    grid.appendChild(leftCol); grid.appendChild(rightCol);
    elOptions.appendChild(grid);

    // Decide prompt + which fields populate LEFT/RIGHT
    let prompt, correctLeft, correctRight, pickSetLeft, pickSetRight;

    if (mode === "k2h-e"){
      // Kanji prompt; choose HIRAGANA (left) + ENGLISH (right)
      prompt       = w.kanji;
      correctLeft  = w.hira;
      correctRight = w.en;
      pickSetLeft  = buildOptions(correctLeft,  "hira");
      pickSetRight = buildOptions(correctRight, "en");
    } else if (mode === "e2h-k"){ // default to "e2h-k"
      // English prompt; choose HIRAGANA (left) + KANJI (right)
      prompt       = w.en || "";
      correctLeft  = w.hira;
      correctRight = w.kanji;
      pickSetLeft  = buildOptions(correctLeft,  "hira");
      pickSetRight = buildOptions(correctRight, "kanji");
    }

    // Show the question text (kanji or english depending on mode)
    elQuestionBox.textContent = prompt;

    let pickedLeft = null, pickedRight = null;

    function finalize(){
      if (pickedLeft == null || pickedRight == null) return;
      const ok = (pickedLeft === correctLeft) && (pickedRight === correctRight);
      if (ok){ App.stats.right++; incrementPoints(1); }
      else   { App.stats.wrong++; recordMistake(w); }
      updateScorePanel();
      setTimeout(()=>{ App.qIndex++; updateDeckProgress(); renderQuestion(); }, 350);
    }

    // LEFT column buttons
    for (const val of pickSetLeft){
      const b = document.createElement("button");
      b.textContent = val;
      b.addEventListener("click", ()=>{
        A(".dual-grid > :first-child button").forEach(x => x.disabled = true);
        b.classList.add(val === correctLeft ? "is-correct" : "is-wrong");
        pickedLeft = val;
        finalize();
      }, { once:true });
      leftCol.appendChild(b);
    }

    // RIGHT column buttons
    for (const val of pickSetRight){
      const b = document.createElement("button");
      b.textContent = val;
      b.addEventListener("click", ()=>{
        A(".dual-grid > :last-child button").forEach(x => x.disabled = true);
        b.classList.add(val === correctRight ? "is-correct" : "is-wrong");
        pickedRight = val;
        finalize();
      }, { once:true });
      rightCol.appendChild(b);
    }
  }
  window.startDualMCQ = (variant)=> window.startPractice(variant);

// ==== Keyboard shortcuts for MCQ (incl. Dual) ====
// 1..4 = pick options; 0 = Skip current question
  window.mcqSkip = function(){
    // NEW: handle Word Matching
    if (App.match?.active && isVisible("#practice")){
      App.stats.skipped++; updateScorePanel();
      newMatchRound();                         // fresh 5-word round
      updateDeckProgressForMatch();
      return;
    }

    // …existing MCQ skip logic…
    if (!isVisible("#practice")) return;
    A("#options button, .dual-grid button").forEach(b => b.disabled = true);
    const w = App.deckFiltered[App.qIndex];
    if (w) recordMistake(w);
    App.stats.skipped++; updateScorePanel();
    setTimeout(()=>{ App.qIndex++; updateDeckProgress(); renderQuestion(); }, 120);
  };



  window.addEventListener("keydown", (e) => {
    // only when MCQ/Dual is on screen; ignore while typing
    if (!isVisible("#practice")) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const k = e.key;

    // 0 → Skip
    if (k === "0") { e.preventDefault(); window.mcqSkip(); return; }

    // 1..4 → pick
    if (k !== "1" && k !== "2" && k !== "3" && k !== "4") return;
    e.preventDefault();
    const idx = k.charCodeAt(0) - 49; // '1'→0, '2'→1, ...

    // Dual MCQ: first press selects LEFT column, second press selects RIGHT
    const dual = document.querySelector(".dual-grid");
    if (dual) {
      const left  = Array.from(dual.querySelectorAll(":scope > :first-child button"));
      const right = Array.from(dual.querySelectorAll(":scope > :last-child  button"));
      const leftActive = left.length && !left[0].disabled;
      const list = leftActive ? left : right;
      const btn = list[idx];
      if (btn && !btn.disabled) btn.click();
      return;
    }

    // Regular MCQ
    const btns = Array.from(document.querySelectorAll("#options li button"));
    const btn = btns[idx];
    if (btn && !btn.disabled) btn.click();
  });

  // ---------- Write Mode ----------
  window.startWriteEN2H = async ()=> startWriteWords("en2h");
  window.startWriteK2H  = async ()=> startWriteWords("k2h");

  async function startWriteWords(variant="en2h"){
    await ensureDeckLoaded(); try{ await flushSession(); }catch{}
    App.mode = (variant==="k2h") ? "write-k2h" : "write-en2h";
    App.write.variant = (variant==="k2h") ? "k2h" : "en2h";
    setCrumbs();
    const base = (variant==="k2h") ? filterDeckForMode("write-k2h") : App.deck.slice();
    const unique = [];
    const seen = new Set();
    for (const w of base) {
      const k = keyForWord(w);
      if (!seen.has(k)) { seen.add(k); unique.push(w); }
    }
    App.mastery = { pending: shuffle(unique), mastered: [] };
    App.mastery.wrongs = new Map(); // key -> count this session
    App.deckFiltered = shuffle(base);
    App.write.order = App.deckFiltered.map((_,i)=>i);
    App.write.idx = 0; App.stats = { right:0, wrong:0, skipped:0 }; updateScorePanel();

    hideLessonsHeaderAndList();
    hideLessonBar();
    hideVocabRootCard();

    hideVocabMenus();
    elLearn.classList.add("hidden");
    D("#practice")?.classList.add("hidden");
    elMake.classList.add("hidden");

    elWrite.classList.remove("hidden");
    renderWriteCard();
    updateBackVisibility();

  }
  function renderWriteCard(){
    const i = App.write.order[App.write.idx] ?? -1;
    const w = App.deckFiltered[i];
    if (!w){ elWriteCard.textContent="All done."; elWriteInput.value=""; updateWriteProgress(); return; }
    if (App.write.variant==="k2h") elWriteCard.textContent = (w.kanji||"");
    else elWriteCard.textContent = w.en;
    elWriteInput.value=""; elWriteFeedback.textContent=""; elWriteInput.focus(); updateWriteProgress();
  }
  function updateWriteProgress(){
    const cur = Math.min(App.write.idx, App.write.order.length);
    elWriteBar.style.width = pct(cur, App.write.order.length);
    elWriteText.textContent = `${cur} / ${App.write.order.length} (${pct(cur, App.write.order.length)})`;
  }

// Write → Submit (no auto-advance on WRONG)
window.writeSubmit = () => {
  const i = App.write.order[App.write.idx] ?? -1;
  const w = App.deckFiltered[i];
  if (!w) return;

  const ans = (elWriteInput.value || "").trim();
  if (!ans) return;

  const norm = s => (s || "")
    .replace(/\s+/g, "")
    .replace(/[〜～~]/g, "")
    .toLowerCase();

  const isCorrect = norm(ans) === norm(w.hira);

  if (isCorrect) {
    // ✅ correct → record + advance
    elWriteFeedback.innerHTML = `<span class="ok-inline">✓ Correct</span>`;
    App.stats.right++; incrementPoints(1);

    App.mastery.mastered.push(w);
    // remove one pending item at this index
    App.mastery.pending.splice(App.write.idx, 1);
    updateScorePanel();

    // if nothing pending → show completion
    if (App.mastery.pending.length === 0) {
      App.write.idx = App.write.order.length;  // forces "All done."
      renderWriteCard();
      return;
    }

    // otherwise advance
    App.write.idx = (App.write.idx + 1) % App.mastery.pending.length;
    renderWriteCard();
  } else {
    // ❌ wrong → stay on same card, log mistake, requeue later
    elWriteFeedback.innerHTML = `<span class="error-inline">❌ Wrong: ${w.hira}</span>`;
    App.stats.wrong++; recordMistake(w);
    requeueWrongItem(w, App.mastery.pending, App.write.idx);
    updateScorePanel();

    // keep focus so you can fix and re-submit
    elWriteInput.focus();
    if (elWriteInput.select) elWriteInput.select();
    // (no renderWriteCard + no idx change → no auto-advance)
  }
};




  window.writeSkip = ()=>{
    const i = App.write.order[App.write.idx] ?? -1;
    const w = App.deckFiltered[i];
    if (w) recordMistake(w);                     // ← log skipped word
    App.stats.skipped++; updateScorePanel();
    App.write.idx++; renderWriteCard();
  };

  window.writeShowDetails = ()=>{
    const i = App.write.order[App.write.idx] ?? -1; const w = App.deckFiltered[i];
    if (!w) return;
    if (App.write.variant==="k2h") toast(`Hint: ${w.kanji} → ${w.hira}`);
    else toast(`Hint: ${w.en} → ${w.hira}`);
  };
  window.writeNext = ()=>{ App.write.idx++; renderWriteCard(); };

  // ---------- Make Sentence ----------
  window.startMakeSentence = async ()=>{
    await ensureDeckLoaded(); try{ await flushSession(); }catch{}
    App.mode = "make"; setCrumbs();
    App.make.order = shuffle(App.deck).map((_,i)=>i).slice(0, Math.min(App.deck.length, 30));
    App.make.idx = 0; App.stats = { right:0, wrong:0, skipped:0 };

    hideLessonsHeaderAndList();
    hideLessonBar();
    hideVocabRootCard();

    hideVocabMenus();
    elLearn.classList.add("hidden");
    elWrite.classList.add("hidden");
    D("#practice")?.classList.add("hidden");

    elMake.classList.remove("hidden");
    renderMakeCard();
    updateBackVisibility();

  };
  function renderMakeCard(){
    const i = App.make.order[App.make.idx] ?? -1;
    const w = App.deck[i]; if(!w){ elMakeCard.textContent="All done."; return; }
    const picks=[w];
    if (Math.random()<0.4 && App.deck.length>1) picks.push(App.deck[(i+3)%App.deck.length]);
    if (Math.random()<0.2 && App.deck.length>2) picks.push(App.deck[(i+7)%App.deck.length]);
    elMakeCard.innerHTML = picks.map(x=>`<b>${escapeHTML(x.hira)}</b>`).join("　·　");
    elMakeInput.value=""; elMakeFeedback.textContent=""; updateMakeProgress();
  }
  function updateMakeProgress(){
    const cur=Math.min(App.make.idx, App.make.order.length);
    elMakeBar.style.width=pct(cur, App.make.order.length);
    elMakeText.textContent=`${cur} / ${App.make.order.length} (${pct(cur, App.make.order.length)})`;
  }
  window.makeSubmit = ()=>{
    const text=(elMakeInput.value||"").trim(); if(!text) return;
    App.stats.right++; incrementPoints(1); elMakeFeedback.textContent="✓ Saved.";
  };
  window.makeSkip = ()=>{
    const i = App.make.order[App.make.idx] ?? -1;
    const w = App.deck[i];
    if (w) recordMistake(w);                     // ← log skipped word
    App.stats.skipped++; updateScorePanel();
    App.make.idx++; renderMakeCard();
  };

  window.makeShowHints = ()=> toast("Hint: Use particles like は / を / に / で to connect.");
  window.makeNext = ()=>{ App.make.idx++; renderMakeCard(); };

  // ---------- Mistakes ----------
  const MKEY="lj_mistakes_v1";
  function getMistakes(){ try{ return JSON.parse(localStorage.getItem(MKEY))||[]; }catch{ return []; } }
  function setMistakes(a){ try{ localStorage.setItem(MKEY, JSON.stringify(a)); }catch{} }
  function recordMistake(w){ const list=getMistakes(); const key=keyForWord(w); if(!list.some(x=>x.key===key)) list.push({ key, ...w }); setMistakes(list); }
  function renderMistakesLanding(){ const n=getMistakes().length; elMistakesStatus.textContent = n ? `${n} word(s) saved as mistakes.` : "No mistakes yet."; }
  window.startMistakeLearn = ()=> setupListPractice("mistake","learn");
  window.startMistakePractice = (m)=> setupListPractice("mistake", m);
  window.startMistakeWrite = ()=> setupListPractice("mistake","write");
  window.clearMistakes = ()=>{ setMistakes([]); renderMistakesLanding(); toast("Mistakes cleared"); };


  // ---------- Marked ----------
  async function renderMarkedList(){
  if (elMarkedContainer) elMarkedContainer.innerHTML = "";

  let remote = [], local = [], signed = [];
  const fb = await whenFBReady().catch(()=>null);

  try { if (fb) remote = await fb.listMarked(); } catch {}
  try { local  = getLocalMarked() || []; } catch {}
  try { if (fb) signed = await fb.signWordList(); } catch {}

  // Merge by single key = safe(front::back)
  const byKey = new Map();

  const ensureRow = (key) => {
    if (!byKey.has(key)){
      byKey.set(key, { id: key, front:"", back:"", hira:"", en:"", kanji:null,
                       hasRemote:false, hasLocal:false, localId:null, signId:null, markedId:key });
    }
    return byKey.get(key);
  };

  // Remote Marked (Firestore rows) — r.id is already the safe doc id
  for (const r of remote){
    const key = r.id;
    const row = ensureRow(key);
    Object.assign(row, {
      front: r.front || r.hira || row.front,
      back:  r.back  || r.en   || row.back,
      hira:  r.hira  || row.hira,
      en:    r.en    || row.en,
      kanji: r.kanji ?? row.kanji,
      hasRemote: true
    });
  }

  // Sign Words — s.markedId is the same safe key used by Marked
  for (const s of signed){
    const key = s.markedId || toSafeKey(`${s.front}::${s.back}`);
    const row = ensureRow(key);
    row.signId = s.id;
    if (!row.front) { row.front = s.front; row.back = s.back; }
  }

  // Local Marked (your localStorage copy)
  for (const l of local){
    const f = l.front || l.hira || "";
    const b = l.back  || l.en   || "";
    const key = toSafeKey(`${f}::${b}`);
    const row = ensureRow(key);
    row.hasLocal = true;
    row.localId  = l.id || row.localId;
    if (!row.front){ row.front = f; row.back = b; row.hira = l.hira || ""; row.en = l.en || ""; row.kanji = l.kanji ?? row.kanji; }
  }

  const rows = Array.from(byKey.values());
  elMarkedStatus.textContent = `${rows.length} item(s).`;

  for (const r of rows){
    const badges = [
      r.hasRemote ? "cloud" : null,
      r.hasLocal  ? "local" : null,
      r.signId    ? "signed" : null
    ].filter(Boolean).map(x=>`<span class="badge">${x}</span>`).join(" ");

    const div = document.createElement("div");
    div.className = "marked-item";
    div.innerHTML = `
      <div>${escapeHTML(r.front || r.hira || r.kanji || r.id)} —
        <span class="muted">${escapeHTML(r.back || r.en || "")}</span> ${badges}
      </div>
      <button
        data-key="${escapeHTML(r.markedId)}"
        data-sign-id="${escapeHTML(r.signId || "")}"
        data-has-remote="${r.hasRemote ? "1" : "0"}"
        data-has-local="${r.hasLocal ? "1" : "0"}"
        data-local-id="${escapeHTML(r.localId || "")}"
      >Unmark</button>`;

    div.querySelector("button")?.addEventListener("click", async (e) => {
      const key       = e.currentTarget.dataset.key;
      const signId    = e.currentTarget.dataset.signId || null;
      const hasRemote = e.currentTarget.dataset.hasRemote === "1";
      const hasLocal  = e.currentTarget.dataset.hasLocal  === "1";
      const localId   = e.currentTarget.dataset.localId || null;
      await cascadeRemoveByKey({ key, signId, hasRemote, hasLocal, localId });
      toast("Removed ✓");
      await renderMarkedList();
    });

    elMarkedContainer.appendChild(div);
  }
}



  window.startMarkedLearn = async()=> setupListPractice("marked","learn");
  window.startMarkedPractice = async(m)=> setupListPractice("marked", m);
  window.startMarkedWrite = async()=> setupListPractice("marked","write");
  
  window.renderWordListLanding = async function renderWordListLanding(){
    const fb = await whenFBReady();
    // prefer cache first
    let lists = null;
    try { lists = JSON.parse(localStorage.getItem("lj_wl_lists")||"null"); } catch {}
    if (!Array.isArray(lists)) lists = await fb.lists.listLists();

    elWLListUL.innerHTML = "";
    if (!lists.length){ elWLEmpty.style.display="block"; return; }
    elWLEmpty.style.display="none";

    for (const it of lists){
      const li = document.createElement("li");
      const left = document.createElement("div");
      const right = document.createElement("div");
      left.innerHTML = `<strong>${escapeHTML(it.name)}</strong> <span class="muted">(${it.wordCount||0})</span>`;
      right.innerHTML = `<button data-id="${it.id}" class="primary">Open</button>`;
      li.appendChild(left); li.appendChild(right);
      li.querySelector("button").addEventListener("click", ()=>{
    if ((it.wordCount|0) === 0) {
      hideContentPanes();
      document.querySelector("#wordlist-section")?.classList.remove("hidden");
      openWLAddWords(it.id, it.name);
    } else {
      openWordListAsVocab(it.id, it.name);
    }
  });
      elWLListUL.appendChild(li);
    }
  }

  elWLCreateBtn?.addEventListener("click", async ()=>{
    const name = (elWLNameInput?.value||"").trim();
    if (!name) { toast("Name required."); return; }
    const fb = await whenFBReady();
    const id = await fb.lists.createList(name);
    elWLNameInput.value = "";
    toast("List created.");
    await renderWordListLanding();
  });

  elWLRefreshBtn?.addEventListener("click", async ()=>{
    // bust cache and refresh
    try { localStorage.removeItem("lj_wl_lists"); }catch{}
    const fb = await whenFBReady();
    fb.lists.invalidate?.();// if exposed; else just call listLists() again
    await renderWordListLanding();
  });

  // “Add words” flow
  let __WL_CTX = { listId:null, listName:null, stagedDeck:[] };

  // Open "Add Words" using the exact Mix picker UI
  async function openWLAddWords(listId, listName){
    WLAddCtx.active   = true;
    WLAddCtx.listId   = listId;
    WLAddCtx.listName = listName || "Untitled";
    WLAddCtx.staged   = [];

    // Reuse your Mix Practice screen verbatim
    await openMixPractice();

    // Optional: small banner so the user knows they’re adding to a list
    decorateMixForWordList();
  }
function decorateMixForWordList(){
  if (!WLAddCtx.active) return;
  const mixTitle = document.querySelector("#mix-title"); // adjust the selector to your Mix header
  const mixStatus = document.querySelector("#mix-status");
  if (mixTitle)  mixTitle.textContent = "Mix Practice — pick lessons";
  if (mixStatus) mixStatus.textContent =
    `Adding to: “${WLAddCtx.listName}”. Pick lessons, then click “Build Deck”.`;
}



  async function drawWLMixPicker(){
  elWLMixPicker.innerHTML = "Loading lessons…";

  // Build a scoped, lightweight Mix picker inside #wl-mix-picker
  const levels = ["N5","N4","N3"];
  const frag = document.createDocumentFragment();

  for (const lvl of levels){
    const m = await loadLevelManifest(lvl);
    const lessons = (m?.allLessons || []);

    const box = document.createElement("div");
    box.className = "wl-level";
    box.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:.5rem;">
        <strong>${lvl}</strong>
        <span>
          <button type="button" data-level="${lvl}" class="wl-sel-all">All</button>
          <button type="button" data-level="${lvl}" class="wl-clear">Clear</button>
        </span>
      </div>
      <div class="wl-lessons">
        ${
          lessons.length
            ? lessons.map(ls =>
                `<label class="wl-chip">
                   <input type="checkbox" class="wl-lesson-check"
                          data-level="${lvl}" data-lesson="${ls}">
                   ${ls.replace(/-/g," ")}
                 </label>`
              ).join("")
            : `<div class="muted">No lessons — missing or invalid manifest.json</div>`
        }
      </div>`;
    frag.appendChild(box);
  }

  elWLMixPicker.innerHTML = "";
  elWLMixPicker.appendChild(frag);

  // Per-level helpers
  elWLMixPicker.querySelectorAll(".wl-sel-all").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      const lvl = e.currentTarget.dataset.level;
      elWLMixPicker.querySelectorAll(`.wl-lesson-check[data-level="${lvl}"]`).forEach(ch => ch.checked = true);
    });
  });
  elWLMixPicker.querySelectorAll(".wl-clear").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      const lvl = e.currentTarget.dataset.level;
      elWLMixPicker.querySelectorAll(`.wl-lesson-check[data-level="${lvl}"]`).forEach(ch => ch.checked = false);
    });
  });
}
elWLBuildFromMix.onclick = async ()=>{
  const picks = Array.from(
    elWLMixPicker.querySelectorAll('.wl-lesson-check:checked')
  ).map(cb => ({ level: cb.dataset.level, lesson: cb.dataset.lesson }));

  if (!picks.length){ toast("Pick at least one deck."); return; }

  const words = [];
  for (const p of picks){
    const batch = await loadDeckFor(p.level, p.lesson);
    batch.forEach(r => words.push({ kanji:r.kanji||"—", hira:r.hira||"", en:r.en||"" }));
  }

  // ✅ Use WLAddCtx instead of __WL_CTX
  window.WLAddCtx = window.WLAddCtx || { listId:null, listName:null, staged:[] };
  WLAddCtx.staged = words.filter(x=>x.hira && x.en);

  // Switch to confirmation table
  elWLMix.classList.add("hidden");
  renderWLWordTable();
};



  elWLCancelMix?.addEventListener("click", ()=>{
    elWLFlow.classList.add("hidden");
    __WL_CTX = { listId:null, listName:null, stagedDeck:[] };
  });


  window.renderWLWordTable = () => {
  const ctx = window.WLAddCtx || {};
  const listName = ctx.listName || "Untitled";

  let rows = (Array.isArray(ctx.staged) && ctx.staged.length)
    ? ctx.staged
    : (Array.isArray(window.__WL_CTX?.stagedDeck) ? window.__WL_CTX.stagedDeck : []);

  // normalize so future renders always find data in WLAddCtx.staged
  if ((!Array.isArray(ctx.staged) || !ctx.staged.length) && rows.length) {
    window.WLAddCtx = { ...(window.WLAddCtx || {}), staged: rows };
  }

  const t = document.querySelector("#wl-tbody");
  const ttl = document.querySelector("#wl-wordtable-title");
  const cnt = document.querySelector("#wl-wordtable-count");
  if (!t) return;

  if (ttl) ttl.textContent = `Word Table — ${listName}`;
  if (cnt) cnt.textContent = ` (${rows.length} words)`;

  // render all rows
  t.innerHTML = rows.map((w, i) => {
    const id = (String(w.hira||"").trim().toLowerCase()) + "|" + (String(w.en||"").trim().toLowerCase());
    return `
      <tr data-id="${id}">
        <td><input type="checkbox" class="wl-pick" data-idx="${i}" checked /></td>
        <td class="kanji">${w.kanji || "—"}</td>
        <td class="hira">${w.hira || ""}</td>
        <td class="en">${w.en || ""}</td>
      </tr>`;
  }).join("");

  // search/filter
  const q = document.querySelector("#wl-search");
  if (q && !q._wlBound){
    q._wlBound = true;
    q.addEventListener("input", () => {
      const val = (q.value || "").trim().toLowerCase();
      const trs = t.querySelectorAll("tr");
      trs.forEach(tr => {
        const hira = tr.querySelector(".hira")?.textContent.toLowerCase() || "";
        const en   = tr.querySelector(".en")?.textContent.toLowerCase() || "";
        tr.style.display = (!val || hira.includes(val) || en.includes(val)) ? "" : "none";
      });
    });
  }

  // select all
  const selAll = document.querySelector("#wl-select-all");
  if (selAll && !selAll._wlBound){
    selAll._wlBound = true;
    selAll.addEventListener("click", () => {
      const checks = t.querySelectorAll(".wl-pick");
      const allOn = Array.from(checks).every(ch => ch.checked);
      checks.forEach(ch => ch.checked = !allOn);
    });
  }

  // save selected → Firestore
  const saveBtn = document.querySelector("#wl-save");
  const status = document.querySelector("#wl-status");
  if (saveBtn && !saveBtn._wlBound){
    saveBtn._wlBound = true;
    saveBtn.addEventListener("click", async () => {
      const picks = [];
      t.querySelectorAll(".wl-pick:checked").forEach(ch => {
        const w = rows[Number(ch.dataset.idx)];
        if (w && w.hira && w.en) picks.push(w);
      });
      if (!picks.length){
        if (status) status.textContent = "Pick at least one word.";
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        const n = await window.FB.lists.addWordsToList(ctx.listId, picks);
        if (status) status.textContent = `Saved ${n} word(s) to “${listName}”.`;
        // Optional: fetch fresh words and go back to the list detail so user can start Learn/MCQ/Write/Make
        if (typeof openWordListDetail === "function"){
          openWordListDetail(ctx.listId);
        }
      } catch (e){
        console.error(e);
        if (status) status.textContent = "Save failed. Check console.";
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Add selected to list";
      }
    });
  }
};


  // Optional manage modal for “Unselect individually”
  async function openWLManage(listId, listName){
    const fb = await whenFBReady();
    const rows = await fb.lists.listWords(listId);
    // You can reuse the same table but with a “Remove” button per row:
    // Keep it simple: confirm() then fb.lists.removeWordFromList(listId, row.id)
    alert("Open a small manager to remove words one by one (implementation same as table above).");
  }
  async function fetchAllMarkedForPicker(){
      let remote = [], local = [], signed = [];
      try { const fb = await whenFBReady(); remote = await fb.listMarked(); } catch {}
      try { local = getLocalMarked(); } catch {}
      try { const fb = await whenFBReady(); signed = await fb.signWordList(); } catch {}

      return [
        ...remote.map(r => ({ id:r.id, front:r.front || r.hira, back:r.back || r.en, src:"remote" })),
        ...local .map(r => ({ id:r.id, front:r.front || r.hira, back:r.back || r.en, src:"local"  })),
        ...signed.map(r => ({
          id:`sign::${r.id}`, front:r.front, back:r.back, src:"sign",
          markedId:`${r.front}::${r.back}`
        }))
      ];
    }

    async function openUnmarkModal(){
  const modal = document.querySelector("#unmark-modal");
  const list  = document.querySelector("#unmark-list");
  if (!modal || !list) return;

  list.innerHTML = "<div class='muted'>Loading…</div>";
  const rows = await buildPickerRowsMerged();

  if (!rows.length){
    list.innerHTML = "<div class='muted'>No marked words.</div>";
  } else {
    list.innerHTML = rows.map(r => `
      <label>
        <input type="checkbox" class="unmark-check"
               data-key="${escapeHTML(r.key)}"
               data-sign-id="${escapeHTML(r.signId || "")}"
               data-has-remote="${r.hasRemote ? "1":"0"}"
               data-has-local="${r.hasLocal ? "1":"0"}"
               data-local-id="${escapeHTML(r.localId || "")}">
        <b>${escapeHTML(r.front)}</b> — <span class="muted">${escapeHTML(r.back || "")}</span>
        ${r.signId ? "<span class='badge'>signed</span>" : ""} 
        ${r.hasRemote ? "<span class='badge'>cloud</span>" : ""} 
        ${r.hasLocal ? "<span class='badge'>local</span>" : ""}
      </label>
    `).join("");
  }

  document.querySelector("#unmark-select-all")?.addEventListener("click", ()=>{
    document.querySelectorAll(".unmark-check").forEach(ch => ch.checked = true);
  }, { once:true });

  document.querySelector("#unmark-clear")?.addEventListener("click", ()=>{
    document.querySelectorAll(".unmark-check").forEach(ch => ch.checked = false);
  }, { once:true });

  // ✅ Use the same cascade remover as the main list
  document.querySelector("#unmark-remove")?.addEventListener("click", async ()=>{
    const picks = Array.from(document.querySelectorAll(".unmark-check:checked"));
    if (!picks.length){ toast("Nothing selected."); return; }

    for (const cb of picks){
      const key       = cb.dataset.key;
      const signId    = cb.dataset.signId || null;
      const hasRemote = cb.dataset.hasRemote === "1";
      const hasLocal  = cb.dataset.hasLocal  === "1";
      const localId   = cb.dataset.localId || null;
      try { await cascadeRemoveByKey({ key, signId, hasRemote, hasLocal, localId }); } catch {}
    }

    toast("Removed selected words ✓");
    closeUnmarkModal();
    await renderMarkedList();
    // If nothing remains, leave the Vocab deck and hide the action row
    try {
      const left = (await buildPickerRowsMerged()).length;
      if (left === 0) {
        removeListActions();
        hideContentPanes();
        document.querySelector("#marked-section")?.classList.remove("hidden");
        updateBackVisibility();
      }
    } catch {}
  }, { once:true });

  document.querySelector("#unmark-close")?.addEventListener("click", closeUnmarkModal, { once:true });
  modal.querySelector(".lightbox-backdrop")?.addEventListener("click", closeUnmarkModal, { once:true });

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}


    function closeUnmarkModal(){
      const modal = document.querySelector("#unmark-modal");
      if (!modal) return;
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      // clean handlers so we don’t double-bind next time
      const fresh = modal.cloneNode(true);
      modal.replaceWith(fresh);
    }
    window.openUnmarkModal = openUnmarkModal;



  async function getMarkedAsDeck(){
  // Remote (if signed in)
  let remote = [];
  try {
    const fb = await whenFBReady();
    remote = await fb.listMarked();
  } catch {}

  // Local (offline)
  const local = getLocalMarked(); // [{id, kanji?, hira/front, en/back}]

  // Signed Words (treat like marked)
  let signed = [];
  try {
    const fb = await whenFBReady();
    signed = await fb.signWordList(); // {id, front, back, romaji?}
  } catch {}

  // Map all to {kanji,hira,en}
  const combined = [
    ...remote.map(r => ({ kanji: r.kanji || "—", hira: r.hira || r.front || "", en: r.en || r.back || "" })),
    ...local .map(r => ({ kanji: r.kanji || "—", hira: r.hira || r.front || "", en: r.en || r.back || "" })),
    ...signed.map(r => ({ kanji: r.kanji || "—", hira: r.front || "", en: r.back || "" })),
  ].filter(x => x.hira && x.en);

  // De-dupe
  const seen = new Set();
  const deck = [];
  for (const w of combined){
    const k = keyForWord(w);
    if (!seen.has(k)){ seen.add(k); deck.push(w); }
  }
  return deck;
}

  async function setupListPractice(source, mode){
      // If App.deck is already loaded (enterListMode), prefer that.
      let deck = (App.deck && App.deck.length) ? App.deck.slice() : [];
      if (!deck.length) {
        if (source === "mistake") deck = await fbListMistakesAsDeck();
        else deck = await getMarkedAsDeck();
      }
      if (!deck.length){ toast("No items to practice."); return; }

      App.deck = deck; App.mode = mode; setCrumbs();

      // Hide root/submenus; show finals identical to Vocabulary behavior
      hideVocabMenus();
      elLearn.classList.add("hidden");
      elWrite.classList.add("hidden");
      D("#practice")?.classList.add("hidden");
      elMake.classList.add("hidden");

      if (mode==="learn"){
        App.deckFiltered = deck.slice();
        App.qIndex = 0; App.stats = { right:0, wrong:0, skipped:0 }; updateScorePanel();
        elLearn.classList.remove("hidden");
        renderLearnCard();
      } else if (mode==="write"){
        App.deckFiltered = shuffle(deck);
        App.write.order = App.deckFiltered.map((_,i)=>i);
        App.write.idx = 0; App.stats = { right:0, wrong:0, skipped:0 }; updateScorePanel();
        elWrite.classList.remove("hidden");
        renderWriteCard();
      } else if (mode==="make"){
        App.make.order = shuffle(deck).map((_,i)=>i).slice(0, Math.min(deck.length, 30));
        App.make.idx   = 0; App.stats = { right:0, wrong:0, skipped:0 }; updateScorePanel();
        elMake.classList.remove("hidden");
        renderMakeCard();
      } else {
        // MCQ variants
        App.deckFiltered = shuffle(filterDeckForMode(mode));
        App.qIndex = 0; App.stats = { right:0, wrong:0, skipped:0 }; updateScorePanel();
        D("#practice").classList.remove("hidden");
        updateDeckProgress();
        renderQuestion();
      }
      updateBackVisibility();
    }


  // Mark current word (available across modes)
  // Mark current word (available across modes) — now also accepts an explicit word
  window.markCurrentWord = async (w0) => {
    // Prefer the passed-in word (Word Table), else use the active one (flashcard/write)
    const w =
      w0 ||
      App.deckFiltered[App.qIndex] ||
      (App.write?.order ? App.deck[App.write.order[App.write.idx]] : null) ||
      null;

    if (!w) return;
    const id = (w.kanji && w.kanji !== "—" ? w.kanji : w.hira) + "::" + w.en;
    try {
      const fb = await whenFBReady();
      await fb.markWord(id, { kanji: w.kanji, hira: w.hira, en: w.en, front: w.hira, back: w.en });
      toast("Marked ✓");
    } catch {
      // Signed out or Firebase failed → store locally so Marked Words still works
      addLocalMarked(w);
      toast("Marked locally ✓ (sign in to sync)");
    }
  };

  // window.markCurrentWord = async () => {
  //   const w = App.deckFiltered[App.qIndex] || App.deck[App.write.order[App.write.idx]] || null;
  //   if (!w) return;
  //   const id = (w.kanji && w.kanji!=="—" ? w.kanji : w.hira) + "::" + w.en;
  //   try {
  //     const fb = await whenFBReady();
  //     await fb.markWord(id, { kanji: w.kanji, hira: w.hira, en: w.en, front: w.hira, back: w.en });
  //     toast("Marked ✓");
  //   } catch {
  //       // Signed out or Firebase failed → store locally so Marked Words still works
  //       addLocalMarked(w);
  //       toast("Marked locally ✓ (sign in to sync)");
  //     }
  // };

  // ---------- Grammar ----------
  function wireGrammarTab(){
  document.querySelector("#open-grammar-pdf").onclick = async ()=>{
    const level  = App.level;
    const lesson = App.lesson;
    const ent = getManifestEntry(level, lesson);

    if (ent && ent.grammar){
      const rel = Array.isArray(ent.grammar) ? ent.grammar[0] : ent.grammar;
      const u = `${LEVEL_BASE}/${level}/${lesson}/${rel}`;
      window.open(u, "_blank", "noopener");
    } else {
      toast("PDF not configured in manifest.");
    }
  };
  renderGrammarPracticeFiles?.();
}





  async function renderGrammarPracticeFiles(){
    elPgFiles.innerHTML=""; elPgStatus.textContent="(optional) choose a practice set:";
    try{
      const files = await listCsvFiles(`/practice_grammar/`);
      if (!files.length){ elPgStatus.textContent="No practice sets."; return; }
      elPgStatus.textContent="Choose a set:";
      for (const f of files){
        const b=document.createElement("button"); b.textContent=f.replace(/\.csv$/i,"");
        b.addEventListener("click", ()=> loadGrammarPractice(f));
        elPgFiles.appendChild(b);
      }
    } catch { elPgStatus.textContent="No practice sets found."; }
  }
  async function loadGrammarPractice(filename){
    try{
      const txt = await (await fetch(encodePath(`/practice_grammar/${filename}`), { cache:"no-cache" })).text();
      const csv = parseCSV(txt).filter(r=>r.length>=2);
      App.pg.rows = csv.map(r=>({ q:r[0], a:r[1] })); App.pg.idx=0; elPgArea.classList.remove("hidden"); renderPgItem();
    } catch { toast("Failed to load set"); }
  }
  function renderPgItem(){
    const row = App.pg.rows[App.pg.idx];
    if (!row){ elPgCard.textContent="Done."; return; }
    elPgCard.textContent=row.q; elPgInput.value=""; elPgFeedback.textContent=""; updatePgProgress();
  }
  function updatePgProgress(){
    const cur=Math.min(App.pg.idx, App.pg.rows.length);
    elPgBar.style.width=pct(cur, App.pg.rows.length);
    elPgText.textContent=`${cur} / ${App.pg.rows.length} (${pct(cur, App.pg.rows.length)})`;
  }
  window.pgSubmit = ()=>{
    const row=App.pg.rows[App.pg.idx]; if(!row) return;
    const val=(elPgInput.value||"").trim(); if(!val) return;
    const norm = s => (s||"").replace(/\s+/g,"").toLowerCase();
    if (norm(val)===norm(row.a)){ elPgFeedback.innerHTML=`<span class="ok-inline">✓ Correct</span>`; incrementPoints(1); }
    else { elPgFeedback.innerHTML=`Answer: <b>${escapeHTML(row.a)}</b>`; }
  };
  window.pgShowAnswer = ()=>{ const row=App.pg.rows[App.pg.idx]; if(row) elPgFeedback.innerHTML=`Answer: <b>${escapeHTML(row.a)}</b>`; };
  window.pgNext = ()=>{ App.pg.idx++; renderPgItem(); };

  // ---------- Progress / Leaderboard ----------
  async function renderProgress(){
    try{
      const fb = await whenFBReady();
      // already per-user & sorted; returns last 10
      const rows = await fb.getRecentAttempts({ max: 10 });

      // Top summary
      if (rows.length){
        const last = rows[0];
        const lastDt = last.clientAtMs ? new Date(last.clientAtMs)
                                      : (last.createdAt?.toDate?.() || new Date());
        elProgressLast.textContent =
          `${fmtDate(lastDt)} — ${last.deckId || last.lesson || "deck"} — ${last.mode} — R:${last.right} W:${last.wrong} S:${last.skipped}`;

        const same = rows.find(r => r !== last && (r.deckId || r.lesson) === (last.deckId || last.lesson));
        if (same){
          const sameDt = same.clientAtMs ? new Date(same.clientAtMs)
                                        : (same.createdAt?.toDate?.() || new Date());
          elProgressPrev.textContent =
            `${fmtDate(sameDt)} — R:${same.right|0} W:${same.wrong|0} S:${same.skipped|0}`;
          elProgressDelta.textContent =
            ((last.right|0)-(same.right|0) >= 0)
              ? `+${(last.right|0)-(same.right|0)} right`
              : `${(last.right|0)-(same.right|0)} right`;
        } else {
          elProgressPrev.textContent = "—";
          elProgressDelta.textContent = "—";
        }
      } else {
        elProgressLast.textContent="No attempts yet.";
        elProgressPrev.textContent="—";
        elProgressDelta.textContent="—";
      }

      // Recent Attempts table
      elProgressTable.innerHTML="";
      for (const r of rows){
        const dt = r.clientAtMs ? new Date(r.clientAtMs)
                                : (r.createdAt?.toDate?.() || new Date());
        const tr=document.createElement("tr");
        tr.innerHTML = `
          <td>${fmtDate(dt)}</td>
          <td>${escapeHTML(r.deckId || r.lesson || "-")}</td>
          <td>${escapeHTML(r.mode || "-")}</td>
          <td>${r.right|0}</td><td>${r.wrong|0}</td><td>${r.skipped|0}</td><td>${r.total|0}</td>`;
        elProgressTable.appendChild(tr);
      }

      // Removed: best-per-deck write section
      // if (window.elWriteProgressTable) {
      //   try { document.querySelector("#write-progress-card")?.remove(); } catch {}
      // }
    } catch (e){
      console.error(e);
      elProgressLast.textContent="Failed to load progress.";
    }
  }

  function fmtDate(d){ try{ const dt=d instanceof Date ? d : new Date(d); return dt.toLocaleString(); }catch{ return "-"; } }

  async function renderOverallLeaderboard() {
      const tb = document.querySelector("#leaderboard-table tbody");
      if (!tb) return;
      tb.innerHTML = `<tr><td colspan="3" class="muted">Loading…</td></tr>`;

      try {
        const fb = await whenFBReady();
        const rows = await fb.getOverallLeaderboard({ max: 100 });

        const sorted = (rows || []).slice().sort((a, b) => (b.score | 0) - (a.score | 0));
        tb.innerHTML = "";

        const current = fb?.auth?.currentUser || null;

        sorted.forEach((r, i) => {
          const rank = i + 1;
          const name = r.displayName || "Player";
          const score = r.score | 0;
          const isYou = current && r.uid && r.uid === current.uid;

          const tr = document.createElement("tr");
          tr.className = rank <= 3 ? `rank-${rank}` : "";

          tr.innerHTML = `
            <td class="rank">${rank}</td>
            <td class="player">
              ${
                r.photoURL
                  ? `<img class="avatar" src="${escapeHTML(r.photoURL)}" alt="">`
                  : `<span class="avatar">${escapeHTML((name[0] || "U").toUpperCase())}</span>`
              }
              <span class="name">${escapeHTML(name)}${isYou ? " <span class='you-badge'>you</span>" : ""}</span>
            </td>
            <td class="score">${(score.toLocaleString?.() || score)}</td>
          `;
          tb.appendChild(tr);
        });

        if (!sorted.length) {
          tb.innerHTML = `<tr><td colspan="3" class="muted">No scores yet — be the first!</td></tr>`;
        }
      } catch (e) {
        console.error(e);
        tb.innerHTML = `<tr><td colspan="3" class="error">Failed to load leaderboard.</td></tr>`;
      }
    }


  // ---------- Sign Word ----------
  window.signWordAdd = async ()=>{
    const front=(elSWFront.value||"").trim(); const back=(elSWBack.value||"").trim(); const romaji=(elSWRomaji.value||"").trim();
    if (!front || !back){ toast("Please enter Front and Back."); return; }
    try{
        const fb = await whenFBReady();

        // 1) save in Sign Words
        await fb.signWordAdd({ front, back, romaji: romaji || null });

        // 2) also save in Marked Words (id = "front::back")
        const markedId = `${front}::${back}`;
        await fb.markWord(markedId, {
          // normalize into the shape your Marked deck expects
          kanji: "—",
          hira: front,
          en: back,
          front,
          back,
          romaji: romaji || null
        });

        elSWFront.value=""; elSWBack.value=""; elSWRomaji.value="";
        await renderSignWordList(); 
        toast("Added ✓");
      } catch { 
        toast("Sign in to save."); 
      }

  };
  async function renderSignWordList(){
    elSWList.innerHTML="";
    try{
      const fb = await whenFBReady();
      const rows = await fb.signWordList();
      if (!rows.length){ elSWList.innerHTML = `<div class="muted">No signed words yet.</div>`; return; }
      for (const r of rows){
        const div=document.createElement("div"); div.className="sw-item";
        const rom = r.romaji ? ` <span class="muted">(${escapeHTML(r.romaji)})</span>` : "";
        div.innerHTML = `
          <div><b>${escapeHTML(r.front)}</b>${rom} — <span class="muted">${escapeHTML(r.back || "")}</span></div>
          <button data-id="${r.id}">Remove</button>`;
        div.querySelector("button").addEventListener("click", async()=>{
          try{
            const fb2 = await whenFBReady();
            // remove from Sign Words collection
            await fb2.signWordRemove(r.id);

            // also remove from Marked Words using the deterministic id "front::back"
            if (r.front && r.back) {
              const markedId = `${r.front}::${r.back}`;
              await fb2.unmarkWord(markedId);
            }
            toast("Removed ✓");
          } catch {
            toast("Failed to remove.");
          }

          // refresh lists that might be visible
          await renderSignWordList();
          if (!document.querySelector("#marked-section")?.classList.contains("hidden")) {
            await renderMarkedList();
          }
        });

        elSWList.appendChild(div);
      }
    } catch { elSWList.innerHTML = `<div class="muted">Failed to load your signed words.</div>`; }
  }

  // Open the Mix picker UI
window.openMixPractice = async () => {
  try { await flushSession?.(); } catch {}
  window.closeVideoLightbox?.();   // safe global
  window.hideContentPanes?.();     // safe global
  removeListActions();
  document.querySelector("#mix-section")?.classList.remove("hidden");

  // breadcrumbs / state
  document.querySelector("#crumb-level").textContent  = "Mix";
  document.querySelector("#crumb-lesson").textContent = "—";
  document.querySelector("#crumb-mode").textContent   = "vocab";

  await renderMixPicker?.();       // build the multi-select UI
  window.updateBackVisibility?.(); // safe global
};


// Render checkboxes for N5/N4/N3 using manifests
async function renderMixPicker(){
  const host = document.querySelector("#mix-levels");
  if (!host) return;
  host.innerHTML = "";

  const levels = ["N5","N4","N3"];
  for (const lvl of levels){
    const m = await loadLevelManifest(lvl);
    const lessons = (m?.allLessons || []);
    const box = document.createElement("div");
    box.className = "mix-level";
    box.innerHTML = `
      <div class="mix-level-head">
        <label><input type="checkbox" class="mix-level-check" data-level="${lvl}"> <b>${lvl}</b></label>
        <div class="mix-level-actions">
          <button type="button" data-level="${lvl}" class="mix-sel-all">All</button>
          <button type="button" data-level="${lvl}" class="mix-clear">Clear</button>
        </div>
      </div>
      <div class="mix-lessons">
        ${
          lessons.length
            ? lessons.map(ls=>`<label><input type="checkbox" class="mix-lesson-check" data-level="${lvl}" data-lesson="${ls}"> ${ls.replace(/-/g," ")}</label>`).join("")
            : `<div class="muted">No lessons — missing or invalid manifest.json</div>`
        }
      </div>`;
    host.appendChild(box);
  }

  // Wire per-level actions
  host.querySelectorAll(".mix-level-check").forEach(cb=>{
    cb.addEventListener("change", (e)=>{
      const lvl = e.currentTarget.dataset.level;
      host.querySelectorAll(`.mix-lesson-check[data-level="${lvl}"]`).forEach(ch => ch.checked = e.currentTarget.checked);
    });
  });
  host.querySelectorAll(".mix-sel-all").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      const lvl = e.currentTarget.dataset.level;
      host.querySelectorAll(`.mix-lesson-check[data-level="${lvl}"]`).forEach(ch => ch.checked = true);
      const lc = host.querySelector(`.mix-level-check[data-level="${lvl}"]`);
      if (lc) lc.checked = true;
    });
  });
  host.querySelectorAll(".mix-clear").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      const lvl = e.currentTarget.dataset.level;
      host.querySelectorAll(`.mix-lesson-check[data-level="${lvl}"]`).forEach(ch => ch.checked = false);
      const lc = host.querySelector(`.mix-level-check[data-level="${lvl}"]`);
      if (lc) lc.checked = false;
    });
  });

  const st = document.querySelector("#mix-status");
  if (st) st.textContent = "Select lessons, then click Build Deck.";
}


// Global select/clear helpers (buttons below the picker)
window.mixSelectAll = ()=>{
  document.querySelectorAll(".mix-lesson-check").forEach(ch=> ch.checked = true);
  document.querySelectorAll(".mix-level-check").forEach(ch=> ch.checked = true);
};
window.mixClear = ()=>{
  document.querySelectorAll(".mix-lesson-check,.mix-level-check").forEach(ch=> ch.checked = false);
};

// Build the combined deck and enter the Vocab root menus (no Video/Grammar)
window.mixBuildDeck = async () => {
  const st = document.querySelector("#mix-status");

  try {
    // 1) Collect selected lessons
    const picks = Array.from(document.querySelectorAll(".mix-lesson-check:checked"))
      .map(ch => ({ level: ch.dataset.level, lesson: ch.dataset.lesson }));

    if (!picks.length) {
      if (st) st.textContent = "Pick at least one lesson.";
      toast?.("Pick at least one lesson.");
      return;
    }

    // 2) Load words from each lesson (parallel)
    const batches = await Promise.all(
      picks.map(p => loadDeckFor(p.level, p.lesson).catch(() => []))
    );

    // Flatten + guard
    const combined = batches.flat().filter(Boolean);

    // 3) De-duplicate by canonical key
    const seen = new Set();
    const deck = [];
    for (const w of combined) {
      const k = keyForWord(w);
      if (!seen.has(k)) {
        seen.add(k);
        deck.push(w);
      }
    }

    // Empty guard
    if (!deck.length) {
      if (st) st.textContent = "No vocabulary found in those lessons (check manifest or CSV files).";
      toast?.("No words found. Verify manifest.json and CSV filenames/columns.");
      return;
    }

    // 4) Word List intercept — send deck to Word Table when WLAddCtx.active
    if (window.WLAddCtx?.active) {
      // Normalize to the table row shape
      const stagedRows = deck
        .map(r => ({ kanji: r.kanji || "—", hira: r.hira || "", en: r.en || "" }))
        .filter(w => w.hira && w.en);

      // Keep a single source of truth in WLAddCtx
      window.WLAddCtx = {
        ...(window.WLAddCtx || {}),
        staged: stagedRows
      };

      // (Optional) keep __WL_CTX in sync for any legacy readers
      window.__WL_CTX = {
        listId:   WLAddCtx.listId ?? null,
        listName: WLAddCtx.listName ?? null,
        stagedDeck: stagedRows
      };

      // Return to Word List and show the prefilled Word Table
      openSection("wordlist");
      document.querySelector("#wordlist-section")?.classList.remove("hidden");
      document.querySelector("#wl-flow")?.classList.remove("hidden");
      document.querySelector("#wl-mix")?.classList.add("hidden");
      document.querySelector("#wl-wordtable")?.classList.remove("hidden");

      if (typeof renderWLWordTable === "function") renderWLWordTable();

      WLAddCtx.active = false; // reset so next time normal Mix works
      updateBackVisibility?.();
      return; // stop normal Mix flow here
    }

    // 5) Normal Mix flow (unchanged)
    App.mix = { active: true, selection: picks, deck };
    App.level = "Mix";
    App.lesson = `${picks.length} lesson(s)`;
    App.tab = "vocab"; App.mode = null; App.qIndex = 0;

    const setTxt = (sel, txt) => { const el = document.querySelector(sel); if (el) el.textContent = txt; };
    setTxt("#crumb-level",  App.level);
    setTxt("#crumb-lesson", App.lesson);
    setTxt("#crumb-mode",   "vocab");

    document.querySelector("#mix-section")?.classList.add("hidden");
    document.querySelector("#level-shell")?.classList.remove("hidden");
    document.querySelector("#lesson-area")?.classList.remove("hidden");
    hideLessonsHeaderAndList?.();
    hideLessonBar?.();

    ["#tab-videos", "#tab-grammar"].forEach(s => document.querySelector(s)?.classList.add("hidden"));
    document.querySelector("#tab-vocab")?.classList.remove("hidden");

    showVocabRootMenu?.();
    showVocabRootCard?.();

    const vs = document.querySelector("#vocab-status");
    if (vs) {
      vs.textContent = `Built ${deck.length} words from ${picks.length} lesson(s). Pick an option. `;
      const edit = document.createElement("button");
      edit.style.marginLeft = "6px";
      edit.textContent = "Edit selection";
      edit.addEventListener("click", () => {
        App.mix.active = false;
        document.querySelector("#tab-vocab")?.classList.add("hidden");
        document.querySelector("#mix-section")?.classList.remove("hidden");
        hideLessonBar?.();
        updateBackVisibility?.();
      });
      vs.appendChild(edit);
    }

    updateBackVisibility?.();
  } catch (err) {
    console.error("mixBuildDeck error:", err);
    if (st) st.textContent = "Failed to build deck. See console for details.";
    toast?.("Failed to build deck. Please check console and CSV/manifest.");
  }
};


  // ---------- Save / Flush ----------
  window.saveCurrentScore = async ()=>{
    try{ const ok = await flushSession(); toast(ok ? "Progress saved ✓" : "Nothing to save."); }
    catch{ toast("Save failed."); }
  };
  async function flushSession(){
  const totalAttempted = (App.stats.right|0) + (App.stats.wrong|0) + (App.stats.skipped|0);
  if (!App.mode || !totalAttempted) return false;

  // prevent duplicate writes when nothing changed
  const sig = attemptSig();
  if (App.buffer.lastSavedSig === sig) return false;

  const deckTotal = App.mode.startsWith("write")
    ? (App.write.order?.length || App.deckFiltered.length || App.deck.length || 0)
    : (App.deckFiltered.length || App.deck.length || 0);

  const attempt = {
    level: App.level || null,
    lesson: App.lesson || null,
    deckId: currentDeckId(),
    mode: App.mode,
    right: App.stats.right|0,
    wrong: App.stats.wrong|0,
    skipped: App.stats.skipped|0,
    total: deckTotal|0,
  };

  try {
    const fb = await whenFBReady();
    await fb.commitSession({ attempts: [attempt], points: App.buffer.points|0 });
    App.buffer.points = 0;
    App.buffer.lastSavedSig = sig;       // <-- remember what we saved
    App.stats = { right:0, wrong:0, skipped:0 }; // reset counters
    updateScorePanel();
    return true;
  } catch (e){
    console.error("[flushSession] commit failed", e);
    return false;
  }
}


  // quick inputs
  // quick inputs — WRITE: Enter=Submit, Ctrl+Enter=Next, Esc=Skip
elWriteInput?.addEventListener("keydown", (e) => {
  // Ctrl + Enter → Next
  if (e.key === "Enter" && e.ctrlKey) {
    e.preventDefault();
    window.writeNext();
    return;
  }
  // Enter → Submit
  if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    window.writeSubmit();
    return;
  }
  // Esc → Skip
  if (e.key === "Escape") {
    e.preventDefault();
    window.writeSkip();
  }
});
// Global shortcuts for WRITE (active only when #write is visible):
// Ctrl+M = Mark, Ctrl+D = Show Details
window.addEventListener("keydown", (e) => {
  // Only when Write mode is on screen
  if (!isVisible("#write")) return;

  // Guard: require Ctrl, and ignore Alt/Meta to avoid surprises
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    const k = (e.key || "").toLowerCase();

    // Ctrl + m → Mark current word
    if (k === "m") {
      e.preventDefault();           // avoid browser defaults
      markCurrentWord();
      return;
    }

    // Ctrl + d → Show Details
    if (k === "d") {
      e.preventDefault();           // avoid bookmark shortcut in some browsers
      window.writeShowDetails();
      return;
    }
  }
});

  elPgInput?.addEventListener("keydown", (e)=>{ if(e.key==="Enter"){ e.preventDefault(); window.pgSubmit(); } });

  // Close lightbox when switching away
  window.addEventListener("hashchange", closeVideoLightbox);
  window.addEventListener("beforeunload", ()=>{ try{}catch{} });

})();





