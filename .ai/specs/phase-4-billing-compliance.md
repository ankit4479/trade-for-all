# Phase 4 — Billing + Compliance Tech Spec (Revenue, legally clean)

> **Owning personas:** `payments-billing-engineer` (lead) · `growth-pricing` (pricing/packaging + upgrade UX) ·
> `legal-compliance-privacy` (GDPR + disclaimers + ToS). QA + security gates per BUILD_PLAN §11.
> **Status:** v1 (2026-06-09).
> **References (DO NOT re-decide):** `00-foundation.md` — §2 schema (`subscriptions`, `usage`, `events`),
> §3 API conventions (envelopes, error codes, §3.7 idempotency), §4 provenance types, §5 repo layout +
> `withUserTx()`, ADR-006 (Firebase Auth + custom claims), ADR-014 (idempotency). `BUILD_PLAN.md` §8
> (monetization), §9 (cost controls), §12 Phase 4 row.
> **Sequencing (BUILD_PLAN §12):** Phase 4 ships AFTER accuracy (Phase 1) and smoothness (Phase 2) —
> *never charge for fast-but-wrong data.* Phase 0 custom-claims plumbing is a prerequisite.

This spec is buildable: §4 Stripe endpoints, §5 webhook + claim-setting, §3 metering middleware, and §6
cost circuit-breaker are real TypeScript an engineer can drop into the `server/` layout from foundation §5.1.
It does **not** redefine the schema — it consumes `subscriptions` / `usage` / `events` verbatim from foundation §2.

---

## 1. Goal + exit metric

**Goal:** Turn the accurate, fast product into a revenue product without legal exposure. A user can self-serve
a paid upgrade through Stripe Checkout, their plan/quota is enforced server-side (Stripe = truth, mirrored to
DB + Firebase custom claims), and the legal surface (disclaimers, privacy policy, ToS, GDPR rights) is live
**before the first charge**.

**Exit metric (BUILD_PLAN §12):**
1. **Paid upgrade works end-to-end** — Free user → Checkout (Stripe test mode) → webhook flips
   `subscriptions` + custom claims → quota raised → an analysis previously blocked by quota now runs. Customer
   Portal lets them manage/cancel. Idempotent on webhook replay.
2. **Disclaimers + privacy policy live** — trade-advice disclaimer on every analysis result, privacy policy +
   ToS pages published and accept-gated at signup, GDPR export + deletion paths implementable, third-party ToS
   (WTO/Comtrade/Gemini) caching check documented.

**Definition of Done (merged from the three skills):**
- [ ] Stripe = billing truth; DB mirrors via signature-verified, idempotent webhooks; reconciliation job exists.
- [ ] Entitlements set via Firebase custom claims, enforced server-side; zero client-trusted plan state.
- [ ] Proration, dunning, trials, cancellation, refunds, Stripe Tax handled.
- [ ] No raw card data stored (Checkout/Portal only); only customer/subscription IDs persisted.
- [ ] Value metric = deep analyses; tiers + Business overage defined and margin-checked.
- [ ] Quota-wall converts without nagging (no dark patterns); billing infra supports frequent re-pricing.
- [ ] Privacy policy + ToS cover data use, retention, rights, sub-processors; export + deletion implementable.
- [ ] WTO/Comtrade/Gemini ToS verified for caching + redistribution; documented.
- [ ] Trade-advice disclaimer present everywhere a number is shown; PII + BYOK keys encrypted; breach plan exists.

---

## 2. Pricing / packaging spec (growth-pricing lens)

### 2.1 Value metric & philosophy
Per BUILD_PLAN §8 + `growth-pricing` (Poyar/Verna): **meter on DEEP ANALYSES, not logins or seats.** Cost and
value both concentrate in a deep analysis (15–30+ Gemini calls, BUILD_PLAN §4). Logins/classifications are
cheap and are NOT the value metric — classification lookups stay generous to drive the activation moment (first
sourced analysis = aha). The shared HS-keyed cache is the margin lever: COGS scales with **unique routes**, not
users, so a cache hit costs ≈0 and a popular route gets cheaper as it saturates.

**A "deep analysis" (the metered unit)** = one `analysis_jobs` row of `kind = 'deep_analysis'` (or
`'multi_market'`) that reaches synthesis on a **cache miss/stale path**. A **fresh cache hit is NOT metered**
(it costs us nothing and we want to reward the shared-cache flywheel). This is enforced at the metering point
in §3 (increment only when we are about to spend on Gemini, after the cache/correction check fails).

**Re-pricing posture (Verna):** prices, quotas, and Stripe Price IDs live in **config**
(`server/services/billing/plans.ts`), never hardcoded at call sites, so pricing can iterate often (Lovable
re-priced 10× in a year) without a code change beyond config + a new Stripe Price.

### 2.2 Tiers (proposed defaults — margin-checked, iterate from data)

| Tier | Price (USD/mo) | Deep analyses / mo (quota) | Classifications / mo | Markets per analysis | BYOK (WTO/Comtrade) | Overage | Plan claim |
|---|---|---|---|---|---|---|---|
| **Free** | $0 | **3** | 25 | 1 | – | none (hard wall) | `free` |
| **Starter** | $39 | **30** | 300 | up to 3 | optional | none (hard wall + upgrade prompt) | `starter` |
| **Growth** | $129 | **150** | unlimited* | up to 6 | yes | none (hard wall + upgrade prompt) | `growth` |
| **Business** | $399 | **600** | unlimited* | up to 12 | yes (priority) | **$0.90 / extra deep analysis** (metered, auto-billed) | `business` |

\* "Unlimited" classifications are still soft-protected by the global cost circuit-breaker (§6) and rate limits;
they are cheap (single lookup), not a per-use-cost driver, so no hard cap — but never advertised as "unlimited
analyses" (anti-pattern: flat unlimited on a per-use-cost product).

