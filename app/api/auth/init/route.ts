import { NextRequest, NextResponse } from 'next/server';
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
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';
// init concatena forceDelete + /instance/create (10-30s quando Evolution è
// carico) + setWebhook + sleep + il breve wait del semaforo full-sync: il
// default Hobby ~10s è troppo stretto e taglia il pairing a metà sotto carico.
export const maxDuration = 30;

const SESSION_TTL_MINUTES = 10;


// Eventi webhook sottoscritti. TUTTI devono stare nell'enum di
// EventController.events (v2.3.7): un solo nome fuori enum fa 400-are l'intera
// config. MESSAGING_HISTORY_SET NON è nell'enum v2 (e mai emesso da Evolution,
// vedi nota CLAUDE.md) — per anni ha fatto fallire in silenzio /webhook/set,
// erano i due errori [Validate] fissi nei log container a ogni pairing.
const WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'CONTACTS_SET',
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
];

function webhookConfig() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app';
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  return {
    enabled: true,
    url: `${appUrl}/api/webhook`,
    // Chiavi v2: byEvents/base64 (i legacy webhook_by_events/webhook_base64
    // venivano ignorati — il default false coincideva, per fortuna).
    byEvents: false,
    base64: false,
    events: WEBHOOK_EVENTS,
    ...(webhookSecret ? { headers: { 'x-webhook-secret': webhookSecret } } : {}),
  };
}

