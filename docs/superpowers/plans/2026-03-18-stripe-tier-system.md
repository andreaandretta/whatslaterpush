# Stripe + Tier System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Stripe payments (Personal €4.99/mo, Business €19.99/mo) with tier-based message limits, trial→free downgrade, and cool-down anti-ban protection.

**Architecture:** Stripe Checkout Sessions for payments, Customer Portal for management. Plan limits enforced centrally via `app/lib/plans.ts`. Cron route handles daily limit enforcement, midnight reset, cool-down checks, trial expiry, and upsell notifications. DB migration adds `stripe_customer_id`, renames `subscription_status` to `subscription_plan` with new values, adds daily counters.

**Tech Stack:** Stripe SDK (already in package.json), Supabase (existing), Next.js API routes

**Existing code to replace:**
- `app/api/payment/create-checkout/route.ts` — outdated single-plan checkout
- `app/api/payment/webhook/route.ts` — outdated webhook with wrong column names
- `app/payment/page.tsx` — outdated payment page

---

## Chunk 1: DB Migration + Plans Module

### Task 1: Database Migration

**Files:**
- Migration via Supabase MCP tool

This migration:
1. Adds `stripe_customer_id`, `messages_sent_today`, `upsell_sent_today` columns to `user_instances`
2. Renames `subscription_status` to `subscription_plan` and updates CHECK constraint to `('trial', 'free', 'personal', 'business')`
3. Adds `paused` to `scheduled_messages` status CHECK constraint
4. Updates existing `active` values to `personal` (preserving any paying users)

- [ ] **Step 1: Run the migration**

```sql
-- 1. Add new columns to user_instances
ALTER TABLE user_instances
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS messages_sent_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upsell_sent_today boolean NOT NULL DEFAULT false;

-- 2. Drop old CHECK constraint on subscription_status
ALTER TABLE user_instances DROP CONSTRAINT IF EXISTS user_instances_subscription_status_check;

-- 3. Rename column subscription_status → subscription_plan
ALTER TABLE user_instances RENAME COLUMN subscription_status TO subscription_plan;

-- 4. Migrate existing values: 'active' → 'personal', 'expired' → 'free', 'cancelled' → 'free'
UPDATE user_instances SET subscription_plan = 'personal' WHERE subscription_plan = 'active';
UPDATE user_instances SET subscription_plan = 'free' WHERE subscription_plan IN ('expired', 'cancelled');

-- 5. Add new CHECK constraint with correct values
ALTER TABLE user_instances ADD CONSTRAINT user_instances_subscription_plan_check
  CHECK (subscription_plan IN ('trial', 'free', 'personal', 'business'));

-- 6. Add 'paused' to scheduled_messages status CHECK
ALTER TABLE scheduled_messages DROP CONSTRAINT IF EXISTS scheduled_messages_status_check;
ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'paused', 'awaiting_confirm', 'awaiting_time', 'awaiting_recipient'));
```

- [ ] **Step 2: Verify migration**

Run: `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'user_instances' ORDER BY ordinal_position;`

Expected: See `subscription_plan`, `stripe_customer_id`, `messages_sent_today`, `upsell_sent_today` columns.

- [ ] **Step 3: Verify existing data preserved**

Run: `SELECT phone_number, subscription_plan, messages_sent_today, stripe_customer_id FROM user_instances;`

Expected: All rows have valid `subscription_plan` values (trial/free/personal), `messages_sent_today = 0`, `stripe_customer_id = null`.

### Task 2: Plans Module