**Overage (Business only):** once the 600 included deep analyses are consumed in a billing period, additional
deep analyses are **allowed** (no wall — Business users don't get blocked) and **metered to Stripe** at
**$0.90 each** via a metered Price, billed at period end. Free/Starter/Growth have **no overage** — they hit a
hard wall and see an upgrade prompt (predictable cost for cost-sensitive SMEs; expansion revenue lands on
Business where willingness-to-pay is highest).

**Trial:** Starter and Growth offer a **14-day trial** (Stripe `trial_period_days: 14`); during trial the plan
claim is granted (`status: 'trialing'`) so quota is the paid quota. No card-required-to-trial dark pattern is
mandated — `growth-pricing` decides per experiment via Checkout config.

### 2.3 Margin check (sanity, not contract)
Assume blended COGS per *cache-miss* deep analysis ≈ $0.20–$0.35 (Gemini 2.5 flash/pro mix per ADR-007) and a
target cache-hit ≥60% (BUILD_PLAN §0). Effective COGS/analysis falls as routes saturate. Starter at $39 / 30
analyses = ~$1.30 gross/analysis vs ≤$0.35 COGS → comfortably margin-positive even at 0% cache hit. Business
overage $0.90 sits ~2.5–4.5× above marginal COGS. **These are defaults to validate against the COGS dashboard
(§6.4), not frozen** — re-price from real `usage.cogs_micro_usd` data.

### 2.4 Plan → entitlements config (single source for code)
```typescript
// server/services/billing/plans.ts
import type { PlanTier } from '../../../shared/provenance'; // 'free'|'starter'|'growth'|'business' (foundation §2 enum)

export interface PlanConfig {
  tier: PlanTier;
  /** Stripe recurring Price ID for the base subscription (null for free). */
  stripePriceId: string | null;
  /** Stripe metered Price ID for overage (Business only). */
  stripeOveragePriceId: string | null;
  /** Included deep analyses per billing period. */
  deepAnalysisQuota: number;
  /** Classification lookups per period; null = soft-unlimited (cost-breaker still applies). */
  classificationQuota: number | null;
  /** Max markets evaluated per single deep analysis. */
  maxMarketsPerAnalysis: number;
  /** If true, deep analyses beyond quota are allowed and metered (overage); else hard wall. */
  allowOverage: boolean;
  /** Overage unit price in micro-USD (for COGS/margin display only; Stripe holds the billing price). */
  overageMicroUsd: number;
  trialDays: number;
}

// Stripe Price IDs come from env/Secret Manager so test vs live differ without code change.
export const PLANS: Record<PlanTier, PlanConfig> = {
  free: {
    tier: 'free', stripePriceId: null, stripeOveragePriceId: null,
    deepAnalysisQuota: 3, classificationQuota: 25, maxMarketsPerAnalysis: 1,
    allowOverage: false, overageMicroUsd: 0, trialDays: 0,
  },
  starter: {
    tier: 'starter', stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null, stripeOveragePriceId: null,
    deepAnalysisQuota: 30, classificationQuota: 300, maxMarketsPerAnalysis: 3,
    allowOverage: false, overageMicroUsd: 0, trialDays: 14,
  },
  growth: {
    tier: 'growth', stripePriceId: process.env.STRIPE_PRICE_GROWTH ?? null, stripeOveragePriceId: null,
    deepAnalysisQuota: 150, classificationQuota: null, maxMarketsPerAnalysis: 6,
    allowOverage: false, overageMicroUsd: 0, trialDays: 14,
  },
  business: {
    tier: 'business', stripePriceId: process.env.STRIPE_PRICE_BUSINESS ?? null,
    stripeOveragePriceId: process.env.STRIPE_PRICE_BUSINESS_OVERAGE ?? null,
    deepAnalysisQuota: 600, classificationQuota: null, maxMarketsPerAnalysis: 12,
    allowOverage: true, overageMicroUsd: 900_000, /* $0.90 */ trialDays: 0,
  },
};

export function planFor(tier: PlanTier): PlanConfig { return PLANS[tier]; }

/** Reverse-map a Stripe Price ID (from a webhook line item) back to our tier. */
export function tierForPriceId(priceId: string): PlanTier | null {
  const hit = Object.values(PLANS).find((p) => p.stripePriceId === priceId);
  return hit?.tier ?? null;
}
```

---

## 3. Metering implementation (server-truth quota gate)

### 3.1 Where usage is incremented
Foundation §2 `usage` table: one row per `(user_id, period_month='YYYY-MM')`, columns `deep_analyses`,
`classifications`, `cogs_micro_usd`. The increment happens **inside a DB transaction, BEFORE the expensive
Gemini synthesis fires**, and ONLY on the cache-miss/stale synthesis path (a fresh cache hit or an approved
correction override is free and not metered — §2.1). Sequence at the start of a deep analysis job:

```
resolve corrections override?  yes → serve (free, NOT metered)
look up hs_code_data cache (fresh?) yes → serve (free, NOT metered)
miss/stale → quota gate (this section) → if allowed: increment usage.deep_analyses (same txn) → synthesize
```

This guarantees **server-truth**: the meter moves before we spend, so we can never overspend a tier's quota
without either blocking (no overage) or recording an overage unit (Business).

### 3.2 The atomic check-and-increment (`reserveDeepAnalysis`)
Quota is checked and the counter incremented in **one atomic transaction** to avoid the classic race where two
concurrent jobs both pass the check. We upsert the period row and increment in a single statement, then read the
post-increment value to decide allow/block. For Business overage, we never block — we flag the unit as overage
so it is reported to Stripe (§5.4).

```typescript
// server/services/billing/metering.ts
import { sql } from 'drizzle-orm';
import { usage } from '../../db/schema';
import { planFor } from './plans';
import type { Tx } from '../../db/client';
import type { PlanTier } from '../../../shared/provenance';

export function currentPeriodMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7); // 'YYYY-MM'
}

export interface QuotaDecision {
  allowed: boolean;
  isOverage: boolean;        // true => allowed but billable as overage (Business)
  used: number;              // deep_analyses AFTER this reservation
  quota: number;             // included quota for the plan
  remaining: number;         // max(0, quota - used)
}

/**
 * Atomically reserve one deep analysis against the user's monthly quota.
 * MUST be called inside the request/job transaction, BEFORE any Gemini synthesis.
 * Increments first, then evaluates — for non-overage plans a blocked attempt is rolled
 * back by the caller (throw QuotaExceeded -> tx aborts -> counter restored).
 */
export async function reserveDeepAnalysis(
  tx: Tx, userId: string, plan: PlanTier,
): Promise<QuotaDecision> {
  const period = currentPeriodMonth();
  const cfg = planFor(plan);

  // Upsert + atomic increment; return the new value.
  const [row] = await tx
    .insert(usage)
    .values({ userId, periodMonth: period, deepAnalyses: 1 })
    .onConflictDoUpdate({
      target: [usage.userId, usage.periodMonth],
      set: { deepAnalyses: sql`${usage.deepAnalyses} + 1`, updatedAt: sql`now()` },
    })
    .returning({ used: usage.deepAnalyses });

  const used = row.used;
  const quota = cfg.deepAnalysisQuota;
  const overQuota = used > quota;

  if (!overQuota) {
    return { allowed: true, isOverage: false, used, quota, remaining: Math.max(0, quota - used) };
  }
  if (cfg.allowOverage) {
    // Business: allowed but this unit is billable overage (reported to Stripe in §5.4).
    return { allowed: true, isOverage: true, used, quota, remaining: 0 };
  }
  // Hard wall: signal the caller to abort the txn (rolls back the increment).
  return { allowed: false, isOverage: false, used, quota, remaining: 0 };
}
```

### 3.3 Quota gate middleware (the "upgrade-needed" 429)
A thin gate runs at the boundary for the **analysis-creation** route only (classification has its own cheap
`classificationQuota` check using the same pattern). It does a *cheap pre-check* read so the client gets a fast
`QUOTA_EXCEEDED` with the upgrade state, while the **authoritative** reservation still happens transactionally
inside the job (§3.2) — the middleware is UX, the txn is truth.

```typescript
// server/middleware/quota.ts
import type { RequestHandler } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { usage } from '../db/schema';
import { planFor } from '../services/billing/plans';
import { currentPeriodMonth } from '../services/billing/metering';
import { AppError } from '../http/errors';

/** Pre-check gate for POST /api/v1/analysis (deep analysis). Server-truth = the txn reservation in the job. */
export const requireDeepAnalysisQuota: RequestHandler = async (req, _res, next) => {
  const { userId, plan } = req.auth; // set by auth.ts (foundation §3.2)
  const cfg = planFor(plan);
  if (cfg.allowOverage) return next(); // Business never blocked here

  const period = currentPeriodMonth();
  const [row] = await db
    .select({ used: usage.deepAnalyses })
    .from(usage)
    .where(and(eq(usage.userId, userId), eq(usage.periodMonth, period)))
    .limit(1);

  const used = row?.used ?? 0;
  if (used >= cfg.deepAnalysisQuota) {
    // 429 QUOTA_EXCEEDED with an actionable upgrade state (foundation §3.4 error taxonomy).
    throw new AppError('QUOTA_EXCEEDED', 'You have used all deep analyses in your plan this month.', {
      used, quota: cfg.deepAnalysisQuota, plan,
      upgrade: { needed: true, suggestedPlan: plan === 'free' ? 'starter' : plan === 'starter' ? 'growth' : 'business' },
      resetsAt: nextResetIso(),
    });
  }
  return next();
};

/** UTC monthly reset boundary — first day of next month, 00:00 UTC. */
export function nextResetIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
```

`AppError('QUOTA_EXCEEDED', …)` maps to **HTTP 429** with error code `QUOTA_EXCEEDED` per foundation §3.4. The
`details.upgrade` object drives the Plan UI quota wall (§7).

### 3.4 Monthly reset
Quota is **period-scoped, not decremented** — the period is the billing month string `YYYY-MM`. A new month =
a new `usage` row (the `onConflictDoUpdate` in §3.2 inserts it lazily on first use), so reset is free and needs
no cron for the gate itself. We align the *display* reset (`resetsAt`) to the Stripe **billing period** for paid
plans (use `subscriptions.current_period_end` when present; fall back to calendar UTC month for Free). A nightly
reconcile job (§5.5) verifies no row is stuck on a stale period.

> **Calendar vs billing period note:** Free uses calendar UTC month. Paid plans ideally reset on
> `current_period_end`. v1 keeps the meter keyed on calendar `YYYY-MM` for simplicity and shows `resetsAt` from
> the subscription period when available; if a future experiment needs strict anniversary-based metering, switch
> the period key to a `subscriptionPeriodId` — a config change in `currentPeriodMonth`, no schema change.

### 3.5 How usage maps to Stripe
- **Base subscription:** flat recurring Price per tier (`stripePriceId`). Quota is enforced **by us** (above),
  not by Stripe — Stripe only knows "this customer is on the Growth Price."
- **Overage (Business):** each overage unit (`QuotaDecision.isOverage === true`) is reported to Stripe as a
  **usage record** on the metered Price (`stripeOveragePriceId`) at the moment of reservation (§5.4). Stripe
  aggregates and bills at period end. We also accumulate `usage.cogs_micro_usd` for our own COGS dashboard
  (independent of what we bill).

---

## 4. Stripe integration — endpoints (real TypeScript)

Stripe client + shared helpers. Secrets from env (foundation §5.3: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
Stripe Tax is enabled on Checkout for cross-border SaaS VAT/GST (skill DoD).

```typescript
// server/services/billing/stripe.ts
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY missing');

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia', // pin the API version (deterministic webhook payloads)
  appInfo: { name: 'Trade-for-All', version: '1.0.0' },
});

/** Find-or-create the Stripe Customer for a user, persisted on subscriptions.stripeCustomerId. */
export async function ensureStripeCustomer(args: {
  userId: string; email: string; companyName?: string | null; existingCustomerId?: string | null;
}): Promise<string> {
  if (args.existingCustomerId) return args.existingCustomerId;
  const customer = await stripe.customers.create({
    email: args.email,
    name: args.companyName ?? undefined,
    metadata: { app_user_id: args.userId }, // lets webhooks resolve our user from the Customer
  });
  return customer.id;
}
```

### 4.1 Create Checkout Session — `POST /api/v1/billing/checkout`
```typescript
// server/routes/billing.ts (excerpt)
import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { stripe, ensureStripeCustomer } from '../services/billing/stripe';
import { PLANS, planFor } from '../services/billing/plans';
import { withUserTx } from '../db/rls';
import { subscriptions } from '../db/schema';
import { validate } from '../middleware/validate';
import { ok } from '../http/envelope';
import { AppError } from '../http/errors';

export const billingRouter = Router();

const checkoutBody = z.object({
  plan: z.enum(['starter', 'growth', 'business']), // cannot "checkout" free
});

billingRouter.post('/checkout', validate({ body: checkoutBody }), async (req, res) => {
  const { userId, email, role } = req.auth;
  const { plan } = req.body as z.infer<typeof checkoutBody>;
  const cfg = planFor(plan);
  if (!cfg.stripePriceId) throw new AppError('VALIDATION_FAILED', 'Plan is not purchasable.');

  const customerId = await withUserTx({ userId, role }, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
    const customerId = await ensureStripeCustomer({
      userId, email, existingCustomerId: sub?.stripeCustomerId ?? null,
    });
    // Persist customer id immediately (idempotent across retries) so we never orphan a Stripe customer.
    if (!sub) {
      await tx.insert(subscriptions).values({ userId, stripeCustomerId: customerId, plan: 'free', status: 'incomplete' });
    } else if (!sub.stripeCustomerId) {
      await tx.update(subscriptions).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(subscriptions.userId, userId));
    }
    return customerId;
  });

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: cfg.stripePriceId!, quantity: 1 }];
  // Business: attach the metered overage Price (quantity omitted for metered items).
  if (cfg.allowOverage && cfg.stripeOveragePriceId) lineItems.push({ price: cfg.stripeOveragePriceId });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: lineItems,
    subscription_data: cfg.trialDays > 0 ? { trial_period_days: cfg.trialDays } : undefined,
    automatic_tax: { enabled: true },                 // Stripe Tax (cross-border SaaS)
    customer_update: { address: 'auto', name: 'auto' },
    allow_promotion_codes: true,
    client_reference_id: userId,                      // resolve our user in checkout.session.completed
    metadata: { app_user_id: userId, target_plan: plan },
    success_url: `${process.env.APP_BASE_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_BASE_URL}/pricing?canceled=1`,
  });

  return res.json(ok({ url: session.url }, req));
});
```

### 4.2 Create Customer Portal Session — `POST /api/v1/billing/portal`
```typescript
billingRouter.post('/portal', async (req, res) => {
  const { userId, role } = req.auth;
  const customerId = await withUserTx({ userId, role }, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
    return sub?.stripeCustomerId ?? null;
  });
  if (!customerId) throw new AppError('NOT_FOUND', 'No billing account for this user yet.');

  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.APP_BASE_URL}/account/billing`,
  });
  return res.json(ok({ url: portal.url }, req));
});
```

The Customer Portal handles **plan changes (with proration), cancellation, payment-method updates, and invoice
history** out of the box — we do not rebuild these. All resulting state changes flow back through the webhook
(§5), keeping Stripe as the single source of truth.

### 4.3 Read current plan + usage — `GET /api/v1/billing/me`
```typescript
billingRouter.get('/me', async (req, res) => {
  const { userId, role, plan } = req.auth;
  const cfg = planFor(plan);
  const data = await withUserTx({ userId, role }, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
    const [u] = await tx.select().from(usage)
      .where(and(eq(usage.userId, userId), eq(usage.periodMonth, currentPeriodMonth()))).limit(1);
    const used = u?.deepAnalyses ?? 0;
    return {
      plan, status: sub?.status ?? 'active',
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      quota: { deepAnalyses: cfg.deepAnalysisQuota, used, remaining: Math.max(0, cfg.deepAnalysisQuota - used) },
      allowOverage: cfg.allowOverage,
      resetsAt: sub?.currentPeriodEnd?.toISOString() ?? nextResetIso(),
    };
  });
  return res.json(ok(data, req));
});
```

> `req.auth.plan` comes from the verified Firebase custom claim (foundation §3.2), which the webhook keeps in
> sync (§5). It is **never** trusted from the client.

---

## 5. Stripe webhook handler — idempotent, claim-setting (real TypeScript)

### 5.1 Mounting (raw body for signature verification)
The webhook route is mounted with the **raw body parser** BEFORE the global JSON parser, because Stripe
signature verification needs the exact bytes:

```typescript
// server/app.ts (excerpt) — order matters
import express from 'express';
import { stripeWebhookHandler } from './routes/stripeWebhook';

