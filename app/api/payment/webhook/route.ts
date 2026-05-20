import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getPlanName, getPlanLimits } from '../../../lib/plans';

export const dynamic = 'force-dynamic';

// Single source of truth for which plans Stripe checkout can produce.
// Kept in sync with app/lib/plans.ts and the subscription_plan CHECK
// constraint in supabase/migrations/20260520_add_professional_plan.sql.
const PAID_PLANS = ['personal', 'professional', 'business'] as const;

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
    const plan = session.metadata?.plan;

    if (phone && plan && (PAID_PLANS as readonly string[]).includes(plan)) {
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

      if (user.instance_name) {
        await notifyUser(user.instance_name, user.phone_number,
          '📋 Il tuo abbonamento è stato cancellato. Sei passato al piano Free (3 messaggi/giorno).\n\nI messaggi oltre il limite saranno messi in pausa. Puoi riattivare quando vuoi dalla dashboard.'
        );
      }
    }
  }

  return NextResponse.json({ received: true });
}
