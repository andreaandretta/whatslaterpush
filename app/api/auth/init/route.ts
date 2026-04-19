import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validatePhone } from '../../../lib/phone';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const SESSION_TTL_MINUTES = 10;

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function forceDeleteInstance(name: string): Promise<void> {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  try {
    await fetch(`${evoUrl}/instance/logout/${name}`, { method: 'DELETE', headers: { apikey: evoKey! } });
  } catch {}
  await new Promise(r => setTimeout(r, 500));
  try {
    await fetch(`${evoUrl}/instance/delete/${name}`, { method: 'DELETE', headers: { apikey: evoKey! } });
  } catch {}
  await new Promise(r => setTimeout(r, 1500));
}

async function setWebhook(name: string): Promise<void> {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app';
  const webhookUrl = `${appUrl}/api/webhook`;
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  const body: any = {
    enabled: true,
    url: webhookUrl,
    webhook_by_events: false,
    webhook_base64: false,
    events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
  };
  if (webhookSecret) body.headers = { 'x-webhook-secret': webhookSecret };
  try {
    const res = await fetch(`${evoUrl}/webhook/set/${name}`, {
      method: 'POST',
      headers: { apikey: evoKey!, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data?.error || data?.status === 'error' || !res.ok) {
      await fetch(`${evoUrl}/webhook/set/${name}`, {
        method: 'POST',
        headers: { apikey: evoKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook: body }),
      });
    }
  } catch (e) {
    console.error('[auth/init] setWebhook error:', e);
  }
}

export async function POST(req: NextRequest) {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app';

  const body = await req.json().catch(() => ({}));
  const cleanPhone = validatePhone(body?.phone || '');
  if (!cleanPhone) {
    return NextResponse.json(
      { error: 'Inserisci numero completo con prefisso internazionale (es: 393509898408)' },
      { status: 400 }
    );
  }
  const instanceName = `SchedWhats-${cleanPhone}`;
  const sessionId = crypto.randomUUID();
  const supabase = getSupabase();

  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();
  const { error: insertErr } = await supabase
    .from('pending_auth_sessions')
    .insert({ id: sessionId, phone: cleanPhone, status: 'pending', expires_at: expiresAt });
  if (insertErr) {
    console.error('[auth/init] insert pending session failed:', insertErr.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  // user_instances upsert (mirrors logic from /api/connect getCodeAndPairing)
  await supabase.from('user_instances')
    .delete()
    .eq('instance_name', instanceName)
    .neq('phone_number', cleanPhone);
  await supabase.from('user_instances').upsert(
    {
      phone_number: cleanPhone,
      instance_name: instanceName,
      subscription_plan: 'trial',
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'phone_number' }
  );

  await forceDeleteInstance(instanceName);

  let createRes: any;
  try {
    const res = await fetch(`${evoUrl}/instance/create`, {
      method: 'POST',
      headers: { apikey: evoKey!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceName,
        number: cleanPhone,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          enabled: true,
          url: `${appUrl}/api/webhook`,
          webhook_by_events: false,
          webhook_base64: false,
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
          ...(process.env.WEBHOOK_SECRET ? { headers: { 'x-webhook-secret': process.env.WEBHOOK_SECRET } } : {}),
        },
      }),
    });
    createRes = await res.json();
  } catch (e) {
    console.error('[auth/init] instance create error:', e);
    return NextResponse.json({ error: 'Errore creazione istanza Evolution API' }, { status: 500 });
  }

  await setWebhook(instanceName);

  let qrCode: string | null = createRes?.qrcode?.base64 || createRes?.base64 || null;
  let pairingCode: string | null = createRes?.qrcode?.pairingCode || createRes?.pairingCode || null;

  if (!qrCode) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await fetch(`${evoUrl}/instance/connect/${instanceName}`, { headers: { apikey: evoKey! } });
      const d = await r.json();
      qrCode = d?.base64 || d?.qrcode?.base64 || null;
      pairingCode = pairingCode || d?.pairingCode || d?.qrcode?.pairingCode || null;
    } catch {}
  }
  if (!pairingCode) {
    try {
      const r = await fetch(`${evoUrl}/instance/connect/${instanceName}`, {
        method: 'POST',
        headers: { apikey: evoKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: cleanPhone }),
      });
      const d = await r.json();
      pairingCode = d?.pairingCode || d?.code || null;
    } catch {}
  }

  if (!qrCode && !pairingCode) {
    return NextResponse.json(
      { error: 'Impossibile generare QR o codice. Riprova tra qualche secondo.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ sessionId, instanceName, qrCode, pairingCode });
}
