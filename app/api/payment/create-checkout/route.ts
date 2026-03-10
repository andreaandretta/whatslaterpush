// @ts-nocheck
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });

export async function POST(req: Request) {
    try {
          const { phone, email } = await req.json();

      const customer = await stripe.customers.create({
              email: email || phone + '@schedwhats.user',
              metadata: { phone }
      });

      const session = await stripe.checkout.sessions.create({
              customer: customer.id,
              payment_method_types: ['card'],
              line_items: [{
                        price_data: {
                                    currency: 'eur',
                                    product_data: { name: 'SchedWhats Pro - 1 mese' },
                                    unit_amount: 199,
                                    recurring: { interval: 'month' }
                        },
                        quantity: 1
              }],
              mode: 'subscription',
              success_url: (process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app') + '/dashboard?payment=success',
              cancel_url: (process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app') + '/dashboard?payment=cancelled',
              metadata: { phone }
      });

      return NextResponse.json({ url: session.url });

    } catch (err: any) {
          return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
