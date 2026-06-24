# Frontend Implementation Plan — Conversation→Canvas Workspace (CRO-first)

> **Owning skills:** `ui-ux-designer` (Saarinen/Linear + Rams + Norman) + `frontend-engineer` (Osmani +
> shadcn/Tailwind) lead; `growth-pricing` (Poyar/Verna) owns the CRO + pricing layer; `payments-billing-engineer`
> owns Stripe; `product-manager` owns funnel outcomes. Authored against `.ai/specs/00-foundation.md` (ADRs),
> `.ai/specs/phase-2-smooth-ux.md` (SSE contract), `.ai/BUILD_PLAN.md`, and a full audit of `src/`.
> **Status:** v2 (2026-06-24) — pricing/gating + account/history/subscription/billing + execution milestones locked.
> This is the single source of truth for the customer-facing frontend. GitHub issues link back to this file.
>
> **Thesis:** A ChatGPT-simple **split workspace** — you *talk* on the left, a *living trade report* builds and
> updates on the right — engineered so every pixel reduces friction and every screen has a defined funnel job.

---

## 0. Locked decisions (sign-off 2026-06-24)
1. **Tiers:** Free = **1 analysis/month** (signup-gated, read-only). Pro = **10/month** + unlimited refinement
   + export. Plus = **100/month** + same. **Monthly refill** on all tiers.
2. **Payments:** **Stripe** (Checkout + Customer Portal).
3. **Analytics:** **PostHog** (events + funnels + experiments + replay).
4. **Demo = the Free tier**, post-signup: 1 analysis, **no refinement chat, no export, screenshot-deterred**.
5. **Screenshots:** true blocking is impossible on web → **deterrent stack** (dynamic watermark + disabled
   copy/right-click + blur-on-blur). Honest framing; protect the *data's* value.
6. **Storage:** this file (`.ai/specs/frontend-implementation-plan.md`); issues grouped under 6 milestones.

---

## 1. Audience + the CRO funnel (the spine of every decision)

### 1.1 Primary persona
SME exporter — coffee farmer-exporter in India, furniture maker in Vietnam, small manufacturer in Germany.
Often **non-native English**, frequently on a **mid-range Android on patchy data**, expert in their *product*
but a **complete novice** in HS codes/tariffs/incoterms/FTAs, making a real financial decision they can't get
wrong. ⇒ no jargon on the surface · one decision per step · traffic-light verdicts over raw numbers ·
mobile-first · works offline · **every number shows its source**.

### 1.2 The funnel (signup-gated; demo = Free tier)
```
 STAGE              GOAL                          CRO LEVER (section)
 ────────────────────────────────────────────────────────────────────────
 1 Land             value understood in 5s         §5.1 hero = outcome, not features
 2 Sign up          Google 1-tap (lead capture)    §5.2 social-first, single tap, no forms
 3 First value      1 free analysis renders        §5.4/§7 streaming <3s
   (ACTIVATION/AHA)  = map + 🟢🟡🔴 verdict         §1.3 — the single most important moment
 4 Hit a gate       refine / export / 2nd analysis §5.10 contextual upgrade wall at moment of need
 5 Upgrade          Pro/Plus via Stripe            §2.7 transparent pricing, live unlock
 6 Habit + retain   refine, run more, offline      §2.4 history, §6 offline, §11 re-engagement
```
**Note (tradeoff):** signup-before-value trades the "no-wall" ideal for **lead capture** — a valid B2B choice.
1-tap Google keeps friction minimal. Flag **signup-gated vs. anonymous-demo** as a future A/B test (§11.3).

**Benchmarks we design against** (2025–26): time-to-first-value < 5 min lifts conversion >25%; cutting form
fields 7→3 lifts completion 25–40%; contextual in-app upgrade prompts convert **3–4×** vs generic;
limit-hitters convert **~40% vs ~8%**; **60% of conversions happen in the first 14 days**; trust signals lift
B2B conversion **15–30%**; freemium→paid median 2.6%, top quartile 5–8%.

