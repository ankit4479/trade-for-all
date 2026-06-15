# 02 — Classification Tech Spec (product → right HS6, with earned confidence)

> **Personas:** `ai-rag-engineer` (lead), `trade-customs-expert` (classification authority),
> `product-manager` + `ui-ux-designer` (the single confirmation gate), `architect` (reversible).
> **Status:** v1 (2026-06-09).
> **Scope:** How a vague product description (optionally + an image) reaches the **correct HS6** with a
> **confidence score we compute from real signals** — and how the user confirms *their product* (never the
> code). This is the *upstream* half of the backbone: the lookup in `01-data-backbone.md` is only as good as
> the HS6 fed into it.
> **Relationship:** Builds **on top of the existing MVP** classifier (`src/services/gemini.ts:classifyProduct`,
> `:685`) — we keep it and add a real confidence model + a product-confirmation gate. Extends `00-foundation.md`
> (ADRs 001–014) and `01-data-backbone.md` (ADRs 015–021); new decisions are **ADR-022 … ADR-027**.
>
> **The one rule that frames everything:** the user confirms **the product** (the thing they can judge); the
> system owns **the code** (the thing they're paying us to know). Confidence is *earned from data points*,
> never self-reported by the LLM.

---

## How to use this document

- **§1 — ADRs 022–027.** The six classification decisions.
- **§2 — The confidence model.** The signals, how they combine, the caps, the thresholds — concrete enough to
  implement. This is the heart of the spec.
- **§3 — The classification pipeline + state machine.** Classify → confidence gates how much we ask → single
  product-confirmation gate → show the code as the answer → hand off to the data resolver.
- **§4 — Schema touchpoints.** Additive `classifications` table (signal breakdown, image, mirror, approval).
- **§5 — Data contracts.** `classify` / `confirm` API shapes on the foundation envelope.
- **§6 — The compounding-accuracy loop.** Every confirmation/correction is a labeled signal.
- **§7 — Exit metrics & calibration.**
- **§8 — Deferred decisions.**

---

# 1. Architecture Decision Records (ADR-022 … ADR-027)

### ADR-022 — Confidence is **computed from signals**, never the LLM's self-report
- **Decision:** The classification confidence score is a deterministic function of measurable signals
  (§2) — attribute completeness, ambiguity resolution, code validity, self-consistency, image corroboration.
  The LLM's own "confidenceScore" (today `classificationSchema`, `gemini.ts:236`) is **demoted to one weak
  input at most**, not the score itself.
- **Context:** An LLM grading its own homework is uncalibrated — it is confidently wrong exactly when it
  matters. In a tool whose whole job is to *remove* the HS-code burden, the user can't catch a wrong code, so
  the score is load-bearing: it decides whether we proceed, ask more, or disclose uncertainty.
- **Consequences:** Confidence is reproducible and auditable (we can show *why* a score is what it is) and
  **calibratable** (§7) against actual correctness from the confirmation loop. **Revisit** weights as
  calibration data accrues — the *structure* (signals, not self-report) is fixed.

### ADR-023 — The single user gate is **PRODUCT IDENTITY**, not the HS code
- **Decision:** Exactly one user-facing confirmation: a plain-English **mirror of the product** (+ image),
  "Is this your product? [Yes / Fix it]". The HS code is **shown as the answer**, never presented as something
  the user must approve.
- **Context:** Asking a user to validate `7323.93` is fake confirmation — not knowing the code is why they came
  to us. They *can* judge their own product; they *cannot* judge a nomenclature code. Confirm the thing they
  can judge; own the thing they can't.
- **Consequences:** One checkpoint, low friction. Code correctness is guaranteed internally (ADR-022 + ADR-024),
  not by a meaningless click. Showing the code + its official description is **transparency + a soft error-catch**
  (a human may notice "that says plastic"), but it never *blocks*. **Revisit** never — this is the product thesis.

### ADR-024 — HS code validity is **deterministic** (must exist in the official nomenclature, resolve to 6 digits)
- **Decision:** A proposed code is gated against the official HS list (`hs_codes`, the nomenclature loaded by
  `01-data-backbone`): it must **exist** and resolve to a full **6-digit subheading** (not a 4-digit heading).
  A code that fails never reaches the user — it forces re-classification / more questions.
- **Context:** This is a lookup, not a judgment. It kills a whole failure class: **the LLM cannot hand out a
  hallucinated code.** It also lets us render the code's **official description** beside the product.
- **Consequences:** Code validity is a hard signal in §2 and a hard gate in §3. Requires the HS nomenclature
  reference table to be present (a dependency on `01-data-backbone` §2). **Revisit** never.

### ADR-025 — Product image is **multimodal-optional, required-on-low**; it confirms identity + OCRs specs, never replaces clarifiers
- **Decision:** Accept an optional product image (GA multimodal Gemini per foundation ADR-007). Uses: (a) the
  user's visual confirmation at the product gate, (b) OCR of a photographed **label / spec sheet** to recover
  non-visual attributes (material, model, voltage, composition). The image is **required only when confidence
  is Low**. It **never replaces** clarifying questions for attributes a photo can't reveal.
- **Context:** HS codes hinge on material/use/composition/specs that a photo of a finished product cannot show
  (steel vs aluminium look identical). An image confirms *appearance*, not *classification* — except a
  photographed spec sheet, which is gold.
- **Consequences:** Image is a confidence signal (§2), not a shortcut. Mandatory-on-low keeps friction low for
  easy products while forcing evidence on hard ones. **Revisit if** image-classification accuracy data later
  justifies a stronger weight.

### ADR-026 — Confidence **gates the flow** (High/Medium/Low → distinct paths) with honest low-confidence disclosure
- **Decision:** The computed score branches the flow: **High** → straight to the product gate; **Medium** → ask
  the targeted clarifying questions first; **Low** → request image/spec sheet and re-classify; if *still* Low,
  present as a **"best estimate — verify with a licensed customs broker"** result, never as certainty.
- **Context:** Because the user doesn't validate the code (ADR-023), a low-confidence code must not be dressed
  up as right. This is the honesty valve already committed in shared memory (trade-domain cautions).
- **Consequences:** Stay fast for easy products and rigorous for hard ones, from the same pipeline. The "still
  Low" disclosure path is a first-class UI state, not an error. Thresholds are tunable (§7).

### ADR-027 — Every confirmation/correction is a **labeled signal** → compounding accuracy
- **Decision:** Each product-gate outcome (confirm / fix) and any later correction is stored as a labeled
  example (description + answers + image → confirmed product → validated code) in `classifications` +
  foundation `user_products`/`data_corrections`.
- **Context:** The user-as-surety isn't only a check — it's a flywheel. The same product next time is instant
  and certain; aggregated, it improves retrieval/classification and *calibrates* the confidence model.
- **Consequences:** Feeds §6 loop and §7 calibration. Reuses foundation tables (no new accuracy infra).
  **Revisit** never — this is the moat.

---

# 2. The confidence model (the heart of the spec)

Confidence is a number in `[0,1]` computed from **five signals**, combined with weights, then **capped** by
hard conditions. It is *not* the LLM's self-grade (ADR-022).

### 2.1 The five signals

| # | Signal | Inputs (data points) | Range | Meaning |
|---|---|---|---|---|
| S1 | **Attribute completeness** | Are the HS-*driving* attributes known? (material, use, composition, specs — the customs-relevant ones for this chapter) | 0–1 | The single most important signal. Missing a driving attribute = we literally cannot be sure. |
| S2 | **Ambiguity resolution** | `isAmbiguous` from the classifier × clarifying questions the **user answered** that removed a branch | 0–1 | Rewards *resolved* ambiguity, not the absence of questions. |
| S3 | **Code validity & specificity** | Code exists in `hs_codes` (deterministic) AND resolves to a 6-digit subheading | 0 or 1 (hard) | ADR-024. If 0 → re-classify (not a low score — a *gate*). |
| S4 | **Self-consistency** | Classify N times (or check description↔code alignment via retrieval over the nomenclature); agreement ratio | 0–1 | Catches unstable guesses; cheap with GA flash. |
| S5 | **Image corroboration** | (optional) image matches described product; spec-sheet OCR confirms a driving attribute | 0–1 | Boost only; absence is neutral, not penalty (image is optional, ADR-025). |

### 2.2 Combination + caps

```
raw = w1·S1 + w2·S2 + w4·S4 + w5·S5        // S3 is a gate, not a weighted term
      (initial weights, calibrated later: w1=0.40, w2=0.25, w4=0.25, w5=0.10)

HARD GATES (applied after the weighted sum):
  if S3 == 0            → DO NOT SCORE; re-classify / ask more (invalid or 4-digit-only code)
  if any DRIVING attribute unknown (S1 incomplete) → confidence = min(raw, MEDIUM_CEILING)
                                                      // never "High" while a code-deciding fact is missing

confidence = clamp(raw, 0, 1) after caps
```

The **cap on S1** is the rule that makes this honest: no matter how fluent the LLM is, if we don't know whether
the bottle is *steel or plastic* — which changes the chapter — we are not allowed to claim High confidence.

### 2.3 Thresholds → behavior (ADR-026)

| Band | Default cutoff | Flow action |
|---|---|---|
| **High** | ≥ 0.85 | Skip extra questions → straight to the product gate (§3). |
| **Medium** | 0.60–0.85 | Ask the targeted clarifying questions → recompute → then the gate. |
| **Low** | < 0.60 | Require image/spec sheet → re-classify. Still Low → present with the **broker-verify** disclosure. |

Cutoffs are **tunable and must be calibrated** (§7) — when we say 0.9, we should be right ~90% of the time.

---

# 3. Classification pipeline + state machine

Builds on the MVP classifier; adds the confidence computation and the single gate.

```
        ┌─────────────────────────────────────────────────────────────┐
        │ INPUT: description (+ optional image)                        │
        └─────────────────────────────────────────────────────────────┘
                              │
                  [ CLASSIFY ]  (MVP gemini classifyProduct → HS6 + isAmbiguous + raw Qs)
                              │
                  [ VALIDATE CODE ]  S3 deterministic gate (ADR-024)
                       │ invalid/4-digit → loop back, ask more
                       ▼ valid 6-digit
                  [ COMPUTE CONFIDENCE ]  S1·S2·S4·S5 + caps (§2)
                              │
            ┌─────────────────┼──────────────────────────┐
        High│             Medium│                      Low│
            ▼                   ▼                          ▼
   (skip questions)   [ ASK CLARIFIERS ]        [ REQUIRE IMAGE/SPEC ]
            │          user answers → recompute    re-classify → recompute
            │                   │                          │ still Low →
            └─────────┬─────────┘                          │  attach broker-verify flag
                      ▼                                     ▼
        ┌─ PRODUCT GATE (the ONE user checkpoint, ADR-023) ───────────┐
        │ mirror: plain-English product understanding + image         │
        │ "Is this your product?"   [ Yes ]   [ Fix it → edit/answer ]│
        └─────────────────────────────────────────────────────────────┘
                      │ Yes
                      ▼
        [ SHOW THE ANSWER ]  HS6 + official description (transparency, NOT a gate)
                      │
                      ▼
        HAND OFF → data resolver (01-data-backbone §6): cache → real source → store
                      │
                      ▼
        [ RECORD ]  confirmed product + validated code + signals → learning loop (§6)
```

State machine: `classifying → validating_code → (asking | imaging) → awaiting_product_confirmation →
confirmed → resolving_data`. "Fix it" returns to `classifying` with the user's edits as new inputs.

---

# 4. Schema touchpoints (additive)

Foundation already has `user_products` (query, hsCode, clarifiers) and `data_corrections`. Add one table for
the per-attempt audit + the signal breakdown + the gate outcome:

```ts
export const classificationBand = pgEnum('classification_band', ['high', 'medium', 'low']);
export const gateOutcome = pgEnum('gate_outcome', ['pending', 'confirmed', 'corrected']);

export const classifications = pgTable(
  'classifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userProductId: uuid('user_product_id').references(() => userProducts.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    answers: jsonb('answers').$type<Record<string, string>>().default({}), // clarifier responses (S2)
    imageRef: text('image_ref'),                 // stored product/spec-sheet image (ADR-025), null if none
    proposedHs6: varchar('proposed_hs6', { length: 6 }).references(() => hsCodes.code),
    productMirror: text('product_mirror').notNull(), // the plain-English understanding shown at the gate
    // --- confidence breakdown (auditable, ADR-022) ---
    signals: jsonb('signals').$type<{
      s1_attributes: number; s2_ambiguity: number; s3_valid: 0 | 1;
      s4_consistency: number; s5_image: number; capped: boolean;
    }>().notNull(),
    confidence: doublePrecision('confidence').notNull(),  // 0..1, computed (not LLM self-report)
    band: classificationBand('band').notNull(),
    brokerVerifyFlag: boolean('broker_verify_flag').notNull().default(false), // still-Low honesty path
    // --- the single gate (ADR-023) ---
    gate: gateOutcome('gate').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userProductIdx: index('classifications_user_product_idx').on(t.userProductId),
    bandIdx: index('classifications_band_idx').on(t.band),
  }),
);
```

On `confirmed`, write/refresh the `user_products` row (`hsCode = proposedHs6`) so the same product is instant
next time. On `corrected`, log a `data_corrections` row (foundation) — a labeled negative example.

---

# 5. Data contracts (on the foundation envelope §3.3)

```ts
// POST /api/classify
type ClassifyRequest = {
  description: string;
  imageBase64?: string;                 // optional product/spec image (ADR-025)
  answers?: Record<string, string>;     // clarifier responses on re-submit
};
type ClassifyResponse = {
  status: 'needs_answers' | 'needs_image' | 'awaiting_confirmation';
  band: 'high' | 'medium' | 'low';
  confidence: number;                   // computed (§2)
  productMirror: string;                // shown at the gate
  hs6: string;                          // the proposed code
  hs6Description: string;               // official nomenclature description (shown as the answer)
  clarifyingQuestions?: { id: string; question: string; options?: string[] }[];
  brokerVerify?: boolean;               // true on the still-Low honesty path
  signals: Record<string, number>;      // transparency / debugging
};

// POST /api/classify/confirm   → only after the user approves the PRODUCT
type ConfirmRequest = { classificationId: string; outcome: 'confirmed' | 'corrected'; edits?: string };
// confirmed → hands off to the data resolver (01-data-backbone §6)
```

The LLM here only *classifies and mirrors* (ADR-020/022). No number, no duty, no tax is produced in this
pipeline — those come exclusively from the data resolver after confirmation.

---

# 6. The compounding-accuracy loop (ADR-027)

```
user confirms product ──► labeled example {description, answers, image → product → validated HS6}
                          │
                          ├─► user_products: same product = instant next time (no LLM call)
                          ├─► data_corrections: "fix it" outcomes = negative examples
                          └─► retrieval corpus / few-shot pool: improves future classification
                                  │
                                  └─► calibration set (§7): aligns confidence with real correctness
```

Every interaction makes the next classification faster *and* more certain — the user-as-surety is the moat,
not just a gate.

---

# 7. Exit metrics & calibration

- **Calibration (the key one):** in each confidence band, measured correctness ≈ the band (High ≈ ≥90% correct
  at confirmation/audit). Recalibrate weights/cutoffs (§2) from `classifications` outcomes. An *uncalibrated*
  score is worse than none.
- **Right-product rate:** % of product gates confirmed on first try (proxy for "we understood the product").
- **Zero hallucinated codes:** 100% of shown codes exist in the official nomenclature (ADR-024 guarantees this).
- **Honest-uncertainty rate:** % of Low results that carry the broker-verify flag (never a shaky code shown as
  certain).
- **Friction:** median questions asked per classification by band (High should approach 0).
- **Flywheel:** repeat-product latency → near-zero (DB hit, no LLM).

---

# 8. Deferred decisions (designed unknowns)

1. **Self-consistency cost (S4):** N classification samples per request adds LLM cost — pick N (e.g. 3) vs. a
   cheaper description↔code retrieval-agreement check. Decide against the COGS budget (foundation §0).
2. **Driving-attribute lists per HS chapter (S1):** which attributes are "code-deciding" differs by chapter
   (textiles = fibre %, electronics = function/voltage). Needs a `trade-customs-expert` knowledge table —
   build incrementally per corridor, mirroring `01-data-backbone` rollout.
3. **Image storage & privacy:** where product/spec images live, retention, and PII (a spec sheet may carry
   business data) — coordinate with `legal-compliance-privacy` + foundation KMS (ADR-004).
4. **Confidence cutoffs:** 0.85/0.60 are seeds — must be set from real calibration data, not guessed.

> Resolve each as a new ADR (028+) here when the relevant corridor/feature ships. Do not let an undecided fork
> silently widen scope.
