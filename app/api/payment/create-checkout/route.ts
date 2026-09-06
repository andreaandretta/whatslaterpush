import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';
import Stripe from 'stripe';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';
import { isBillingEnabled } from '../../../lib/billing';

export const dynamic = 'force-dynamic';

const PRICE_IDS: Record<string, string | undefined> = {
  personal: process.env.STRIPE_PRICE_PERSONAL,
  professional: process.env.STRIPE_PRICE_PROFESSIONAL,
  business: process.env.STRIPE_PRICE_BUSINESS,
};

export async function POST(req: NextRequest) {
  try {
    const cookieRaw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
    const auth = await verifyCookie(cookieRaw);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const phone = auth.phone;

    // Beta kill-switch: no new Stripe customers/subscriptions while billing
    // is off. The UI hides the upgrade buttons, but this endpoint stays
    // directly callable — the belt is server-side. The portal route has NO
    // such gate on purpose: existing subscribers keep self-service cancel.
    if (!isBillingEnabled()) {
      return NextResponse.json({ error: 'billing_disabled_beta' }, { status: 403 });
    }

    const { plan } = await req.json();
    if (!plan) return NextResponse.json({ error: 'plan required' }, { status: 400 });
    const priceId = PRICE_IDS[plan];
    if (!priceId) return NextResponse.json({ error: 'Invalid plan: ' + plan }, { status: 400 });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16' as any,
    });
    const supabase = getSupabaseAdmin();

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