**Files:**
- Create: `app/lib/plans.ts`
- Test: `__tests__/plans.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/plans.test.ts
import { getPlanLimits, getPlanName } from '../app/lib/plans';

describe('getPlanLimits', () => {
  test('returns trial limits (same as personal)', () => {
    const limits = getPlanLimits('trial');
    expect(limits.dailyLimit).toBe(20);
    expect(limits.maxContacts).toBe(50);
    expect(limits.maxRetry).toBe(3);
    expect(limits.historyDays).toBe(30);
  });

  test('returns free limits', () => {
    const limits = getPlanLimits('free');
    expect(limits.dailyLimit).toBe(3);
    expect(limits.maxContacts).toBe(5);
    expect(limits.maxRetry).toBe(1);
    expect(limits.historyDays).toBe(7);
  });

  test('returns personal limits', () => {
    const limits = getPlanLimits('personal');
    expect(limits.dailyLimit).toBe(20);
    expect(limits.maxContacts).toBe(50);
    expect(limits.maxRetry).toBe(3);
    expect(limits.historyDays).toBe(30);
  });

  test('returns business limits', () => {
    const limits = getPlanLimits('business');
    expect(limits.dailyLimit).toBe(50);
    expect(limits.maxContacts).toBe(999999);
    expect(limits.maxRetry).toBe(3);
    expect(limits.historyDays).toBe(90);
  });

  test('defaults to free for unknown plans', () => {
    const limits = getPlanLimits('unknown');
    expect(limits.dailyLimit).toBe(3);
  });

  test('defaults to free for empty string', () => {
    const limits = getPlanLimits('');
    expect(limits.dailyLimit).toBe(3);
  });
});

describe('getPlanName', () => {
  test('returns Italian display name for each plan', () => {
    expect(getPlanName('free')).toBe('Free');
    expect(getPlanName('trial')).toBe('Trial');
    expect(getPlanName('personal')).toBe('Personal');
    expect(getPlanName('business')).toBe('Business');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/plans.test.ts --no-cache`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// app/lib/plans.ts
export interface PlanLimits {
  dailyLimit: number;
  maxContacts: number;
  maxRetry: number;
  historyDays: number;
}

const PLANS: Record<string, PlanLimits> = {
  trial:    { dailyLimit: 20, maxContacts: 50,     maxRetry: 3, historyDays: 30 },
  free:     { dailyLimit: 3,  maxContacts: 5,      maxRetry: 1, historyDays: 7  },
  personal: { dailyLimit: 20, maxContacts: 50,     maxRetry: 3, historyDays: 30 },
  business: { dailyLimit: 50, maxContacts: 999999, maxRetry: 3, historyDays: 90 },
};

const FREE = PLANS.free;

export function getPlanLimits(plan: string): PlanLimits {
  return PLANS[plan] || FREE;
}

const PLAN_NAMES: Record<string, string> = {
  trial: 'Trial',
  free: 'Free',
  personal: 'Personal',
  business: 'Business',
};

