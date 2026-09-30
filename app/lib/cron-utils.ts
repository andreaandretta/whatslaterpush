/**
 * Pure utility functions extracted from cron/send-messages for testability.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isNotOnWhatsAppError as notOnWhatsApp, looksDisconnected } from './message-error';
import { SPREAD_STEP_MS } from './anti-ban';
import { isGroupJid } from './jid';

export interface UserInstance {
  id: string;
  phone_number: string;
  instance_name: string;
  trial_ends_at: string | null;
  subscription_plan: string;
  connection_status: string;
}

export interface PendingMessage {
  id: string;
  scheduled_at: string;
  status: string;
  retry_count: number;
  recipient_number: string;
  recipient_name: string | null;
  parsed_message: string;
  user_instances: UserInstance;
}

export type SkipReason =
  | 'no_instance'
  | 'disconnected'
  | 'trial_expired'
  | 'send'
  | 'skip';

/**
 * Determines if a message should be skipped before sending, and why.
 * Returns the skip reason or 'send' if the message should be sent.
 */
export function shouldSendMessage(msg: PendingMessage): SkipReason {
  const userInst = msg.user_instances;
  if (!userInst || !userInst.instance_name) {
    return 'no_instance';
  }

  // P17: Check connection_status
  if (userInst.connection_status !== 'open') {
    return 'disconnected';
  }

  // P9: Check trial/subscription
  const subPlan = userInst.subscription_plan;
  const trialEnd = userInst.trial_ends_at;
  // 'beta' is the synthetic free-beta plan (app/lib/billing.ts): it must count
  // as paying here — beta users' trial_ends_at is typically months in the past,
  // so falling through to the trial branch would pause every beta message.
  const isPaying = subPlan === 'personal' || subPlan === 'professional' || subPlan === 'business' || subPlan === 'beta';
  // 'free' is the TERMINAL post-trial tier: its trial_ends_at is always in the
  // past (that's how the user became free), so gating it on the trial window
  // would (and did) pause every Free user forever and make the 3/day branch
  // dead code. Free must return 'send' here; its 3-msg/day allowance is enforced
  // downstream by claim_daily_quota (dailyLimit=3) + the daily-limit pre-check
  // in send-messages. 'trial_expired' is reserved for an actual 'trial' (or
  // unknown/empty legacy plan) whose trial date is expired or missing.
  if (!isPaying && subPlan !== 'free') {
    const trialExpiredAt = trialEnd ? new Date(trialEnd) : null;
    if (!trialExpiredAt || trialExpiredAt < new Date()) {
      return 'trial_expired';
    }
  }

  return 'send';
}

/**
 * Upsell gate at 80% of the daily limit (once per day). Pure so the billing
 * kill-switch semantics stay unit-testable:
 *  - billing OFF → never (no pricing copy may leave the system during the
 *    free beta — the caller passes isBillingEnabled());
 *  - 'business' has no higher tier; 'beta' is the synthetic beta plan and
 *    must never receive pricing copy even if billing were re-enabled while a
 *    'beta' string is still in flight (double belt on top of the flag).
 */
export function shouldSendUpsell(opts: {
  billingEnabled: boolean;
  plan: string;
  newSentToday: number;
  dailyLimit: number;
  upsellSentToday: boolean;
}): boolean {
  if (!opts.billingEnabled) return false;
  if (opts.plan === 'business' || opts.plan === 'beta') return false;
  if (opts.upsellSentToday) return false;
  return opts.newSentToday === Math.floor(opts.dailyLimit * 0.8);
}

/**
 * Computes the rescheduled time for a disconnected instance (tomorrow same time).
 */
export function rescheduleTomorrow(scheduledAt: string): string {
  const tomorrow = new Date(scheduledAt);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString();
}

/**
 * Short retry: pushes scheduled_at forward by N minutes (default 5).
 * Used by the smart-retry path when an instance is briefly disconnected —
 * gives the user a chance to reconnect within the hour before the message
 * gets deferred to next day. Also used for cool-down (30min default override)
 * so a "3 msg / 24h" cap doesn't punish the next message with a 24h shift.
 */
export function rescheduleSoon(scheduledAt: string, minutes: number = 5): string {
  // Anchor on NOW, not the (possibly stale) original scheduled_at, so a badly-late
  // row actually leaves the current cron window instead of staying "due now" for
  // dozens of ticks. A future scheduled_at still anchors on itself (max preserves it).
  const next = new Date(Math.max(Date.now(), new Date(scheduledAt).getTime()));
  next.setMinutes(next.getMinutes() + minutes);
  return next.toISOString();
}