app.post('/api/v1/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
// ... AFTER this line, the normal app.use(express.json()) for everything else.
```

### 5.2 Handler — verify, dedupe (foundation §3.7 / ADR-014), dispatch, set claims
Dedup uses the foundation `events` table: `type = 'webhook'`, `dedupeKey = stripe_event_id` (the
`events_dedupe_uq` unique index makes replays a no-op). Everything — DB mirror update + custom-claim set —
happens inside one `withUserTx`-style service transaction so a partial failure rolls back and Stripe retries.

```typescript
// server/routes/stripeWebhook.ts
import type { RequestHandler } from 'express';
import type Stripe from 'stripe';
import { stripe } from '../services/billing/stripe';
import { handleStripeEvent } from '../services/billing/webhookEvents';

export const stripeWebhookHandler: RequestHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig as string, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    // Bad signature => 400, do NOT process. (Never trust an unverified webhook.)
    return res.status(400).send(`Webhook signature verification failed: ${(err as Error).message}`);
  }

  try {
    await handleStripeEvent(event);          // idempotent inside (dedupe on event.id)
    return res.status(200).json({ received: true });
  } catch (err) {
    // Transient failure => 5xx so Stripe retries (handler is idempotent, safe to replay).
    console.error('[stripe webhook] processing error', event.id, err);
    return res.status(500).json({ error: 'processing_failed' });
  }
};
```

```typescript
// server/services/billing/webhookEvents.ts
import type Stripe from 'stripe';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { stripe } from './stripe';
import { subscriptions, users, events } from '../../db/schema';
import { tierForPriceId } from './plans';
import { setPlanClaims } from './claims';
import type { PlanTier } from '../../../shared/provenance';

