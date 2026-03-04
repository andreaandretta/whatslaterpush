// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { headers } from 'next/headers';

// FIX-VERCEL: force-dynamic prevents build-time module evaluation crash
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
      // Init inside function to avoid top-level crash at Vercel build time
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });
      const supabase = createClient(
              process.env.SUPABASE_URL!,
              process.env.SUPABASE_SERVICE_ROLE_KEY!
            );
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  const payload = await req.text();
      const signature = headers().get('stripe-signature');

  let event;
      try {
              event = stripe.webhooks.constructEvent(payload, signature!, webhookSecret);
      } catch (err: any) {
              return NextResponse.json({ error: err.message }, { status: 400 });
      }

  if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const phone = session.metadata?.phone;

        if (phone) {
                  await supabase
                    .from('user_instances')
                    .update({
                                  subscription_status: 'active',
                                  subscription_id: session.subscription
                    })
                    .eq('phone_number', phone);

            await supabase
                    .from('subscriptions')
                    .insert({
                                  stripe_customer_id: session.customer,
                                  stripe_subscription_id: session.subscription,
                                  status: 'active',
                                  current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                    });

            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/SchedWhats-Primary', {
                        method: 'POST',
                        headers: {
                                      'apikey': process.env.EVOLUTION_API_KEY!,
                                      'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                                      number: phone,
                                      text: 'Benvenuto in SchedWhats Pro! Il tuo abbonamento e attivo. Puoi programmare tutti i messaggi che vuoi.'
                        })
            });
        }
  }

  return NextResponse.json({ received: true });
}