export function getPlanName(plan: string): string {
  return PLAN_NAMES[plan] || 'Free';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/plans.test.ts --no-cache`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/lib/plans.ts __tests__/plans.test.ts
git commit -m "feat: add plans module with tier limits"
```

---

## Chunk 2: Stripe API Routes

### Task 3: Stripe Checkout Route

**Files:**
- Rewrite: `app/api/payment/create-checkout/route.ts`

This replaces the existing outdated checkout route. Key changes:
- Uses pre-created Stripe Price IDs (env vars) instead of inline price_data
- Accepts `plan` parameter ('personal' or 'business')
- Uses `client_reference_id` = phone_number for webhook matching
- Creates or reuses Stripe Customer with phone in metadata

- [ ] **Step 1: Write the checkout route**

```typescript
// app/api/payment/create-checkout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

const PRICE_IDS: Record<string, string | undefined> = {
  personal: process.env.STRIPE_PRICE_PERSONAL,
  business: process.env.STRIPE_PRICE_BUSINESS,
};

export async function POST(req: NextRequest) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16' as any,
    });
    const supabase = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { phone, plan } = await req.json();

    if (!phone || !plan) {
      return NextResponse.json({ error: 'phone and plan required' }, { status: 400 });
    }

    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return NextResponse.json({ error: 'Invalid plan: ' + plan }, { status: 400 });
    }

    // Find or create Stripe customer
    const { data: user } = await supabase
      .from('user_instances')
      .select('stripe_customer_id')
      .eq('phone_number', phone)
      .single();

    let customerId = user?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { phone },
      });
      customerId = customer.id;
      await supabase
        .from('user_instances')
        .update({ stripe_customer_id: customerId })
        .eq('phone_number', phone);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: phone,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: appUrl + '/dashboard?payment=success',
      cancel_url: appUrl + '/dashboard?payment=cancelled',
      metadata: { phone, plan },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('[stripe/checkout] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit app/api/payment/create-checkout/route.ts` (or just check no red in editor)

- [ ] **Step 3: Commit**

```bash
git add app/api/payment/create-checkout/route.ts
git commit -m "feat: rewrite checkout route for Personal/Business plans"
```

### Task 4: Stripe Webhook Route

**Files:**
- Rewrite: `app/api/payment/webhook/route.ts`

Key changes:
- Handles `checkout.session.completed` → set `subscription_plan` to 'personal' or 'business'
- Handles `customer.subscription.deleted` → downgrade to 'free'
- Handles `customer.subscription.updated` → sync plan changes
- Uses `client_reference_id` (phone) to find user
- Sends WhatsApp confirmation via user's own instance

- [ ] **Step 1: Write the webhook route**

```typescript
// app/api/payment/webhook/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function notifyUser(instanceName: string, phone: string, text: string) {
  try {
    await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
      method: 'POST',
      headers: { apikey: process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: phone, text }),
    });
  } catch (e) {
    console.error('[stripe/webhook] notify error:', e);
  }
}

export async function POST(req: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
  });
  const supabase = getSupabase();

  const payload = await req.text();
  const signature = req.headers.get('stripe-signature');

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error('[stripe/webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  console.log('[stripe/webhook] Event:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const phone = session.client_reference_id || session.metadata?.phone;
    const plan = session.metadata?.plan; // 'personal' or 'business'

    if (phone && plan) {
      const { data: user } = await supabase
        .from('user_instances')
        .select('instance_name, stripe_customer_id')
        .eq('phone_number', phone)
        .single();

      await supabase
        .from('user_instances')
        .update({
          subscription_plan: plan,
          stripe_customer_id: user?.stripe_customer_id || (session.customer as string),
        })
        .eq('phone_number', phone);

      // Unpause any paused messages
      await supabase
        .from('scheduled_messages')
        .update({ status: 'pending' })
        .eq('instance_phone', phone)
        .eq('status', 'paused');

      const planName = plan === 'business' ? 'Business' : 'Personal';
      if (user?.instance_name) {
        await notifyUser(user.instance_name, phone,
          `✅ Piano ${planName} attivato! Ora hai ${plan === 'business' ? '50' : '20'} messaggi al giorno.\n\nGrazie per aver scelto WhatsLater!`
        );
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    const { data: user } = await supabase
      .from('user_instances')
      .select('phone_number, instance_name')
      .eq('stripe_customer_id', customerId)
      .single();

    if (user) {
      await supabase
        .from('user_instances')
        .update({ subscription_plan: 'free' })
        .eq('stripe_customer_id', customerId);

      if (user.instance_name) {
        await notifyUser(user.instance_name, user.phone_number,
          '📋 Il tuo abbonamento è stato cancellato. Sei passato al piano Free (3 messaggi/giorno).\n\nI messaggi oltre il limite saranno messi in pausa. Puoi riattivare quando vuoi dalla dashboard.'
        );
      }
    }
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/payment/webhook/route.ts
git commit -m "feat: rewrite Stripe webhook for plan management and downgrade"
```

### Task 5: Customer Portal Route

**Files:**
- Create: `app/api/payment/portal/route.ts`

- [ ] **Step 1: Write the portal route**

```typescript
// app/api/payment/portal/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16' as any,
    });
    const supabase = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { phone } = await req.json();
    if (!phone) {
      return NextResponse.json({ error: 'phone required' }, { status: 400 });
    }

    const { data: user } = await supabase
      .from('user_instances')
      .select('stripe_customer_id')
      .eq('phone_number', phone)
      .single();

    if (!user?.stripe_customer_id) {
      return NextResponse.json({ error: 'No active subscription' }, { status: 404 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app';

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: appUrl + '/dashboard',
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err: any) {
    console.error('[stripe/portal] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/payment/portal/route.ts
git commit -m "feat: add Stripe Customer Portal route"
```

---

## Chunk 3: Codebase Updates for subscription_plan Rename

### Task 6: Update All References from subscription_status to subscription_plan

**Files:**
- Modify: `app/lib/cron-utils.ts` — update `UserInstance` interface
- Modify: `app/api/cron/send-messages/route.ts` — update select query
- Modify: `app/api/webhook/route.ts` — update select queries
- Modify: `app/api/messages/route.ts` — update select + response field
- Modify: `app/api/connect/route.ts` — update upsert field
- Modify: `app/dashboard/page.tsx` — update `SubscriptionState` + response parsing
- Modify: `__tests__/cron-utils.test.ts` — update test data
- Modify: `__tests__/cron.integration.test.ts` — update mock data
- Modify: `__tests__/webhook.integration.test.ts` — update mock data

This is a rename across the codebase: `subscription_status` → `subscription_plan`. The column was renamed in the DB migration. Every file that references the old column name must be updated.

- [ ] **Step 1: Update `app/lib/cron-utils.ts`**

Change in `UserInstance` interface:
```
subscription_status: string;  →  subscription_plan: string;
```
Change in `shouldSendMessage`:
```
const subStatus = userInst.subscription_status;  →  const subStatus = userInst.subscription_plan;
```
Also update the logic: `subStatus !== 'active'` → `subStatus !== 'personal' && subStatus !== 'business'`
(Because now paying users have 'personal' or 'business', not 'active')

- [ ] **Step 2: Update `app/api/cron/send-messages/route.ts`**

Change select query:
```
.select('*, user_instances!inner(id, phone_number, instance_name, trial_ends_at, subscription_status, connection_status)')
→
.select('*, user_instances!inner(id, phone_number, instance_name, trial_ends_at, subscription_plan, connection_status)')
```

- [ ] **Step 3: Update `app/api/webhook/route.ts`**

Find all `.select(...)` queries that include `subscription_status` and replace with `subscription_plan`. There should be 2 occurrences.

- [ ] **Step 4: Update `app/api/messages/route.ts`**

Change select:
```
.select('id, trial_ends_at, subscription_status, connection_status')
→
.select('id, trial_ends_at, subscription_plan, connection_status')
```
Change response:
```
subscription_status: user?.subscription_status || 'unknown'
→
subscription_plan: user?.subscription_plan || 'free'
```

- [ ] **Step 5: Update `app/api/connect/route.ts`**

Change the upsert in `getCodeAndPairing`:
```
subscription_status: 'trial'  →  subscription_plan: 'trial'
```

- [ ] **Step 6: Update `app/dashboard/page.tsx`**

In `SubscriptionState` interface and all references:
```
status: string  →  plan: string
```
Update the response parsing from `/api/messages`:
```
subscription_status → subscription_plan
```
Update all usages of `subscription.status` → `subscription.plan`.

- [ ] **Step 7: Update all test files**

In `__tests__/cron-utils.test.ts`, `__tests__/cron.integration.test.ts`, `__tests__/webhook.integration.test.ts`:
Replace all `subscription_status` → `subscription_plan`.
Replace `subscription_status: 'active'` → `subscription_plan: 'personal'`.

- [ ] **Step 8: Run all tests**

Run: `npx jest --no-cache`
Expected: All tests pass (existing behavior unchanged, just renamed)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: rename subscription_status to subscription_plan across codebase"
```

---

## Chunk 4: Tier Enforcement in Cron

### Task 7: Daily Limit + Reset + Cool-down in Cron Route

**Files:**
- Modify: `app/api/cron/send-messages/route.ts`
- Create: `__tests__/tier-enforcement.test.ts`

This adds to the existing cron route:
1. Check `messages_sent_today < dailyLimit` before sending
2. Cool-down: check `sent` messages to same recipient in last 24h (max 3)
3. Increment `messages_sent_today` after each send
4. Midnight reset: `UPDATE user_instances SET messages_sent_today = 0, upsell_sent_today = false`
5. Trial → free downgrade when `trial_ends_at < now()` and `subscription_plan = 'trial'`
6. Upsell notification at 80% of daily limit

- [ ] **Step 1: Write failing tests for plan limit checking**

```typescript
// __tests__/tier-enforcement.test.ts
import { getPlanLimits } from '../app/lib/plans';

describe('tier enforcement logic', () => {
  test('free plan allows 3 messages per day', () => {
    const limits = getPlanLimits('free');
    expect(2 < limits.dailyLimit).toBe(true);  // 2 sent, can send more
    expect(3 < limits.dailyLimit).toBe(false); // 3 sent, at limit
  });

  test('personal plan allows 20 messages per day', () => {
    const limits = getPlanLimits('personal');
    expect(19 < limits.dailyLimit).toBe(true);
    expect(20 < limits.dailyLimit).toBe(false);
  });

  test('trial has same limits as personal', () => {
    const trial = getPlanLimits('trial');
    const personal = getPlanLimits('personal');
    expect(trial.dailyLimit).toBe(personal.dailyLimit);
  });
});
```

- [ ] **Step 2: Run tests — should pass (uses already-built plans module)**

Run: `npx jest __tests__/tier-enforcement.test.ts --no-cache`
Expected: PASS

- [ ] **Step 3: Add daily limit check to cron route**

In `app/api/cron/send-messages/route.ts`, add import at top:
```typescript
import { getPlanLimits } from '../../../lib/plans';
```

In the message processing loop, after the `shouldSendMessage` check and before `canSend()`, add:
```typescript
// Tier daily limit check
const plan = msg.user_instances.subscription_plan || 'free';
const planLimits = getPlanLimits(plan);
const sentToday = msg.user_instances.messages_sent_today || 0;
if (sentToday >= planLimits.dailyLimit) {
  console.log('CRON: DAILY LIMIT reached for ' + ownerPhone + ' (' + sentToday + '/' + planLimits.dailyLimit + ' plan=' + plan + ')');
  return 'rate_limited' as const;
}
```

Update the select query to also fetch `subscription_plan` and `messages_sent_today`:
```
.select('*, user_instances!inner(id, phone_number, instance_name, trial_ends_at, subscription_plan, connection_status, messages_sent_today)')
```

- [ ] **Step 4: Add cool-down check (3 msgs per recipient per 24h)**

After the daily limit check, before `canSend()`:
```typescript
// Cool-down: max 3 messages to same recipient in 24h
const { count: recentToRecipient } = await supabase
  .from('scheduled_messages')
  .select('id', { count: 'exact', head: true })
  .eq('instance_phone', ownerPhone)
  .eq('recipient_number', msg.recipient_number)
  .eq('status', 'sent')
  .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

if ((recentToRecipient || 0) >= 3) {
  console.log('CRON: COOLDOWN — 3 msgs already sent to ' + msg.recipient_number + ' in 24h');
  // Reschedule to tomorrow
  const tomorrowIso = rescheduleTomorrow(msg.scheduled_at);
  await supabase.from('scheduled_messages').update({
    scheduled_at: tomorrowIso,
    error_message: 'Cool-down: max 3 messaggi allo stesso contatto in 24h. Riprogrammato.'
  }).eq('id', msg.id);
  return 'rate_limited' as const;
}
```

- [ ] **Step 5: Increment messages_sent_today after successful send**

After `recordSend(ownerPhone, instanceName);`, add:
```typescript
await supabase.from('user_instances')
  .update({ messages_sent_today: sentToday + 1 })
  .eq('phone_number', ownerPhone);
```

- [ ] **Step 6: Add upsell at 80% of daily limit**

After incrementing `messages_sent_today`, add:
```typescript
// Upsell at 80% of daily limit
const newSentToday = sentToday + 1;
const upsellThreshold = Math.floor(planLimits.dailyLimit * 0.8);
if (newSentToday === upsellThreshold && !msg.user_instances.upsell_sent_today && plan !== 'business') {
  const nextPlan = plan === 'free' || plan === 'trial' ? 'Personal' : 'Business';
  const nextLimit = plan === 'free' || plan === 'trial' ? 20 : 50;
  const nextPrice = plan === 'free' || plan === 'trial' ? '€4,99' : '€19,99';
  try {
    await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
      method: 'POST',
      headers: { apikey: process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: ownerPhone,
        text: `📊 Hai usato ${newSentToday} dei tuoi ${planLimits.dailyLimit} messaggi oggi.\n\nPassa a ${nextPlan} per ${nextLimit}/giorno a ${nextPrice}/mese:\nhttps://whatslaterpush.vercel.app/dashboard`
      }),
    });
    await supabase.from('user_instances')
      .update({ upsell_sent_today: true })
      .eq('phone_number', ownerPhone);
  } catch (e) {}
}
```

Also update the select query to include `upsell_sent_today`:
```
.select('*, user_instances!inner(id, phone_number, instance_name, trial_ends_at, subscription_plan, connection_status, messages_sent_today, upsell_sent_today)')
```

- [ ] **Step 7: Add midnight reset at the start of the cron**

After the stale cleanup block (around line 82), add:
```typescript
// Midnight reset: reset daily counters for all users
const { data: resetResult } = await supabase
  .from('user_instances')
  .update({ messages_sent_today: 0, upsell_sent_today: false })
  .gt('messages_sent_today', 0)
  .select('id');