const RELEVANT = new Set<Stripe.Event['type']>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (!RELEVANT.has(event.type)) return; // ignore noise; still 200 so Stripe stops resending

  await db.transaction(async (tx) => {
    // --- Idempotency / dedupe (foundation §3.7, events_dedupe_uq) ---
    const inserted = await tx
      .insert(events)
      .values({ type: 'webhook', dedupeKey: event.id, payload: { stripeType: event.type } })
      .onConflictDoNothing({ target: events.dedupeKey })
      .returning({ id: events.id });
    if (inserted.length === 0) return; // already processed this event.id -> no-op

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        // Subscription details are authoritative on the subscription object; fetch + reuse the upsert path.
        if (s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await upsertFromSubscription(tx, sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertFromSubscription(tx, event.data.object as Stripe.Subscription);
        break;
      }
      case 'invoice.paid': {
        // Healthy payment -> ensure status active (covers recovery from past_due/dunning).
        const inv = event.data.object as Stripe.Invoice;
        if (inv.subscription) {
          const sub = await stripe.subscriptions.retrieve(inv.subscription as string);
          await upsertFromSubscription(tx, sub);
        }
        break;
      }
      case 'invoice.payment_failed': {
        // Dunning: mark past_due. Stripe Smart Retries + dunning emails drive recovery; we keep entitlement
        // through the grace window (status stays past_due, claim unchanged) until subscription is canceled.
        const inv = event.data.object as Stripe.Invoice;
        if (inv.subscription) {
          await tx.update(subscriptions)
            .set({ status: 'past_due', updatedAt: new Date() })
            .where(eq(subscriptions.stripeSubscriptionId, inv.subscription as string));
        }
        break;
      }
    }
  });
}

