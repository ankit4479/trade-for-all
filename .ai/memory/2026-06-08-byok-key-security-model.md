---
title: BYOK key security model
type: fact
tags: security,byok,encryption,wto
source_tool: claude
created: 2026-06-08T13:01:38Z
---

User third-party API keys (WTO now, Comtrade later) use envelope encryption: KMS master key -> per-record data key -> encrypts the token. Store ciphertext only in user_api_keys table (provider, user_id, status, last_validated_at). Decrypt in-memory at call time only; NEVER return to the browser or expose cross-tenant; never log. Validate on paste with a server-side test call (store only on 200); re-validate periodically. Browser only ever sees a status chip (connected/not). This is the 'tokenization' the user asked for.
