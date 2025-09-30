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

  // ---------- State ----------
  const App = {
    level: null, lesson: null, tab: "videos", mode: null,
    deck: [], deckFiltered: [], qIndex: 0,
    stats: { right: 0, wrong: 0, skipped: 0 },
    write: { order: [], idx: 0, variant: "en2h" }, // "en2h" | "k2h"
    make: { order: [], idx: 0 },
    pg:   { rows: [], idx: 0 },
    buffer: { points: 0 },
    cache: {
      lessons: new Map(),     // level -> [Lesson-XX]
      vocab: new Map(),       // key -> deck
      vocabCsvFiles: new Map()
    }
  };

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

  async function anyExists(urls){
    for (const u of urls){
      try{ const r = await fetch(encodePath(u), { method:"GET", cache:"no-cache" }); if (r.ok) return true; }catch{}
    }
    return false;
  }
  async function firstOk(urls){
    for (const u of urls){
      try{ const r = await fetch(encodePath(u), { cache:"no-cache" }); if (r.ok) return u; } catch {}
    }
    return null;
  }

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
  function clearVideosPane(){ elVideoCards.innerHTML = ""; elVideoStatus.textContent = ""; closeVideoLightbox(); }
  function clearVocabPane(){
    elVocabStatus.textContent = "";
    D("#practice")?.classList.add("hidden");
    elLearn.classList.add("hidden");
    elWrite.classList.add("hidden");
    elMake.classList.add("hidden");
    elQuestionBox.textContent = ""; elOptions.innerHTML=""; elExtraInfo.textContent="";
    elWriteFeedback.textContent = "";
    elMakeFeedback.textContent = "";
  }
  function clearGrammarPane(){
    elPgArea?.classList.add("hidden");
    elPgCard.textContent = ""; elPgInput.value = ""; elPgFeedback.textContent = "";
    elPgFiles && (elPgFiles.innerHTML=""); elPgStatus && (elPgStatus.textContent="");
  }
  function hideAllSections(){
    [elLevelShell, elProgressSection, elLeaderboardSection, elMistakesSection, elMarkedSection, elSignWordSection]
      .forEach(x=>x.classList.add("hidden"));
  }

  window.navigateLevel = async (level) => {
    try { await flushSession(); } catch {}
    App.level = level; App.lesson = null; App.tab = "videos"; App.mode = null;
    App.stats = { right: 0, wrong: 0, skipped: 0 }; updateScorePanel(); setCrumbs();

    // NEW: hide any previously open lesson/tab pane before we show the lesson list
    [elTabVideos, elTabVocab, elTabGrammar].forEach(s => s.classList.add("hidden"));
    clearVideosPane(); clearVocabPane(); clearGrammarPane(); // also clears DOM inside tabs
    elLessonArea.classList.add("hidden");                    // hide previous lesson detail view
    closeVideoLightbox?.();                                  // close any open video overlay

    hideAllSections();
    elLevelShell.classList.remove("hidden");
    elLessonStatus.textContent = "Scanning lessons…";
    await showLessonList(level);
  };


  window.openSection = async (name) => {
    try { await flushSession(); } catch {}
    hideAllSections();
    clearVideosPane(); clearVocabPane(); clearGrammarPane();
    if (name==="progress"){ elProgressSection.classList.remove("hidden"); await renderProgress(); }
    else if (name==="leaderboard"){ elLeaderboardSection.classList.remove("hidden"); await renderOverallLeaderboard(); }
    else if (name==="mistakes"){ elMistakesSection.classList.remove("hidden"); renderMistakesLanding(); }
    else if (name==="marked"){ elMarkedSection.classList.remove("hidden"); await renderMarkedList(); }
    else if (name==="signword"){ elSignWordSection.classList.remove("hidden"); await renderSignWordList(); }
  };

  // ---------- Lesson discovery ----------
  async function showLessonList(level){
    let lessons = App.cache.lessons.get(level);
    if (!lessons) { lessons = await discoverLessons(level); App.cache.lessons.set(level, lessons); }

    elLessonList.innerHTML = "";
    if (!lessons.length){ elLessonStatus.textContent = "No lessons found under /level/"+level; return; }
    elLessonStatus.textContent = `${lessons.length} lesson(s) found.`;
    for (const name of lessons){
      const item = document.createElement("div");
      item.className = "lesson-item"; item.setAttribute("role","listitem");
      item.textContent = name.replace(/-/g," ");
      item.addEventListener("click", ()=> openLesson(level, name));
      elLessonList.appendChild(item);
    }
  }
  async function discoverLessons(level){
    const found=[];
    for(let i=1;i<=60;i++){
      const L = `Lesson-${pad2(i)}`;
      const any = await anyExists([
        `/level/${level}/${L}/Vocabulary/lesson-${pad2(i)}.csv`,
        `/level/${level}/${L}/Vocabulary/Lesson-${pad2(i)}.csv`,
        `/level/${level}/${L}/Vocabulary/Lesson.csv`,
        `/level/${level}/${L}/Video Lecture/Lesson.csv`,
        `/level/${level}/${L}/Grammar/lesson-${pad2(i)}.pdf`,
        `/level/${level}/${L}/Grammar/Lesson.pdf`,
      ]);
      if (any) found.push(L);
    }
    return found;
  }

  // ---------- Open lesson & tabs ----------
  async function openLesson(level, lesson){
    try { await flushSession(); } catch {}
    // NEW: wipe any previous tab content first
    [elTabVideos, elTabVocab, elTabGrammar].forEach(s => s.classList.add("hidden"));
    clearVideosPane(); clearVocabPane(); clearGrammarPane();
    closeVideoLightbox?.();

    App.level = level; App.lesson = lesson; setCrumbs();

    // Show lesson view; hide the lesson list if you prefer a single-pane experience
    elLevelShell.classList.add("hidden");     // <— hide lesson list pane
    elLessonArea.classList.remove("hidden");  // show the tabs for this lesson

    elLessonTitle.textContent = `${lesson.replace(/-/g," ")} — ${level}`;
    elLessonAvail.textContent = "";
    await openLessonTab("videos");

    // quick availability snapshot
    const hasPDF = await anyExists([
      `/level/${level}/${lesson}/Grammar/lesson-${lesson.split("-")[1]}.pdf`,
      `/level/${level}/${lesson}/Grammar/Lesson.pdf`,
    ]);
    // Just show counts we can determine without 404 spam:
    elLessonAvail.textContent = `PDF: ${hasPDF ? "Yes" : "No"}`;
  }

  window.openLessonTab = async (tab)=>{
  try { await flushSession(); } catch {}
  App.tab = tab; setCrumbs();

  // NEW: hide all tab panes and clear their DOM before showing the new one
  [elTabVideos, elTabVocab, elTabGrammar].forEach(s => s.classList.add("hidden"));
  clearVideosPane(); clearVocabPane(); clearGrammarPane(); closeVideoLightbox?.();

  // now show the selected tab
  if (tab==="videos"){ elTabVideos.classList.remove("hidden"); await renderVideos(); }
  else if (tab==="vocab"){ elTabVocab.classList.remove("hidden"); await ensureDeckLoaded(); elVocabStatus.textContent = "Pick a mode."; }
  else if (tab==="grammar"){ elTabGrammar.classList.remove("hidden"); wireGrammarTab(); }
  };


  // ---------- Video Module (no extra file buttons) ----------
  async function loadAllVideoRows(level, lesson){
    const base = `/level/${level}/${lesson}/Video Lecture/`;
    // Prefer listing (if enabled), otherwise only try canonical filenames (no part-* probing)
    let files = await listCsvFiles(base);
    if (!files.length){
      // Only a couple of safe attempts to avoid 404 spam
      const canonical = [];
      const f1 = await firstOk([base + "Lesson.csv"]);
      if (f1) canonical.push("Lesson.csv");
      else {
        const f2 = await firstOk([base + "lesson.csv"]);
        if (f2) canonical.push("lesson.csv");
      }
      files = canonical;
    }
    const rows = [];
    for (const f of files){
      try{
        const txt = await (await fetch(encodePath(base + f), { cache:"no-cache" })).text();
        const csv = parseCSV(txt);
        for (const r of csv){
          if (r[0] && r[1]) rows.push({ title: r[0], url: r[1] });
        }
      }catch{}
    }
    return rows;
  }

  async function renderVideos(){
    elVideoCards.innerHTML = "";
    elVideoStatus.textContent = "Loading videos…";

    const rows = await loadAllVideoRows(App.level, App.lesson);
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
  function extractYouTubeId(u){ try{ const url=new URL(u); if(url.hostname.includes("youtu.be")) return url.pathname.slice(1); return url.searchParams.get("v")||""; }catch{ return ""; } }

  // Lightbox for videos (moderate large)
  let videoLightboxEl = null;
  function openVideoLightbox(yid, title){
    closeVideoLightbox();
    videoLightboxEl = document.createElement("div");
    videoLightboxEl.className = "lightbox";
    videoLightboxEl.innerHTML = `
      <div class="lightbox-backdrop"></div>
      <div class="lightbox-inner card">
        <div class="lightbox-head">
          <h4>${escapeHTML(title)}</h4>
          <button class="lightbox-close" aria-label="Close">✕</button>
        </div>
        <div class="yt-wrap">
          <iframe loading="lazy" width="100%" height="100%"
            src="https://www.youtube-nocookie.com/embed/${yid}?autoplay=1"
            title="${escapeHTML(title)}" frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
        </div>
      </div>`;
    document.body.appendChild(videoLightboxEl);
    videoLightboxEl.querySelector(".lightbox-backdrop")?.addEventListener("click", closeVideoLightbox, { passive:true });
    videoLightboxEl.querySelector(".lightbox-close")?.addEventListener("click", closeVideoLightbox);
    window.addEventListener("keydown", escCloseOnce, { once:true });
  }
  function escCloseOnce(e){ if (e.key==="Escape") closeVideoLightbox(); }
  function closeVideoLightbox(){
    if (videoLightboxEl){ videoLightboxEl.remove(); videoLightboxEl = null; }
  }

  // ---------- Vocabulary ----------
  async function listVocabCsvFiles(level, lesson){
    const key = `v/${level}/${lesson}`;
    if (App.cache.vocabCsvFiles.has(key)) return App.cache.vocabCsvFiles.get(key);

    const dir = `/level/${level}/${lesson}/Vocabulary/`;
    let files = await listCsvFiles(dir);

    // If we can't list, pick a small set of canonical names only (no multi-part probing)
    if (!files.length){
      const num = lesson.split("-")[1];
      const candidates = [
        `lesson-${num}.csv`, `Lesson-${num}.csv`, "lesson.csv", "Lesson.csv"
      ];
      const existing = [];
      for (const f of candidates){
        const ok = await firstOk([dir + f]);
        if (ok) { existing.push(f); break; } // take the first that exists
      }
      files = existing;
    }

    App.cache.vocabCsvFiles.set(key, files);
    return files;
  }

  async function ensureDeckLoaded(){
    const key = `${App.level}/${App.lesson}`;
    if (App.cache.vocab.has(key)) { App.deck = App.cache.vocab.get(key).slice(); return; }
    elVocabStatus.textContent = "Loading vocabulary…";

    const files = await listVocabCsvFiles(App.level, App.lesson);
    const deck = [];
    for (const f of files){
      try{
        const path = `/level/${App.level}/${App.lesson}/Vocabulary/${f}`;
        const txt = await (await fetch(encodePath(path), { cache:"no-cache" })).text();
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
  window.startLearnMode = async () => {
    await ensureDeckLoaded(); try{ await flushSession(); }catch{}
    App.mode = "learn"; setCrumbs();
    App.deckFiltered = App.deck.slice(); // sequential
    App.qIndex = 0; App.stats = { right: 0, wrong: 0, skipped: 0 }; updateScorePanel();

    // hide everything else from this tab
    D("#practice")?.classList.add("hidden");
    elWrite.classList.add("hidden");
    elMake.classList.add("hidden");

    elLearn.classList.remove("hidden");
    renderLearnCard();
  };
  function renderLearnCard(){
    const w = App.deckFiltered[App.qIndex];
    if (!w){ elLearnBox.textContent = "No words."; return; }
    elLearnBox.innerHTML = `
      <div class="flashcard">
        <div class="muted" style="font-size:1.1em;">Kanji → Hiragana / Hiragana → English</div>
        <div style="margin:8px 0;font-size:2em;">${escapeHTML(w.kanji && w.kanji!=="—" ? w.kanji : w.hira)}</div>
        <div class="muted" style="margin-top:6px;">${escapeHTML(w.hira)} · ${escapeHTML(w.en)}</div>
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

    // hide everything else
    elLearn.classList.add("hidden");
    elWrite.classList.add("hidden");
    elMake.classList.add("hidden");

    D("#practice").classList.remove("hidden");
    elQuestionBox.textContent=""; elOptions.innerHTML=""; elExtraInfo.textContent="";
    updateDeckProgress(); renderQuestion();
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

    elLearn.classList.add("hidden");
    D("#practice")?.classList.add("hidden");
    elMake.classList.add("hidden");

    elWrite.classList.remove("hidden");
    renderWriteCard();
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

    elLearn.classList.add("hidden");
    elWrite.classList.add("hidden");
    D("#practice")?.classList.add("hidden");

    elMake.classList.remove("hidden");
    renderMakeCard();
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
    elOpenGrammarPDF.onclick = async ()=>{
      const n = App.lesson.split("-")[1];
      const u = await firstOk([
        `/level/${App.level}/${App.lesson}/Grammar/lesson-${n}.pdf`,
        `/level/${App.level}/${App.lesson}/Grammar/Lesson.pdf`,
      ]);
      if (u) window.open(u,"_blank","noopener"); else toast("PDF not found.");
    };
    renderGrammarPracticeFiles();
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

