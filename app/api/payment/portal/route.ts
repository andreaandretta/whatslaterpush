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
