'use client';
import React, { useMemo, useState, useEffect } from 'react';
import { Search, X, MoreVertical, Calendar, Inbox, Clock, AlertCircle, RotateCcw, Plug, Loader2, Paperclip, UserRound, Users } from 'lucide-react';
import { ContactAvatar } from '../../components/ContactAvatar';
import { StatusBadge, formatCountdown, formatRelativePast } from './StatusBadge';
import { MessageActionsSheet } from './MessageActionsSheet';
import { DeliveryStatusIcon } from './DeliveryStatusIcon';
import FakeDoorCard from './FakeDoorCard';
import { mapErrorReason, isNotOnWhatsAppError, isIndeterminateSend, mapPendingReason } from '../lib/message-error';
import { looksLikeLidDigits, isGroupJid, recipientDisplayName } from '../lib/jid';
import { recurrenceTagLabel } from '../lib/schedule-quick';
import { romeWallClock } from '../lib/rome-time';

export interface ScheduledMessage {
  id: string;
  recipient_name?: string;
  recipient_number?: string;
  parsed_message?: string;
  caption?: string;
  scheduled_at: string;
  status: string;
  retry_count?: number;
  error_message?: string;
  photo_url?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  // Allegato (GET /api/messages fa select('*'): i campi c'erano già, la lista li ignorava)
  media_type?: 'image' | 'video' | 'document' | 'audio' | string | null;
  media_url?: string | null;
  media_filename?: string | null;
  // Id di Evolution (key.id): assente su una riga 'sent' = invio mai confermato.
  evolution_message_id?: string | null;
  recurrence_rule?: string | null;
}

const MEDIA_LABEL: Record<string, string> = { image: 'Foto', video: 'Video', document: 'Documento', audio: 'Audio' };

// Chip dell'allegato nella lista: prima un messaggio in attesa con una foto
// dentro era indistinguibile da uno senza (22 set 2026, segnalato da Andrea).
export function AttachmentChip({ msg }: { msg: Pick<ScheduledMessage, 'media_type' | 'media_filename'> }) {
  if (!msg.media_type) return null;
  const label = MEDIA_LABEL[msg.media_type] || 'Allegato';
  return (
    <span
      className="inline-flex items-center gap-1 max-w-full text-[11px] font-medium text-emerald-300 bg-emerald-500/10 rounded-full px-2 py-0.5"
      aria-label={`Allegato: ${label}`}
      title={msg.media_filename || label}
      data-testid="attachment-chip"
    >
      <Paperclip className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}{msg.media_filename ? ` · ${msg.media_filename}` : ''}</span>
    </span>
  );
}

// Chip "Gruppo": la riga va in un gruppo WhatsApp, non a una persona.
export function GroupTag() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 text-[#BFF0D5] bg-[#1F5A45]/60"
      data-testid="group-tag"
    >
      <Users className="w-3 h-3 shrink-0" aria-hidden="true" />
      Gruppo
    </span>
  );
}

// "↻ ogni martedì": prima nella lista niente diceva che una riga era una serie,
// e "Elimina" sul singolo martedì fermava tutta la serie senza avvisare.
export function RecurrenceTag({ rule }: { rule?: string | null }) {
  const label = recurrenceTagLabel(rule);
  if (!label) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-300 bg-sky-500/10 rounded-full px-2 py-0.5"
      title={`Promemoria ricorrente: ${label}`}
      data-testid="recurrence-tag"
    >
      ↻ {label}
    </span>
  );
}

export type DeleteScope = 'occurrence' | 'series';

interface Props {
  messages: ScheduledMessage[];
  // scope solo per le righe ricorrenti: 'occurrence' = salta questa volta,
  // 'series' = ferma la serie. Assente = riga singola, si cancella.
  onDelete: (id: string, scope?: DeleteScope) => void;
  onDuplicate: (msg: ScheduledMessage) => void;
  onEdit: (msg: ScheduledMessage) => void;
  onPauseToggle: (msg: ScheduledMessage) => void;
  onRetry: (msg: ScheduledMessage) => Promise<void> | void;
  onSnooze: (msg: ScheduledMessage, iso: string, label: string) => void;
  onShowToast: (text: string, undo?: () => void) => void;
  // Numero che WhatsApp non conosce: riprovare non serve, si riprogramma lo
  // stesso testo scegliendo un altro contatto. Opzionale (senza, niente bottone).
  onChooseOtherContact?: (msg: ScheduledMessage) => void;
  // Live Evolution link state — drives the "Ricollega WhatsApp" CTA on a
  // failed card even when the stored error string is ambiguous.
  connected: boolean;
  // Porta finta "foto del calendario" (GET /api/feedback dalla dashboard).
  fakeDoor?: { active: boolean; answered: boolean };
  onFakeDoorAnswered?: () => void;
}