/** Single mirror path: Stripe subscription -> subscriptions row + Firebase custom claims. */
async function upsertFromSubscription(tx: typeof db | any, sub: Stripe.Subscription): Promise<void> {
  // Resolve our user via customer metadata (set in ensureStripeCustomer) or stored mapping.
  const customer = await stripe.customers.retrieve(sub.customer as string);
  const appUserId = !('deleted' in customer) ? (customer.metadata?.app_user_id ?? null) : null;
  if (!appUserId) throw new Error(`No app_user_id on customer ${sub.customer}`);

  // Derive plan from the non-metered base line item's Price.
  const basePrice = sub.items.data.find((i) => i.price.recurring?.usage_type !== 'metered')?.price.id;
  const plan: PlanTier =
    sub.status === 'canceled' || sub.status === 'incomplete_expired'
      ? 'free'
      : (basePrice ? tierForPriceId(basePrice) : null) ?? 'free';

  const status = mapStatus(sub.status);

  await tx
    .insert(subscriptions)
    .values({
      userId: appUserId,
      stripeCustomerId: sub.customer as string,
      stripeSubscriptionId: sub.id,
      plan, status,
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        stripeSubscriptionId: sub.id, plan, status,
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        updatedAt: new Date(),
      },
    });

  // Mirror plan onto users.plan (foundation §2) for queries that don't read claims.
  await tx.update(users).set({ plan, updatedAt: new Date() }).where(eq(users.id, appUserId));

  // SOURCE-OF-TRUTH ENTITLEMENT: set Firebase custom claims (plan + role). Replaces hardcoded admin email.
  const [u] = await tx.select({ firebaseUid: users.firebaseUid, role: users.role }).from(users).where(eq(users.id, appUserId)).limit(1);
  await setPlanClaims(u.firebaseUid, { plan, role: u.role });
}

function mapStatus(s: Stripe.Subscription.Status) {
  switch (s) {
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'unpaid': return 'unpaid';
    case 'incomplete': return 'incomplete';
    case 'canceled':
    case 'incomplete_expired': return 'canceled';
    default: return 'active';
  }
}
```

### 5.3 Setting Firebase custom claims (entitlements) — ADR-006
This is the line that **deletes the hardcoded admin email** in `firestore.rules`: role + plan become
server-set claims, the webhook is the only writer of `plan`, and admin is provisioned as a claim (Phase 0).

```typescript
// server/services/billing/claims.ts
import { getAuth } from 'firebase-admin/auth';
import type { PlanTier } from '../../../shared/provenance';

/** Merge plan/role claims without clobbering other claims. Forces token refresh on next client call. */
export async function setPlanClaims(firebaseUid: string, claims: { plan: PlanTier; role: string }): Promise<void> {
  const auth = getAuth();
  const user = await auth.getUser(firebaseUid);
  const existing = user.customClaims ?? {};
  await auth.setCustomUserClaims(firebaseUid, { ...existing, plan: claims.plan, role: claims.role });
  // Optionally bump a 'claimsUpdatedAt' so the client knows to force-refresh the ID token.
  await auth.setCustomUserClaims(firebaseUid, { ...existing, plan: claims.plan, role: claims.role, claimsUpdatedAt: Date.now() });
}
```

The client must call `getIdToken(true)` (force refresh) after returning from Checkout/Portal so the new claim
is in the bearer token; `auth.ts` reads `plan`/`role` straight off the verified token (foundation §3.2). The
new Firestore rules use `request.auth.token.role == 'admin'` instead of the email check — that change is in the
file-level list (§8) but the rule edit itself is Phase-0/Phase-1 plumbing referenced here.

### 5.4 Reporting overage usage to Stripe
When `reserveDeepAnalysis` returns `isOverage: true` (Business beyond 600), report one usage unit to the
metered subscription item. Done **after** the txn commits (so we don't report for a rolled-back analysis), with
its own idempotency on the analysis job id:

```typescript
// server/services/billing/overage.ts
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { stripe } from './stripe';
import { subscriptions } from '../../db/schema';

export async function reportOverageUnit(userId: string, jobId: string): Promise<void> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  if (!sub?.stripeSubscriptionId) return;
  const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const meteredItem = s.items.data.find((i) => i.price.recurring?.usage_type === 'metered');
  if (!meteredItem) return;
  await stripe.subscriptionItems.createUsageRecord(
    meteredItem.id,
    { quantity: 1, timestamp: Math.floor(Date.now() / 1000), action: 'increment' },
    { idempotencyKey: `overage:${jobId}` }, // Stripe-side idempotency: one unit per job, even on retry
  );
}
```

### 5.5 Reconciliation job (drift guard)
A nightly pg-boss job (ADR-002) lists active Stripe subscriptions, re-derives plan/status, and corrects any
`subscriptions` row + custom claim that drifted (e.g. a webhook was permanently dropped). It also clears stale
`usage` rows and verifies metered overage was reported. This satisfies the skill DoD "reconciliation job in
place" and protects against missed webhooks.

---

## 6. Cost controls (BUILD_PLAN §9)

### 6.1 Two-level circuit breaker
1. **Per-user** — the quota gate (§3) is already the per-user cost cap: a Free user physically cannot trigger
   more than 3 cache-miss syntheses/month. Overage on Business is bounded by willingness-to-pay (they're paying
   $0.90/unit). Per-user rate limit (foundation `rateLimit.ts`) caps burst.
2. **Global cost circuit-breaker** — protects margin during a cache-miss storm or abuse spike. Tracks USD/min
   of *outbound LLM spend* across all users; when it exceeds `COST_BREAKER_USD_PER_MIN` (foundation §5.3 env),
   it **trips**: new cache-miss deep analyses are **degraded** — served from stale cache if available, otherwise
   **queued** (`analysis_jobs` stays `queued`, SSE shows "high demand, queued") instead of firing unbounded
   Gemini calls. Fresh cache hits and approved overrides are NEVER blocked (they're free).

### 6.2 Implementation (sliding-window counter + trip behavior)
```typescript
// server/middleware/costBreaker.ts  (foundation §5.1 names this file)
import { AppError } from '../http/errors';

/** Sliding 60s window of micro-USD spent on Gemini. In-process for the single deployable (ADR-001/5.2);
 *  for multi-instance, back this with a Postgres counter or Supabase advisory counter — interface unchanged. */
class CostBreaker {
  private windowMs = 60_000;
  private spend: Array<{ at: number; microUsd: number }> = [];
  private trippedUntil = 0;

  private thresholdMicroUsd = Number(process.env.COST_BREAKER_USD_PER_MIN ?? '5') * 1_000_000; // default $5/min

  /** Call when a Gemini call's cost is known (also feeds COGS, §6.4). */
  record(microUsd: number) {
    const now = Date.now();
    this.spend.push({ at: now, microUsd });
    this.prune(now);
    if (this.currentSpend(now) > this.thresholdMicroUsd) {
      this.trippedUntil = now + 30_000; // stay tripped 30s; re-evaluate as window drains
    }
  }