/**
 * Anti-ban jitter: shifts a scheduled_at timestamp by a random offset in
 * [0, maxJitterMs]. Two messages from the same user that share an identical
 * timestamp (e.g. "Convocazione 18:00" sent to 5 contacts) get distributed
 * across the jitter window, breaking the burst pattern that triggers
 * WhatsApp/Baileys rate limiting on the sender's personal number.
 *
 * Default 15s is below the 5-minute cron polling window (so the next cron
 * still picks the message up on time) and below user-perceptible delay for
 * the ICP-D use case (reminders, convocations).
 */
export function applyJitter(scheduledAt: string, maxJitterMs = 15_000): string {
  const base = new Date(scheduledAt).getTime();
  const offset = Math.floor(Math.random() * (maxJitterMs + 1));
  return new Date(base + offset).toISOString();
}

export interface RequeueUpdate {
  status: 'pending' | 'failed';
  // ALWAYS null on a requeue. A row that previously reached the send path has a
  // stale send_attempted_at; leaving it set lets the stale-'processing' recovery
  // (send-messages:156-165) mis-mark the NEXT attempt 'sent' without sending it.
  send_attempted_at: null;
  retry_count?: number;
  error_message?: string;
  scheduled_at?: string;
}

/**
 * Update payload to release a message locked to 'processing' back to 'pending'
 * when the atomic quota claim fails. Clears send_attempted_at (see RequeueUpdate).
 * With `rescheduleTo` (genuine quota exhaustion) the row also moves past the
 * Rome-midnight quota reset: left due-now it would re-enter the cron's
 * limit(25) oldest-first window every tick until midnight, starving other
 * users' delivery (head-of-line; runbook §2).
 */
export function buildQuotaRequeueUpdate(rescheduleTo?: string): RequeueUpdate {
  const update: RequeueUpdate = { status: 'pending', send_attempted_at: null };
  if (rescheduleTo) {
    update.scheduled_at = rescheduleTo;
    update.error_message = 'Limite giornaliero raggiunto — riprogrammato dopo il reset di mezzanotte';
  }
  return update;
}

/**
 * Update payload for a failed send attempt. retry < 3 → back to 'pending'
 * (rescheduled +retry*5min from now); retry >= 3 → terminal 'failed' keeping the
 * original scheduled_at. Always clears send_attempted_at (see RequeueUpdate).
 */
export { isNotOnWhatsAppError } from './message-error';

export function buildFailureRequeueUpdate(args: {
  newRetryCount: number;
  errorMessage: string;
  originalScheduledAt: string;
  now: number;
}): RequeueUpdate {
  const terminal = args.newRetryCount >= 3;
  return {
    status: terminal ? 'failed' : 'pending',
    retry_count: args.newRetryCount,
    error_message: args.errorMessage,
    scheduled_at: terminal
      ? args.originalScheduledAt
      : new Date(args.now + args.newRetryCount * 5 * 60 * 1000).toISOString(),
    send_attempted_at: null,
  };
}

/**
 * Atomic point-of-no-return claim for the actual Evolution send.
 *
 * `send_attempted_at` flips null -> now() exactly once per attempt (it is reset to
 * null on every requeue — see RequeueUpdate), so this conditional UPDATE has
 * exactly ONE winner even if two concurrent cron invocations both passed the
 * upstream status='processing' CAS. That CAS empirically leaked in prod
 * (2026-06-22 double-delivery: two triggers fired at :00, both claimed, both sent);
 * this gate is the real safety net because it sits AFTER the random jitter, so the
 * two invocations reach it staggered and the DB serializes them cleanly.
 *
 * Returns true iff THIS invocation won the claim and may send. false => a
 * concurrent invocation already owns this send; the caller MUST skip without
 * re-sending AND refund the quota slot it claimed pre-send (both invocations
 * incremented messages_sent_today, only the winner delivers).
 */
export async function claimSendAttempt(supabase: SupabaseClient, msgId: string): Promise<boolean> {
  const { data } = await supabase
    .from('scheduled_messages')
    .update({ send_attempted_at: new Date().toISOString() })
    .eq('id', msgId)
    .is('send_attempted_at', null)
    .select('id');
  return Array.isArray(data) && data.length > 0;
}

