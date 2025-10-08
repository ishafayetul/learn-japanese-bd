/* =======================================================
   Speaking Practice (Shadowing)
   - Loads /stories/manifest.json
   - UI: story dropdown, play/pause, prev/next, +/- speed
   - Triple play per line: Normal → Slow → Normal
   - Auto Bangla translation (client-side Google mini endpoint fallback)
   - Keyboard Shortcuts: Space (play/pause), ←/→ (prev/next), +/- (rate)
   ======================================================= */

(function(){
  const S = {
    el: {},
    state: {
      stories: [],
      story: null,
      idx: 0,
      playing: false,
      baseRate: 1.0,
      curRate: 1.0,
      slowFactor: 0.82,
      queueToken: 0,
      voices: [],
      voiceName: null,
    }
  };

  // ===== Mount / Unmount =====================================================
  function mount(){
    const host = document.getElementById('speaking-section');
    host.innerHTML = renderShell();
    cacheEls(host);
    bindEvents();
    loadStories().then(()=> {
      buildStoryDropdown();
      // auto-select first
      if (S.state.stories.length) {
        S.el.storySel.value = S.state.stories[0].id;
        selectStory();
      }
    });
    // focus keyboard scope
    host.tabIndex = -1;
    host.focus();
  }

  function cacheEls(root){
    S.el.wrap      = root;
    S.el.back      = root.querySelector('#speaking-back');
    S.el.storySel  = root.querySelector('#sp-story');
    S.el.play      = root.querySelector('#sp-play');
    S.el.pause     = root.querySelector('#sp-pause');
    S.el.prev      = root.querySelector('#sp-prev');
    S.el.next      = root.querySelector('#sp-next');
    S.el.rateDown  = root.querySelector('#sp-rate-down');
    S.el.rateUp    = root.querySelector('#sp-rate-up');
    S.el.rateBadge = root.querySelector('#sp-rate-badge');
    S.el.voiceSel  = root.querySelector('#sp-voice');
    S.el.cardJa    = root.querySelector('#sp-ja');
    S.el.cardBn    = root.querySelector('#sp-bn');
    S.el.list      = root.querySelector('#sp-list');
  }

  function renderShell(){
    return `
      <div class="topbar">
        <button id="speaking-back" class="back" type="button">← Back</button>
        <div class="crumbs">Learn Japanese <span class="sep">›</span> <span class="speak-accent">Speaking Practice</span></div>
        <div class="topbar-right"></div>
      </div>

      <div class="card">
        <div class="sp-head">
          <select id="sp-story" title="Choose story"></select>
          <select id="sp-voice" title="Voice (ja-JP preferred)"></select>
          <button id="sp-play"  type="button">▶ Play</button>
          <button id="sp-pause" type="button">⏸ Pause</button>
          <button id="sp-prev"  type="button">⟵ Prev</button>
          <button id="sp-next"  type="button">Next ⟶</button>
          <button id="sp-rate-down" type="button">− Speed</button>
          <span   id="sp-rate-badge" class="rate-badge">1.00×</span>
          <button id="sp-rate-up" type="button">+ Speed</button>
        </div>

        <div class="sp-card">
          <div id="sp-ja" class="sp-ja">—</div>
          <div id="sp-bn" class="sp-bn"> </div>
        </div>

        <div class="sp-transport">
          <button class="sp-big" id="sp-play2" type="button">▶ Start / Resume</button>
          <button class="sp-big" id="sp-stop"  type="button">⏹ Stop</button>
        </div>

        <div id="sp-list" class="sp-list"></div>
        <p class="muted" style="margin-top:8px">
          Shortcuts: <b>Space</b> play/pause · <b>←/→</b> prev/next · <b>- / +</b> speed
        </p>
      </div>
    `;
  }

  // ===== Story Manifest ======================================================
  async function loadStories(){
    try{
      const res = await fetch('/stories/manifest.json', {cache: 'no-store'});
      const json = await res.json();
      S.state.stories = (json.stories || []).map(x => ({
        id: x.id,
        title: x.title,
        lang: x.lang || 'ja-JP',
        lines: (x.lines || []).map(s => String(s).trim()).filter(Boolean)
      }));
    }catch(e){
      console.error('Failed to load stories manifest:', e);
      S.state.stories = [];
    }
  }

  function buildStoryDropdown(){
    const sel = S.el.storySel;
    sel.innerHTML = S.state.stories.map(s => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join('');
  }

  function selectStory(){
    const id = S.el.storySel.value;
    const s  = S.state.stories.find(x => x.id === id);
    S.state.story = s || null;
    S.state.idx = 0;
    paintList();
    showLine();
    loadVoices(); // set voice defaults per language, if possible
  }

  // ===== Rendering Sentences List ===========================================
  async function paintList(){
    const st = S.state.story;
    if (!st){ S.el.list.innerHTML = ''; return; }
    // Prefetch Bangla translations to make scrolling/snapping quick
    const bnList = await Promise.all(st.lines.map(line => autoBn(line)));
    S.el.list.innerHTML = st.lines.map((ja, i) => `
      <div class="sp-item" data-i="${i}">
        <div class="ja">${escapeHtml(ja)}</div>
        <div class="bn bn-${i}">${escapeHtml(bnList[i] || '')}</div>
      </div>
    `).join('');
    S.el.list.querySelectorAll('.sp-item').forEach(div=>{
      div.addEventListener('click', ()=>{
        S.state.idx = +div.dataset.i;
        showLine();
        scrollActive();
      });
    });
    markActive();
  }

  function markActive(){
    S.el.list.querySelectorAll('.sp-item').forEach(n=> n.classList.remove('active'));
    const cur = S.el.list.querySelector(`.sp-item[data-i="${S.state.idx}"]`);
    if (cur) cur.classList.add('active');
  }

  function scrollActive(){
    const cur = S.el.list.querySelector(`.sp-item[data-i="${S.state.idx}"]`);
    if (cur) cur.scrollIntoView({behavior:'smooth', block:'center'});
  }

  // ===== Line View + Translation ============================================
  async function showLine(){
    const st = S.state.story;
    if (!st) return;
    const ja = st.lines[S.state.idx] || '';
    S.el.cardJa.textContent = ja || '—';
    markActive();
    // put cached translation if already rendered; otherwise fetch
    const bnCell = S.el.list.querySelector(`.bn-${S.state.idx}`);
    const bn = bnCell?.textContent?.trim() || await autoBn(ja);
    S.el.cardBn.textContent = bn || '';
    if (bnCell && !bnCell.textContent.trim()) bnCell.textContent = bn || '';
  }

  // Prefer a local translator hook if you add one later (e.g. Firebase Cloud Fn)
  async function autoBn(text){
    if (!text) return '';
    // Fallback mini endpoint (no key): may be rate-limited — good enough for a small line set
    try{
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=bn&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);
      const data = await res.json();
      return (data?.[0] || []).map(x => x?.[0] || '').join('');
    }catch{
      return ''; // silently ignore if offline or blocked
    }
  }

  // ===== Web Speech Synthesis ===============================================
  function loadVoices(){
    const sel = S.el.voiceSel;
    const voices = window.speechSynthesis.getVoices() || [];
    S.state.voices = voices.slice().sort((a,b)=>
      (b.lang.startsWith('ja') - a.lang.startsWith('ja')) || a.name.localeCompare(b.name)
    );
    sel.innerHTML = S.state.voices.map(v => `<option value="${v.name}">${escapeHtml(v.name)} (${v.lang})</option>`).join('');
    const defIdx = Array.from(sel.options).findIndex(o => /\(ja/i.test(o.textContent));
    if (defIdx >= 0) sel.selectedIndex = defIdx;
    S.state.voiceName = sel.value || null;
  }
  window.speechSynthesis.onvoiceschanged = ()=> loadVoices();

  function pickVoice(){
    const name = S.state.voiceName;
    const v = S.state.voices.find(v => v.name === name) || S.state.voices.find(v => v.lang?.startsWith('ja')) || S.state.voices[0];
    return v || null;
  }

  function speakOnce(text, rate){
    return new Promise(resolve=>{
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v){ u.voice = v; u.lang = v.lang; }
      u.rate = Math.max(.6, Math.min(1.6, rate || S.state.curRate));
      u.onend = resolve;
      u.onerror = resolve;
      window.speechSynthesis.speak(u);
    });
  }

  // Pause length depends on chars & punctuation
  function pauseMsFor(text){
    const base = 400;
    const perChar = 55;
    const bonus = /[。？！]/.test(text) ? 350 : 150;
    return base + (text.length * perChar) + bonus;
  }

  function sleep(ms){ return new Promise(r=> setTimeout(r, ms)); }

  async function playCurrentTriple(token){
    const st = S.state.story; if (!st) return;
    const i = S.state.idx;
    const line = st.lines[i] || '';
    if (!line) return;

    const n = S.state.curRate;
    const slow = Math.max(.6, n * S.state.slowFactor);
    await speakOnce(line, n);                 if (token.cancelled) return; await sleep(pauseMsFor(line));
    await speakOnce(line, slow);              if (token.cancelled) return; await sleep(pauseMsFor(line));
    await speakOnce(line, n);                 if (token.cancelled) return; await sleep(120); // small settle
  }

  async function playFromCurrent(){
    S.state.playing = true;
    const token = { cancelled:false }; S.state.queueToken = token;
    while(S.state.playing){
      await playCurrentTriple(token);
      if (!S.state.playing) break;
      // move forward or stop at end
      if (S.state.idx < (S.state.story.lines.length - 1)){
        S.state.idx++;
        showLine(); scrollActive();
      }else{
        S.state.playing = false; // reached end
      }
    }
  }

  function pause(){
    S.state.playing = false;
    S.state.queueToken.cancelled = true;
    window.speechSynthesis.pause();
    window.speechSynthesis.cancel();
  }

  function stopAll(){
    pause();
    S.state.idx = 0;
    showLine();
  }

  // ===== Events ==============================================================
  function bindEvents(){
    S.el.back.addEventListener('click', ()=> goBack());

    S.el.storySel.addEventListener('change', ()=> selectStory());
    S.el.voiceSel.addEventListener('change', (e)=> { S.state.voiceName = e.target.value; });

    const start = ()=> { if (!S.state.playing){ playFromCurrent(); } };
    S.el.play.addEventListener('click', start);
    S.el.play2 = S.el.wrap.querySelector('#sp-play2'); S.el.play2.addEventListener('click', start);

    S.el.pause.addEventListener('click', ()=> pause());
    S.el.wrap.querySelector('#sp-stop').addEventListener('click', ()=> stopAll());
    S.el.prev.addEventListener('click', ()=> { if (S.state.idx>0){ S.state.idx--; showLine(); scrollActive(); } });
    S.el.next.addEventListener('click', ()=> { if (S.state.idx < S.state.story.lines.length-1){ S.state.idx++; showLine(); scrollActive(); } });

    S.el.rateDown.addEventListener('click', ()=> setRate(S.state.curRate - 0.05));
    S.el.rateUp.addEventListener('click',   ()=> setRate(S.state.curRate + 0.05));

    // Keyboard shortcuts (scope: section only)
    S.el.wrap.addEventListener('keydown', (ev)=>{
      if (ev.key === ' '){ ev.preventDefault(); S.state.playing ? pause() : playFromCurrent(); }
      else if (ev.key === 'ArrowLeft'){ ev.preventDefault(); S.el.prev.click(); }
      else if (ev.key === 'ArrowRight'){ ev.preventDefault(); S.el.next.click(); }
      else if (ev.key === '+'){ ev.preventDefault(); S.el.rateUp.click(); }
      else if (ev.key === '-' || ev.key === '_'){ ev.preventDefault(); S.el.rateDown.click(); }
    }, true);
  }

  function setRate(v){
    S.state.curRate = Math.max(.6, Math.min(1.6, v));
    S.el.rateBadge.textContent = S.state.curRate.toFixed(2) + '×';
  }

  // ===== Navigation helpers (no hard coupling) ===============================
  function hideAllSections(){
    // hide known sections safely if present
    ['level-shell','lesson-area','progress-section','leaderboard-section','mistakes-section','marked-section','signword-section','mix-section','speaking-section']
      .forEach(id=> { const n = document.getElementById(id); if(n) n.classList.add('hidden'); });
  }

  function showSpeaking(){
    hideAllSections();
    document.getElementById('speaking-section')?.classList.remove('hidden');
    mount();
  }

  function goBack(){
    pause();
    // mimic your app's back behavior: go to last lesson area or level list
    hideAllSections();
    // Prefer lesson-area if deep, else level-shell
    const lesson = document.getElementById('lesson-area');
    const level  = document.getElementById('level-shell');
    (lesson || level)?.classList.remove('hidden');
  }

  // ===== Sidebar injection ===================================================
  function ensureNavButton(){
    const side = document.querySelector('.sidebar');
    if (!side || document.getElementById('nav-speaking')) return;
    // Find the Mix Practice button to insert after
    const anchor = side.querySelector('#nav-mix') || side.querySelector('button[data-nav="mix"]');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'nav-speaking';
    btn.className = 'chip speaking-chip';
    btn.textContent = '🗣️ Speaking Practice';
    btn.addEventListener('click', showSpeaking);
    if (anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    }else{
      side.appendChild(btn);
    }
  }

  // ===== Public init =========================================================
  function boot(){
    ensureNavButton();
    // if a central router exists, expose a hook
    window.openSpeaking = showSpeaking;
  }

  // util
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m])); }

  // kick
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  }else{
    boot();
  }

})();