if (resetResult?.length) {
  console.log('CRON: Reset daily counters for ' + resetResult.length + ' users');
}
```

Note: This runs every cron execution. Since the cron runs at midnight UTC (`0 0 * * *`), this resets once per day. If it runs more often (e.g., via cron-job.org), the reset is idempotent — it only affects users with `messages_sent_today > 0`.

- [ ] **Step 8: Add trial → free downgrade**

After the midnight reset block, add:
```typescript
// Trial → Free downgrade
const { data: expiredTrials } = await supabase
  .from('user_instances')
  .select('phone_number, instance_name')
  .eq('subscription_plan', 'trial')
  .lt('trial_ends_at', new Date().toISOString());

for (const trial of (expiredTrials || [])) {
  await supabase.from('user_instances')
    .update({ subscription_plan: 'free' })
    .eq('phone_number', trial.phone_number);

  // Pause messages beyond free limit
  // (they'll be unpaused if user upgrades)

  // Notify user
  try {
    await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + trial.instance_name, {
      method: 'POST',
      headers: { apikey: process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: trial.phone_number,
        text: '⏰ Il tuo trial WhatsLater è scaduto.\n\nHai 3 messaggi gratuiti al giorno. Per 20/giorno, passa a Personal a €4,99/mese:\nhttps://whatslaterpush.vercel.app/dashboard'
      }),
    });
  } catch (e) {}
  console.log('CRON: Trial expired → free for ' + trial.phone_number);
}
```

- [ ] **Step 9: Run all tests**

Run: `npx jest --no-cache`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add app/api/cron/send-messages/route.ts __tests__/tier-enforcement.test.ts
git commit -m "feat: add tier limits, cool-down, midnight reset, trial downgrade to cron"
```

