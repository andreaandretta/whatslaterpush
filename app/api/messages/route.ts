import { NextRequest, NextResponse } from 'next/server';
import { getPlanLimits } from '../../lib/plans';
import { isBillingEnabled, getEffectivePlan } from '../../lib/billing';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { validatePhone } from '../../lib/phone';
import { looksLikeLidDigits, isLegacyLidRow } from '../../lib/jid';
import { isUnsendableContactRow } from '../../lib/contact-rows';
import { evolutionClient } from '../../../lib/evolution/client';
import { applyJitter } from '../../lib/cron-utils';
import { isNotOnWhatsAppError } from '../../lib/message-error';
import { contactActiveCutoffIso, isRecipientActive } from '../../lib/contact-window';
import { isValidRule, reconcileRecurringChain } from '../../lib/recurrence';
import { unfilledPlaceholders, unfilledPlaceholderMessage } from '../../lib/placeholders';
import { logAuditEvent, clientIpFromHeaders, hashContactRef } from '../../lib/audit';
import { getSupabaseAdmin } from '../../lib/supabase-admin';

// Tipi di allegato accettati (POST e PATCH). Il CHECK in DB è identico.
const ALLOWED_MEDIA = ['image', 'video', 'document', 'audio', 'sticker', 'location', 'contact'];

// Stati "vivi" di una catena ricorrente: stessi di recurring_chains_needing_next()
// (migration 20260621). Se uno di questi esiste, la catena va avanti da sola.
const LIVE_STATES = ['pending', 'processing', 'paused', 'awaiting_time', 'awaiting_recipient', 'awaiting_confirm'];

// Template con {giorno}, {orario}... non compilati: 400 con frase italiana.
// Vale per ogni client (anche vecchi o scritti a mano): all'invio si risolve
// solo {nome}, il resto arriverebbe tra graffe al destinatario.
function unfilledPlaceholderResponse(text: string): NextResponse | null {
  if (unfilledPlaceholders(text).length === 0) return null;
  return NextResponse.json({
    error: 'unfilled_placeholder',
    message: unfilledPlaceholderMessage(text),
  }, { status: 400 });
}

export const dynamic = 'force-dynamic';
// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';


// true unless WhatsApp explicitly answers "exists": false (4 s cap; any error,
// missing instance or unclear answer counts as "don't block"). ONE number per
// call, the one the user just chose: never used to probe an address book.
async function whatsappKnowsNumber(supabase: any, phone: string, number: string): Promise<boolean> {
  try {
    const { data: inst } = await supabase.from('user_instances').select('instance_name').eq('phone_number', phone).maybeSingle();
    const instanceName = (inst as any)?.instance_name;
    if (!instanceName) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const res = await Promise.race([
      evolutionClient.whatsappNumbers(instanceName, [number]),
      new Promise<null>((r) => { timer = setTimeout(() => r(null), 4000); }),
    ]).finally(() => clearTimeout(timer));
    const hit = Array.isArray(res) ? res[0] : null;
    return hit?.exists !== false;
  } catch {
    return true;
  }
}

async function getAuthedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

