---
title: Firebase login config
type: lesson
tags: auth,firebase
source_tool: claude
created: 2026-06-08T00:00:00Z
---

Auth = Firebase `signInWithPopup` + `GoogleAuthProvider` (src/App.tsx `handleLogin`). Config comes
from `firebase-applet-config.json` (read in `src/firebase.ts`), NOT from .env.

Active Firebase project: **trade-for-all-22b44** (set 2026-06-08; replaced the original AI-Studio
project gen-lang-client-0106769023). `firestoreDatabaseId` is `(default)`.

When "login does nothing / no popup", the cause is almost always one of:
1. `localhost` not in Firebase Console → Authentication → Settings → Authorized domains
2. Google provider not enabled in Authentication → Sign-in method
3. Wrong `firestoreDatabaseId` (use `(default)` unless a named DB exists)
4. Popup blocked by browser

The login error was originally swallowed into `console.error`. We added an on-screen `authError`
state in App.tsx so the exact `auth/...` code shows under the Sign In button. Keep that pattern —
surface auth errors to the UI, don't swallow them.

STATUS: login confirmed working after pointing config at trade-for-all-22b44 + enabling Google
provider + authorizing localhost.