  isOpen(now = Date.now()): boolean {
    this.prune(now);
    if (now < this.trippedUntil) return true;
    return this.currentSpend(now) > this.thresholdMicroUsd;
  }

  private prune(now: number) { this.spend = this.spend.filter((e) => now - e.at <= this.windowMs); }
  private currentSpend(now: number) { return this.spend.reduce((s, e) => s + e.microUsd, 0); }
}

export const costBreaker = new CostBreaker();

/** Guard the EXPENSIVE synthesis path only. Cheap cache hits bypass this entirely. */
export function assertCostBudgetOrDegrade(opts: { canServeStale: boolean }): void {
  if (!costBreaker.isOpen()) return;
  if (opts.canServeStale) return;       // caller serves stale cache + a "showing cached" flag (BUILD_PLAN §4.6)
  // No stale fallback -> degrade to queued, surfaced as COST_CIRCUIT_OPEN (foundation §3.4 -> HTTP 503).
  throw new AppError('COST_CIRCUIT_OPEN', 'Service is under heavy demand. Your analysis has been queued.');
}
```

### 6.3 Wiring into the analysis path
At the start of a deep-analysis job, after the cache/correction check and quota reservation, but **before**
Gemini synthesis:
```
fresh hit / approved override          → serve (free, breaker irrelevant)
miss/stale:
  reserveDeepAnalysis(tx)              → block / overage / allow
  assertCostBudgetOrDegrade({canServeStale})
     breaker open + stale available    → serve stale + "showing cached, revalidating" (graceful, BUILD_PLAN §4.6)
     breaker open + no stale           → COST_CIRCUIT_OPEN -> job stays queued, SSE 'status: queued', retried by worker when window drains
     breaker closed                    → synthesize; on each Gemini call, costBreaker.record(microUsd) + accumulate usage.cogs_micro_usd