export async function GET(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data: user } = await supabase
    .from('user_instances')
    .select('id, trial_ends_at, subscription_plan, connection_status')
    .eq('phone_number', phone)
    .single();

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const planLimits = getPlanLimits(getEffectivePlan(user.subscription_plan));
  const historyStart = new Date(Date.now() - planLimits.historyDays * 24 * 60 * 60 * 1000).toISOString();

  // The history window bounds TERMINAL rows only: pending/paused/awaiting are
  // the user's queue (future), not history. Hiding them past historyDays made
  // old-but-live rows invisible — and thus uneditable/unresumable — in the
  // dashboard while the cron kept processing them (runbook §2).
  const { data, error } = await supabase
    .from('scheduled_messages')
    .select('*')
    .eq('instance_phone', phone)
    .or(`created_at.gte.${historyStart},status.in.(pending,paused,processing,awaiting_time,awaiting_recipient,awaiting_confirm)`)
    .order('scheduled_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach cached profile photos from whatsapp_contacts so the dashboard
  // avatars can render WhatsApp pictures without a second client round-trip.
  const recipientNumbers = Array.from(
    new Set(
      ((data || []) as Array<{ recipient_number: string | null }>)
        .map((m) => m.recipient_number)
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
    )
  );

  const photoByNumber = new Map<string, string>();
  if (recipientNumbers.length > 0) {
    const { data: contacts } = await supabase
      .from('whatsapp_contacts')
      .select('contact_number, profile_pic_url')
      .eq('user_phone', phone)
      .in('contact_number', recipientNumbers);
    for (const c of (contacts || []) as Array<{ contact_number: string; profile_pic_url: string | null }>) {
      const url = c.profile_pic_url?.trim();
      if (url) photoByNumber.set(c.contact_number, url);
    }
  }

  const messages = ((data || []) as Array<Record<string, any>>).map((m) => ({
    ...m,
    photo_url: m.recipient_number ? photoByNumber.get(m.recipient_number) || null : null,
  }));

  const { count: lifetimeCount } = await supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('instance_phone', phone);

  // Client contract: subscription_plan is the plan whose limits/UI apply —
  // the dashboard gates ALL plan UI on it (pricing, trial banner, counter,
  // upsell copy). raw_plan mirrors the stored one: the Stripe portal button
  // keys on it, so a paying user keeps portal access while the beta overrides
  // limits. With billing on the two coincide (raw 'unknown' kept as-is).
  const rawPlan = user?.subscription_plan || 'unknown';
  return NextResponse.json({
    messages,
    subscription_plan: isBillingEnabled() ? rawPlan : getEffectivePlan(rawPlan),
    raw_plan: rawPlan,
    billing_enabled: isBillingEnabled(),
    // T-14 lever (runbook §3): set BETA_END_DATE on Vercel to surface the
    // end-of-beta banner in the dashboard. Meaningful only in beta mode.
    beta_end_date: isBillingEnabled() ? null : (process.env.BETA_END_DATE || null),
    trial_ends_at: user?.trial_ends_at || null,
    connection_status: user?.connection_status || null,
    total_scheduled_lifetime: lifetimeCount ?? 0,
  });
}

export async function DELETE(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { id, scope } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: msg } = await supabase
    .from('scheduled_messages')
    .select('id, instance_phone, status, scheduled_at, recurrence_rule, recurrence_anchor_at, parent_recurrence_id')
    .eq('id', id)
    .eq('instance_phone', phone)
    .single();

  if (!msg) return NextResponse.json({ error: 'Message not found or not owned' }, { status: 403 });

  // Promemoria ricorrente: una riga 'cancelled' in cima alla catena significa
  // "l'utente ha fermato la serie" e il cron non crea MAI più la prossima
  // (reconcileRecurringChain + recurring_chains_needing_next). Prima "Elimina"
  // su un solo martedì di catechismo, o sulla card rossa di un invio fallito,
  // fermava in silenzio tutta la serie. Ora la serie si ferma solo con
  // scope='series' ("Tutta la serie"); altrimenti ("Solo questa volta", e anche
  // un client vecchio che non manda scope) la riga salta alla prossima
  // occorrenza: nessuno stato nuovo, nessuna migration.
  const m = msg as any;
  if (m.recurrence_rule && scope !== 'series' && ['pending', 'paused', 'failed'].includes(m.status) && m.scheduled_at) {
    const skipped = await skipRecurringOccurrence(supabase, phone, m);
    if (skipped) return skipped;
  }

  // 'failed' incluso: "Elimina" è offerto sulle card rosse ed era l'unico modo di
  // togliere un non-inviato; prima il 409 lasciava la card lì per sempre.
  // Mai 'processing'/'sent': una riga già presa dal cron non si tocca.
  const { data: updated, error } = await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('instance_phone', phone)
    .in('status', ['pending', 'paused', 'failed'])
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'message_not_cancellable', message: 'Il messaggio è già in invio o inviato.' }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}