### 1.3 The Activation moment ("aha")
> **Aha = the instant the user sees their own product as a world map with 🟢 Go / 🟡 Careful / 🔴 Avoid
> markets + a plain-language verdict.** Reachable in 1 tap (Google) + <3s (SSE). Instrumented as the
> activation event (§11) and optimized relentlessly.

---

## 2. Product model + the four core surfaces

### 2.1 Conversation→Canvas
Persistent panes: **left = chat (driver)**, **right = canvas (living report)**. Chat = questions, steering,
plain-language verdicts, follow-ups; never renders a tariff table. Canvas = every number, map, table, document,
source; never asks a question.

### 2.2 Progressive split (the canvas is born, not pre-drawn)
```
 STAGE A Landing → STAGE B Clarify (chips) → ── hinge ──► STAGE C Split workspace
 full-width chat    full-width chat                      chat docks left; canvas opens at the
                                                         first SSE section-fill (~<3s)
```
Hinge trigger = first `section-fill` (overview), not job-complete → canvas appears fast, fills via skeletons.

### 2.3 Three-zone layout (history ∣ chat ∣ canvas) + responsive
```
 ≥1280px (xl)   🕘 history(260, collapsible) ∣ 💬 chat(380) ∣ canvas(fills)
 1024–1279      history → ☰ overlay drawer; chat+canvas split
 <1024          history = ☰ full-screen drawer; chat+canvas = one-pane toggle (§2.3.1)
 "+ New analysis" always reachable. Breakpoint lg=1024 is the pane-split boundary.
```
**2.3.1 Mobile one-pane toggle:** chat = home; when data lands → "📊 Results ready ▸" slides canvas OVER chat;
persistent bottom "💬 Ask" bar returns to chat; canvas mutation while in chat → toast.

### 2.4 Chat history / sessions  ★new
**Session** = `{ id, userId, title, productDescription, originCountry, hsCode, jobId, messages[], pinned,
createdAt, updatedAt }`. Backed by `user_products` + `analysis_jobs` (BUILD_PLAN). One history entry = one
analysis session, exactly like ChatGPT/Claude.
```
 🕘 HISTORY RAIL
 [ + New analysis ]              🔍 Search
 ── Pinned ──   📌 Coffee → Germany
 ── Today ──    • Bamboo brush → USA  (active highlighted)   ⋯ = rename·pin·delete·duplicate
 ── Earlier ──  • Leather bags → EU
```
- Auto-title from product→origin (editable). Resume = restore chat thread + re-hydrate canvas from saved
  `jobId` (cached-first, revalidate via TanStack Query).
- **Free tier:** only the current month's 1 session persists (older read-only).
- **Edge:** empty → "Your analyses will appear here" + nudge; offline → browsable from cache + 📡 banner;
  delete active → fall back to newest or fresh workspace; very long titles truncate w/ tooltip.

### 2.5 Account / Settings (rebuild of ProfilePage)  ★new
Routes under `/settings`, lazy, shadcn forms with **real validation** (audit: none today):
```
 /settings/account      identity (Google), name, company info (collected HERE, not at signup), catalog URL
 /settings/preferences  base currency, language, units, notifications
 /settings/subscription §2.6
 /settings/billing      §2.7
 /settings/security      active sessions, sign-out-everywhere, BYOK key mgmt (ciphertext-only)
 /settings/danger        export my data (GDPR), delete account (confirm + consequences)
```
Edge: unsaved-changes guard; optimistic save + rollback; disabled email labeled "managed by Google".

### 2.6 Subscription + entitlements  ★new
```
 /settings/subscription
 Your plan: FREE        ▓▓▓░░░ 1 of 1 analyses used · resets Jul 1
 [ Upgrade → Pro: 10/mo, refine, export, screenshots ]   [ Compare plans ]
 ── Use your own WTO key (free, unlimited data) ──  [ Add WTO API key ]  guided checklist + demo
 PRO/PLUS see: plan, renewal date, usage meter, [Manage → portal], [Change plan].
```
- **Entitlements server-authoritative ONLY** (security memory): UI reads `useEntitlements()`, never computes
  "remaining" client-side. After upgrade, entitlements refresh live → gated features unlock **without reload**.
