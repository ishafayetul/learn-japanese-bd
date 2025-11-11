# Learn Japanese - JLPT N5-N3 Companion

Interactive, CSV-powered study tool that bundles every JLPT N5-N3 lesson into a single-page web app. Learners can jump from bite-sized video summaries to vocab drills, writing practice, grammar PDFs, and speaking shadowing-while their progress, mistakes, and personal word lists stay in sync via Firebase.

---

## Core Features

- **Lesson explorer & auto-discovery** - `script.js` scans `level/<N5|N4|N3>/Lesson-*` folders at runtime using `level/<level>/manifest.json`, so new lessons become available as soon as their CSV/PDF assets land in the repo.
- **Multi-mode practice lab** - Learn cards, MCQ quiz, typing drills (`Write`), sentence crafting (`Make`), and grammar prompts all ride on the same deck pipeline with keyboard shortcuts (Enter, Ctrl+Enter, Esc, <-/->) and adaptive feedback bars.
- **Video hub & grammar PDFs** - Each lesson surfaces lecture playlists from `/Video Lecture/*.csv` and links to per-lesson grammar PDFs for quick reference.
- **Speaking shadowing** - `speaking/speaking.js` drives a Web Speech API experience: auto Bangla translations, triple-rate playback, keyboard transport controls, and story manifests so teachers can drop new dialogues without code.
- **Personal progress cockpit** - Mistake history, marked words, Sign Word notebook, write-mode best scores, daily/overall leaderboards, and Mix Practice runs are all backed by Firestore collections for long-term tracking.
- **Word list studio** - Create/import/export personal decks, add entire lessons in bulk, manage entries, or reopen a list directly inside the vocab modes. Lists sync to Firestore, but also persist to `localStorage`/IndexedDB for offline resilience.
- **AI grammar coach (today)** - `api/grammar-review.js` is a Vercel-ready serverless function that forwards grammar answers to Google Gemini and returns structured scoring, verdicts, and corrections tailored to JLPT N5 learners.

---

## Technology Overview

- **Frontend:** Vanilla HTML/CSS/JS (`index.html`, `style.css`, `script.js`) with zero build step. Responsive layout with sidebar navigation, accessible status updates, toast notifications, and mobile-friendly nav drawer.
- **Content pipeline:** CSV-first design-`Vocabulary/*.csv`, `Video Lecture/video.csv`, `Grammar/*.pdf`-controlled via the level manifest. Setting `window.APP_LEVEL_BASE` lets you host lesson files elsewhere without touching the code.
- **Firebase layer (`firebase.js`):**
  - Google Auth sign-in, guarded bootstrap (`whenFBReady`) so the app never touches undefined Firebase objects.
  - Firestore for attempts, mistake logs, write best scores, marked words, Sign Word, per-user word lists, plus shared daily & overall leaderboards.
  - IndexedDB persistence and local caches for word lists/mistakes, so the UI keeps working while offline.
- **Speaking module:** Uses the Web Speech API for playback, dynamic voice selection, and auto translations pulled from the story manifest.
- **AI service:** Gemini 1.5 Flash (`api/grammar-review.js`) with temperature 0.2, JSON-only responses, and guardrails for malformed output.
- **Deployment:** Pure static output makes it trivial to host on Firebase Hosting, GitHub Pages, Netlify, or any CDN. A `Dockerfile` packages the site into an Nginx container for reproducible on-prem/cloud deploys. The optional AI endpoint fits Vercel/Netlify Functions or any Node 18 serverless runtime.

---

## Repository Layout

```
.
|- index.html            # Landing page + SPA shell
|- style.css             # Main styling (plus speaking/speaking.css)
|- script.js             # Lesson loader, practice engine, UI state
|- firebase.js           # Firebase init + Firestore helpers
|- speaking/             # Shadowing UI + stories manifest
|- level/
|   |- N5|N4|N3/
|        |- manifest.json
|        |- Lesson-XX/
|             |- Vocabulary/*.csv
|             |- Video Lecture/video.csv
|             |- Grammar/*.pdf
|- api/grammar-review.js # Gemini grammar checker (serverless)
|- Dockerfile            # Nginx static image
```

Add or update lessons by dropping CSV/PDF assets in the proper lesson folder and updating the manifest entry-no code changes required.

---

## Getting Started

### 1. Clone & serve the static app

```bash
git clone https://github.com/<you>/N5-Vocab-Japanese.git
cd N5-Vocab-Japanese
python3 -m http.server 4173  # or: npx serve .
```

Fetches use relative paths, so you must run any static server (no bundler needed). Open the served URL in a browser.

### 2. Configure Firebase

Add your Firebase project settings before `firebase.js` loads (inside `index.html`):

```html
<script>
  window.FIREBASE_CONFIG = {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
    storageBucket: "...",
    messagingSenderId: "...",
    appId: "...",
    measurementId: "..."
  };
</script>
<script src="/firebase.js"></script>
```

Optional runtime flags:

```html
<script>
  window.APP_LEVEL_BASE = "level";      // change if lessons live elsewhere
  window.APP_LEVEL_DEFAULT = "N5";      // default tab on login
</script>
```

### 3. (Optional) Run the AI grammar endpoint locally

The function is framework-agnostic; place it under `api/` in a Vercel project or expose it with any Node 18 server:

```bash
export GEMINI_API_KEY=sk-...
vercel dev         # or: node api/grammar-review.js via your own express wrapper
```

Point the frontend to the deployed endpoint via your hosting setup or a reverse proxy.

---

## Deployment Notes

- **Docker/Nginx:** `docker build -t n5-vocab . && docker run -p 8080:80 n5-vocab`
- **Firebase Hosting or static CDNs:** Upload the repo root; Firebase Auth + Firestore work client-side, so no SSR needed.
- **Serverless AI hook:** Deploy `api/grammar-review.js` to Vercel/Netlify/AWS Lambda with the `GEMINI_API_KEY` secret. The UI will POST grammar answers there whenever the Grammar Review mode is enabled.

Mixing deployments is fine: keep the static site on a CDN and the AI endpoint on a function platform.

---

## Possible New AI Features

1. **Adaptive deck tutor** - Use a lightweight LLM service to analyze Firestore attempt history and auto-build personal decks (e.g., "verb te-form mistakes from the last 7 days") or suggest the next best lesson.
2. **Pronunciation scoring** - Pair the speaking module with speech-to-text (Gemini Live, Whisper, or Web Speech recognition) to grade pronunciation, point out mora errors, and compare against native pitch accents.
3. **Contextual sentence coach** - Let learners type free-form sentences; have an LLM return grammar notes, naturalness scores, and alternative vocabulary tied to the lesson they're on.
4. **AI conversation partner** - Offer dialogue simulations that adapt to the learner's answers, with quick-switch difficulty modes (N5 -> N3) and automatic logging into "Sign Word" or Mistakes for follow-up drills.
5. **Smart mix generator** - Feed the CSV corpus into embeddings so the app can auto-generate themed mixes (travel, food, counters) or Kanji confusion drills without manual curation.

---

## Contributing

1. Keep assets in UTF-8 CSV/PDF to avoid parsing issues.
2. Validate new lesson entries by opening the level once locally; the `Lesson Status` banner will surface manifest or CSV parse errors.
3. When editing Firebase logic, keep `whenFBReady()` guards and cached state helpers so unauthenticated flows stay safe.
4. PRs that add AI/ML endpoints: prefer stateless serverless functions and document any new env vars inside this README.

Happy studying! 