// "Solo questa volta" su una riga ricorrente. Ritorna la risposta HTTP, oppure
// null quando la cosa giusta è la cancellazione normale della riga (la serie
// continua comunque, o la regola non dà una prossima occorrenza).
async function skipRecurringOccurrence(supabase: any, phone: string, m: any): Promise<NextResponse | null> {
  // Prossima occorrenza DOPO questa, all'ora dell'ancora (l'orario scelto
  // dall'utente, non quello spostato dal cron) e comunque nel futuro: è lo
  // stesso calcolo del cron quando crea l'occorrenza successiva, quindi la
  // serie resta identica a come sarebbe andata. latestStatus 'sent' serve solo
  // a superare il cancello "catena viva" della funzione, qui già verificato.
  const decision = reconcileRecurringChain({
    hasLiveRow: false,
    latestStatus: 'sent',
    latestScheduledAt: m.scheduled_at,
    rule: m.recurrence_rule,
    anchorAt: m.recurrence_anchor_at,
  });
  if (!decision.insert) return null;

  if (m.status === 'failed') {
    // Card rossa: se il cron ha già creato l'occorrenza successiva, la serie
    // va avanti con quella e questa riga si cancella e basta.
    const chainId = m.parent_recurrence_id || m.id;
    const { data: live } = await supabase
      .from('scheduled_messages')
      .select('id')
      .eq('instance_phone', phone)
      .or(`id.eq.${chainId},parent_recurrence_id.eq.${chainId}`)
      .in('status', LIVE_STATES)
      .neq('id', m.id)
      .limit(1);
    if (Array.isArray(live) && live.length > 0) return null;
  }

  // Una riga in pausa resta in pausa (l'utente la riprende quando vuole); una
  // fallita torna in coda per la prossima volta, con i contatori azzerati.
  const { data: moved, error } = await supabase
    .from('scheduled_messages')
    .update({
      scheduled_at: decision.scheduledAt,
      status: m.status === 'failed' ? 'pending' : m.status,
      retry_count: 0,
      disconnect_retry_count: 0,
      error_message: null,
      send_attempted_at: null,
    })
    .eq('id', m.id)
    .eq('instance_phone', phone)
    .in('status', [m.status])
    .select('id, status, scheduled_at');

  // 23505 = il cron ha creato proprio adesso la stessa occorrenza
  // (uniq_recurrence_occurrence): la serie c'è già, questa riga si cancella.
  if (error && error.code === '23505') return null;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!moved || moved.length === 0) {
    return NextResponse.json({ error: 'message_not_cancellable', message: 'Il messaggio è già in invio o inviato.' }, { status: 409 });
  }
  return NextResponse.json({ success: true, skipped_to: moved[0].scheduled_at });
}