- Upgrade = Stripe Checkout; downgrade/cancel = Customer Portal w/ proration + "works until period end".
- BYOK = onboarding-as-flow (checklist + deep links + demo), status 🟢 validated / ⚪ unverified.

### 2.7 Billing  ★new
Delegate to Stripe (Checkout + Customer Portal); keep an in-app summary:
```
 /settings/billing
 Payment method  •••• 4242  [Manage →portal]      Next invoice  $X on Jul 24
 ── Invoices ──  Jun 24 $X Paid [PDF] · May 24 $X Paid [PDF]
```
- **Dunning:** failed payment → in-app banner "Payment failed — update card to keep Pro [Fix it]", grace
  period, never silent lock without recovery.
- **Pricing page (`/pricing`, public):** Free/Pro/Plus, monthly default + annual toggle (save %), feature×tier
  table, BYOK explainer, trust row (sources, security, disclaimer), FAQ. No dark patterns.
- **Edge:** declined → friendly retry; Checkout closed → back to wall not broken; webhook lag → optimistic
  "activating…" then confirm.

### 2.8 Entitlement / gating matrix (the contract)
```
 Capability                         FREE          PRO            PLUS
 New analyses (product queries)     1 / month     10 / month     100 / month   (monthly refill)
 Classify + clarify (to produce it) ✓             ✓              ✓
 Refinement chat (same product)     ✗             ✓ unlimited    ✓ unlimited
 View analysis + deep-dive          ✓ read-only   ✓              ✓
 Export (PDF/CSV/docs)              ✗             ✓              ✓
 Screenshots                        deterred      allowed        allowed
 History persistence                current only  ✓              ✓
 Expert chat                        ✗             ✓              ✓
```
A "product query" = one new analysis. Refinement within a product never costs a query. Quota = analyses, not
messages. **Server-authoritative; increment in a transaction BEFORE the LLM call** (BUILD_PLAN).

### 2.9 Real-time canvas mutation
Follow-ups mutate the relevant canvas block in place (not a chat reprint), with a visible diff:
**scroll into view + 1.5s emerald outline pulse** (desktop) **+ toast** (mobile). `prefers-reduced-motion` →
static ring. Mutation map in §7.4. (Gated to Pro/Plus per §2.8.)

---

## 3. Design system — tokens first

Everything is a **token** (Tailwind 4 `@theme` in `src/index.css`); no raw hex/px in components.

### 3.1 Color
```
 Brand     brand-50..700 (emerald)
 Verdict   go(emerald) / care(amber) / avoid(rose)  — SEMANTIC, never decorative
 Trust     verified(sky-600) / estimate(slate-400)
 Neutral   bg slate-50 · surface white · border slate-200 · text slate-900 · muted slate-600
```
Verdict color is **never the sole carrier of meaning** — always color + icon + word (color-blind safety).
All text/bg pairs ≥ WCAG AA.

### 3.2 Type (tuned for non-native readers)
Display Inter 700 32–40 · Section Inter 600 20 · **Body Inter 400 17/27** · Label Inter 600 13 UPPER ·
Numbers JetBrains Mono tabular. Min body 17px, min tap 44px, max ~70ch line.

### 3.3 Spacing / radius / elevation / motion
8pt grid (4 8 12 16 24 32 48 64) · radius sm8/md12/lg16/xl24/full · shadow-sm default, shadow-lg overlays only ·
motion fast120/base200/hinge320, ease-out, all gated by `prefers-reduced-motion`.

### 3.4 Z-index (kills modal-on-modal — audit found nested dialogs)
`base0 · nav30 · canvas-overlay(mobile)40 · drawer50 · popover60 · toast70 · command80 · dialog90`.
**Max ONE layer above the workspace.** Docs + Expert are NOT nested modals (§4.3).

### 3.5 `SourceChip` (signature; trust = UX + CRO + legal safety)
```
 🟢 Verified · WTO · Jun 2026 ↗      props { level:'verified'|'estimate', source, asOf, sourceUrl, confidence? }
 ⚪ AI estimate · verify before use   stale(>TTL) → adds "⏳ may be outdated"
```
On **every fact**. SR label: "Verified by WTO, as of June 2026, opens source in new tab."

