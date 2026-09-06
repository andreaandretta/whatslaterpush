import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';
import Stripe from 'stripe';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyCookie(req.cookies.get(AUTH_COOKIE_NAME)?.value);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const phone = auth.phone;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16' as any,
    });
    const supabase = getSupabaseAdmin();

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