// ── Giro "errori reali" (audit 25 set 2026) ──────────────────────────────────

/** Soglia del circuit breaker per utente (destinatari distinti falliti in 24h). */
export const BREAKER_THRESHOLD = 5;

// Motivi di gruppo che non pesano sul breaker (vedi countBreakerFailures).
const GROUP_NOT_BREAKER = /\[object object\]|not-acceptable|no sessions/i;

/**
 * Quanti guasti "veri" pesano sul circuit breaker dell'utente.
 *
 * Prima contava OGNI riga 'failed' delle ultime 24h: cinque numeri sbagliati
 * (un fisso d'ufficio, un genitore che ha cambiato SIM) congelavano TUTTI i
 * promemoria dell'utente, anche quelli ai clienti validi, e ogni "Riprova"
 * dello stesso numero aggiungeva un'altra riga. Un exists:false dice qualcosa
 * sul DESTINATARIO, non sulla salute del numero che invia: resta fuori. Il
 * resto si conta per destinatario distinto.
 */
export function countBreakerFailures(rows: Array<{ recipient_number?: string | null; error_message?: string | null }>): number {
  const recipients = new Set<string>();
  for (const r of rows || []) {
    if (notOnWhatsApp(r?.error_message)) continue;
    // Allegato già tolto dalla pulizia dei 30 giorni: è un problema della
    // RIGA (il file non c'è più), non del numero che invia.
    if (typeof r?.error_message === 'string' && r.error_message.startsWith(MEDIA_EXPIRED_ERROR)) continue;
    // Gruppo sparito/lasciato o non consegnabile (#2521): dice qualcosa sul
    // GRUPPO, non sul numero che invia. Cintura: con classifyGroupSendFailure
    // queste righe vanno in pausa e non dovrebbero mai arrivare a 'failed'.
    if (isGroupJid(r?.recipient_number) && GROUP_NOT_BREAKER.test(String(r?.error_message || ''))) continue;
    recipients.add(String(r?.recipient_number || ''));
  }
  return recipients.size;
}

/**
 * Motivo scritto dal cron su una riga con media_type ma senza media_url: la
 * pulizia dei 30 giorni (cleanup-media) ha tolto il file e lasciato il tipo
 * apposta, come segnale. Spedirla come solo testo manderebbe il promemoria
 * senza il PDF (o un corpo vuoto → 400 e tre tentativi bruciati).
 */
export const MEDIA_EXPIRED_ERROR = 'Allegato non più disponibile (rimosso dopo 30 giorni): usa "Duplica" e caricalo di nuovo';

export const TEXT_SEND_TIMEOUT_MS = 8000;
export const MEDIA_SEND_TIMEOUT_CAP_MS = 40_000;
export const GROUP_TEXT_SEND_TIMEOUT_MS = 25_000;
const MEDIA_MS_PER_MB = 2000;

/**
 * Timeout dell'invio a Evolution. Per un allegato Evolution deve scaricare il
 * file da Supabase, cifrarlo, caricarlo sui server media di WhatsApp e poi
 * inoltrare il messaggio: con gli 8 s del testo un PDF da 10-16 MB andava in
 * abort e la riga finiva 'sent' senza prova. 8 s + 2 s per MB, tetto 40 s
 * (la route esporta maxDuration=60). Dimensione ignota → il tetto.
 */
export function sendTimeoutMs(kind: 'text' | 'media', sizeBytes?: number | null, opts: { group?: boolean } = {}): number {
  if (opts.group) {
    // Il primo invio in un gruppo apre una sessione per ogni dispositivo dei
    // membri: 8 s non bastano, e un abort qui è un "incerto" che nessuno
    // può verificare. Allegati: la formula, tra 25 e 40 s.
    if (kind === 'text') return GROUP_TEXT_SEND_TIMEOUT_MS;
    return Math.min(MEDIA_SEND_TIMEOUT_CAP_MS, Math.max(GROUP_TEXT_SEND_TIMEOUT_MS, sendTimeoutMs('media', sizeBytes)));
  }
  if (kind === 'text') return TEXT_SEND_TIMEOUT_MS;
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return MEDIA_SEND_TIMEOUT_CAP_MS;
  const mb = Math.ceil(sizeBytes / (1024 * 1024));
  return Math.min(MEDIA_SEND_TIMEOUT_CAP_MS, TEXT_SEND_TIMEOUT_MS + mb * MEDIA_MS_PER_MB);
}