### 3.6 Screenshot deterrent stack (Free tier)  ★new
Dynamic per-user **watermark** (email + timestamp tiled over data) · disable right-click/copy/selection on data
blocks · **blur-on-blur / tab-switch** (`visibilitychange`) · no bulk raw data pre-rendered in DOM. Honest:
not 100%; protects the data's perceived value. Removed for Pro/Plus.

---

## 4. Component system — shadcn/ui + inventory

### 4.1 Adoption (decided: adopt shadcn/ui)
Copy-owned Radix primitives into `src/components/ui/`, themed via §3 tokens. Migrate **leaf-first,
incremental** (button/input/dialog/popover/tabs/tooltip/accordion/toast/drawer first), rebuild features on top.
Keep `motion` (hinge+pulse) + `lucide-react`.

### 4.2 Primitives
`button input textarea select combobox(command) dialog drawer(vaul) sheet popover tooltip tabs accordion
skeleton toast(sonner) badge progress avatar scroll-area alert separator hover-card`.

### 4.3 Feature inventory — current → target
```
 App.tsx (925-line monolith)    → routes/ + features/ + layout/ (split; §13)
 MarketDetailModal (1267 lines) → features/market/MarketDetailPanel + sections/* (modal→routed panel; un-nest;
                                   remove artificial 500/1500ms delays)
 DocumentGeneratorModal         → features/docs/DocumentDrawer (drawer; LAZY jspdf; no fake 1000ms delay)
 TalkToExpertModal              → folded INTO chat pane (streamed; no separate modal)
 WorldMap (d3, EAGER)           → features/map/WorldMap (MapLibre GL JS; LAZY; vector basemap + country
                                  verdict fill + hover/select; tiles = self-hosted Protomaps PMTiles (primary)
                                  + OpenFreeMap (fallback/dev); list a11y fallback). Drops @vis.gl/react-google-maps.
 MarketCard                     → verdict = icon+word+color; remove hard .slice(0,2) hidden items
 ExportSimulator                → features/simulator/Simulator (profit verdict line; currency-bound; guards)
 CustomMarketExplorer           → folded into chat ("what about X"); dedupe country list
 Country/GenericAutocomplete    → components/ui/CountryCombobox (shadcn command + virtualized; single list)
 ProfilePage                    → routes/Settings/* (validation; lazy)
 CurrencySelector/Context       → keep; rates from API not hardcoded (audit: stale)
 ★new SourceChip · ChatPane · CanvasShell · QuotaWall · HistoryRail · Glossary · PlanTable · UsageMeter
```

---

## 5. Screens (wireframes · CRO · micro · edge) — see v1 detail; deltas for locked model

### 5.1 Landing (public, pre-signup)
Outcome headline ("Find out where you can sell your product abroad"), subhead = 3 concrete jobs, example chips
(coffee/toothbrush/furniture) that **preview** value, single CTA **"Sign in with Google to start free"**,
micro-trust "✓ 1 free analysis/month · no card", authority line "🟢 Data from WTO & UN Comtrade".
Edge: offline → "works offline after your first analysis".

### 5.2 Auth — Google 1-tap, social-first
Primary = Google popup (Firebase, already wired) → effectively 1-field signup. Company data collected later in
Settings, never at signup. Edge: popup blocked → redirect fallback + explainer; friendly errors (audit: raw
`code:message` today → replace).

### 5.3 Clarify (chat, chips)
Plain product-attribute questions (memory rule: never ask for codes), big tap chips, "I'm not sure" always
present, "Step 2 of 3" progress, free-text escape hatch. Edge: 0 questions → skip to results; all "not sure" →
proceed + lower-confidence HS chip.

### 5.4 Split workspace (Stage C)
Verdict banner (plain language, lands first) → map → 🟢🟡🔴 buckets → market cards with SourceChips. Free tier:
canvas is **read-only** (composer shows "Upgrade to refine →" instead of input; §5.10). Pro/Plus: composer
active, mutations live (§2.9).