```

### 6.4 COGS/request dashboard metric (events table)
Every Gemini call writes a `cogs` event and increments the period meter, so margin is queryable:
- On each synthesis: `events.insert({ type: 'cogs', userId, payload: { jobId, model, microUsd, cacheHit: false } })`
  and `UPDATE usage SET cogs_micro_usd = cogs_micro_usd + $micro`.
- **Dashboard queries (admin-only, RLS-restricted reads on `events`, foundation §2):**
  - **COGS/request:** `SUM(payload->>'microUsd') / COUNT(*)` over `type='cogs'` in window.
  - **COGS/analysis trend:** group by day; must trend down as routes saturate (BUILD_PLAN §0).
  - **Cache-hit-rate SLO:** `count(type='cache_hit') / (count('cache_hit') + count('cache_miss'))`. **SLO ≥60%
    (target 80%)** per BUILD_PLAN §0; alert if a rolling 24h window drops below 60%.
  - **Margin per tier:** join `events.cogs` → `users.plan` vs plan price.

### 6.5 Cache-hit-rate SLO
Tracked as a first-class SLO (BUILD_PLAN §9). Below 60% over 24h → page `devops-engineer`; sustained low hit
rate is the trigger to invest in cache pre-warming (BUILD_PLAN §4.3) or to re-price (margin erosion). The
breaker threshold `COST_BREAKER_USD_PER_MIN` and the hit-rate SLO are reviewed together — a tripping breaker
plus a low hit-rate means a route-coverage problem, not an abuse problem.

---

## 7. Plan UI (growth-pricing + ui-ux-designer)

All client surfaces read plan/usage from `GET /api/v1/billing/me` (§4.3) — server-truth, never local state.

### 7.1 Pricing page (`/pricing`)
- Four tier cards (§2.2 table): price, deep-analysis quota, markets/analysis, BYOK, overage note.
- **Trust/conversion asset (growth-pricing):** feature the WTO BYOK "verified data" badge on Growth/Business —
  it's a differentiator, not a footnote.
- CTA per card → `POST /api/v1/billing/checkout` → redirect to `session.url`. Current plan card shows
  "Current plan" + a "Manage billing" button → `POST /api/v1/billing/portal`.
- Annual toggle (optional) maps to annual Price IDs — config-only addition.

### 7.2 Upgrade flow
1. User clicks a paid tier → `POST /billing/checkout` → Stripe-hosted Checkout (no card data touches us).
2. Success URL `/billing/success?session_id=…` → client calls `getIdToken(true)` to refresh claims, polls
   `GET /billing/me` until `plan` reflects the purchase (webhook lands within seconds; show a brief
   "activating your plan…" state — never assert success from the client).
3. Cancel URL `/pricing?canceled=1` → no state change.

### 7.3 Usage display states (the quota wall — converts without nagging)
Driven by `billing/me.quota` and the `QUOTA_EXCEEDED` 429 `details.upgrade`:
- **Healthy** (`remaining > 20%`): subtle "12 of 30 deep analyses used this month" meter in account/header.
- **Approaching** (`remaining ≤ 20%`, > 0): amber meter + soft "Running low — upgrade for more" link. **No
  modal, no nag** (anti-pattern: dark-pattern upgrade nags).
- **Exhausted** (Free/Starter/Growth): the analysis CTA becomes an **upgrade wall** card: "You've used all N
  deep analyses this month. Resets {resetsAt}. Upgrade to {suggestedPlan} for {nextQuota}." with one Upgrade
  button and one "wait until reset" affordance. Cached/previously-run analyses remain readable (BUILD_PLAN §4.6).
- **Business overage active:** info banner "You're past your included 600 — additional analyses bill at
  $0.90 each, shown on your next invoice." (transparent, never silent).
- **Cost-circuit degraded** (`COST_CIRCUIT_OPEN` / queued): "High demand — your analysis is queued and will run
  shortly" + cached results stay visible. Not framed as the user's fault or a quota issue.

---

## 8. Legal / compliance pass (legal-compliance-privacy lens)

> **Framing:** this persona flags risk and enforces safe defaults; it is **not** a substitute for a licensed
> lawyer. Items marked **[LAWYER]** require sign-off before charging.

### 8.1 GDPR essentials
- **Lawful basis + minimization (Art. 5/6):** collect only signup identity (email, display name), company
  profile (optional), `user_products` history, BYOK key ciphertext, billing IDs. No data "just in case."
  Document purpose per field.
- **Right to access / export (Art. 15/20):** `GET /api/v1/account/export` returns a JSON bundle of the user's
  `users`, `user_products`, `subscriptions` (IDs only), `usage`, and their private `embeddings`/analyses.
  Implementable from the per-tenant `user_id` scope (foundation RLS).
- **Right to erasure (Art. 17):** `DELETE /api/v1/account` → cascade-delete the user's tenant rows
  (foundation schema already uses `onDelete: 'cascade'` on `user_id` FKs), revoke BYOK keys, delete the Firebase
  user, and **cancel the Stripe subscription** + delete the Stripe Customer (or retain per legal/tax retention —
  see retention). Shared reference data (`hs_code_data`, shared `embeddings`) is non-personal and retained.
- **Data retention policy:** define + publish — e.g. `user_products`/analyses retained while account active +
  30 days post-deletion (backups), billing records retained per **tax law (typically 7 years)** even after
  account deletion (legal obligation overrides erasure for invoices — document this carve-out). **[LAWYER]**
- **Sub-processors / DPA:** maintain a published sub-processor list — **Stripe** (payments), **Google/Firebase**
  (auth, Gemini), **Supabase** (DB host, ADR-003), **GCP KMS** (crypto). Sign/accept each vendor's **DPA**;
  Stripe and Google offer standard DPAs + SCCs for cross-border transfer. **[LAWYER]**
- **Breach plan:** documented incident response (detect → contain → notify within **72h** to supervisory
  authority per Art. 33 where applicable). BYOK key compromise path: revoke + rotate + notify affected users.
- **Consent / cookies:** signup requires explicit accept of ToS + Privacy Policy (checkbox, logged with
  timestamp + version). Analytics/cookies banner only if non-essential cookies are used.

### 8.2 Trade-data disclaimers (with trade-customs-expert)
- **Decision-support, not legal advice:** every analysis result and exported report carries the disclaimer:
  *"This analysis is decision-support, not legal or customs advice. Verify all duties, classifications, and
  regulations with a licensed customs broker or the relevant authority before acting."*
- **Every-number-sourced framing:** consistent with BUILD_PLAN §0 (100% sourced) and foundation §4 provenance —
  every figure shows its source + "last verified: <date>" + confidence band; "data unavailable" is a designed
  state, never a guess. The disclaimer reinforces that sourced ≠ guaranteed-current.
- **No accuracy guarantee:** ToS explicitly disclaims warranty of fitness; liability cap. **[LAWYER]**

### 8.3 Privacy Policy + ToS requirements (must be published + accept-gated)
Privacy Policy covers: data collected + purpose; lawful basis; retention; sub-processors; data-subject rights +
how to exercise (export/delete); international transfer mechanism; security measures; contact/DPO. ToS covers:
service description; **trade-advice disclaimer + liability limitation + no-warranty**; acceptable use;
**billing terms** (subscription, auto-renewal, overage at $0.90/unit, taxes via Stripe Tax, refunds/cancellation
via Customer Portal); BYOK terms (user responsible for their WTO/Comtrade key + its ToS); termination; governing
law. **[LAWYER]** for final wording.

### 8.4 Third-party ToS — caching / redistribution check (must be documented before launch)
| Provider | What we cache/redistribute | Question to resolve | Status |
|---|---|---|---|
| **WTO Timeseries API** | public tariff facts in shared `hs_code_data` cache, re-served to other users (BUILD_PLAN §6) | Does WTO ToS permit caching + redistribution of public tariff data across users? Per-user BYOK key used for fetch. | **[LAWYER] — verify before launch** |
| **UN Comtrade** | derived trade-flow figures cached + re-served | Comtrade attribution + redistribution terms; attribution string shown? | **[LAWYER]** |
| **Gemini API** | synthesized output cached + re-served | Google GenAI terms on storing/redistributing model output; no PII in prompts | **[LAWYER]** |
> The shared-cache margin model (BUILD_PLAN §8) **depends** on these answers. If WTO/Comtrade forbids
> cross-user redistribution, fall back to per-user caching (still allowed) — a `corpus_scope` change
> (`shared`→`private`), no schema change. This risk MUST be closed before charging.

### 8.5 Pre-charge launch checklist (everything that MUST be live before the first charge)
- [ ] Privacy Policy published, versioned, linked in footer + accept-gated at signup (logged consent).
- [ ] Terms of Service published, versioned, accept-gated; includes billing terms + disclaimer + liability cap. **[LAWYER]**
- [ ] Trade-advice disclaimer rendered on every analysis result + every exported report.
- [ ] GDPR data **export** endpoint (`/account/export`) live + tested.
- [ ] GDPR data **deletion** endpoint (`/account`) live + tested (cascades + Stripe cancel + Firebase delete + key revoke).
- [ ] Data retention policy documented + published (incl. 7-yr billing/tax carve-out). **[LAWYER]**
- [ ] Sub-processor list published; DPAs signed/accepted (Stripe, Google, Supabase, GCP KMS). **[LAWYER]**
- [ ] WTO / Comtrade / Gemini caching+redistribution ToS verified + documented (§8.4). **[LAWYER]**
- [ ] Breach/incident response plan documented (incl. BYOK key compromise; 72h notification).
- [ ] Stripe Tax enabled + tax registration confirmed for selling jurisdictions. **[LAWYER]**
- [ ] No raw card data anywhere (Checkout/Portal only); confirmed in security review.
- [ ] PII + BYOK keys encrypted at rest (KMS, ADR-004) + in transit (HTTPS/HSTS, BUILD_PLAN §7).
- [ ] Security gate (SAST/DAST) on the billing endpoints + webhook (BUILD_PLAN §7 "pen-test before charging").

---

## 9. File-level change list

> Per foundation §5.1 layout. **No code is written in this spec** — this is the build manifest for the phase.

**New files:**
- `server/services/billing/stripe.ts` — Stripe client + `ensureStripeCustomer` (§4).
- `server/services/billing/plans.ts` — `PLANS` config, `planFor`, `tierForPriceId` (§2.4).
- `server/services/billing/metering.ts` — `reserveDeepAnalysis`, `currentPeriodMonth` (§3.2).
- `server/services/billing/webhookEvents.ts` — `handleStripeEvent`, `upsertFromSubscription` (§5.2).
- `server/services/billing/claims.ts` — `setPlanClaims` (Firebase custom claims, §5.3).
- `server/services/billing/overage.ts` — `reportOverageUnit` (§5.4).
- `server/services/billing/reconcile.ts` — nightly reconciliation pg-boss handler (§5.5).
- `server/routes/billing.ts` — `/checkout`, `/portal`, `/me` (§4). (Foundation §5.1 already lists `billing.ts`.)
- `server/routes/stripeWebhook.ts` — raw-body webhook handler (§5.1/5.2).
- `server/routes/account.ts` — `/account/export`, `DELETE /account` (GDPR, §8.1). (Already in foundation §5.1.)
- `server/middleware/quota.ts` — `requireDeepAnalysisQuota`, `nextResetIso` (§3.3).
- `src/pages/Pricing.tsx` — pricing page + Checkout/Portal CTAs (§7.1/7.2).
- `src/pages/BillingSuccess.tsx` — post-checkout claim-refresh + poll (§7.2).
- `src/pages/account/Billing.tsx` — plan + usage + manage-billing (§7.3).
- `src/components/QuotaWall.tsx` — exhausted/approaching/overage/degraded states (§7.3).
- `src/components/UsageMeter.tsx` — header/account usage meter.
- `src/components/TradeDisclaimer.tsx` — disclaimer banner (§8.2), rendered on every result.
- `public/legal/privacy-policy.md` + `public/legal/terms.md` (or DB-backed versioned docs) — §8.3.

**Modified files:**
- `server/app.ts` — mount `express.raw` webhook route BEFORE `express.json`; mount `billingRouter`,
  `accountRouter` under `/api/v1` (§5.1).
- `server/middleware/costBreaker.ts` — `CostBreaker` + `assertCostBudgetOrDegrade` (§6.2). (File named in
  foundation §5.1; this phase implements it.)
- `server/jobs/deepAnalysis.ts` (Phase 2 job) — insert quota reservation + cost-breaker gate + cogs/usage
  recording into the synthesis path (§3.1, §6.3); call `reportOverageUnit` post-commit on overage.
- `server/middleware/auth.ts` — read `plan` claim into `req.auth.plan` (foundation already specifies this; this
  phase makes the claim authoritative via the webhook).
- `server/routes/analysis.ts` — add `requireDeepAnalysisQuota` to the deep-analysis POST.
- `firestore.rules` — **delete** the hardcoded `amankr4883@gmail.com` `isAdmin()` check; replace with
  `request.auth.token.role == 'admin'` (claim-based, ADR-006). (Plumbing introduced Phase 0; finalized here.)
- `server/db/schema.ts` — **no change** (consumes `subscriptions`/`usage`/`events` from foundation §2 verbatim).
- `.env` / Secret Manager — add `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_BUSINESS`,
  `STRIPE_PRICE_BUSINESS_OVERAGE`, `APP_BASE_URL` (alongside existing `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `COST_BREAKER_USD_PER_MIN` from foundation §5.3).