export type GroupSendOutcome = 'unreachable' | 'undeliverable' | 'retry' | 'indeterminate';

// Errori di fetch per cui la richiesta non è mai partita (nessun socket aperto).
const NOT_SENT_CAUSES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH'];

/**
 * Esito di un invio FALLITO in un gruppo (D10). Un doppione in un gruppo lo
 * vedono tutti: si ritenta solo ciò che è di sicuro prima dell'inoltro.
 * In Evolution 2.3.7 qualsiasi errore dentro sendMessageWithTyping, prima o
 * dopo l'inoltro, esce come 400; i 500 nascono prima (whatsappNumber fuori dal
 * try, prepareMediaMessage). 502/503/504 li produce qualcosa davanti.
 *  - unreachable: 400 con "[object Object]" (NotFoundException('Group not found') serializzato)
 *  - undeliverable: 400 not-acceptable / No sessions (Baileys #2521)
 *  - retry: la richiesta non è partita, o è stata respinta prima dell'inoltro
 *  - indeterminate: può essere partita → 'sent' col marcatore, niente retry
 * Solo per le righe di gruppo: per le persone il cron non cambia.
 */
export function classifyGroupSendFailure(err: unknown): GroupSendOutcome {
  const e = err as any;
  // Il chiamante gestisce già il timeout; difesa: un abort può essere dopo l'inoltro.
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return 'indeterminate';
  if (e?.name === 'TypeError') {
    const cause = e?.cause;
    if (NOT_SENT_CAUSES.indexOf(String(cause?.code || '')) !== -1 || cause?.name === 'ConnectTimeoutError') return 'retry';
    return 'indeterminate';
  }
  const msg = typeof e?.message === 'string' ? e.message : '';
  const m = /^HTTP (\d{3}):\s?([\s\S]*)$/.exec(msg);
  // Errori nostri prima della fetch (es. "Failed to sign media URL").
  if (!m) return 'retry';
  const status = Number(m[1]);
  const body = m[2].toLowerCase();
  if (status === 400) {
    if (body.includes('[object object]')) return 'unreachable';
    if (/not-acceptable|no sessions/.test(body)) return 'undeliverable';
    if (looksDisconnected(body) || /overlimit|timed out|text is required|requires property|is not one of|does not match/.test(body)) return 'retry';
    return 'indeterminate';
  }
  if (status === 500) return 'retry';
  if (status > 500) return 'indeterminate';
  return 'retry';
}

export const COOLDOWN_MAX_PER_RECIPIENT = 3;
const COOLDOWN_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Cool-down "max 3 messaggi in 24h alla stessa persona": l'istante in cui il
 * prossimo può davvero partire, cioè quando nella finestra mobile ne restano
 * max-1. Prima si spostava +30 min e si riprovava ogni mezz'ora fino al giorno
 * dopo, con un motivo ("+30 min") falso. null = nessun blocco.
 */
export function cooldownReleaseAt(sentTimes: Date[], max: number = COOLDOWN_MAX_PER_RECIPIENT): Date | null {
  const sorted = (sentTimes || []).map((d) => d.getTime()).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (sorted.length < max) return null;
  return new Date(sorted[sorted.length - max] + COOLDOWN_WINDOW_MS);
}

export const DISCONNECT_RETRY_THRESHOLD = 12;

/**
 * Scaletta della disconnessione: 12 giri (circa 1 h), poi domani. Il contatore
 * è CUMULATIVO (è anche il segnale "questa riga è arretrata"), ma la soglia
 * scatta ogni 12 giri e non "da 12 in su": prima, dopo un blackout lungo la
 * riga restava a 12 e il giorno dopo bastava un 'connecting' di pochi secondi
 * per rinviarla di un altro giorno intero, senza nessuna tolleranza.
 * 'connecting' è quasi sempre un riaggancio di Baileys: i primi 3 giri di
 * ogni scaletta ricontrollano dopo 1 minuto invece di 5.
 */
export function disconnectRetryStep(prevCount: number, connectionStatus: string | null | undefined): { newCount: number; retryInMinutes: number | null } {
  const prev = Number.isFinite(prevCount) && prevCount > 0 ? Math.floor(prevCount) : 0;
  const newCount = prev + 1;
  const pos = newCount % DISCONNECT_RETRY_THRESHOLD;
  if (pos === 0) return { newCount, retryInMinutes: null };
  const minutes = connectionStatus === 'connecting' && pos <= 3 ? 1 : 5;
  return { newCount, retryInMinutes: minutes };
}