### 5.5 Market deep-dive — routed panel `/r/:job/market/:country`
Real back button (fixes audit modal trap); verdict header (icon+word+color); accordions: 💰 cost (SourceChip
per number) · 📋 paperwork · 🚢 shipping · 📜 rules · 📰 news (risk badge). Footer: 📄 Get docs (gated→wall) ·
💬 Ask about X (focuses chat w/ context; gated→wall). Edge: section `unavailable` → designed-unknown state.

### 5.6 Simulator
"Will I make money?" inputs bound to CurrencyContext (fixes mismatch), input guards (min 1, numeric — fixes
NaN), profit line carries verdict color (🟢 profit / 🔴 loss + break-even suggestion), inline disclaimer,
[Save quote] (Pro+) / [Export] (gated→wall). 

### 5.7 Docs drawer — LAZY jspdf, validation, more templates (gated).
### 5.8 Expert chat — folded into left pane, streamed, context-aware, copy button (Pro+).
### 5.9 History rail — §2.4.
### 5.10 Quota / upgrade wall — contextual, at moment of need
Trigger = user hits a gate WHILE doing something valuable (clicks refine/export, or starts a 2nd analysis past
quota). Celebrate usage ("You've used your free analysis 🎉"), show what they did (sunk value), highlight the
exact feature they clicked, [See plans →] + [Maybe later], "Your analysis is saved." Once per gate-hit, never
blocks viewing saved work. Server-authoritative entitlement check.
### 5.11 Pricing — §2.7.  ### 5.12 Settings — §2.5.

---

## 6. State matrix — every surface × {default·loading·empty·error·offline·quota}
Global rules: never a lone full-page spinner (skeletons sized to content, CLS<0.1) · every error has a next
action · offline shows 📡 "Showing saved data" · designed-unknown ("couldn't verify — [ask expert]") not blank.
(Full per-surface matrix carried from v1; extend with history/subscription/billing/quota rows.)

---

## 7. Streaming + real-time choreography (implements phase-2-smooth-ux.md)
- **7.1 Transport:** `POST /api/v1/analysis`→`{jobId}`; `GET /api/v1/jobs/:id/stream` SSE; `EventSource` +
  `Last-Event-ID` reconnect; `jobId` in URL `?job=` + IndexedDB → resume/replay from `partial_result`.
- **7.2 Section→canvas:** overview→verdict+map+buckets · duty_tax→cost (HARD numbers, never LLM) ·
  trade_laws→rules · compliance→paperwork · logistics→shipping · roadmap→steps · pulse→news+risk.
- **7.3 Paint order:** emit ALL `section-start` up-front → full skeleton grid in ~300ms → overview fills <3s
  (the aha) → per-market fills stream → `done`; `degraded` → quiet "some data cached".
- **7.4 Mutation map:** add market · sort/cheaper shipping · trade-deal · cost what-if · compare(fast-follow);
  definitions answered in chat only; ambiguous → chat clarifies, never guesses a mutation. (Pro/Plus only.)

---

## 8. Performance budgets (Osmani, CI-gated)
Initial JS ≤170KB gzip · FCP<1.5s · first useful content<3s · LCP<2.5s · INP<200ms · CLS<0.1. Lazy: WorldMap
(**MapLibre GL JS** ~200KB — lazy-loaded after analysis, off the initial JS budget; powers BOTH the verdict
map and the deep-dive logistics map), DocumentDrawer (jspdf). **Remove the app-wide (Google) Maps-key gate**
in App.tsx → no Google key needed at all; map degrades to the market list if tiles fail. Tile cost = $0
(self-hosted Protomaps / OpenFreeMap).
Route-split Landing/Workspace/MarketDetail/Settings/Pricing. Lighthouse CI + bundlesize = **merge gates**.
**Map = MapLibre GL JS** (free, open-source, GPU vector — Google-Maps-quality zoom/pan): a fixed **style JSON**
+ a **countries layer** (Natural Earth admin-0 GeoJSON) filled 🟢🟡🔴 by verdict; **hover** a country →
`setFeatureState({hover})` highlight, **click/tap** → `onSelectCountry(iso)` swaps the canvas to that country.
**Tiles = a mix:** self-hosted **Protomaps PMTiles** (primary — we host one file → identical every time, no
limits, $0) with **OpenFreeMap** as the zero-setup fallback/dev source, switchable by config. Consistent
rendering guaranteed (our style + our tiles, no provider restyle/billing). Accessible **list fallback** (market cards).