// Ridondanza difensiva sulla config webhook: la scrive già /instance/create col
// blocco nested (è così che ha sempre funzionato in prod — lo schema create non
// valida il nested e il controller lo legge). Questa POST allinea/ripara la
// config con il body che webhookSchema v2.3.7 esige: root `webhook` required.
async function setWebhook(name: string): Promise<void> {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  try {
    const res = await fetch(`${evoUrl}/webhook/set/${name}`, {
      method: 'POST',
      headers: { apikey: evoKey!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook: webhookConfig() }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[auth/init] setWebhook rejected:', res.status, detail.slice(0, 300));
    }
  } catch (e) {
    console.error('[auth/init] setWebhook error:', e);
  }
}

export async function POST(req: NextRequest) {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;

  const body = await req.json().catch(() => ({}));
  const cleanPhone = validatePhone(body?.phone || '');
  if (!cleanPhone) {
    return NextResponse.json(
      { error: 'Inserisci numero completo con prefisso internazionale (es: 393509898408)' },
      { status: 400 }
    );
  }

  // Rate limit the public pairing endpoint by IP and by phone, reusing the
  // existing atomic rate_limit_record RPC (rate_limit_state table). Each call
  // spawns a Baileys socket on the single Evolution node — without a cap a
  // flood can OOM the box (#1). The RPC has no built-in threshold: we pass a
  // 10-min window as the "minute" reset and enforce the limit on the returned
  // count (same pattern as recordSend in app/lib/rate-limit.ts).
  const supabase = getSupabaseAdmin();
  {
    const PAIRING_WINDOW_MS = 10 * 60 * 1000;
    const PAIRING_MAX_PER_IP = 8;
    const PAIRING_MAX_PER_PHONE = 5;
    const nowMs = Date.now();
    const winReset = nowMs + PAIRING_WINDOW_MS;
    const dayReset = nowMs + 86_400_000; // neutral: daily_count is not read here
    const ip = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim() || 'unknown';
    const [ipRes, phoneRes] = await Promise.all([
      supabase.rpc('rate_limit_record', { p_key: 'pairing:ip:' + ip, p_now: nowMs, p_minute_reset: winReset, p_daily_reset: dayReset }),
      supabase.rpc('rate_limit_record', { p_key: 'pairing:phone:' + cleanPhone, p_now: nowMs, p_minute_reset: winReset, p_daily_reset: dayReset }),
    ]);
    // Fail-open on RPC error or undefined response: a rate-limiter blip must
    // not break pairing (same non-fatal philosophy as recordSend). Flip to a
    // 503 here if you prefer fail-closed for this public pre-auth endpoint.
    if (ipRes && phoneRes && !ipRes.error && !phoneRes.error) {
      const ipCount = (ipRes.data as { minute_count: number })?.minute_count ?? 0;
      const phoneCount = (phoneRes.data as { minute_count: number })?.minute_count ?? 0;
      if (ipCount > PAIRING_MAX_PER_IP || phoneCount > PAIRING_MAX_PER_PHONE) {
        return NextResponse.json(
          { error: 'rate_limited', message: 'Troppi tentativi di collegamento. Riprova tra qualche minuto.' },
          { status: 429, headers: { 'Retry-After': String(PAIRING_WINDOW_MS / 1000) } }
        );
      }
    } else {
      console.warn('[auth/init] rate-limit RPC error (fail-open):', ipRes?.error?.message || phoneRes?.error?.message);
    }
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
  // supabase client already created above in the rate-limit gate block

  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();
  const { error: insertErr } = await supabase
    .from('pending_auth_sessions')
    .insert({ id: sessionId, phone: cleanPhone, status: 'pending', instance_name: instanceName, expires_at: expiresAt });
  if (insertErr) {
    console.error('[auth/init] insert pending session failed:', insertErr.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  // SECURITY: this endpoint is UNAUTHENTICATED (pairing entry point). Guard
  // against an attacker POSTing a victim's phone to reset their plan or nuke
  // their connected instance. Read the existing row first.
  const { data: existing } = await supabase
    .from('user_instances')
    .select('phone_number, connection_status, paired_at')
    .eq('phone_number', cleanPhone)
    .maybeSingle();

  // SECURITY (BUG #8): if the number ALREADY has a REAL account, only the owner
  // (valid sw_session cookie for that phone) may re-initialise it. "Real" =
  // paired_at NOT NULL (timbrato dal webhook al primo CONNECTION_UPDATE open,
  // migration 20260818_paired_at). Una riga SENZA paired_at è un onboarding mai
  // completato — la lascia l'upsert di un tentativo interrotto — e DEVE poter
  // essere re-inizializzata senza cookie: prima del 2026-08-18 il guard scattava
  // su qualsiasi riga e il primo retry di un numero vergine moriva 409 ("questo
  // numero ha già un account") con recovery solo operatore. La finestra
  // close/connecting di un account reale resta owner-only (hijack chiuso).
  // Re-pair da browser nuovo (device perso, no cookie) resta bloccato → recovery
  // operatore (runbook); OTP self-chat v1.5 lo renderà self-service.
  if (existing?.paired_at) {
    const payload = await verifyCookie(req.cookies?.get(AUTH_COOKIE_NAME)?.value);
    if (payload?.phone !== cleanPhone) {
      await supabase.from('pending_auth_sessions').delete().eq('id', sessionId);
      return NextResponse.json(
        { error: 'Questo numero ha gia un account. Aprilo dallo stesso browser dove sei gia loggato, oppure contatta il supporto per recuperare l\'accesso.' },
        { status: 409 }
      );
    }
  }

  // Clear a stale row that points this instance name at a different phone.
  await supabase.from('user_instances')
    .delete()
    .eq('instance_name', instanceName)
    .neq('phone_number', cleanPhone);

  // Se il numero non ha un account REALE (nessuna riga, o riga senza
  // paired_at lasciata da un tentativo interrotto) e questo init fallisce, la
  // riga upsertata va rimossa nei rami d'errore: tiene il DB pulito e, in
  // cintura col guard paired_at sopra, evita che un onboarding fallito si
  // trasformi in 409 al retry. Mai cancellarla per un account accoppiato.
  const isUnpairedNumber = !existing?.paired_at;
  const cleanupFailedInit = async () => {
    await supabase.from('pending_auth_sessions').delete().eq('id', sessionId);
    if (isUnpairedNumber) {
      await supabase.from('user_instances').delete().eq('phone_number', cleanPhone);
    }
  };

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

  // Teardown VERIFICATO (bug 2026-08-17): se la vecchia istanza sopravvive
  // (zombie con socket 'connecting'), procedere è garanzia di codice morto —
  // create 403 "name already in use" e il fallback connect restituirebbe lo
  // stale qrCode in-memory. Meglio un errore onesto di un codice che il
  // telefono rifiuta con "verifica che il numero sia corretto".
  const teardownOk = await forceDeleteInstance(instanceName);
  if (!teardownOk) {
    console.error(`[auth/init] Evolution teardown failed for ${instanceName} — zombie instance still on the node, aborting pairing`);
    // phone_hash (mai plaintext, coerente con pairing_started) così l'operatore
    // sa QUALE istanza è zombie; flush esplicito perché la lambda Node può
    // congelare prima del drain del transport (gotcha documentato in
    // app/api/test/sentry/route.ts — vercelWaitUntil è no-op fuori da Edge).
    Sentry.captureMessage('pairing_teardown_failed', {
      level: 'error',
      tags: { phone_hash: hashContactRefSync(cleanPhone) },
    });
    await cleanupFailedInit();
    await Sentry.flush(2000).catch(() => {});
    return NextResponse.json(
      { error: 'Il numero risulta ancora agganciato a una vecchia sessione che non riusciamo a scollegare. Riprova tra un minuto; se succede ancora, contatta il supporto.' },
      { status: 503 }
    );
  }

  // Gate "solo cache vuota" (Fase 2, 2026-06-21): syncFullHistory pesa sulla RAM
  // del nodo (Baileys bufferizza app-state/history al link). Lo attiviamo SOLO
  // quando il numero non ha ancora contatti cachati su Supabase — cioè un primo
  // pairing, l'unico caso che richiede il burst CONTACTS_SET/UPSERT della rubrica.
  // Un re-pair (cache già popolata) salta il full-sync: la rubrica è su Supabase e
  // le foto si rinfrescano via backfill (Leva 3). Default OOM-safe a false se la
  // count fallisce (mai scatenare full-sync per un errore di rete).
  // Storia: false hardcoded dal 2026-06-07 (commit 6d3fb6b) ha spento i burst →
  // contatti spariti su ogni nuovo pairing.
  let syncFullHistory = false;
  try {
    const { count: cachedContacts, error: countErr } = await supabase
      .from('whatsapp_contacts')
      .select('contact_number', { count: 'exact', head: true })
      .eq('user_phone', cleanPhone);
    if (countErr) {
      console.error('[auth/init] contacts count failed, syncFullHistory=false:', countErr.message);
    } else {
      syncFullHistory = (cachedContacts ?? 0) === 0;
    }
  } catch (e: any) {
    console.error('[auth/init] contacts count threw, syncFullHistory=false:', e?.message || e);
  }
  console.log(`[auth/init] pairing ${instanceName} syncFullHistory=${syncFullHistory} (cache-empty gate)`);

  // Task 5 (opzione b): quando facciamo un full-sync (primo pairing), acquisiamo
  // uno slot del semaforo distribuito full_sync_slots per limitare quanti
  // full-sync girano insieme sul nodo unico ed evitare l'OOM da signup-burst —
  // SENZA disattivare il burst di contatti (disattivarlo = rubrica vuota per ogni
  // nuovo utente, vedi commit 6d3fb6b). Se tutti gli slot sono occupati aspettiamo
  // brevemente (così i burst si distribuiscono nel tempo e il picco RAM cala) e
  // poi procediamo comunque: fail-open, non rompiamo mai il caricamento contatti.
  if (syncFullHistory) {
    const SLOT_TTL_S = 120;    // durata approssimata di un full-sync sul nodo
    const MAX_WAIT_MS = 2500;  // limitato per restare dentro maxDuration
    const POLL_MS = 700;
    const deadline = Date.now() + MAX_WAIT_MS;
    let slot: number | null = null;
    while (true) {
      const { data, error } = await supabase.rpc('acquire_full_sync_slot', {
        p_holder: instanceName,
        p_ttl_seconds: SLOT_TTL_S,
      });
      slot = error ? 1 : ((data as number | null) ?? null); // fail-open su errore RPC
      if (slot !== null || Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (slot === null) {
      console.warn(`[auth/init] full-sync semaphore saturated for ${instanceName} — proceeding anyway (node under concurrent-pairing pressure)`);
      Sentry.captureMessage('full_sync_semaphore_saturated', { level: 'warning' });
    }
  }

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
        // full-sync CONDIZIONALE — true solo al primo pairing (cache contatti
        // vuota, vedi gate sopra) per ripristinare il burst rubrica. L'OOM da
        // signup-burst concorrente è mitigato dal semaforo full_sync_slots sopra
        // (Task 5 opzione b), NON disattivando il burst.
        syncFullHistory,
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
        // È QUESTO blocco a configurare davvero il webhook (il controller v2
        // legge il nested; lo schema create non lo valida). setWebhook dopo è
        // solo ridondanza difensiva. Stessa config condivisa: webhookConfig().
        webhook: webhookConfig(),
      }),
    });
    createRes = await res.json();
    // Una create rigettata (403 name-in-use, 400 validazione…) prima veniva
    // ignorata: si proseguiva fino al fallback connect che può restituire un
    // codice morto. Fail-fast con cleanup, come per l'errore di rete.
    if (!res.ok || createRes?.error) {
      console.error('[auth/init] instance create rejected:', res.status, JSON.stringify(createRes)?.slice(0, 300));
      await cleanupFailedInit();
      return NextResponse.json({ error: 'Errore creazione istanza Evolution API' }, { status: 500 });
    }
  } catch (e) {
    console.error('[auth/init] instance create error:', e);
    await cleanupFailedInit();
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
    await cleanupFailedInit();
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