// PATCH /api/messages — partial update of a pending/paused scheduled message.
// Two real flows feed it:
//  1. Pause/resume from the dashboard (status: 'paused' | 'pending').
//  2. Edit-in-place: reschedule and/or rewrite the body of a message that
//     hasn't been sent yet. This replaces the old "duplicate-then-delete"
//     workaround the dashboard used while no PATCH existed.
// Terminal-state messages (sent / cancelled / failed) are immutable —
// the right way to "edit" one of those is to schedule a brand new send.
export async function PATCH(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { id, status, scheduled_at, message, recurrence_rule, action, media } = body || {};
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from('scheduled_messages')
    .select('id, instance_phone, status, scheduled_at, media_type, media_url, media_filename, recurrence_rule, parsed_message, caption, error_message')
    .eq('id', id)
    .eq('instance_phone', phone)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Message not found or not owned' }, { status: 403 });
  }

  // Retry — re-queue a message the cron gave up on (status='failed', i.e. it
  // exhausted its 3 automatic attempts). This is the ONLY way out of the
  // otherwise-terminal 'failed' state, so it lives ahead of the EDITABLE_STATES
  // guard below (which deliberately excludes 'failed'). We hand the row back to
  // the cron with a clean slate: status='pending' + scheduled_at=now (jittered)
  // so it's picked up on the next run, retry_count/disconnect_retry_count reset
  // to 0 so it gets a fresh 3-strike budget, and error_message/send_attempted_at
  // cleared so neither the stale-row UI nor the idempotency recovery is misled.
  // All the cron's anti-ban layers (jitter, typing, cool-down, rate limits,
  // atomic quota) still apply downstream — no cron change needed.
  if (action === 'retry') {
    if (existing.status !== 'failed') {
      return NextResponse.json({ error: 'not_retryable', current_status: existing.status }, { status: 409 });
    }
    // WhatsApp ha già detto che il numero non esiste: un nuovo tentativo
    // fallisce uguale, riavvisa il proprietario e conta nel freno dei fallimenti
    // (25 set 2026: righe LID rimesse in coda e fallite di nuovo). Rifiutato
    // anche qui, non solo nascosto in UI, per i client vecchi.
    if (isNotOnWhatsAppError((existing as any).error_message)) {
      return NextResponse.json({
        error: 'not_retryable_permanent',
        message: 'Riprovare non serve: WhatsApp non conosce questo numero. Programma di nuovo il messaggio con il numero giusto.',
      }, { status: 409 });
    }
    // La pulizia allegati (cleanup-media) ha già tolto il file: rimesso in coda
    // partirebbe senza allegato, o fallirebbe di nuovo se era solo allegato.
    if ((existing as any).media_type && !(existing as any).media_url) {
      return NextResponse.json({
        error: 'media_expired',
        message: 'L\'allegato di questo messaggio non è più disponibile: usa "Duplica" e caricalo di nuovo.',
      }, { status: 409 });
    }
    const retryUpdate = {
      status: 'pending',
      scheduled_at: applyJitter(new Date().toISOString()),
      retry_count: 0,
      disconnect_retry_count: 0,
      error_message: null,
      send_attempted_at: null,
    };
    // Conditional write scoped to status='failed' so a concurrent retry (double
    // tap) or any race can't re-queue an already-requeued row twice.
    const { data: retried, error: retryErr } = await supabase
      .from('scheduled_messages')
      .update(retryUpdate)
      .eq('id', id)
      .eq('instance_phone', phone)
      .in('status', ['failed'])
      .select('id, status, scheduled_at')
      .single();

    if (retryErr) {
      if (retryErr.code === 'PGRST116') {
        return NextResponse.json({ error: 'not_retryable' }, { status: 409 });
      }
      return NextResponse.json({ error: retryErr.message }, { status: 500 });
    }

    await logAuditEvent({
      userPhone: phone,
      eventType: 'schedule_retried',
      payload: { message_id: id },
      ipAddress: clientIpFromHeaders(req.headers),
    });

    return NextResponse.json({ message: retried });
  }

  // Terminal states are write-once. Cron may still flip pending → processing
  // → sent under us, so we treat anything outside the editable set as final.
  const EDITABLE_STATES = new Set(['pending', 'paused', 'awaiting_confirm', 'awaiting_contact', 'awaiting_datetime', 'awaiting_message']);
  if (!EDITABLE_STATES.has(existing.status)) {
    return NextResponse.json({ error: 'message_not_editable', current_status: existing.status }, { status: 409 });
  }

  const update: Record<string, unknown> = {};

  if (status !== undefined) {
    if (status !== 'paused' && status !== 'pending') {
      return NextResponse.json({ error: 'invalid_status', message: 'Operazione non valida per questo messaggio.' }, { status: 400 });
    }
    update.status = status;
  }

  // "Riattiva" su un messaggio in pausa il cui orario è già passato: prima
  // tornava in coda con il vecchio orario e il cron lo mandava entro un minuto,
  // a qualsiasi ora e col testo ormai vecchio ("domani alle 9 hai la guida"
  // martedì alle 23:10). Ora si chiede all'utente: invia ora o nuovo orario
  // (la dashboard offre le due scelte e le manda con scheduled_at nello stesso
  // PATCH, che quindi passa).
  if (status === 'pending' && existing.status === 'paused' && scheduled_at === undefined) {
    const at = new Date((existing as any).scheduled_at || '');
    if (!isNaN(at.getTime()) && at.getTime() < Date.now() + 60_000) {
      return NextResponse.json({
        error: 'time_passed',
        message: 'L\'orario di questo messaggio è già passato: scegli se inviarlo ora o a un nuovo orario.',
        scheduled_at: (existing as any).scheduled_at,
      }, { status: 409 });
    }
  }

  if (scheduled_at !== undefined) {
    if (typeof scheduled_at !== 'string') {
      return NextResponse.json({ error: 'invalid_datetime' }, { status: 400 });
    }
    const d = new Date(scheduled_at);
    if (isNaN(d.getTime()) || d.getTime() < Date.now() + 60_000) {
      return NextResponse.json({ error: 'invalid_datetime' }, { status: 400 });
    }
    update.scheduled_at = applyJitter(d.toISOString());
    // L'orario ora lo sceglie l'utente (modifica o Posticipa): il conteggio dei
    // tentativi a WhatsApp scollegato è della vecchia scaletta. Lasciato lì, un
    // conteggio ≥6 faceva trattare dal cron il nuovo orario come "arretrato di
    // sistema" e lo spostava a domattina (isLateDisconnectBacklog).
    update.disconnect_retry_count = 0;
  }

  // Allegato in modifica (22 set 2026): `media: null` lo toglie, `media: {...}`
  // lo sostituisce con un file già caricato (stesso contratto del POST).
  // Prima il PATCH ignorava i media: dalla modale non si poteva né vedere né
  // togliere l'allegato di un messaggio in attesa.
  let nextHasMedia = typeof existing.media_type === 'string' && typeof existing.media_url === 'string' && existing.media_url.length > 0;
  let oldMediaToDrop: string | null = null;
  if (media !== undefined) {
    if (media === null) {
      if (nextHasMedia) oldMediaToDrop = existing.media_url as string;
      update.media_type = null;
      update.media_url = null;
      update.media_filename = null;
      update.media_caption = null;
      nextHasMedia = false;
    } else {
      const mt = media?.media_type;
      const mu = media?.media_url;
      if (typeof mt !== 'string' || !ALLOWED_MEDIA.includes(mt)) {
        return NextResponse.json({ error: 'invalid_media_type' }, { status: 400 });
      }
      // IDOR guard, come nel POST: solo file sotto il prefisso di QUESTO utente.
      if (typeof mu !== 'string' || mu.length === 0 || mu.includes('..') || !mu.startsWith(phone + '/')) {
        return NextResponse.json({ error: 'invalid_media_url' }, { status: 400 });
      }
      if (nextHasMedia && existing.media_url !== mu) oldMediaToDrop = existing.media_url as string;
      update.media_type = mt;
      update.media_url = mu;
      update.media_filename = typeof media?.media_filename === 'string' && media.media_filename.length > 0
        ? media.media_filename.slice(0, 200)
        : null;
      nextHasMedia = true;
    }
  }

  if (message !== undefined) {
    if (typeof message !== 'string') {
      return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
    }
    const hasMedia = nextHasMedia;
    const clean = message.trim();
    if (!hasMedia) {
      if (clean.length === 0 || clean.length > 3500) {
        return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
      }
    } else {
      if (message.length > 3500) {
        return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
      }
    }
    const unfilled = unfilledPlaceholderResponse(clean);
    if (unfilled) return unfilled;
    update.parsed_message = clean;
    update.caption = clean;
    if (hasMedia) update.media_caption = clean.length > 0 ? clean : null;
  } else if (media === null) {
    // Tolto l'allegato senza toccare il testo: il messaggio non può restare vuoto.
    const curText = (((existing as any).parsed_message || (existing as any).caption || '') as string).trim();
    if (curText.length === 0) {
      return NextResponse.json({ error: 'invalid_message', reason: 'text_required_without_media' }, { status: 400 });
    }
  }

  if (recurrence_rule !== undefined) {
    if (recurrence_rule === null || recurrence_rule === '') {
      update.recurrence_rule = null;
    } else {
      if (typeof recurrence_rule !== 'string' || !isValidRule(recurrence_rule)) {
        return NextResponse.json({ error: 'invalid_recurrence_rule' }, { status: 400 });
      }
      update.recurrence_rule = recurrence_rule;
    }
  }

  // BUG #2: keep the recurrence anchor in sync when the user reschedules a
  // (still-)recurring row — the new intended time-of-day (PRE-jitter) becomes the
  // anchor so future occurrences follow the edit; clearing the rule clears it.
  // keep_recurrence_anchor: lo spostamento vale per QUESTA volta sola ("Invia
  // ora" dopo una pausa, "Posticipa"): senza, un +1 ora su un settimanale delle
  // 18:00 spostava alle 19:00 tutte le volte successive.
  const effectiveRule = update.recurrence_rule !== undefined ? update.recurrence_rule : (existing as any).recurrence_rule;
  const keepAnchor = body?.keep_recurrence_anchor === true;
  if (scheduled_at !== undefined && effectiveRule && !keepAnchor) {
    update.recurrence_anchor_at = new Date(scheduled_at as string).toISOString();
  } else if (update.recurrence_rule === null) {
    update.recurrence_anchor_at = null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no_fields_to_update' }, { status: 400 });
  }

  // Il motivo scritto dal cron ("spostato a domattina: ...", "in pausa: ...")
  // descrive la SUA decisione. Se l'utente riprogramma o riprende il messaggio,
  // quel motivo non è più vero e la lista non deve più mostrarlo. Su una riga
  // che resta in pausa si tiene (es. "ha scritto stop": deve restare visibile).
  const nextStatus = (update.status as string | undefined) ?? existing.status;
  if ((update.scheduled_at !== undefined || update.status !== undefined) && nextStatus === 'pending' && (existing as any).error_message) {
    update.error_message = null;
  }
  // Pausa decisa dall'utente: il vecchio motivo del cron ("Nuovo tentativo a
  // breve", "Spostato a domattina") su una riga ferma è falso, non parte
  // niente. Restano solo i motivi di pausa veri (destinatario che ha scritto
  // stop, logout: "In pausa: ...") e il trial scaduto.
  if (update.status === 'paused' && existing.status !== 'paused' && (existing as any).error_message) {
    const reason = String((existing as any).error_message).trim().toLowerCase();
    if (!reason.startsWith('in pausa') && !reason.startsWith('trial scaduto')) {
      update.error_message = null;
    }
  }

  // Conditional write: refuse if the cron picked up the row between our
  // read and update (status would have moved out of EDITABLE_STATES).
  const { data: updated, error } = await supabase
    .from('scheduled_messages')
    .update(update)
    .eq('id', id)
    .eq('instance_phone', phone)
    .in('status', Array.from(EDITABLE_STATES))
    .select('id, status, scheduled_at, parsed_message, recurrence_rule')
    .single();

  if (error) {
    // No row matched → cron beat us to it. Surface as conflict, not 500.
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'message_not_editable' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Il vecchio allegato viene tolto dallo Storage SOLO se nessun'altra riga lo
  // usa: le occorrenze di una ricorrenza condividono lo stesso file
  // (vedi cleanup-media). Best-effort: un errore qui non annulla la modifica.
  if (oldMediaToDrop) {
    try {
      const { count } = await supabase
        .from('scheduled_messages')
        .select('id', { count: 'exact', head: true })
        .eq('media_url', oldMediaToDrop);
      if ((count || 0) === 0) {
        await supabase.storage.from('message-media').remove([oldMediaToDrop]);
      }
    } catch (e) {
      console.error('PATCH: old media cleanup failed', (e as any)?.message || e);
    }
  }

  await logAuditEvent({
    userPhone: phone,
    eventType: 'schedule_updated',
    payload: {
      message_id: id,
      fields: Object.keys(update),
    },
    ipAddress: clientIpFromHeaders(req.headers),
  });

  return NextResponse.json({ message: updated });
}