## 9. Accessibility (WCAG AA)
Color independence (color+icon+word) · full keyboard incl. map countries · shadcn ARIA · `aria-live` for SSE
fills · `aria-busy` skeletons · reduced-motion · ≥44px targets · label+error association · focus moves to new
heading on route change; drawers trap+restore focus.

## 10. i18n + plain-language layer
`react-i18next` + switch; English + Hindi/Vietnamese/Spanish/Bahasa/Arabic (RTL scaffold); `Intl.NumberFormat`.
`glossary.ts`: MFN→"import tax", HS code→"global tax category", Incoterm→"who pays for shipping", FTA→"trade
deal that lowers tax", VAT/GST→"local sales tax", anti-dumping→"extra tax on cheap imports"; technical term on
`ⓘ what's this?` only.

## 11. CRO instrumentation (PostHog)
- **11.1 Events:** landing_view · signin_start · signin_complete · analysis_start · clarify_complete ·
  first_section_rendered(ACTIVATION) · analysis_complete · deepdive_open · simulator_used · refine_attempt ·
  export_attempt · quota_wall_shown · pricing_view · checkout_start · upgrade_complete · refine_utterance(intent)
  · offline_session · error_shown(type).
- **11.2 KPIs/targets:** land→activation ≥40% · activation→upgrade-aware · quota_wall→checkout ≥25% · free→paid
  5–8% · ~60% of conversions in first 14 days (focus onboarding email there).
- **11.3 Experiments:** signup-gated vs anonymous-demo · hero headline · quota-wall copy · SourceChip prominence
  · signup timing. Flag-gated; never ship an unmeasured CRO change.

## 12. Edge / test plan (A–K, automated Vitest/Playwright/Lighthouse + manual UX)
A Landing/input · B Auth · C Classify/clarify · D Streaming/canvas (reconnect, replay, stale-race, timeout→
unavailable, circuit-open) · E Market data/designed-unknown (authoritative-only duty, source precedence, stale)
· F Simulator (≤0 guard, NaN, loss/break-even, currency switch) · G Docs (lazy fail, validation, non-Latin
font) · H **Quota/billing** (wall once per gate, server-auth entitlement, live unlock, downgrade re-lock,
dunning recovery, webhook lag) · I Offline/PWA · J Responsive (320px, mobile toggle, tablet drawer, ultrawide
clamp) · K a11y/i18n (keyboard journey, SR announces fills, color-blind, reduced-motion, RTL, long strings).
Plus **History** edge: empty/resume/delete-active/offline-browse; **Screenshot**: watermark present, copy
disabled, blur-on-blur.

---

## 13. Execution plan — milestones → parallelizable issues (with checks)
Within a milestone, **∥** = parallel-safe (separate sub-agents); **→** = depends. Each milestone ends with a
**✅ Check** gate. Each issue links to this file for shared context + carries its own scope/spec/AC/tests/files.

**M0 Foundation & Design System** — 0.1 tokens ∥ · 0.2 shadcn primitives →0.1 · 0.3 SourceChip →0.2 ·
0.4 App-shell decomposition ∥ · 0.5 tooling (TanStack Query, i18next, PostHog SDK, utils) ∥ · 0.6 perf
(lazy d3/jspdf/maps, remove Maps gate, code-split, Lighthouse+bundlesize gates) ∥.
✅ **Check 0:** tokens/primitives/SourceChip preview; CI fails on budget regress; app still runs; App.tsx thin.

**M1 Conversation→Canvas shell** — 1.1 WorkspaceLayout (history∣chat∣canvas + responsive) →M0 ·
1.2 Chat pane ∥ · 1.3 CanvasShell + skeleton grid ∥ · 1.4 routing + session URL ∥.
✅ **Check 1:** empty workspace at all breakpoints; mobile toggle; start a mock session; keyboard/focus ok.

