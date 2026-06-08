# Learnings Log

Append-only. Mistakes and their corrections, newest at the bottom.
Any model appends here automatically via `.ai/bin/remember.sh` (type `lesson` or `mistake`).

- **2026-06-08** (claude) — Firebase login config: Auth uses Firebase `signInWithPopup` + `GoogleAuthProvider`, configured from `firebase-applet-config.json` (NOT from .env). Login failing usually means localhost not in Firebase Authorized domains, Google provider not enabled, or wrong `firestoreDatabaseId`. Use `(default)` unless a named Firestore DB exists.
