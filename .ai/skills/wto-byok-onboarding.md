# Skill: wto-byok-onboarding

**When to use:** building or modifying the flow where a user connects their own WTO API key
(Bring-Your-Own-Key), or any per-user third-party credential (Comtrade later).

## Verified facts (do not re-research unless stale)
- WTO API runs on an **Azure API Management** developer portal: `https://apiportal.wto.org`.
- Auth header is `Ocp-Apim-Subscription-Key: <primary key>` (already used in `server.ts`).
- Product to subscribe to: **WTO Timeseries API** (covers tariff data).
- The portal site **cannot be iframed** (X-Frame-Options). Guide users via deep links + checklist,
  never an embedded frame.

## User-facing steps (build these as a guided checklist with deep links)
1. Sign up → https://apiportal.wto.org/signup
2. Confirm email (verification link).
3. Sign in → https://apiportal.wto.org/signin
4. Products → **WTO Timeseries API** → Subscribe (name it) → https://apiportal.wto.org/products
5. Profile → reveal **Primary key** → Copy → https://apiportal.wto.org/profile
6. Paste into our app.

## Engineering requirements (enforce all)
1. **Validate on paste, server-side:** one test call with the pasted key. Store only on HTTP 200.
   Bad key → inline error, never silently saved.
2. **Encrypt at rest (envelope encryption):** KMS master key → per-record data key → encrypts the
   token. Store ciphertext only in `user_api_keys`. Decrypt in memory at call time only.
3. **Never expose the key to the browser** or to other tenants. Browser sees only a status chip.
4. **Re-validate periodically** (e.g. weekly) and on first failure; set `status` + `last_validated_at`.
5. **Status chip:** 🟢 "WTO connected — verified live data" / ⚪ "demo data — add your key".
6. **Shared cache still applies:** results are public trade facts → cache in the shared HS-keyed
   table even though fetched with a personal key (verify WTO ToS once).
7. Fallback/demo mode for users without a key so they get instant value before connecting.

**Done when:** a user can connect a real WTO key through the guided flow, it's validated, stored
encrypted, the chip turns green, and live WTO data flows for that user — with the key never leaving
the server.