/**
 * La riga è in scaletta PER COLPA DEL SISTEMA adesso? Il contatore da solo non
 * basta: Posticipa e Modifica (PATCH /api/messages) riscrivono scheduled_at e
 * azzerano error_message ma non disconnect_retry_count, quindi un contatore
 * vecchio restava su un orario scelto di nuovo dall'utente e il cron lo
 * spostava a domattina (o di +90 s). Conta solo se l'ultimo motivo l'ha
 * scritto il cron per la disconnessione o per il rientro dal backlog.
 */
const DISCONNECT_BACKLOG_MARKER = /^(Istanza disconnessa|WhatsApp ricollegato)/;
export function isDisconnectBacklogRow(disconnectRetryCount: number | null | undefined, errorMessage: string | null | undefined): boolean {
  return (disconnectRetryCount || 0) > 0 && typeof errorMessage === 'string' && DISCONNECT_BACKLOG_MARKER.test(errorMessage);
}

/**
 * Riga trattenuta per disconnessione da almeno 30 min GARANTITI, o già
 * rinviata a domani: il suo orario non è più quello scelto a mano
 * dall'utente ma uno calcolato dal sistema, quindi vale la fascia 08-21.
 * Sotto i 30 min resta l'orario dell'utente (un glitch alle 22:00 non sposta
 * il promemoria alle 08:00 del giorno dopo).
 * Si contano i MINUTI, non i giri: in 'connecting' i primi 3 giri durano
 * 1 minuto, e "6 giri" erano 18 min, non 30. Il conto usa la scaletta più
 * veloce possibile (disconnectRetryStep in 'connecting'): meglio lasciare
 * l'orario dell'utente qualche minuto di troppo che spostarlo a domattina.
 */
export const LATE_BACKLOG_MIN_MINUTES = 30;
export function isLateDisconnectBacklog(disconnectRetryCount: number | null | undefined, errorMessage: string | null | undefined): boolean {
  if (!isDisconnectBacklogRow(disconnectRetryCount, errorMessage)) return false;
  const n = Math.floor(disconnectRetryCount || 0);
  let minutes = 0;
  for (let k = 0; k < n; k++) {
    const step = disconnectRetryStep(k, 'connecting');
    if (step.retryInMinutes === null) return true; // già rinviata a domani
    minutes += step.retryInMinutes;
    if (minutes >= LATE_BACKLOG_MIN_MINUTES) return true;
  }
  return false;
}

/**
 * Alla riconnessione tutto ciò che era in scaletta diventa dovuto nello stesso
 * tick: fino a 5 invii in parallelo in ~3 s da un device appena ricollegato,
 * il pattern "burst da istanza fresca" che anti-ban.ts vuole evitare. Per ogni
 * utente la prima riga arretrata (isDisconnectBacklogRow) parte, le altre
 * slittano di +90 s l'una (stesso passo di spreadCoTimed). Solo istanze già
 * 'open': una riga ancora disconnessa deve fare la sua scaletta.
 */
export function planBacklogSpread<T extends {
  id: string;
  instance_phone?: string | null;
  disconnect_retry_count?: number | null;
  error_message?: string | null;
  user_instances?: { connection_status?: string | null; phone_number?: string | null } | null;
}>(rows: T[], nowMs: number, stepMs: number = SPREAD_STEP_MS): { keep: T[]; defer: Array<{ id: string; scheduledAt: string }> } {
  const keep: T[] = [];
  const defer: Array<{ id: string; scheduledAt: string }> = [];
  const seen: Record<string, number> = {};
  for (const r of rows || []) {
    const backlog = isDisconnectBacklogRow(r.disconnect_retry_count, r.error_message) && r.user_instances?.connection_status === 'open';
    if (!backlog) { keep.push(r); continue; }
    const owner = r.instance_phone || r.user_instances?.phone_number || 'unknown';
    const k = seen[owner] || 0;
    seen[owner] = k + 1;
    if (k === 0) keep.push(r);
    else defer.push({ id: r.id, scheduledAt: new Date(nowMs + k * stepMs).toISOString() });
  }
  return { keep, defer };
}