const RECIPIENT_IS_LID_MESSAGE = 'Questo contatto è salvato con un codice interno di WhatsApp, non con il numero. Cercalo di nuovo in rubrica o scrivi il numero a mano.';

export async function POST(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const {
    recipient_number: rawNumber,
    recipient_name,
    message,
    scheduled_at,
    recurrence_rule,
    media_type,
    media_url,
    media_filename,
    media_caption,
  } = body || {};
  // true only when the number was typed in ContactPicker "Nuovo contatto":
  // picks from the address book or from Recents must not become 'manual'
  // rows (manual rows are always shown and exempt from the LID filters).
  const manualEntry = body?.manual_entry === true;

  if (typeof rawNumber !== 'string' || rawNumber.includes('@g.us') || rawNumber.includes('@broadcast')) {
    return NextResponse.json({
      error: 'invalid_phone',
      message: 'Si può programmare un messaggio solo verso un numero di telefono.',
    }, { status: 400 });
  }

  const normalized = validatePhone(rawNumber);
  if (!normalized) {
    // A Linked ID from an old address-book row cannot be a number at all
    // (e.g. 15 digits after +1): say so instead of "numero non valido", which
    // would blame the user for digits they never typed.
    const digits = rawNumber.replace(/\D/g, '');
    if (/^\d{13,15}$/.test(digits)) {
      const { data: row } = await getSupabaseAdmin()
        .from('whatsapp_contacts')
        .select('added_manually, created_at')
        .eq('user_phone', phone)
        .eq('contact_number', digits)
        .maybeSingle();
      if (row && isUnsendableContactRow({ contact_number: digits, ...(row as any) })) {
        return NextResponse.json({ error: 'recipient_is_lid', message: RECIPIENT_IS_LID_MESSAGE }, { status: 400 });
      }
    }
    return NextResponse.json({
      error: 'invalid_phone',
      message: 'Numero non valido. Controlla le cifre; se è estero scrivilo col prefisso (es. +41 79 123 45 67).',
    }, { status: 400 });
  }

  if (normalized === phone) {
    return NextResponse.json({ error: 'self_target' }, { status: 400 });
  }

  // When media is attached, the message body becomes optional (used as
  // caption). Without media, the body is mandatory like before.
  const hasMedia = typeof media_type === 'string' && typeof media_url === 'string' && media_url.length > 0;
  const messageStr = typeof message === 'string' ? message : '';
  if (!hasMedia) {
    if (messageStr.trim().length === 0 || messageStr.length > 3500) {
      return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
    }
  } else {
    // With media: allow empty body, just cap length.
    if (messageStr.length > 3500) {
      return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
    }
    if (!ALLOWED_MEDIA.includes(media_type)) {
      return NextResponse.json({ error: 'invalid_media_type' }, { status: 400 });
    }
    // IDOR guard: media_url must live under THIS user's own storage prefix
    // (uploads are stored at {phone}/{uuid}-{file}); block cross-user paths and
    // traversal so the cron never signs + sends someone else's private media.
    if (media_url.includes('..') || !media_url.startsWith(phone + '/')) {
      return NextResponse.json({ error: 'invalid_media_url' }, { status: 400 });
    }
  }

  const unfilled = unfilledPlaceholderResponse(messageStr);
  if (unfilled) return unfilled;

  if (typeof scheduled_at !== 'string') {
    return NextResponse.json({ error: 'invalid_datetime' }, { status: 400 });
  }
  const scheduledDate = new Date(scheduled_at);
  const MAX_FUTURE_MS = 365 * 24 * 60 * 60 * 1000; // 1-year cap — reject 9999-01-01 junk
  if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now() + 60_000 || scheduledDate.getTime() > Date.now() + MAX_FUTURE_MS) {
    return NextResponse.json({ error: 'invalid_datetime' }, { status: 400 });
  }

  // recurrence_rule is optional. If present, must be a valid RRULE subset
  // (see app/lib/recurrence.ts). Null/undefined/empty means one-shot send.
  let normalizedRule: string | null = null;
  if (recurrence_rule != null && recurrence_rule !== '') {
    if (typeof recurrence_rule !== 'string' || !isValidRule(recurrence_rule)) {
      return NextResponse.json({ error: 'invalid_recurrence_rule' }, { status: 400 });
    }
    normalizedRule = recurrence_rule;
  }

  const supabase = getSupabaseAdmin();

  const { data: user } = await supabase
    .from('user_instances')
    .select('id, subscription_plan')
    .eq('phone_number', phone)
    .single();

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Effective plan: contact cap and MAX_PENDING follow it (beta: 300/350).
  // With billing on this is the raw plan with the same || 'free' fallback.
  const plan = getEffectivePlan(user.subscription_plan);
  const limits = getPlanLimits(plan);

  // The contact cap counts ACTIVE recipients, not lifetime ones: a recipient
  // counts only if they have a non-cancelled message still in-flight, or
  // sent/scheduled within the last 90 days (see app/lib/contact-window.ts).
  // Without this window a Free user stays locked out forever by contacts they
  // messaged once, months ago. pending_contacts (self-chat saved contacts) are
  // windowed on created_at for the same reason — recently-used ones reappear
  // here via scheduled_messages anyway.
  const cutoffIso = contactActiveCutoffIso();

  const { data: pendingContacts } = await supabase
    .from('pending_contacts')
    .select('recipient_number')
    .eq('owner_phone', phone)
    .gte('created_at', cutoffIso);

  // Bounded query ordered by scheduled_at DESC so the most-recent 2000 rows —
  // exactly the ones that can still be ACTIVE — are the ones kept. This replaces
  // the old unbounded select that silently truncated at supabase-js's ~1000-row
  // default (undercounting the cap on heavy accounts). isRecipientActive() then
  // applies the 90-day window in JS: in-flight rows always count, sent/failed
  // only within 90 days (see app/lib/contact-window.ts). The date filtering stays
  // in JS (not SQL) so it works uniformly for sent_at||scheduled_at.
  const { data: scheduledContacts } = await supabase
    .from('scheduled_messages')
    .select('recipient_number, status, sent_at, scheduled_at')
    .eq('instance_phone', phone)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: false })
    .limit(2000);
  if ((scheduledContacts?.length ?? 0) >= 2000) {
    console.warn('[messages POST] contact-window query hit 2000-row cap — contact count may be understated for phone=' + phone);
  }

  const knownSet = new Set<string>();
  for (const row of pendingContacts || []) if (row.recipient_number) knownSet.add(row.recipient_number);
  for (const row of scheduledContacts || []) {
    if (row.recipient_number && isRecipientActive(row)) knownSet.add(row.recipient_number);
  }

  if (!knownSet.has(normalized) && knownSet.size >= limits.maxContacts) {
    return NextResponse.json({
      error: 'plan_contacts_limit_exceeded',
      plan,
      limit: limits.maxContacts,
    }, { status: 403 });
  }

  // MAX_PENDING quota — prevents an authenticated client (or compromised
  // session) from filling the queue faster than the cron can drain it. Cap is
  // dailyLimit × 7 so users keep a full week of buffer even under heavy use;
  // abusive flows trip 429 long before they materially grow the table.
  const { count: pendingCount } = await supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('instance_phone', phone)
    .eq('status', 'pending');

  const MAX_PENDING = limits.dailyLimit * 7;
  if ((pendingCount || 0) >= MAX_PENDING) {
    return NextResponse.json({
      error: 'queue_full',
      message: 'Hai troppi messaggi in coda. Aspetta che ne venga inviato qualcuno.',
      pending: pendingCount || 0,
      limit: MAX_PENDING,
    }, { status: 429 });
  }

  // Does WhatsApp know this number? Asked once, only for a recipient this user
  // never reached ('sent' row), so a typo, a landline or a dead number is
  // caught now and not days later at send time (prod: 3466…2716 failed
  // exists:false 4 times over 17 days). Asked last, after every cheap check.
  // A Linked ID (WhatsApp's internal code, 14-15 digits) stored in the address
  // book before the webhook learned to skip it gets its own message. If
  // WhatsApp cannot be asked in 4 s, nothing is blocked.
  let legacyLid = false;
  if (looksLikeLidDigits(normalized)) {
    const { data: lidRow } = await supabase
      .from('whatsapp_contacts')
      .select('added_manually, created_at')
      .eq('user_phone', phone)
      .eq('contact_number', normalized)
      .maybeSingle();
    legacyLid = !!lidRow && isLegacyLidRow({ contact_number: normalized, ...(lidRow as any) });
  }
  const { data: sentBefore } = await supabase
    .from('scheduled_messages')
    .select('id')
    .eq('instance_phone', phone)
    .eq('recipient_number', normalized)
    .eq('status', 'sent')
    .limit(1);
  const reachedBefore = Array.isArray(sentBefore) && sentBefore.length > 0;
  if ((legacyLid || !reachedBefore) && !(await whatsappKnowsNumber(supabase, phone, normalized))) {
    return NextResponse.json(legacyLid
      ? { error: 'recipient_is_lid', message: RECIPIENT_IS_LID_MESSAGE }
      : {
          error: 'recipient_not_on_whatsapp',
          message: 'Questo numero non risulta su WhatsApp. Controlla le cifre (e il prefisso, se è estero).',
        }, { status: 400 });
  }

  const cleanMessage = messageStr.trim();
  const cleanName = typeof recipient_name === 'string' && recipient_name.trim().length > 0
    ? recipient_name.trim().slice(0, 100)
    : null;
  const cleanMediaCaption = typeof media_caption === 'string' && media_caption.length > 0
    ? media_caption.slice(0, 3500)
    : null;
  const cleanMediaFilename = typeof media_filename === 'string' && media_filename.length > 0
    ? media_filename.slice(0, 200)
    : null;

  const { data: inserted, error: insErr } = await supabase
    .from('scheduled_messages')
    .insert({
      user_instance_id: user.id,
      instance_phone: phone,
      recipient_number: normalized,
      recipient_name: cleanName,
      caption: cleanMessage,
      parsed_message: cleanMessage,
      scheduled_at: applyJitter(scheduledDate.toISOString()),
      // BUG #2: the anchor is the user's ORIGINAL time-of-day, PRE-jitter, so the
      // reconciliation can re-derive it even after operational reschedules push
      // scheduled_at toward midnight. Null for one-shot rows.
      recurrence_anchor_at: normalizedRule ? scheduledDate.toISOString() : null,
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      wa_message_id: null,
      recurrence_rule: normalizedRule,
      media_type: hasMedia ? media_type : null,
      media_url: hasMedia ? media_url : null,
      media_filename: cleanMediaFilename,
      media_caption: cleanMediaCaption,
    })
    .select('id, scheduled_at')
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await logAuditEvent({
    userPhone: phone,
    eventType: 'schedule_created',
    payload: {
      message_id: inserted.id,
      scheduled_at: inserted.scheduled_at,
      has_recurrence: normalizedRule !== null,
      recipient_hash: await hashContactRef(normalized),
      body_length: cleanMessage.length,
    },
    ipAddress: clientIpFromHeaders(req.headers),
  });

  // Best-effort: ensure the manually-typed recipient has a whatsapp_contacts
  // row so the picker can list them next time even before the webhook
  // confirms their existence via CONTACTS_UPSERT. ignoreDuplicates=true maps
  // to ON CONFLICT DO NOTHING, which keeps any pre-existing webhook-ingested
  // row intact (their added_manually stays whatever it already was — usually
  // false). A failure here must not mask the scheduled-message success, so
  // errors are logged and swallowed.
  // Only for numbers typed in "Nuovo contatto" (manual_entry): before, a pick
  // from Recents with no row became a permanent 'manual' contact, exempt from
  // the LID filters (prod: LID 1154…3692 saved as MANUAL the day it failed).
  if (manualEntry) {
    try {
      const { error: contactErr } = await supabase
        .from('whatsapp_contacts')
        .upsert({
          user_phone: phone,
          contact_number: normalized,
          name: cleanName,
          push_name: null,
          source: 'MANUAL',
          added_manually: true,
        }, { onConflict: 'user_phone,contact_number', ignoreDuplicates: true });
      if (contactErr) console.error('MANUAL_CONTACT_UPSERT_FAILED', contactErr.message);
    } catch (err: any) {
      console.error('MANUAL_CONTACT_UPSERT_FAILED', err?.message || err);
    }
  }

  return NextResponse.json({
    id: inserted.id,
    scheduled_at: inserted.scheduled_at,
    status: 'pending',
  });
}