---

## 10. Test plan (QA gate — BUILD_PLAN §11)

### 10.1 Stripe test-mode upgrade e2e (the exit metric)
1. Seed a Free user (claims `{plan:'free'}`), exhaust 3 deep analyses → 4th returns **429 QUOTA_EXCEEDED** with
   `details.upgrade.suggestedPlan === 'starter'`.
2. `POST /billing/checkout {plan:'starter'}` → assert a Checkout `url`; complete with Stripe **test card
   `4242 4242 4242 4242`** (use Stripe CLI `stripe trigger` or the hosted page in test mode).
3. Assert webhook `checkout.session.completed` + `customer.subscription.created` processed: `subscriptions` row
   = `{plan:'starter', status:'active'}`, `users.plan = 'starter'`, Firebase custom claim `plan === 'starter'`.
4. Client force-refreshes token; `GET /billing/me` shows Starter quota; the previously-blocked analysis now runs.
5. `POST /billing/portal` → assert portal `url`; cancel via portal → `customer.subscription.deleted` webhook →
   plan reverts to `free` at period end (`cancelAtPeriodEnd`/`canceled`), claim updated.

### 10.2 Webhook idempotency test
- Replay the **same** `checkout.session.completed` event id twice (Stripe CLI `--load` / resend) → assert the
  second is a no-op (`events_dedupe_uq` blocks; `subscriptions`/claims unchanged; exactly one `events` row).
- Out-of-order test: deliver `subscription.updated` before `subscription.created` → final state still correct
  (handler derives from the subscription object each time, last-write-by-Stripe-state wins).
- Bad signature → 400, no DB mutation. Transient handler error → 500 so Stripe retries; retry succeeds (no
  double-apply).

### 10.3 Quota enforcement test (server-truth + race)
- **Concurrency:** fire 5 simultaneous deep-analysis requests on a Free user with `remaining = 2` → exactly 2
  succeed, 3 get `QUOTA_EXCEEDED` (atomic `reserveDeepAnalysis` increment, no over-grant).
- **Cache-hit not metered:** a fresh cache hit does NOT increment `usage.deep_analyses`.
- **Client-tamper:** a forged client `plan` value is ignored — gate reads the verified claim/`usage` only.
- **Reset:** roll `period_month` forward → quota resets (new `usage` row).
- **Business overage:** exceed 600 → analysis still runs, `reportOverageUnit` called once per job
  (idempotent on `jobId`), `usage.cogs_micro_usd` accrues.

### 10.4 Cost circuit-breaker test
- Force `costBreaker.record` past `COST_BREAKER_USD_PER_MIN` → next miss with stale cache serves stale +
  "showing cached" flag; next miss with no stale → `COST_CIRCUIT_OPEN` (503) and job stays `queued`.
- After the 60s window drains → breaker closes → queued job runs.
- Fresh cache hit during a tripped breaker still serves (free path bypasses the breaker).

### 10.5 Compliance tests
- Disclaimer component renders on every analysis result + export (snapshot/DOM test).
- `GET /account/export` returns only the caller's tenant data (RLS scoped); `DELETE /account` cascades, cancels
  Stripe, deletes Firebase user, revokes BYOK keys; cross-tenant data untouched.
- Signup is blocked until ToS + Privacy accept checkbox is set; consent row logged with version + timestamp.

### 10.6 Security gate
- Webhook signature verification mandatory (no unsigned acceptance); no PAN/card data in DB or logs (grep
  audit); billing endpoints require auth + RBAC; admin dashboard reads on `events` are admin-claim-gated.
- SAST/DAST over billing routes + webhook before enabling live mode (BUILD_PLAN §7: pen-test before charging).

---

## 11. Open items / cross-persona handoffs
- **[LAWYER]** sign-off on all §8.5 items before live mode — blocking for the exit metric.
- **growth-pricing:** validate the §2.2 quota numbers + $0.90 overage against real `usage.cogs_micro_usd` after
  Phase 1/2 data exists; expect to re-price (config-only).
- **devops-engineer:** own the COGS/cache-hit dashboards (§6.4) + the `COST_BREAKER_USD_PER_MIN` threshold +
  multi-instance breaker backing (Postgres counter) if we scale past one instance.
- **frontend-engineer + ui-ux-designer:** build §7 surfaces against `billing/me`; enforce no-dark-pattern copy.
- **security-engineer + qa-tester:** §10.6 gate; no charge until passed.
```
