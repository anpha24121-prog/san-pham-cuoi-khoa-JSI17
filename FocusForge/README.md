# FocusForge — JSI Final Project (enhanced version)

FocusForge is a student productivity workspace with a Pomodoro timer, task planning, focus analytics, a weekly due-date planner, Firebase Authentication, optional Firestore sync, and the existing Focus AI chatbot.

## What's included

- **Pomodoro:** focus / short break / long break modes, configurable durations, accurate timestamp-based countdown, pause/resume/reset, completion chime, optional soft rain-like ambient sound, full-screen focus view, and optional automatic breaks.
- **Task manager:** add, edit, delete, search, filter, subject, priority, estimated duration, due date, and one-click focus on a task.
- **Dashboard:** focus minutes and completed sessions for today, task completion, streaks, a seven-day focus chart, recent sessions, and AI-powered weekly habit review.
- **Weekly planner:** select a day to review tasks due on that date; overdue tasks are surfaced on today's agenda.
- **Personalization:** dark/light theme, timer preferences, editable Firebase display name, and export of tasks, sessions, and settings as JSON.
- **Firebase Authentication:** existing email/password and Google sign-in flows.
- **Focus AI:** the chatbot uses the same shared Firebase app configuration as the rest of the website and can receive the current task list when generating a study plan.
- **Local-first behavior:** core task, timer, analytics, and preferences work in the browser. When Firestore is unavailable or its rules deny access, the website keeps using local data and displays a sync warning rather than breaking the workspace.

## Important: existing Firebase configuration preserved

`firebase-config.js` retains the project values from the supplied version (`minitest-f2254`). The Firebase configuration is now the single source of truth for Authentication, Firestore, and Focus AI; the AI file no longer creates a second Firebase app with a different App ID.

Do not paste a different project's credentials into this version unless you intentionally want to migrate the project. Firebase web API keys are client configuration values, not a replacement for Authentication, Firestore Rules, or App Check.

## Run locally

1. Open this folder in VS Code.
2. Start the folder using **Live Server** or another local HTTP server. Do not open `index.html` with a `file://` URL because ES modules require an HTTP origin.
3. Open the local HTTP address provided by the server.
4. Test registration/login with the Firebase project you already configured.

The Firebase project must allow the local hostname under Authentication → Settings → Authorized domains. Email/Password should be enabled; Google sign-in requires the Google provider to be enabled.

## Optional: enable cloud data sync

The workspace can save locally without Firestore. For cross-device sync:

1. In Firebase Console, open the existing `minitest-f2254` project and create/enable Cloud Firestore if it is not enabled.
2. Review `firestore.rules` and publish those rules in Firestore → Rules. They allow an authenticated user to read/write only the document under their own UID. Do not publish broad public write rules.
3. Sign in to FocusForge. The current workspace is saved at `users/{uid}/focusforge/workspace`.
4. Check the status pill in the dashboard. A green status indicates the latest sync succeeded; a warning means the browser is still using local storage.

If you already have deployed custom Firestore rules, merge the narrow rule in `firestore.rules` with your existing rules instead of blindly replacing them.

## Focus AI setup

The chatbot imports the shared `firebase-config.js` and uses Firebase AI Logic with the `gemini-3.8-flash` model. Firebase AI Logic and the Google AI Developer API backend must be available for the existing project. A model request can still fail if the service is not enabled, project restrictions/App Check are configured differently, the browser cannot reach Firebase, or a quota is reached. In that case, authentication and local workspace features can still be used.

## Data and privacy

- Before Firestore is configured, tasks, sessions, and preferences live in that browser's `localStorage`.
- When signed in and Firestore is configured, the app syncs the current workspace to the signed-in user's own document.
- Session history is capped at the most recent 250 focus sessions in the workspace document, and the app caps tasks at 200 so the Firestore document stays small.
- The **Export JSON** button creates a local backup of current tasks, session history, and settings. It does not include passwords or Firebase tokens.
- Do not store passwords, API secrets, or other sensitive information in task names or AI prompts.

## Quick test checklist

- [ ] Register with email/password, then log out and log back in.
- [ ] Verify Google sign-in after enabling the Google provider in Firebase Console.
- [ ] Add a task; change its subject, priority, duration and due date; then edit, complete and delete tasks.
- [ ] Search tasks and use the subject/status filters.
- [ ] Start, pause, resume and reset a timer. Test focus, short break and long break durations.
- [ ] Complete a full focus timer to confirm a session appears in analytics and recent history.
- [ ] Select days in the planner and check due-date tasks.
- [ ] Toggle light/dark theme, change timer preferences and reload the page.
- [ ] Export the workspace to JSON.
- [ ] Configure Firestore Rules, then confirm the dashboard sync status turns green.
- [ ] Open Focus AI and try “Lập kế hoạch bằng AI”.

## Project files

- `index.html` — workspace, dashboard, planner, task form and settings UI.
- `home.js` — task CRUD, timer, stats, planner, local persistence and optional Firestore sync.
- `style.css` — original styling plus responsive dashboards, planner, task management and light theme.
- `firebase-config.js` — preserved existing project config, shared app, Authentication and Firestore exports.
- `focus-ai-chat.js` / `focus-ai-chat.css` — Focus AI interface and Firebase AI Logic integration.
- `login.html` / `login.js` — sign-in page.
- `register.html` / `register.js` — registration page.
- `firestore.rules` — user-scoped Firestore rules template for review and deployment.
