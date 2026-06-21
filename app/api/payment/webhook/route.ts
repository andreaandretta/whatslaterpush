import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getPlanName, getPlanLimits, resolveSubscriptionPlan } from '../../../lib/plans';
import { logAuditEvent } from '../../../lib/audit';

export const dynamic = 'force-dynamic';

// Single source of truth for which plans Stripe checkout can produce.
// Kept in sync with app/lib/plans.ts and the subscription_plan CHECK
// constraint in supabase/migrations/20260520_add_professional_plan.sql.
const PAID_PLANS = ['personal', 'professional', 'business'] as const;

// Reverse of create-checkout's PRICE_IDS — maps a Stripe price id back to a plan,
// used by the customer.subscription.updated tier sync.
const PRICE_MAP = {
  personal: process.env.STRIPE_PRICE_PERSONAL,
  professional: process.env.STRIPE_PRICE_PROFESSIONAL,
  business: process.env.STRIPE_PRICE_BUSINESS,
};

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

  // Idempotency: skip events already processed. constructEvent verifies the
  // signature but does NOT block replays (Stripe retries; a captured signed
  // payload can be re-POSTed). Check-then-process-then-mark; the mark is at the
  // end so a transient failure mid-processing lets Stripe's retry re-run it.
  const { data: alreadyProcessed } = await supabase
    .from('processed_stripe_events')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle();
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, deduplicated: true });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const phone = session.client_reference_id || session.metadata?.phone;
    const plan = session.metadata?.plan;

    if (session.payment_status !== 'paid') {
      // Subscription checkouts can complete 'unpaid' / 'no_payment_required'
      // (100% coupon, async payment methods) — do NOT grant paid limits until
      // money is actually collected. A later invoice.payment_succeeded / the
      // subscription.updated active sync grants the tier once paid.
      console.warn('[stripe/webhook] checkout.session.completed not paid (payment_status=' + session.payment_status + ') — not granting');
    } else if (phone && plan && (PAID_PLANS as readonly string[]).includes(plan)) {
      const { data: user } = await supabase
        .from('user_instances')
        .select('instance_name, stripe_customer_id, subscription_plan')
        .eq('phone_number', phone)
        .single();

      const fromPlan = user?.subscription_plan || 'unknown';

      await supabase
        .from('user_instances')
        .update({
          subscription_plan: plan,
          stripe_customer_id: user?.stripe_customer_id || (session.customer as string),
        })
        .eq('phone_number', phone);

      await logAuditEvent({
        userPhone: phone,
        eventType: 'payment_event',
        payload: {
          stripe_event: event.type,
          amount: session.amount_total,
          currency: session.currency,
          plan,
        },
      });
      if (fromPlan !== plan) {
        await logAuditEvent({
          userPhone: phone,
          eventType: 'tier_changed',
          payload: { from_plan: fromPlan, to_plan: plan, trigger: 'checkout_completed' },
        });
      }

      // Unpause any paused messages
      await supabase
        .from('scheduled_messages')
        .update({ status: 'pending' })
        .eq('instance_phone', phone)
        .eq('status', 'paused');

      if (user?.instance_name) {
        const dailyLimit = getPlanLimits(plan).dailyLimit;
        await notifyUser(user.instance_name, phone,
          `✅ Piano ${getPlanName(plan)} attivato! Ora hai ${dailyLimit} messaggi al giorno.\n\nGrazie per aver scelto WhatsLater!`
        );
      }
    } else if (phone && plan) {
      console.warn('[stripe/webhook] checkout.session.completed received with unsupported plan:', plan);
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

      await logAuditEvent({
        userPhone: user.phone_number,
        eventType: 'payment_event',
        payload: { stripe_event: event.type },
      });
      await logAuditEvent({
        userPhone: user.phone_number,
        eventType: 'tier_changed',
        payload: { to_plan: 'free', trigger: 'subscription_deleted' },
      });

      if (user.instance_name) {
        await notifyUser(user.instance_name, user.phone_number,
          '📋 Il tuo abbonamento è stato cancellato. Sei passato al piano Free (3 messaggi/giorno).\n\nI messaggi oltre il limite saranno messi in pausa. Puoi riattivare quando vuoi dalla dashboard.'
        );
      }
    }
  }

  // Portal plan changes + payment recovery: sync the stored tier from the
  // subscription's status + active price. Closes the "portal downgrade keeps the
  // old (higher) tier" leak, and re-grants the tier when a past_due payment
  // recovers (status -> active).
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = sub.customer as string;
    const priceId = sub.items?.data?.[0]?.price?.id || null;
    const target = resolveSubscriptionPlan(sub.status, priceId, PRICE_MAP);
    // null = indeterminate status / unrecognized price -> leave the plan as-is.
    if (target) {
      const { data: user } = await supabase
        .from('user_instances')
        .select('phone_number, instance_name, subscription_plan')
        .eq('stripe_customer_id', customerId)
        .single();
      if (user && user.subscription_plan !== target) {
        await supabase
          .from('user_instances')
          .update({ subscription_plan: target })
          .eq('stripe_customer_id', customerId);
        await logAuditEvent({
          userPhone: user.phone_number,
          eventType: 'tier_changed',
          payload: { from_plan: user.subscription_plan, to_plan: target, trigger: 'subscription_updated', status: sub.status },
        });
      }
    }
  }

  // Failed renewal: TIER-NEUTRAL. Do NOT downgrade — Stripe retries for days
  // (past_due grace), and pausing a paying user's operational reminders over a
  // recoverable card blip is worse than the dunning-window cost. The real
  // downgrade happens only when the subscription truly ends (canceled/unpaid) via
  // customer.subscription.updated. Lifecycle exception: nudge the user to fix
  // their card before it gets there.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = invoice.customer as string;
    const { data: user } = await supabase
      .from('user_instances')
      .select('phone_number, instance_name, subscription_plan')
      .eq('stripe_customer_id', customerId)
      .single();
    if (user && user.subscription_plan !== 'free') {
      await logAuditEvent({
        userPhone: user.phone_number,
        eventType: 'payment_event',
        payload: { stripe_event: event.type },
      });
      if (user.instance_name) {
        await notifyUser(user.instance_name, user.phone_number,
          '⚠️ Il pagamento del tuo abbonamento WhatsLater non è andato a buon fine. Aggiorna il metodo di pagamento dalla dashboard per non perdere il piano.'
        );
      }
    }
  }

  // Mark processed (idempotency). Best-effort: a 23505 from a concurrent delivery
  // is harmless because every handler above is idempotent.
  await supabase.from('processed_stripe_events').insert({ event_id: event.id, event_type: event.type });

  return NextResponse.json({ received: true });
}