---

## Chunk 5: Update shouldSendMessage + Messages API + Cleanup

### Task 8: Update shouldSendMessage for New Plan Values

**Files:**
- Modify: `app/lib/cron-utils.ts`
- Modify: `__tests__/cron-utils.test.ts`

The current `shouldSendMessage` checks `subStatus !== 'active'` to determine if a user is paying. With the rename, paying users have `personal` or `business`. Update the logic.

- [ ] **Step 1: Update shouldSendMessage**

In `app/lib/cron-utils.ts`, change:
```typescript
const subStatus = userInst.subscription_plan;
if (subStatus !== 'active') {
```
to:
```typescript
const subPlan = userInst.subscription_plan;
const isPaying = subPlan === 'personal' || subPlan === 'business';
if (!isPaying) {
```

The rest of the logic stays the same — if not paying, check trial_ends_at.

- [ ] **Step 2: Update tests**

In `__tests__/cron-utils.test.ts`, update test data that uses `subscription_status: 'active'` to `subscription_plan: 'personal'`. Add a test for `subscription_plan: 'business'` returning `'send'`.

- [ ] **Step 3: Run tests**

Run: `npx jest __tests__/cron-utils.test.ts --no-cache`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add app/lib/cron-utils.ts __tests__/cron-utils.test.ts
git commit -m "fix: update shouldSendMessage for personal/business plan values"
```

### Task 9: Update Messages API for Plan-Based History

**Files:**
- Modify: `app/api/messages/route.ts`

Add history filtering based on plan's `historyDays`.

- [ ] **Step 1: Update the GET handler**

Add import:
```typescript
import { getPlanLimits } from '../../lib/plans';
```

After fetching user, add history filter:
```typescript
const planLimits = getPlanLimits(user.subscription_plan || 'free');
const historyStart = new Date(Date.now() - planLimits.historyDays * 24 * 60 * 60 * 1000).toISOString();
```

Update the messages query to add `.gte('created_at', historyStart)`:
```typescript
const { data, error } = await supabase
  .from('scheduled_messages')
  .select('*')
  .eq('instance_phone', normalizedPhone)
  .gte('created_at', historyStart)
  .order('scheduled_at', { ascending: false })