type Tab = 'upcoming' | 'sent';

// Buckets a future-dated message falls into.
function upcomingBucket(scheduledAt: string): 'today' | 'tomorrow' | 'thisWeek' | 'later' {
  const target = new Date(scheduledAt);
  const now = new Date();
  const tMid = new Date(target); tMid.setHours(0, 0, 0, 0);
  const nMid = new Date(now); nMid.setHours(0, 0, 0, 0);
  const diff = Math.round((tMid.getTime() - nMid.getTime()) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return 'thisWeek';
  return 'later';
}

function sentBucket(scheduledAt: string): 'recent' | 'thisWeek' | 'earlier' {
  const target = new Date(scheduledAt);
  const now = new Date();
  const tMid = new Date(target); tMid.setHours(0, 0, 0, 0);
  const nMid = new Date(now); nMid.setHours(0, 0, 0, 0);
  const diff = Math.round((nMid.getTime() - tMid.getTime()) / 86400000);
  if (diff <= 1) return 'recent';   // today + yesterday
  if (diff < 7) return 'thisWeek';
  return 'earlier';
}

const UPCOMING_GROUP_TITLES: Record<string, string> = {
  today: 'Oggi',
  tomorrow: 'Domani',
  thisWeek: 'Questa settimana',
  later: 'Più tardi',
};
const SENT_GROUP_TITLES: Record<string, string> = {
  recent: 'Recente',
  thisWeek: 'Questa settimana',
  earlier: 'Più indietro',
};

const UPCOMING_ORDER = ['today', 'tomorrow', 'thisWeek', 'later'] as const;
const SENT_ORDER = ['recent', 'thisWeek', 'earlier'] as const;

const UPCOMING_STATUSES = new Set([
  'pending', 'sending', 'paused',
  'awaiting_confirm', 'awaiting_contact', 'awaiting_datetime', 'awaiting_message',
]);
// 'failed' is intentionally NOT here — failed messages get their own
// "Non inviati" partition surfaced at the top of the Prossimi tab (they aren't
// "inviati", and the Riprova affordance has to be where the user looks).
const SENT_STATUSES = new Set(['sent', 'cancelled']);

export default function MessagesSection({
  messages, onDelete, onDuplicate, onEdit, onPauseToggle, onRetry, onSnooze, onShowToast, onChooseOtherContact, connected,
  fakeDoor, onFakeDoorAnswered,
}: Props) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState<ScheduledMessage | null>(null);
  // Riga ricorrente su cui l'utente ha toccato "Elimina": prima si chiede
  // "Solo questa volta" / "Tutta la serie".
  const [deleteAsk, setDeleteAsk] = useState<ScheduledMessage | null>(null);

  // Recompute every 60s so countdowns stay fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // Split into failed (own actionable bucket) vs upcoming vs sent
  const { upcoming, sent, failed } = useMemo(() => {
    const up: ScheduledMessage[] = [];
    const sn: ScheduledMessage[] = [];
    const fl: ScheduledMessage[] = [];
    for (const m of messages) {
      if (m.status === 'failed') fl.push(m);
      else if (UPCOMING_STATUSES.has(m.status)) up.push(m);
      else if (SENT_STATUSES.has(m.status)) sn.push(m);
      else up.push(m); // unknown statuses default to upcoming
    }
    // Upcoming: ascending (next first)
    up.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    // Sent + failed: descending (most recent first)
    sn.sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
    fl.sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
    return { upcoming: up, sent: sn, failed: fl };
  }, [messages]);

  // Apply search
  const q = query.trim().toLowerCase();
  const filter = (arr: ScheduledMessage[]) =>
    !q ? arr : arr.filter((m) => {
      const name = (m.recipient_name || '').toLowerCase();
      // Le cifre di un JID di gruppo non si cercano (e non si mostrano): "gruppo" sì.
      const num = isGroupJid(m.recipient_number) ? 'gruppo' : (m.recipient_number || '').toLowerCase();
      const text = (m.parsed_message || m.caption || '').toLowerCase();
      return name.includes(q) || num.includes(q) || text.includes(q);
    });

  const visibleUpcoming = filter(upcoming);
  const visibleSent = filter(sent);
  const visibleFailed = filter(failed);
  const list = tab === 'upcoming' ? visibleUpcoming : visibleSent;
  const buckets = tab === 'upcoming' ? UPCOMING_ORDER : SENT_ORDER;
  const titles = tab === 'upcoming' ? UPCOMING_GROUP_TITLES : SENT_GROUP_TITLES;
  const getBucket = tab === 'upcoming' ? upcomingBucket : sentBucket;

  // Failed cards live at the top of the Prossimi tab (unfinished business),
  // never under Inviati. The Prossimi tab count includes them.
  const showFailedSection = tab === 'upcoming' && visibleFailed.length > 0;
  const upcomingTabCount = visibleUpcoming.length + visibleFailed.length;

  // Group by bucket
  const grouped = useMemo(() => {
    const g: Record<string, ScheduledMessage[]> = {};
    for (const m of list) {
      const k = getBucket(m.scheduled_at);
      (g[k] ||= []).push(m);
    }
    return g;
  }, [list, getBucket]);

  // Stats for the header
  const nextUpcoming = upcoming.find((m) => m.status === 'pending' || m.status === 'sending');
  const nextCountdown = nextUpcoming ? formatCountdown(nextUpcoming.scheduled_at) : null;
  const sentThisMonth = useMemo(() => {
    const now = new Date();
    return sent.filter((m) => {
      if (m.status !== 'sent') return false;
      const d = new Date(m.scheduled_at);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
  }, [sent]);

  // Il toast lo mostra la dashboard SOLO dopo la risposta del server: prima qui
  // usciva "Eliminato" subito, anche quando il server poi rifiutava (409).
  // Una riga ricorrente è UNA occorrenza di una serie: cancellarla senza
  // chiedere fermava la serie per sempre (il cron non ricrea una catena che
  // finisce con una riga cancellata).
  const handleDelete = (msg: ScheduledMessage) => {
    if (msg.recurrence_rule) {
      setDeleteAsk(msg);
      return;
    }
    onDelete(msg.id);
  };

  return (
    <div>
      {/* Header: title + counters + actions */}
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-white">I tuoi messaggi</h2>
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {nextCountdown ? (
              <>Prossimo invio <span className="text-primary font-medium">{nextCountdown.replace('Parte tra ', 'tra ')}</span></>
            ) : upcoming.length === 0 && sent.length > 0 ? (
              <>Nessun invio in coda · {sentThisMonth} inviati questo mese</>
            ) : (
              <>{upcoming.length} in coda{sentThisMonth > 0 ? ` · ${sentThisMonth} inviati questo mese` : ''}</>
            )}
          </p>
        </div>
        <button
          onClick={() => { setSearchOpen((v) => !v); if (searchOpen) setQuery(''); }}
          aria-label="Cerca"
          className="shrink-0 p-2.5 rounded-full bg-[#202C33] border border-[#2A3942] text-gray-300 hover:text-white hover:bg-[#2A3942] transition-colors"
        >
          {searchOpen ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
        </button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="mb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca per nome, numero o testo…"
              className="w-full bg-[#202C33] border border-[#2A3942] focus:border-primary rounded-full pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition-colors"
            />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 bg-[#202C33] border border-[#2A3942] rounded-full p-1 w-fit">
        <TabButton active={tab === 'upcoming'} onClick={() => setTab('upcoming')} count={upcomingTabCount}>
          Prossimi
        </TabButton>
        <TabButton active={tab === 'sent'} onClick={() => setTab('sent')} count={visibleSent.length}>
          Inviati
        </TabButton>
      </div>

      {/* List */}
      {list.length === 0 && !showFailedSection ? (
        <div className="bg-[#202C33] rounded-2xl border border-[#2A3942] p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[#2A3942] flex items-center justify-center">
            {tab === 'upcoming' ? <Calendar className="w-5 h-5 text-gray-500" /> : <Inbox className="w-5 h-5 text-gray-500" />}
          </div>
          <p className="text-sm text-gray-400">
            {q
              ? `Nessun risultato per "${query}"`
              : tab === 'upcoming'
                ? 'Nessun messaggio in coda. Programmane uno col bottone verde.'
                : 'Nessun messaggio inviato ancora.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Non inviati — actionable failed cards pinned to the top of the
              Prossimi tab so the Riprova affordance is where the user looks. */}
          {showFailedSection && (
            <div>
              <div className="flex items-baseline gap-2 mb-2 px-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-red-400/90">
                  Non inviati
                </h3>
                <span className="text-[11px] text-gray-600">·</span>
                <span className="text-[11px] text-gray-500">{visibleFailed.length}</span>
              </div>
              <div className="space-y-2">
                {visibleFailed.map((msg) => (
                  <FailedMessageCard
                    key={msg.id}
                    msg={msg}
                    connected={connected}
                    onRetry={onRetry}
                    onDuplicate={onDuplicate}
                    onChooseOtherContact={onChooseOtherContact}
                    onOpenActions={() => setActionMsg(msg)}
                  />
                ))}
              </div>
            </div>
          )}

          {buckets.map((bucket) => {
            const items = grouped[bucket];
            if (!items || items.length === 0) return null;
            return (
              <div key={bucket}>
                <div className="flex items-baseline gap-2 mb-2 px-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    {titles[bucket]}
                  </h3>
                  <span className="text-[11px] text-gray-600">·</span>
                  <span className="text-[11px] text-gray-500">{items.length}</span>
                </div>
                <div className="bg-[#202C33] rounded-2xl border border-[#2A3942] divide-y divide-[#2A3942] overflow-hidden">
                  {items.map((msg) => (
                    <MessageRow
                      key={msg.id}
                      msg={msg}
                      tab={tab}
                      onOpenActions={() => setActionMsg(msg)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'upcoming' && !q && fakeDoor?.active && !fakeDoor.answered && (
        <FakeDoorCard onAnswered={onFakeDoorAnswered ?? (() => {})} />
      )}

      {/* Actions bottom-sheet */}
      <MessageActionsSheet
        open={!!actionMsg}
        onClose={() => setActionMsg(null)}
        title={actionMsg && isGroupJid(actionMsg.recipient_number)
          ? recipientDisplayName(actionMsg)
          : actionMsg?.recipient_name || actionMsg?.recipient_number || ''}
        onDuplicate={() => actionMsg && onDuplicate(actionMsg)}
        onEdit={() => actionMsg && onEdit(actionMsg)}
        onPauseToggle={() => actionMsg && onPauseToggle(actionMsg)}
        onRetry={() => actionMsg && onRetry(actionMsg)}
        onDelete={() => actionMsg && handleDelete(actionMsg)}
        isPaused={actionMsg?.status === 'paused'}
        canEdit={!!actionMsg && UPCOMING_STATUSES.has(actionMsg.status)}
        canPause={!!actionMsg && (actionMsg.status === 'pending' || actionMsg.status === 'paused')}
        canRetry={!!actionMsg && isRetryable(actionMsg)}
        canDelete={!!actionMsg && (UPCOMING_STATUSES.has(actionMsg.status) || actionMsg.status === 'failed')}
        canSnooze={!!actionMsg && (actionMsg.status === 'pending' || actionMsg.status === 'paused')}
        scheduledAt={actionMsg?.scheduled_at}
        onSnooze={(iso, label) => actionMsg && onSnooze(actionMsg, iso, label)}
      />

      {deleteAsk && (
        <RecurringDeleteDialog
          msg={deleteAsk}
          onCancel={() => setDeleteAsk(null)}
          onChoose={(scope) => { const id = deleteAsk.id; setDeleteAsk(null); onDelete(id, scope); }}
        />
      )}
    </div>
  );
}

function RecurringDeleteDialog({ msg, onCancel, onChoose }: {
  msg: ScheduledMessage; onCancel: () => void; onChoose: (scope: DeleteScope) => void;
}) {
  const label = recurrenceTagLabel(msg.recurrence_rule) || 'ricorrente';
  return (
    <div className="fixed inset-0 z-sheet flex items-end sm:items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurring-delete-title"
        data-testid="recurring-delete-dialog"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-sm sm:mx-4 bg-[#1F2C33] border-t sm:border border-[#2A3942] rounded-t-2xl sm:rounded-2xl p-5 pb-safe shadow-2xl"
      >
        <h3 id="recurring-delete-title" className="text-white font-semibold">Promemoria ricorrente</h3>
        <p className="text-sm text-gray-400 mt-1">
          Questo messaggio parte ↻ {label}. Vuoi togliere solo questa volta o fermare tutta la serie?
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => onChoose('occurrence')}
            className="w-full py-3 rounded-xl bg-primary/15 text-primary font-semibold hover:bg-primary/25 transition-colors"
          >
            Solo questa volta
          </button>
          <button
            onClick={() => onChoose('series')}
            className="w-full py-3 rounded-xl bg-red-500/10 text-red-400 font-semibold hover:bg-red-500/20 transition-colors"
          >
            Tutta la serie
          </button>
          <button
            onClick={onCancel}
            className="w-full py-2.5 rounded-xl text-gray-400 hover:text-gray-200 transition-colors"
          >
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, count, children }: {
  active: boolean; onClick: () => void; count: number; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
        active
          ? 'bg-white/[0.10] text-white shadow-sm'
          : 'text-gray-400 hover:text-white'
      }`}
    >
      {children}
      <span className={`ml-1.5 text-[11px] tabular-nums ${active ? 'opacity-80' : 'opacity-60'}`}>
        {count}
      </span>
    </button>
  );
}

// Riprova ha senso solo se un nuovo tentativo può andare diversamente. Numero
// sconosciuto a WhatsApp ("exists": false) o allegato rifiutato: stesso esito,
// e ogni tentativo in più avvisa il proprietario e pesa sul freno dei fallimenti.
// Il menu ⋮ deve dire la stessa cosa della card rossa.
function isRetryable(msg: ScheduledMessage): boolean {
  if (msg.status !== 'failed') return false;
  const isGroup = isGroupJid(msg.recipient_number);
  if (!isGroup && isNotOnWhatsAppError(msg.error_message)) return false;
  return mapErrorReason(msg.error_message, { hasMedia: !!msg.media_type, isGroup }).kind !== 'media_rejected';
}

// Righe in coda che il sistema ha spostato o messo in pausa: il motivo è in
// error_message (vedi mapPendingReason). Una pausa decisa dall'utente non ha
// motivo: su una riga in pausa si mostrano solo i motivi di pausa veri
// ("In pausa: ..." di suppressions/logout, trial scaduto). Un vecchio "HTTP
// 500" o "riprogrammato a domattina" rimasto da prima della pausa diceva
// "Nuovo tentativo a breve" su un messaggio che non parte.
function pendingReasonFor(msg: ScheduledMessage): string | null {
  if (msg.status === 'pending') return mapPendingReason(msg.error_message);
  if (msg.status !== 'paused') return null;
  const s = (msg.error_message || '').trim().toLowerCase();
  if (!s.startsWith('in pausa') && !s.startsWith('trial scaduto')) return null;
  return mapPendingReason(msg.error_message);
}

function MessageRow({ msg, tab, onOpenActions }: {
  msg: ScheduledMessage; tab: Tab; onOpenActions: () => void;
}) {
  const text = msg.parsed_message || msg.caption || '';
  const isGroup = isGroupJid(msg.recipient_number);
  const displayName = recipientDisplayName(msg);

  // Long-press to open actions on mobile
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = React.useRef(false);
  const startPress = () => {
    moved.current = false;
    pressTimer.current = setTimeout(() => { if (!moved.current) onOpenActions(); }, 500);
  };
  const cancelPress = () => { if (pressTimer.current) clearTimeout(pressTimer.current); };

  const countdown = tab === 'upcoming' ? formatCountdown(msg.scheduled_at) || undefined : undefined;
  const relative = tab === 'sent' ? formatRelativePast(msg.scheduled_at) : '';
  // Invio senza conferma (timeout/lambda morta): non la stessa ✓ di uno confermato.
  const unverified = isIndeterminateSend(msg);
  const pendingReason = pendingReasonFor(msg);

  // Ora italiana, come nella modale (telefono in un altro fuso: stessi numeri
  // che l'utente ha scelto). In Italia è identico a new Date().
  const target = romeWallClock(new Date(msg.scheduled_at));
  const hh = target.getHours().toString().padStart(2, '0');
  const mm = target.getMinutes().toString().padStart(2, '0');
  const time = `${hh}:${mm}`;
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const dateStr = `${target.getDate()} ${months[target.getMonth()]}`;

  return (
    <div
      className="flex items-start gap-3 p-4 hover:bg-[#2A3942]/50 transition-colors"
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={() => { moved.current = true; cancelPress(); }}
      onContextMenu={(e) => { e.preventDefault(); onOpenActions(); }}
    >
      <ContactAvatar
        name={msg.recipient_name}
        number={msg.recipient_number || ''}
        size="md"
        photoSrc={msg.photo_url || undefined}
        variant={isGroup ? 'group' : undefined}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <p className="font-semibold text-sm truncate text-white">{displayName}</p>
          <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-gray-500 font-medium tabular-nums">
            {tab === 'upcoming' ? (
              <span><Clock className="inline w-3 h-3 -mt-0.5 mr-1" />{dateStr} · {time}</span>
            ) : (
              <span>{relative}</span>
            )}
          </div>
        </div>

        {text && (
          <p className="text-sm text-gray-400 mt-0.5 mb-2 line-clamp-2 leading-snug">{text}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {unverified ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 bg-amber-500/12 text-amber-400 ring-amber-500/30"
              title={isGroup
                ? "WhatsApp non ci ha confermato l'invio: guarda nel gruppo se è arrivato prima di rimandarlo."
                : "WhatsApp non ha confermato l'invio: controlla nella chat se è arrivato prima di rimandarlo."}
              data-testid="status-unverified"
            >
              <AlertCircle className="w-3 h-3" aria-hidden="true" />
              Da verificare
            </span>
          ) : (
            <>
              <StatusBadge status={msg.status} countdown={countdown} />
              <DeliveryStatusIcon msg={msg} isGroup={isGroup} />
            </>
          )}
          {isGroup && <GroupTag />}
          <AttachmentChip msg={msg} />
          <RecurrenceTag rule={msg.recurrence_rule} />
        </div>
        {pendingReason && (
          <p className="text-[12px] text-gray-500 mt-1.5 leading-snug" data-testid="pending-reason">
            {pendingReason}
          </p>
        )}
      </div>

      <button
        onClick={onOpenActions}
        aria-label="Azioni messaggio"
        className="text-gray-500 hover:text-white shrink-0 p-2 -m-2 transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
    </div>
  );
}

// Distinct red card for a message the cron gave up on (status='failed').
// Surfaces the human error reason + an inline Riprova; a dropped-session
// failure also gets a "Ricollega WhatsApp" CTA, since Riprova alone won't fix
// it. Riprova shows a spinner while the re-queue request is in flight; the
// card then disappears (the message becomes 'pending' and rejoins the queue).
function FailedMessageCard({ msg, connected, onRetry, onDuplicate, onChooseOtherContact, onOpenActions }: {
  msg: ScheduledMessage;
  connected: boolean;
  onRetry: (msg: ScheduledMessage) => Promise<void> | void;
  onDuplicate: (msg: ScheduledMessage) => void;
  onChooseOtherContact?: (msg: ScheduledMessage) => void;
  onOpenActions: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const text = msg.parsed_message || msg.caption || '';
  const isGroup = isGroupJid(msg.recipient_number);
  const displayName = recipientDisplayName(msg);
  const reason = mapErrorReason(msg.error_message, { hasMedia: !!msg.media_type, isGroup });
  // Only WhatsApp's own "exists": false is permanent; any other 400 keeps Riprova.
  // Per i gruppi niente "numero non su WhatsApp" né suggerimento LID.
  const notOnWhatsApp = !isGroup && isNotOnWhatsAppError(msg.error_message);
  // Allegato rifiutato: rimandare lo stesso file dà lo stesso 400. Si riapre il
  // messaggio (Duplica porta con sé testo e allegato) per cambiare il file.
  const mediaRejected = reason.kind === 'media_rejected';
  const canRetry = isRetryable(msg);
  // Offer "Ricollega" when the failure looks like a dropped session OR the
  // Evolution link is currently down — a plain Riprova won't fix either.
  const showReconnect = (reason.kind === 'disconnected' || !connected) && !notOnWhatsApp;

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry(msg);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="rounded-xl bg-[#2a1f1f] ring-1 ring-red-500/40 p-3 flex items-start gap-3">
      <ContactAvatar
        name={msg.recipient_name}
        number={msg.recipient_number || ''}
        size="md"
        photoSrc={msg.photo_url || undefined}
        variant={isGroup ? 'group' : undefined}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <p className="font-semibold text-sm truncate text-white">{displayName}</p>
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-red-400">
            <AlertCircle className="w-3 h-3" />
            Non inviato
          </span>
        </div>

        {text && (
          <p className="text-sm text-gray-400 mt-0.5 mb-1.5 line-clamp-2 leading-snug">{text}</p>
        )}
        {isGroup && (
          <div className="mb-1.5"><GroupTag /></div>
        )}
        {msg.media_type && (
          <div className="mb-1.5"><AttachmentChip msg={msg} /></div>
        )}
        {msg.recurrence_rule && (
          <div className="mb-1.5"><RecurrenceTag rule={msg.recurrence_rule} /></div>
        )}

        <p className="text-[12px] text-red-400/80 mb-2.5">{reason.label}</p>
        {notOnWhatsApp && (
          <p className="text-[12px] text-gray-400 -mt-1.5 mb-2.5 leading-snug" data-testid="invalid-number-hint">
            {/* Il "codice interno" si nomina solo se le cifre sembrano davvero un
                LID: per un numero sbagliato a mano sarebbe una spiegazione falsa. */}
            {looksLikeLidDigits(msg.recipient_number)
              ? 'Riprovare non serve: WhatsApp non conosce questo numero. Il contatto era salvato con un codice interno di WhatsApp invece del numero. Programma di nuovo il messaggio scegliendo la persona dalla rubrica, oppure scrivi il numero a mano.'
              : 'Riprovare non serve: WhatsApp non conosce questo numero. Forse è sbagliato, è un fisso o non ha WhatsApp. Controlla il numero e programma di nuovo il messaggio.'}
          </p>
        )}
        {mediaRejected && (
          <p className="text-[12px] text-gray-400 -mt-1.5 mb-2.5 leading-snug" data-testid="media-rejected-hint">
            Riprovare con lo stesso file non serve. Riapri il messaggio e scegli un altro allegato (o toglilo).
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {canRetry && <button
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {retrying
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RotateCcw className="w-3.5 h-3.5" />}
            {retrying ? 'Rimetto in coda…' : 'Riprova'}
          </button>}

          {notOnWhatsApp && onChooseOtherContact && (
            <button
              onClick={() => onChooseOtherContact(msg)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
            >
              <UserRound className="w-3.5 h-3.5" />
              Scegli un altro contatto
            </button>
          )}

          {mediaRejected && (
            <button
              onClick={() => onDuplicate(msg)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
            >
              <Paperclip className="w-3.5 h-3.5" />
              Cambia allegato
            </button>
          )}

          {showReconnect && (
            <a
              href="/connect"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold bg-white/[0.06] text-gray-200 hover:bg-white/10 transition-colors"
            >
              <Plug className="w-3.5 h-3.5" />
              Ricollega WhatsApp
            </a>
          )}
        </div>
      </div>

      <button
        onClick={onOpenActions}
        aria-label="Azioni messaggio"
        className="text-gray-500 hover:text-white shrink-0 p-2 -m-2 transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
    </div>
  );
}
