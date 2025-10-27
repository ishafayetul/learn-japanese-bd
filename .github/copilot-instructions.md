# N5-Vocab-Japanese AI Agent Instructions

This repository contains a Japanese language learning web application focused on JLPT N5 level vocabulary, with support for multiple learning modes and Firebase integration.

## Project Architecture

### Core Components

- `index.html` - Main application shell with auth gate and content areas
- `script.js` - Core application logic and module coordination
- `firebase.js` - Firebase authentication and data persistence module
- `style.css` - Application styling
- `/api` - Backend API endpoints
- `/level/N5/` - Main content directory with lesson structure

### Key Data Flows

1. Authentication Flow:
   - Firebase Google auth (configured in `firebase.js`)
   - Auth state controls visibility of landing vs main app
   - User data persisted in Firestore collections

2. Lesson Loading:
   - Content scanned from `/level/N5/Lesson-XX/` directories
   - Manifest.json determines available content
   - CSV files loaded for vocabulary with format: `kanji,hiragana,english`

3. User Progress:
   - Session stats tracked in `App.stats`
   - Progress synced to Firestore on completion
   - Mistakes and marked words cached locally with Firebase backup

## Important Patterns

### Content Structure Convention
- Each lesson folder follows structure:
```
Lesson-XX/
  Grammar/
  Video Lecture/
    - video.csv (title,youtube_url)
  Vocabulary/
    - lesson.csv (kanji,hiragana,english)
```

### State Management
- Global `App` object tracks current:
  - level/lesson/tab navigation state
  - learning mode and deck state
  - session statistics
  - cached content

### Firebase Integration
- Collections follow pattern:
  - `users/{uid}/notes` - User vocabulary notes
  - `users/{uid}/marked` - Marked words for review
  - `daily/{date}/scores` - Daily leaderboard
  - `leaderboard_overall` - Lifetime scores

### Keyboard Controls
- Enter = Submit
- Ctrl+Enter = Next
- Esc = Skip
- Right Arrow = Next
- Left-Shift+M = Mark word

## Development Workflows

1. Adding a New Lesson:
   - Create folder structure under `/level/N5/`
   - Add required CSVs for vocabulary/video
   - Update manifest.json if needed

2. Testing:
   - Test auth flows with different Firebase states
   - Verify offline persistence behavior
   - Check all learning modes with sample content
   - Validate score/progress tracking

## Integration Points

1. External Dependencies:
   - Firebase v10 (app/auth/firestore)
   - YouTube Embed API for video lessons
   - Web Speech API for pronunciation

2. Cross-Component Communication:
   - Firebase auth state drives UI visibility 
   - Score updates trigger leaderboard refresh
   - Progress state shared between practice modes

## Debugging Tips

1. Check Firebase console for:
   - Auth state issues
   - Firestore permission errors
   - Offline sync conflicts

2. Common Issues:
   - Content loading delays with slow connections
   - Audio API restrictions in some browsers
   - Race conditions in async data loading

3. Key Debugging Properties:
   - `window.App` - Current application state
   - `localStorage` - Cached user data
   - Firebase error codes in console