```

Update response to return `subscription_plan` instead of `subscription_status`:
```typescript
return NextResponse.json({
  messages: data || [],
  subscription_plan: user?.subscription_plan || 'free',
  trial_ends_at: user?.trial_ends_at || null,
})
```

- [ ] **Step 2: Commit**

```bash
git add app/api/messages/route.ts
git commit -m "feat: filter message history by plan and return subscription_plan"
```

### Task 10: Delete Outdated Payment Page

**Files:**
- Delete: `app/payment/page.tsx` (outdated €1.99 single-plan page — checkout now happens via dashboard buttons)

- [ ] **Step 1: Delete the file**

```bash
rm app/payment/page.tsx
```

- [ ] **Step 2: Commit**

```bash
git add app/payment/page.tsx
git commit -m "chore: remove outdated payment page (checkout via dashboard now)"
```

---

## Chunk 6: Final Integration Test + Deploy

### Task 11: End-to-End Verification

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-cache`
Expected: All tests pass

- [ ] **Step 2: Verify build compiles**

Run: `npx next build` (will show env var errors for API routes but pages should compile)
Check that `/privacy`, `/terms`, `/dashboard` pages compile without errors.

- [ ] **Step 3: Set required env vars on Vercel**

The following env vars must be configured on Vercel before deploy:
- `STRIPE_SECRET_KEY` — from Stripe dashboard
- `STRIPE_WEBHOOK_SECRET` — from Stripe webhook endpoint config
- `STRIPE_PRICE_PERSONAL` — Price ID for Personal plan (€4.99/mo)
- `STRIPE_PRICE_BUSINESS` — Price ID for Business plan (€19.99/mo)