**M2 Analysis canvas (mock data)** — 2.1 verdict+buckets+MarketCard ∥ · 2.2 WorldMap (lazy,a11y) ∥ ·
2.3 deep-dive panel+sections ∥ · 2.4 Simulator ∥ · 2.5 TradePulse ∥ · 2.6 DocumentDrawer ∥.
✅ **Check 2:** full static analysis renders; deep-dive back works; simulator incl. loss; no eager heavy imports.

**M3 Streaming + mutation** — 3.1 SSE client+lifecycle+reconnect →M2 · 3.2 skeleton paint order →3.1 ·
3.3 intent classification + mutation map + diff-pulse/toast →3.1.
✅ **Check 3:** first content <3s; reconnect no dupes; "what about Brazil"/"cheaper shipping" mutate+pulse.

**M4 Account · Auth · History** — 4.1 auth (Google 1-tap, deferred, friendly errors) ∥ · 4.2 history rail
(list/group/search/rename/pin/delete/resume) →1.1,4.1 · 4.3 Settings rebuild (profile/company/prefs/danger/
GDPR) ∥.
✅ **Check 4:** sign in; analysis appears in history; resume restores chat+canvas; settings validate+save.

**M5 Billing · Subscription · Quota/CRO** — 5.1 Pricing page ∥ · 5.2 Subscription (plan+usage+Checkout/Portal)
→5.4 · 5.3 Billing (methods+invoices+dunning) ∥ · 5.4 entitlements+usage hooks (server-auth, live unlock) →4.1
· 5.5 contextual quota wall →5.4 · 5.6 BYOK onboarding →4.3 · 5.7 screenshot deterrent stack ∥.
✅ **Check 5:** free→paid via Checkout unlocks without reload; wall fires at gate; dunning recovery; BYOK validates.

**M6 Offline · i18n · a11y · CRO** — 6.1 PWA+Dexie offline + all-states final ∥ · 6.2 i18n + glossary ∥ ·
6.3 a11y audit (axe+SR+keyboard+RTL) ∥ · 6.4 PostHog events + funnels + experiment flags ∥.
✅ **Check 6:** Lighthouse+axe pass; offline read works; language switch+glossary live; events fire with targets.

### 13.1 Issue template (each issue is self-contained for an execution agent)
```
Title · Milestone + blocks/blocked-by
## Context (link this plan section + relevant src/ files)
## Scope (in / fast-follow / out)
## Design spec (wireframe + tokens + states + micro-interactions)
## Acceptance criteria
## Test plan (automated + manual)
## Files & components (exact paths, §14)
## Parallelization notes (how sub-agents split the work)
## Definition of Done
```

---

## 14. Target structure
```
 src/ main.tsx App.tsx(thin router) index.css(@theme)
   lib/ queryClient sse analytics(posthog) i18n glossary cn entitlements
   components/ ui/* SourceChip Glossary CurrencySelector CountryCombobox Watermark
   layout/ AppShell Nav WorkspaceLayout(history∣chat∣canvas)
   routes/ Landing Workspace MarketDetail Settings/* Pricing
   features/ chat/* canvas/* map/* market/* simulator/* docs/* pulse/* upgrade/* history/* billing/*
   hooks/ useAnalysisJob useEntitlements useOffline useSession
```

## 15. Open (non-blocking) decisions
1. Map lib: **RESOLVED → MapLibre GL JS** (free, Google-Maps-quality) with tiles = **self-hosted Protomaps
   PMTiles (primary) + OpenFreeMap (fallback/dev)**, config-switchable. Countries layer (Natural Earth) for
   verdict fill + hover/select. Replaces both the crude d3/SVG MVP map and the paid Google Maps option (no
   Google key/billing; same look every time, $0 tiles). Drops the `@vis.gl/react-google-maps` dep.
   2. Compare mode v1 vs fast-follow (fast-follow).
3. Exact prices ($) for Pro/Plus + annual discount (placeholder until set). 4. Annual billing in v1? (lean yes,
toggle). 5. Email/notification provider for dunning + onboarding (TBD).

---

🤖 Frontend + UX + CRO plan, grounded in the current `src/` audit + 2025–26 CRO benchmarks.
