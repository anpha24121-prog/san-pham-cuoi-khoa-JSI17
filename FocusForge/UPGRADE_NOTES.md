# FocusForge upgrade notes

## What changed

- Replaced the static progress preview with live dashboard metrics.
- Added seven-day focus analytics, completed-session history, and streak tracking.
- Rebuilt the task list with edit/delete, subject and status filters, priority, due date, duration, and one-click focus.
- Added focus / short-break / long-break modes, configurable durations, a timestamp-based countdown, full-screen focus view, completion sound, ambient rain-like sound, and automatic break cycling.
- Added a rolling seven-day planner and task-aware AI study-plan action.
- Added weekly habit review via Focus AI, light/dark theme, display-name editing, and JSON export.
- Added optional Firestore workspace sync with localStorage fallback.
- Consolidated Firebase configuration: the homepage, auth pages, Firestore, and Focus AI use the same existing Firebase app. The duplicate app IDs from the old AI bootstrap file were removed.
- Added `firestore.rules` as a restrictive template for a user's own workspace document.

## Firebase preservation

The following values in `firebase-config.js` were preserved exactly from the supplied project: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, and `measurementId`. The Firebase JS SDK imports were aligned to version `13.1.0` so Auth, Firestore, and Firebase AI Logic share the same initialized app.

## Before using cloud sync

Enable Cloud Firestore in the same Firebase project and publish/review `firestore.rules`. If not configured, the app continues to work with local browser storage; cross-device sync is not available until Firestore permissions are correct.
