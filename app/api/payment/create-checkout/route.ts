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
