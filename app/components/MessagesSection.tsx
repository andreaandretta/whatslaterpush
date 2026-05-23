'use client';
import React, { useMemo, useState, useEffect } from 'react';
import { Search, X, MoreVertical, Calendar, Inbox, Clock } from 'lucide-react';
import { ContactAvatar } from '../../components/ContactAvatar';
import { StatusBadge, formatCountdown, formatRelativePast } from './StatusBadge';
import { MessageActionsSheet } from './MessageActionsSheet';

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
}

interface Props {
  messages: ScheduledMessage[];
  onDelete: (id: string) => void;
  onDuplicate: (msg: ScheduledMessage) => void;
  onEdit: (msg: ScheduledMessage) => void;
  onPauseToggle: (msg: ScheduledMessage) => void;
  onShowToast: (text: string, undo?: () => void) => void;
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
const SENT_STATUSES = new Set(['sent', 'failed', 'cancelled']);

export default function MessagesSection({
  messages, onDelete, onDuplicate, onEdit, onPauseToggle, onShowToast,
}: Props) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState<ScheduledMessage | null>(null);

  // Recompute every 60s so countdowns stay fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // Split into upcoming vs sent
  const { upcoming, sent } = useMemo(() => {
    const up: ScheduledMessage[] = [];
    const sn: ScheduledMessage[] = [];
    for (const m of messages) {
      if (UPCOMING_STATUSES.has(m.status)) up.push(m);
      else if (SENT_STATUSES.has(m.status)) sn.push(m);
      else up.push(m); // unknown statuses default to upcoming
    }
    // Upcoming: ascending (next first)
    up.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    // Sent: descending (most recent first)
    sn.sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
    return { upcoming: up, sent: sn };
  }, [messages]);

  // Apply search
  const q = query.trim().toLowerCase();
  const filter = (arr: ScheduledMessage[]) =>
    !q ? arr : arr.filter((m) => {
      const name = (m.recipient_name || '').toLowerCase();
      const num = (m.recipient_number || '').toLowerCase();
      const text = (m.parsed_message || m.caption || '').toLowerCase();
      return name.includes(q) || num.includes(q) || text.includes(q);
    });

  const visibleUpcoming = filter(upcoming);
  const visibleSent = filter(sent);
  const list = tab === 'upcoming' ? visibleUpcoming : visibleSent;
  const buckets = tab === 'upcoming' ? UPCOMING_ORDER : SENT_ORDER;
  const titles = tab === 'upcoming' ? UPCOMING_GROUP_TITLES : SENT_GROUP_TITLES;
  const getBucket = tab === 'upcoming' ? upcomingBucket : sentBucket;

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

  const handleDelete = (msg: ScheduledMessage) => {
    onDelete(msg.id);
    onShowToast(`Eliminato — ${msg.recipient_name || msg.recipient_number || 'messaggio'}`);
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
        <TabButton active={tab === 'upcoming'} onClick={() => setTab('upcoming')} count={visibleUpcoming.length}>
          Prossimi
        </TabButton>
        <TabButton active={tab === 'sent'} onClick={() => setTab('sent')} count={visibleSent.length}>
          Inviati
        </TabButton>
      </div>

      {/* List */}
      {list.length === 0 ? (
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

      {/* Actions bottom-sheet */}
      <MessageActionsSheet
        open={!!actionMsg}
        onClose={() => setActionMsg(null)}
        title={actionMsg?.recipient_name || actionMsg?.recipient_number || ''}
        onDuplicate={() => actionMsg && onDuplicate(actionMsg)}
        onEdit={() => actionMsg && onEdit(actionMsg)}
        onPauseToggle={() => actionMsg && onPauseToggle(actionMsg)}
        onDelete={() => actionMsg && handleDelete(actionMsg)}
        isPaused={actionMsg?.status === 'paused'}
        canEdit={!!actionMsg && UPCOMING_STATUSES.has(actionMsg.status)}
        canPause={!!actionMsg && (actionMsg.status === 'pending' || actionMsg.status === 'paused')}
        canDelete={!!actionMsg && UPCOMING_STATUSES.has(actionMsg.status)}
      />
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

function MessageRow({ msg, tab, onOpenActions }: {
  msg: ScheduledMessage; tab: Tab; onOpenActions: () => void;
}) {
  const text = msg.parsed_message || msg.caption || '';
  const displayName = msg.recipient_name || `+${msg.recipient_number || '?'}`;

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

  const target = new Date(msg.scheduled_at);
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

        <div className="flex items-center gap-2">
          <StatusBadge status={msg.status} countdown={countdown} />
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