These are configured manually by the founder in Stripe Dashboard + Vercel Dashboard.

- [ ] **Step 4: Commit everything and push**

```bash
git push origin main
```

- [ ] **Step 5: After deploy — create Stripe webhook endpoint**

In Stripe Dashboard → Webhooks → Add endpoint:
- URL: `https://whatslaterpush.vercel.app/api/payment/webhook`
- Events: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`
- Copy the webhook signing secret → set as `STRIPE_WEBHOOK_SECRET` on Vercel

---

## Summary of All Files

| Action | File |
|--------|------|
| Create | `app/lib/plans.ts` |
| Create | `__tests__/plans.test.ts` |
| Create | `__tests__/tier-enforcement.test.ts` |
| Create | `app/api/payment/portal/route.ts` |
| Rewrite | `app/api/payment/create-checkout/route.ts` |
| Rewrite | `app/api/payment/webhook/route.ts` |
| Modify | `app/lib/cron-utils.ts` |
| Modify | `app/api/cron/send-messages/route.ts` |
| Modify | `app/api/webhook/route.ts` (2 select queries) |
| Modify | `app/api/messages/route.ts` |
| Modify | `app/api/connect/route.ts` |
| Modify | `app/dashboard/page.tsx` |
| Modify | `__tests__/cron-utils.test.ts` |
| Modify | `__tests__/cron.integration.test.ts` |
| Modify | `__tests__/webhook.integration.test.ts` |
| Delete | `app/payment/page.tsx` |
| Migration | `user_instances`: add columns, rename, new CHECK |
| Migration | `scheduled_messages`: add 'paused' to CHECK |
