import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { validatePhone } from '../../../lib/phone';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';
import { logAuditEvent, clientIpFromHeaders, hashContactRefSync } from '../../../lib/audit';
import { forceDeleteInstance } from '../../../lib/evolution';
import {
  getEgressForPairing,
  MisconfigError,
  FrozenError,
  type Egress,
} from '../../../lib/egress-pool';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const SESSION_TTL_MINUTES = 10;

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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
    events: [
      'MESSAGES_UPSERT',
      'CONTACTS_SET',
      'CONTACTS_UPSERT',
      'CONTACTS_UPDATE',
      'MESSAGING_HISTORY_SET',
      'CONNECTION_UPDATE',
      'QRCODE_UPDATED',
    ],
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

  // Check Evolution API environment variables before proceeding
  if (!evoUrl || !evoKey) {
    console.error('[auth/init] FATAL: EVOLUTION_API_URL or EVOLUTION_API_KEY not set');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  // Egress proxy selection (Fase 0 §2). Resolved BEFORE any side effect so
  // misconfiguration / freeze don't leave half-written rows behind.
  //   null            → proxy disabled, legacy direct egress
  //   MisconfigError → operator error (pool empty/malformed but enabled): 500
  //   FrozenError    → all egress quarantined: 503 with activation form
  let egress: Egress | null;
  try {
    egress = await getEgressForPairing();
  } catch (e) {
    if (e instanceof MisconfigError) {
      Sentry.captureException(e, { tags: { kind: 'pairing_misconfig' } });
      return NextResponse.json(
        { error: 'server_misconfiguration', message: 'Errore di configurazione. Stiamo verificando.' },
        { status: 500 },
      );
    }
    if (e instanceof FrozenError) {
      return NextResponse.json(
        {
          error: 'pairing_frozen',
          message: 'Sistema momentaneamente in sovraccarico. Ti contattiamo via WhatsApp.',
          next_steps: { form_path: '/connect?step=activation-request' },
        },
        { status: 503 },
      );
    }
    throw e;
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

  // SECURITY: this endpoint is UNAUTHENTICATED (pairing entry point). Guard
  // against an attacker POSTing a victim's phone to reset their plan or nuke
  // their connected instance. Read the existing row first.
  const { data: existing } = await supabase
    .from('user_instances')
    .select('phone_number, connection_status')
    .eq('phone_number', cleanPhone)
    .maybeSingle();

  // If the number is currently CONNECTED, only the owner (valid sw_session
  // cookie for that phone) may re-init — otherwise a stranger could log out /
  // delete a live instance just by knowing the number.
  if (existing && existing.connection_status === 'open') {
    const payload = await verifyCookie(req.cookies.get(AUTH_COOKIE_NAME)?.value);
    if (payload?.phone !== cleanPhone) {
      await supabase.from('pending_auth_sessions').delete().eq('id', sessionId);
      return NextResponse.json(
        { error: 'Questo numero e gia collegato. Apri WhatsLater e usa "Disconnetti" prima di ri-collegare.' },
        { status: 409 }
      );
    }
  }

  // Clear a stale row that points this instance name at a different phone.
  await supabase.from('user_instances')
    .delete()
    .eq('instance_name', instanceName)
    .neq('phone_number', cleanPhone);

  // Create the trial row ONLY for a brand-new phone. ignoreDuplicates means an
  // existing user's subscription_plan / trial_ends_at are NEVER overwritten
  // (closes the plan-reset hijack). New signups still get the 7-day trial.
  await supabase.from('user_instances').upsert(
    {
      phone_number: cleanPhone,
      instance_name: instanceName,
      subscription_plan: 'trial',
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'phone_number', ignoreDuplicates: true }
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
        // syncFullHistory:false — a fresh pairing must NOT pull the entire
        // WhatsApp history; a burst of new signups was OOM-ing the 2GB droplet.
        // Contacts populate lazily via incoming-message webhooks instead.
        syncFullHistory: false,
        alwaysOnline: true,
        groupsIgnore: false,
        // Pairing-only egress proxy (Fase 0 §2). Injected only when an egress
        // is selected; steady-state sessions remain direct on the droplet so
        // proxy uptime isn't a hard dependency for already-paired users.
        ...(egress
          ? {
              proxyHost: egress.host,
              proxyPort: egress.port,
              proxyProtocol: egress.protocol,
              ...(egress.username ? { proxyUsername: egress.username } : {}),
              ...(egress.password ? { proxyPassword: egress.password } : {}),
            }
          : {}),
        webhook: {
          enabled: true,
          url: `${appUrl}/api/webhook`,
          webhook_by_events: false,
          webhook_base64: false,
          events: [
            'MESSAGES_UPSERT',
            'CONTACTS_SET',
            'CONTACTS_UPSERT',
            'CONTACTS_UPDATE',
            'MESSAGING_HISTORY_SET',
            'CONNECTION_UPDATE',
            'QRCODE_UPDATED',
          ],
          ...(process.env.WEBHOOK_SECRET ? { headers: { 'x-webhook-secret': process.env.WEBHOOK_SECRET } } : {}),
        },
      }),
    });
    createRes = await res.json();
  } catch (e) {
    console.error('[auth/init] instance create error:', e);
    await supabase.from('pending_auth_sessions').delete().eq('id', sessionId);
    return NextResponse.json({ error: 'Errore creazione istanza Evolution API' }, { status: 500 });
  }

  await setWebhook(instanceName);

  let qrCode: string | null = createRes?.qrcode?.base64 || createRes?.base64 || null;
  let pairingCode: string | null = createRes?.qrcode?.pairingCode || createRes?.pairingCode || null;

  // Evolution returns the 8-char pairing code only when the phone number is
  // passed to /instance/connect as a GET query param. NEVER fall back to the
  // `code` field — that is the raw QR payload (e.g. "2@..."), not a pairing
  // code; typing it into WhatsApp fails. This was the "wrong pairing code" bug.
  const looksLikePairingCode = (v: unknown): v is string =>
    typeof v === 'string' && /^[A-Z0-9]{6,12}$/i.test(v.replace(/-/g, ''));

  if (!qrCode || !pairingCode) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await fetch(
        `${evoUrl}/instance/connect/${instanceName}?number=${encodeURIComponent(cleanPhone)}`,
        { headers: { apikey: evoKey! } },
      );
      const d = await r.json();
      qrCode = qrCode || d?.base64 || d?.qrcode?.base64 || null;
      const pc = d?.pairingCode || d?.qrcode?.pairingCode || null;
      if (!pairingCode && looksLikePairingCode(pc)) pairingCode = pc;
    } catch {}
  }

  // Final guard: drop anything that isn't a real pairing code (e.g. a QR payload
  // that slipped through from the create response) so the UI falls back to the QR.
  if (pairingCode && !looksLikePairingCode(pairingCode)) pairingCode = null;

  if (!qrCode && !pairingCode) {
    await supabase.from('pending_auth_sessions').delete().eq('id', sessionId);
    return NextResponse.json(
      { error: 'Impossibile generare QR o codice. Riprova tra qualche secondo.' },
      { status: 500 }
    );
  }

  // Numerator for the pairing_success_rate metric (Q1/Q3 decisions).
  // Emitted only on the success branch where the client actually receives
  // something pairable — init-500 / "no code generated" returns do NOT count
  // as attempts (those are Evolution health, not pairing health).
  //
  // Fase 0 §2/§6: payload now carries egress_id (drives per-egress watchdog)
  // and phone_hash (SHA-256 8-char, NOT plaintext — coerent with Sprint 6 PII
  // policy from migration 20260527_audit_events.sql:7-9). Plaintext IP lands
  // in the dedicated `ip_address` column via ipAddress param.
  const sourceIp = clientIpFromHeaders(req.headers);
  const phoneHash = hashContactRefSync(cleanPhone);
  void logAuditEvent({
    eventType: 'pairing_started',
    payload: {
      instance_name: instanceName,
      egress_id: egress?.id || null,
      phone_hash: phoneHash,
    },
    ipAddress: sourceIp,
  });

  return NextResponse.json({ sessionId, instanceName, qrCode, pairingCode });
}
