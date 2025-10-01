/* =========================================================
   Learn Japanese — App Script (no-manifest, folder scan)
   - Scans /level/{N5|N4|N3}/Lesson-XX/
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

  // Toast
  const elToast = D("#toast");

// ---------- State (safe bootstrap) ----------
const App = Object.assign(window.App, {
  level: null, lesson: null, tab: "videos", mode: null,
  learnVariant: null,
  deck: [], deckFiltered: [], qIndex: 0,
  stats: { right: 0, wrong: 0, skipped: 0 },
  write: { order: [], idx: 0, variant: "en2h" },
  make: { order: [], idx: 0 },
  pg:   { rows: [], idx: 0 },
  buffer: { points: 0 },
  cache: { lessons: new Map(), vocab: new Map(), vocabCsvFiles: new Map() }
});
// keep a stable global reference
window.App = App;



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
  function currentDeckId(){ return (App.level && App.lesson) ? `${App.level}/${App.lesson}` : (App.lesson || App.level || "-"); }
  // encode segments but preserve slashes
  function encodePath(p){
  return p.split('/').map(s => s === '' ? '' : encodeURIComponent(s)).join('/')
          .replace(/%3A/g, ':');
}
// Build many possible filename variants for the vocab CSV
  function buildVocabCandidates(level, lesson){
    const num2 = (lesson.split("-")[1] || "").padStart(2, "0"); // "01"
    const num  = String(Number(num2));                           // "1"
    const dir  = `/level/${level}/${lesson}/Vocabulary/`;

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
      `vocabulary.csv`, `Vocabulary.csv`, `vocab.csv`, `Vocab.csv`,
      `words.csv`, `Words.csv`
    ];

    // Try inside Vocabulary/ first, then also at lesson root (some repos put CSV there)
    const inFolder = names.map(n => dir + n);
    const atRoot   = names.map(n => `/level/${level}/${lesson}/` + n);
    return [...inFolder, ...atRoot];
  }

  // Try all candidates until one exists
  async function findVocabCsv(level, lesson){
    const urls = buildVocabCandidates(level, lesson);
    return await firstOk(urls); // returns the first existing URL or null
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


  // Global Back button logic
  document.querySelector("#back-btn")?.addEventListener("click", () => {
      // --- Nested Vocab back paths ---
  const inVocabTab = !document.querySelector("#tab-vocab")?.classList.contains("hidden");
  if (inVocabTab) {
    const learnOpen = !document.querySelector("#learn")?.classList.contains("hidden");
    const practiceOpen = !document.querySelector("#practice")?.classList.contains("hidden");
    const writeOpen = !document.querySelector("#write")?.classList.contains("hidden");
    const makeOpen = !document.querySelector("#make")?.classList.contains("hidden");
    const learnMenu = !document.querySelector("#vocab-learn-menu")?.classList.contains("hidden");
    const mcqMenu   = !document.querySelector("#vocab-mcq-menu")?.classList.contains("hidden");
    const writeMenu = !document.querySelector("#vocab-write-menu")?.classList.contains("hidden");

    // Final → submenu
    if (learnOpen)      { openVocabLearnMenu(); updateBackVisibility(); return; }
    if (practiceOpen)   { openVocabMCQMenu();   updateBackVisibility(); return; }
    if (writeOpen)      { openVocabWriteMenu(); updateBackVisibility(); return; }
    if (makeOpen)       { showVocabRootMenu();  updateBackVisibility(); return; }

    // Submenu → Vocab root
    if (learnMenu || mcqMenu || writeMenu) {
      showVocabRootMenu(); updateBackVisibility(); return;
    }
  }
  // If video enlarged view open → close it and go back to videos tab
  if (window.__videoLightboxOpen) {
    closeVideoLightbox();
    document.querySelector("#level-shell")?.classList.remove("hidden");
    document.querySelector("#lesson-area")?.classList.remove("hidden");
    openLessonTab("videos");
    updateBackVisibility();
    return;
  }

  // If we're in lesson tabs → go back to lesson list
  const area = document.querySelector("#lesson-area");
  if (area && !area.classList.contains("hidden")) {
    area.classList.add("hidden");
    document.querySelector("#level-shell")?.classList.remove("hidden");
    updateBackVisibility();
    return;
  }
  // If in any other section → back to lesson list
  hideContentPanes();
  document.querySelector("#level-shell")?.classList.remove("hidden");
  updateBackVisibility();
});

  // ---------- Auth ----------
  elAuthBtn.addEventListener("click", async () => {
    try { const fb = await whenFBReady(); await fb.auth.signInWithGoogle(); }
    catch (e) { console.error(e); elAuthErr.style.display="block"; elAuthErr.textContent = e.message || "Sign-in failed."; }
  });
  elSignOut.addEventListener("click", async () => {
    try { await flushSession(); } catch {}
    const fb = await whenFBReady(); await fb.auth.signOut();
  });
  whenFBReady().then(fb=>{
    fb.auth.onChange(user=>{
      if(user){ elAuthGate.style.display="none"; elApp.classList.remove("hidden"); navigateLevel("N5"); }
      else { elApp.classList.add("hidden"); elAuthGate.style.display=""; }
    });
  }).catch(()=>{ elAuthGate.style.display=""; });

  // ---------- Routing & view cleanup ----------
  // Hide every main pane (level list, lesson tabs, sections). Used before opening video full view.
  function hideContentPanes(){
  // Hide EVERYTHING in the right content area
  document.querySelector("#level-shell")?.classList.add("hidden");
  document.querySelector("#lesson-area")?.classList.add("hidden");
  document.querySelector("#progress-section")?.classList.add("hidden");
  document.querySelector("#leaderboard-section")?.classList.add("hidden");
  document.querySelector("#mistakes-section")?.classList.add("hidden");
  document.querySelector("#marked-section")?.classList.add("hidden");
  document.querySelector("#signword-section")?.classList.add("hidden");

  clearVideosPane();
  clearVocabPane();
  clearGrammarPane();
  }

  function hideVocabMenus(){
    document.querySelector("#vocab-mode-select")?.classList.add("hidden");
    document.querySelector("#vocab-learn-menu")?.classList.add("hidden");
    document.querySelector("#vocab-mcq-menu")?.classList.add("hidden");
    document.querySelector("#vocab-write-menu")?.classList.add("hidden");
  }

  // Show/hide the global Back button depending on what's visible
  function updateBackVisibility(){
  const elBack = document.querySelector("#back-btn");
  const onLessonList = !document.querySelector("#level-shell")?.classList.contains("hidden")
                    &&  document.querySelector("#lesson-area")?.classList.contains("hidden")
                    &&  ["#progress-section","#leaderboard-section","#mistakes-section","#marked-section","#signword-section"]
                          .every(sel => document.querySelector(sel)?.classList.contains("hidden"));
  if (elBack) elBack.classList.toggle("hidden", onLessonList && !window.__videoLightboxOpen);
}

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
  if (practice) practice.classList.add("hidden");
  if (learn) learn.classList.add("hidden");
  if (write) write.classList.add("hidden");
  if (make) make.classList.add("hidden");
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
  function hideAllSections(){
    [elLevelShell, elProgressSection, elLeaderboardSection, elMistakesSection, elMarkedSection, elSignWordSection]
      .forEach(x=>x.classList.add("hidden"));
  }

 window.navigateLevel = async (level) => {
  try { await flushSession?.(); } catch {}

  // make sure we’re writing to the same object used everywhere
  if (!window.App) window.App = {};
  const App = window.App;

  App.level = level; App.lesson = null; App.tab = "videos"; App.mode = null;
  App.stats = { right: 0, wrong: 0, skipped: 0 };

  document.querySelector("#crumb-level").textContent  = level || "—";
  document.querySelector("#crumb-lesson").textContent = "—";
  document.querySelector("#crumb-mode").textContent   = "—";

  // clean right side completely
  ["#tab-videos","#tab-vocab","#tab-grammar"].forEach(sel => document.querySelector(sel)?.classList.add("hidden"));
  closeVideoLightbox?.();
  hideContentPanes();

  // show lesson list and load
  document.querySelector("#level-shell")?.classList.remove("hidden");
  const st = document.querySelector("#lesson-status");
  if (st) st.textContent = "Scanning lessons…";
  await showLessonList(level);

  updateBackVisibility();
};



window.openSection = async (name) => {
  try { await flushSession?.(); } catch {}
  closeVideoLightbox?.();
  hideContentPanes();

  const map = {
    progress: "#progress-section",
    leaderboard: "#leaderboard-section",
    mistakes: "#mistakes-section",
    marked: "#marked-section",
    signword: "#signword-section",
  };
  const sel = map[name];
  if (sel) document.querySelector(sel)?.classList.remove("hidden");

  if (name === "progress") await renderProgress();
  if (name === "leaderboard") await renderOverallLeaderboard();
  if (name === "mistakes") renderMistakesLanding();
  if (name === "marked") await renderMarkedList();
  if (name === "signword") await renderSignWordList();

  updateBackVisibility();
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
  // REPLACE discoverLessons with this version
// FULL REPLACEMENT
// Only check canonical vocab filenames to decide if a lesson exists
async function discoverLessons(level){
  const found = [];
  let misses = 0;
  for (let i = 1; i <= 60; i++){
    const L = `Lesson-${String(i).padStart(2, "0")}`;
    const okUrl = await findVocabCsv(level, L);
    if (okUrl){ found.push(L); misses = 0; }
    else { if (++misses >= 3) break; } // early stop on empty tail
  }
  return found;
}


  // ---------- Open lesson & tabs ----------
async function openLesson(level, lesson){
  try { await flushSession?.(); } catch {}

  // Clean right side
  ["#tab-videos","#tab-vocab","#tab-grammar"].forEach(sel=>document.querySelector(sel)?.classList.add("hidden"));
  clearVideosPane(); clearVocabPane(); clearGrammarPane(); closeVideoLightbox?.();
  hideContentPanes(); // keep navbar visible

  // Set state + show lesson tabs area
  App.level = level;
  App.lesson = lesson;
  document.querySelector("#crumb-level").textContent = level || "—";
  document.querySelector("#crumb-lesson").textContent = lesson || "—";
  document.querySelector("#crumb-mode").textContent = "—";

  document.querySelector("#level-shell")?.classList.remove("hidden");
  const area = document.querySelector("#lesson-area");
  area?.classList.remove("hidden");

  document.querySelector("#lesson-title").textContent = `${lesson.replace(/-/g," ")} — ${level}`;
  document.querySelector("#lesson-availability").textContent = "Loading…";

  const hasVocabUrl = await findVocabCsv(level, lesson);

  await openLessonTab(hasVocabUrl ? "vocab" : "videos");
  document.querySelector("#lesson-availability").textContent = hasVocabUrl ? "Vocab: Yes" : "Vocab: No";

  updateBackVisibility();
}

window.openLessonTab = async (tab)=>{
  document.querySelector("#level-shell")?.classList.remove("hidden");
  document.querySelector("#lesson-area")?.classList.remove("hidden");

  try { await flushSession?.(); } catch {}
  App.tab = tab;
  document.querySelector("#crumb-mode").textContent = tab;

  // Clear all right-side panes
  ["#tab-videos","#tab-vocab","#tab-grammar"].forEach(sel=>document.querySelector(sel)?.classList.add("hidden"));
  clearVideosPane(); clearVocabPane(); clearGrammarPane(); closeVideoLightbox?.();

  if (tab === "videos") {
    document.querySelector("#tab-videos")?.classList.remove("hidden");
    await renderVideos();
  } else if (tab === "vocab") {
    document.querySelector("#tab-vocab")?.classList.remove("hidden");
    await ensureDeckLoaded();
    const has = (App.deck?.length || 0) > 0;
    document.querySelector("#vocab-status").textContent = has ? "Pick an option." : "No vocabulary found.";
    showVocabRootMenu();
  } else if (tab === "grammar") {
    document.querySelector("#tab-grammar")?.classList.remove("hidden");
    wireGrammarTab();
  }
  updateBackVisibility();
};

  // ---------- Video Module (no extra file buttons) ----------
async function loadAllVideoRows(level, lesson){
  const base = `/level/${level}/${lesson}/Video Lecture/`;
  const file = await firstOk([ base + "Lesson.csv", base + "lesson.csv" ]);
  if (!file) return [];
  const rows = [];
  try {
    const txt = await (await fetch(encodePath(file), { cache:"no-cache" })).text();
    const csv = parseCSV(txt);
    for (const r of csv) if (r[0] && r[1]) rows.push({ title: r[0], url: r[1] });
  } catch {}
  return rows;
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



  async function ensureDeckLoaded(){
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
    document.querySelector("#vocab-mode-select")?.classList.remove("hidden");
    document.querySelector("#vocab-learn-menu")?.classList.add("hidden");
    document.querySelector("#vocab-mcq-menu")?.classList.add("hidden");
    document.querySelector("#vocab-write-menu")?.classList.add("hidden");
    // hide finals
    document.querySelector("#learn")?.classList.add("hidden");
    document.querySelector("#practice")?.classList.add("hidden");
    document.querySelector("#write")?.classList.add("hidden");
    document.querySelector("#make")?.classList.add("hidden");
  }

  window.openVocabLearnMenu = ()=>{
    document.querySelector("#vocab-mode-select")?.classList.add("hidden");
    document.querySelector("#vocab-learn-menu")?.classList.remove("hidden");
    document.querySelector("#vocab-mcq-menu")?.classList.add("hidden");
    document.querySelector("#vocab-write-menu")?.classList.add("hidden");
    document.querySelector("#learn")?.classList.add("hidden");
    document.querySelector("#practice")?.classList.add("hidden");
    document.querySelector("#write")?.classList.add("hidden");
    document.querySelector("#make")?.classList.add("hidden");
    updateBackVisibility();

  };

  window.openVocabMCQMenu = ()=>{
    document.querySelector("#vocab-mode-select")?.classList.add("hidden");
    document.querySelector("#vocab-learn-menu")?.classList.add("hidden");
    document.querySelector("#vocab-mcq-menu")?.classList.remove("hidden");
    document.querySelector("#vocab-write-menu")?.classList.add("hidden");
    document.querySelector("#learn")?.classList.add("hidden");
    document.querySelector("#practice")?.classList.add("hidden");
    document.querySelector("#write")?.classList.add("hidden");
    document.querySelector("#make")?.classList.add("hidden");
    updateBackVisibility();

  };

  window.openVocabWriteMenu = ()=>{
    document.querySelector("#vocab-mode-select")?.classList.add("hidden");
    document.querySelector("#vocab-learn-menu")?.classList.add("hidden");
    document.querySelector("#vocab-mcq-menu")?.classList.add("hidden");
    document.querySelector("#vocab-write-menu")?.classList.remove("hidden");
    document.querySelector("#learn")?.classList.add("hidden");
    document.querySelector("#practice")?.classList.add("hidden");
    document.querySelector("#write")?.classList.add("hidden");
    document.querySelector("#make")?.classList.add("hidden");
    updateBackVisibility();

  };

  function filterDeckForMode(mode){
    const hasKanji = (w) => w.kanji && w.kanji !== "—";
    switch (mode){
      case "kanji-hira":
      case "hira-kanji":
      case "k2h-e":
      case "he2k":
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
    App.deckFiltered = App.deck.slice(); // sequential
    App.qIndex = 0; App.stats = { right: 0, wrong: 0, skipped: 0 }; updateScorePanel();

    // STRICT LINEAR: hide all menus and all other finals, then show only Learn
    hideVocabMenus();
    D("#practice")?.classList.add("hidden");
    elWrite.classList.add("hidden");
    elMake.classList.add("hidden");

    elLearn.classList.remove("hidden");
    renderLearnCard();
    updateBackVisibility();

  };
  function renderLearnCard(){
    const w = App.deckFiltered[App.qIndex];
    if (!w){ elLearnBox.textContent = "No words."; return; }
    const isK2H = App.learnVariant !== "h2e";
    const head  = isK2H ? "Kanji → Hiragana (Learn)" : "Hiragana → English (Learn)";
    const big   = isK2H ? (w.kanji && w.kanji!=="—" ? w.kanji : w.hira) : w.hira;
    const sub   = isK2H ? w.hira : w.en;

    elLearnBox.innerHTML = `
      <div class="flashcard">
        <div class="muted" style="font-size:1.1em;">${escapeHTML(head)}</div>
        <div style="margin:8px 0;font-size:2em;">${escapeHTML(big)}</div>
        <div class="muted" style="margin-top:6px;">${escapeHTML(sub)}</div>
        <div style="margin-top:10px; display:flex; gap:8px; justify-content:center;">
          <button id="btn-audio" title="Play audio">🔊</button>
          <button id="btn-mark" title="Mark word">📌 Mark</button>
          <button id="btn-prev">Previous</button>
          <button id="btn-next">Next</button>
        </div>
      </div>`;

    D("#btn-audio").addEventListener("click", ()=>speakJa(w.hira), { passive:true });
    D("#btn-mark").addEventListener("click", markCurrentWord);
    D("#btn-prev").addEventListener("click", ()=>{ if (App.qIndex>0) { App.qIndex--; renderLearnCard(); } });
    D("#btn-next").addEventListener("click", ()=>{ if (App.qIndex<App.deckFiltered.length-1) { App.qIndex++; renderLearnCard(); } });
  }

  // --- MCQ Modes ---
  window.startPractice = async (mode)=>{
    await ensureDeckLoaded(); try{ await flushSession(); }catch{}
    App.mode = mode; setCrumbs();
    App.deckFiltered = shuffle(filterDeckForMode(mode)); // randomized
    App.qIndex = 0; App.stats = { right: 0, wrong: 0, skipped: 0 }; updateScorePanel();

    // STRICT LINEAR
    hideVocabMenus();
    elLearn.classList.add("hidden");
    elWrite.classList.add("hidden");
    elMake.classList.add("hidden");

    D("#practice").classList.remove("hidden");
    elQuestionBox.textContent=""; elOptions.innerHTML=""; elExtraInfo.textContent="";
    updateDeckProgress(); renderQuestion();
    updateBackVisibility();

  };
  function updateDeckProgress(){
    const cur = Math.min(App.qIndex, App.deckFiltered.length);
    elDeckBar.style.width = pct(cur, App.deckFiltered.length);
    elDeckText.textContent = `${cur} / ${App.deckFiltered.length} (${pct(cur, App.deckFiltered.length)})`;
  }
  function renderQuestion(){
    const w = App.deckFiltered[App.qIndex];
    if (!w){ elQuestionBox.textContent = "All done."; elOptions.innerHTML=""; return; }
    const mode = App.mode; let prompt="", correct="", poolField="";
    if (mode==="jp-en"){ prompt=w.hira; correct=w.en;   poolField="en"; }
    else if (mode==="en-jp"){ prompt=w.en;   correct=w.hira; poolField="hira"; }
    else if (mode==="kanji-hira"){ prompt=w.kanji; correct=w.hira; poolField="hira"; }
    else if (mode==="hira-kanji"){ prompt=w.hira; correct=w.kanji; poolField="kanji"; }
    else if (mode==="k2h-e" || mode==="he2k"){ renderDualQuestion(w); return; }
    else { prompt=w.hira; correct=w.en; poolField="en"; }

    elQuestionBox.textContent = prompt;
    const opts = buildOptions(correct, poolField);
    elOptions.innerHTML="";
    for (const opt of opts){
      const li=document.createElement("li");
      const btn=document.createElement("button");
      btn.textContent = opt;
      btn.addEventListener("click", ()=> onPickOption(btn, opt===correct));
      li.appendChild(btn); elOptions.appendChild(li);
    }
  }
  function onPickOption(btn, ok){
    A("#options button").forEach(b=>b.disabled=true);
    if(ok){ btn.classList.add("is-correct"); App.stats.right++; incrementPoints(1); }
    else { btn.classList.add("is-wrong"); App.stats.wrong++; recordMistake(App.deckFiltered[App.qIndex]); }
    updateScorePanel();
    setTimeout(()=>{ App.qIndex++; updateDeckProgress(); renderQuestion(); }, 450);
  }
  function buildOptions(correct, field, n=4){
    const vals = App.deckFiltered.map(w=>w[field]).filter(v=>v && v!==correct);
    const picks = shuffle(vals).slice(0, n-1); picks.push(correct); return shuffle(picks);
  }
  window.skipQuestion = ()=>{ App.stats.skipped++; updateScorePanel(); App.qIndex++; updateDeckProgress(); renderQuestion(); };
  window.showRomaji = ()=> toast("Romaji: (not available)");
  window.showMeaning = ()=>{ const w=App.deckFiltered[App.qIndex]; if(w) toast(`Meaning: ${w.en}`); };

  // Dual (8 options total; two selections)
  function renderDualQuestion(w){
    elOptions.innerHTML="";
    const mode = App.mode;
    const grid = document.createElement("div"); grid.className="dual-grid";
    const leftCol = document.createElement("div"); const rightCol=document.createElement("div");
    grid.appendChild(leftCol); grid.appendChild(rightCol); elOptions.appendChild(grid);

    let prompt="", correctLeft="", correctRight="";
    if (mode==="k2h-e"){ prompt = w.kanji; correctLeft = w.hira; correctRight = w.en; }
    else { prompt = `${w.hira} · ${w.en}`; correctLeft = w.kanji; correctRight = w.en; }
    elQuestionBox.textContent = prompt;

    const pickSetLeft  = buildOptions(correctLeft,  mode==="k2h-e" ? "hira" : "kanji");
    const pickSetRight = buildOptions(correctRight, "en");

    let pickedLeft=null, pickedRight=null;
    function finalize(){
      if (pickedLeft==null || pickedRight==null) return;
      const ok = (pickedLeft===correctLeft) && (pickedRight===correctRight);
      if (ok){ App.stats.right++; incrementPoints(1); }
      else { App.stats.wrong++; recordMistake(w); }
      updateScorePanel();
      setTimeout(()=>{ App.qIndex++; updateDeckProgress(); renderQuestion(); }, 350);
    }

    for (const val of pickSetLeft){
      const b=document.createElement("button"); b.textContent=val;
      b.addEventListener("click", ()=>{
        A(".dual-grid > :first-child button").forEach(x=>x.classList.add("disabled"));
        b.classList.add(val===correctLeft ? "is-correct" : "is-wrong");
        pickedLeft = val; finalize();
      });
      leftCol.appendChild(b);
    }
    for (const val of pickSetRight){
      const b=document.createElement("button"); b.textContent=val;
      b.addEventListener("click", ()=>{
        A(".dual-grid > :last-child button").forEach(x=>x.classList.add("disabled"));
        b.classList.add(val===correctRight ? "is-correct" : "is-wrong");
        pickedRight = val; finalize();
      });
      rightCol.appendChild(b);
    }
  }
  window.startDualMCQ = (variant)=> window.startPractice(variant);

  // ---------- Write Mode ----------
  window.startWriteEN2H = async ()=> startWriteWords("en2h");
  window.startWriteK2H  = async ()=> startWriteWords("k2h");

  async function startWriteWords(variant="en2h"){
    await ensureDeckLoaded(); try{ await flushSession(); }catch{}
    App.mode = (variant==="k2h") ? "write-k2h" : "write-en2h";
    App.write.variant = (variant==="k2h") ? "k2h" : "en2h";
    setCrumbs();
    const base = (variant==="k2h") ? filterDeckForMode("write-k2h") : App.deck.slice();
    App.deckFiltered = shuffle(base);
    App.write.order = App.deckFiltered.map((_,i)=>i);
    App.write.idx = 0; App.stats = { right:0, wrong:0, skipped:0 }; updateScorePanel();

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
    if (App.write.variant==="k2h") elWriteCard.textContent = (w.kanji||"") + "  →  (type Hiragana)";
    else elWriteCard.textContent = w.en + "  →  (type Hiragana)";
    elWriteInput.value=""; elWriteFeedback.textContent=""; elWriteInput.focus(); updateWriteProgress();
  }
  function updateWriteProgress(){
    const cur = Math.min(App.write.idx, App.write.order.length);
    elWriteBar.style.width = pct(cur, App.write.order.length);
    elWriteText.textContent = `${cur} / ${App.write.order.length} (${pct(cur, App.write.order.length)})`;
  }
  window.writeSubmit = ()=>{
    const i = App.write.order[App.write.idx] ?? -1; const w = App.deckFiltered[i]; if(!w) return;
    const ans = (elWriteInput.value||"").trim(); if(!ans) return;
    if ((ans||"").replace(/\s+/g,"").toLowerCase() === (w.hira||"").replace(/\s+/g,"").toLowerCase()){
      elWriteFeedback.innerHTML = `<span class="ok-inline">✓ Correct</span>`;
      App.stats.right++; incrementPoints(1); App.write.idx++; updateScorePanel(); setTimeout(renderWriteCard, 250);
    } else {
      elWriteFeedback.innerHTML = `Expected: <b>${escapeHTML(w.hira)}</b><br>Got: <span class="error-inline">${escapeHTML(ans)}</span>`;
      App.stats.wrong++; updateScorePanel(); recordMistake(w);
    }
  };
  window.writeSkip = ()=>{ App.stats.skipped++; updateScorePanel(); App.write.idx++; renderWriteCard(); };
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
  window.makeSkip = ()=>{ App.stats.skipped++; updateScorePanel(); App.make.idx++; renderMakeCard(); };
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
    try{
      const fb = await whenFBReady();
      const rows = await fb.listMarked();
      elMarkedStatus.textContent = `${rows.length} marked item(s).`;
      elMarkedContainer.innerHTML="";
      for (const r of rows){
        const div=document.createElement("div"); div.className="marked-item";
        div.innerHTML = `<div>${escapeHTML(r.front || r.hira || r.kanji || r.id)} — <span class="muted">${escapeHTML(r.back || r.en || "")}</span></div>
          <button data-id="${r.id}">Remove</button>`;
        div.querySelector("button").addEventListener("click", async()=>{
          await fb.unmarkWord(r.id); await renderMarkedList();
        });
        elMarkedContainer.appendChild(div);
      }
    } catch { elMarkedStatus.textContent = "Failed to load marked words."; }
  }
  window.startMarkedLearn = async()=> setupListPractice("marked","learn");
  window.startMarkedPractice = async(m)=> setupListPractice("marked", m);
  window.startMarkedWrite = async()=> setupListPractice("marked","write");

  async function getMarkedAsDeck(){
    const fb = await whenFBReady();
    const rows = await fb.listMarked();
    return rows.map(r=>({ kanji:r.kanji || "—", hira:r.hira || r.front || "", en:r.en || r.back || "" }))
               .filter(x=>x.hira && x.en);
  }
  async function setupListPractice(source, mode){
    let deck=[]; if (source==="mistake") deck=getMistakes().map(x=>({kanji:x.kanji, hira:x.hira, en:x.en}));
    else deck=await getMarkedAsDeck();
    if (!deck.length){ toast("No items to practice."); return; }
    App.deck = deck; App.mode = mode; setCrumbs();
    if (mode==="learn"){
      App.deckFiltered=deck.slice(); App.qIndex=0;
      D("#practice")?.classList.add("hidden"); elWrite.classList.add("hidden"); elMake.classList.add("hidden");
      elLearn.classList.remove("hidden"); renderLearnCard();
    } else if (mode==="write"){
      App.deckFiltered=shuffle(deck); App.write.order=App.deckFiltered.map((_,i)=>i); App.write.idx=0;
      elLearn.classList.add("hidden"); D("#practice")?.classList.add("hidden"); elMake.classList.add("hidden");
      elWrite.classList.remove("hidden"); renderWriteCard();
    } else {
      App.deckFiltered=shuffle(deck); App.qIndex=0;
      elLearn.classList.add("hidden"); elWrite.classList.add("hidden"); elMake.classList.add("hidden");
      D("#practice").classList.remove("hidden"); updateDeckProgress(); renderQuestion();
    }
  }

  // Mark current word (available across modes)
  window.markCurrentWord = async () => {
    const w = App.deckFiltered[App.qIndex] || App.deck[App.write.order[App.write.idx]] || null;
    if (!w) return;
    const id = (w.kanji && w.kanji!=="—" ? w.kanji : w.hira) + "::" + w.en;
    try {
      const fb = await whenFBReady();
      await fb.markWord(id, { kanji: w.kanji, hira: w.hira, en: w.en, front: w.hira, back: w.en });
      toast("Marked ✓");
    } catch { toast("Sign in to mark"); }
  };

  // ---------- Grammar ----------
  function wireGrammarTab(){
  document.querySelector("#open-grammar-pdf").onclick = async ()=>{
    const n = window.App.lesson.split("-")[1];
    const u = await firstOk([
      `/level/${window.App.level}/${window.App.lesson}/Grammar/lesson-${n}.pdf`,
      `/level/${window.App.level}/${window.App.lesson}/Grammar/Lesson.pdf`,
    ]);
    if (u) window.open(u, "_blank", "noopener"); else toast("PDF not found.");
  };
  // Optional practice sets from /practice_grammar/ if you have them
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
      const rows = await fb.getRecentAttempts({ max: 100 });
      if (rows.length){
        const last = rows[0];
        elProgressLast.textContent = `${fmtDate(last.createdAt?.toDate?.() || new Date())} — ${last.deckId || last.lesson || "deck"} — ${last.mode} — R:${last.right} W:${last.wrong} S:${last.skipped}`;
        const same = rows.find(r => r !== last && r.deckId === last.deckId);
        elProgressPrev.textContent = same ? `${fmtDate(same.createdAt?.toDate?.() || new Date())} — R:${same.right} W:${same.wrong} S:${same.skipped}` : "—";
        elProgressDelta.textContent = same ? (((last.right|0)-(same.right|0))>=0 ? `+${(last.right|0)-(same.right|0)} right` : `${(last.right|0)-(same.right|0)} right`) : "—";
      } else {
        elProgressLast.textContent="No attempts yet."; elProgressPrev.textContent="—"; elProgressDelta.textContent="—";
      }
      elProgressTable.innerHTML="";
      for (const r of rows){
        const tr=document.createElement("tr");
        tr.innerHTML = `
          <td>${fmtDate(r.createdAt?.toDate?.() || new Date())}</td>
          <td>${escapeHTML(r.deckId || r.lesson || "-")}</td>
          <td>${escapeHTML(r.mode || "-")}</td>
          <td>${r.right|0}</td><td>${r.wrong|0}</td><td>${r.skipped|0}</td><td>${r.total|0}</td>`;
        elProgressTable.appendChild(tr);
      }
      const best = await fb.getWriteBestByDeck({ max: 300 });
      elWriteProgressTable.innerHTML="";
      for (const b of best){
        const tr=document.createElement("tr");
        const attempted=(b.right|0)+(b.wrong|0)+(b.skipped|0);
        tr.innerHTML = `
          <td>${escapeHTML(b.deckId || b.lesson || "-")}</td>
          <td>${attempted}</td>
          <td>${b.total|0}</td>
          <td>${pct(attempted, b.total||Math.max(attempted,1))}</td>
          <td>${fmtDate(b.createdAt?.toDate?.() || new Date())}</td>`;
        elWriteProgressTable.appendChild(tr);
      }
    } catch (e){ console.error(e); elProgressLast.textContent="Failed to load progress."; }
  }
  function fmtDate(d){ try{ const dt=d instanceof Date ? d : new Date(d); return dt.toLocaleString(); }catch{ return "-"; } }
  async function renderOverallLeaderboard(){
    elOverallLB.innerHTML="";
    try{
      const fb = await whenFBReady();
      const rows = await fb.getOverallLeaderboard({ max: 100 });
      for (const r of rows){
        const li=document.createElement("li");
        li.textContent = `${r.displayName || "User"} — ${r.score || 0}`;
        elOverallLB.appendChild(li);
      }
    } catch { const li=document.createElement("li"); li.textContent="Failed to load leaderboard."; elOverallLB.appendChild(li); }
  }

  // ---------- Sign Word ----------
  window.signWordAdd = async ()=>{
    const front=(elSWFront.value||"").trim(); const back=(elSWBack.value||"").trim(); const romaji=(elSWRomaji.value||"").trim();
    if (!front || !back){ toast("Please enter Front and Back."); return; }
    try{
      const fb = await whenFBReady();
      await fb.signWordAdd({ front, back, romaji: romaji || null });
      elSWFront.value=""; elSWBack.value=""; elSWRomaji.value="";
      await renderSignWordList(); toast("Added ✓");
    } catch { toast("Sign in to save."); }
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
          const fb2 = await whenFBReady(); await fb2.signWordRemove(r.id); await renderSignWordList();
        });
        elSWList.appendChild(div);
      }
    } catch { elSWList.innerHTML = `<div class="muted">Failed to load your signed words.</div>`; }
  }

  // ---------- Save / Flush ----------
  window.saveCurrentScore = async ()=>{
    try{ const ok = await flushSession(); toast(ok ? "Progress saved ✓" : "Nothing to save."); }
    catch{ toast("Save failed."); }
  };
  async function flushSession(){
    const totalAttempted = (App.stats.right|0)+(App.stats.wrong|0)+(App.stats.skipped|0);
    if (!App.mode || !totalAttempted) return false;
    const deckTotal = App.mode.startsWith("write")
      ? (App.write.order?.length || App.deckFiltered.length || App.deck.length || 0)
      : (App.deckFiltered.length || App.deck.length || 0);
    const attempt = {
      level: App.level || null,
      lesson: App.lesson || null,
      deckId: currentDeckId(),
      mode: App.mode,
      right: App.stats.right|0, wrong: App.stats.wrong|0, skipped: App.stats.skipped|0,
      total: deckTotal|0,
    };
    try{
      const fb = await whenFBReady();
      await fb.commitSession({ attempts: [attempt], points: App.buffer.points|0 });
      App.buffer.points=0; App.stats={ right:0, wrong:0, skipped:0 }; updateScorePanel();
      return true;
    } catch (e){ console.error("[flushSession] commit failed", e); return false; }
  }

  // quick inputs
  elWriteInput?.addEventListener("keydown", (e)=>{ if(e.key==="Enter" && !(e.ctrlKey||e.metaKey)){ e.preventDefault(); window.writeSubmit(); } });
  elPgInput?.addEventListener("keydown", (e)=>{ if(e.key==="Enter"){ e.preventDefault(); window.pgSubmit(); } });

  // Close lightbox when switching away
  window.addEventListener("hashchange", closeVideoLightbox);
  window.addEventListener("beforeunload", ()=>{ try{}catch{} });

})();

