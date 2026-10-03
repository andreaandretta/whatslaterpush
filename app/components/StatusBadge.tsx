'use client';
import React from 'react';
import { Check, Clock, AlertCircle, Loader2, Pause } from 'lucide-react';
import { romeWallClock } from '../lib/rome-time';

// Status → text label + accent color. Pending/awaiting share the orange
// "in attesa" bucket; sending is its own animated spinner; sent green;
// failed red; cancelled gray; paused amber.
export const STATUS_META: Record<string, {
  label: string;
  tone: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'paused';
}> = {
  awaiting_confirm:  { label: 'In attesa',        tone: 'pending'   },
  awaiting_contact:  { label: 'Manca contatto',   tone: 'pending'   },
  awaiting_datetime: { label: 'Manca data',       tone: 'pending'   },
  awaiting_message:  { label: 'Manca messaggio',  tone: 'pending'   },
  pending:           { label: 'In coda',          tone: 'pending'   },
  sending:           { label: 'In invio…',        tone: 'sending'   },
  sent:              { label: 'Inviato',          tone: 'sent'      },
  failed:            { label: 'Non inviato',      tone: 'failed'    },
  cancelled:         { label: 'Annullato',        tone: 'cancelled' },
  paused:            { label: 'In pausa',         tone: 'paused'    },
};

const TONE_STYLES: Record<string, { bg: string; text: string; ring: string; icon: any }> = {
  // Pending = waiting → AMBER (not green — waiting isn't a success state).
  pending:   { bg: 'bg-amber-500/12',   text: 'text-amber-400',   ring: 'ring-amber-500/30',    icon: Clock        },
  sending:   { bg: 'bg-sky-500/15',     text: 'text-sky-400',     ring: 'ring-sky-500/30',      icon: Loader2      },
  // Sent = past-tense success → NEUTRAL pill. Nella lista una riga inviata usa
  // DeliveryStatusIcon con la parola (spunte come WhatsApp, T34): questa resta
  // per gli altri usi. Il verde è solo per le azioni (T35): spunta grigia.
  sent:      { bg: 'bg-white/[0.06]',   text: 'text-gray-400',    ring: 'ring-white/10',        icon: Check        },
  failed:    { bg: 'bg-red-500/15',     text: 'text-red-400',     ring: 'ring-red-500/30',      icon: AlertCircle  },
  cancelled: { bg: 'bg-gray-500/10',    text: 'text-gray-400',    ring: 'ring-gray-500/20',     icon: AlertCircle  },
  paused:    { bg: 'bg-stone-400/12',   text: 'text-stone-300',   ring: 'ring-stone-400/25',    icon: Pause        },
};

export function StatusBadge({ status, countdown }: { status: string; countdown?: string }) {
  const meta = STATUS_META[status] || { label: status, tone: 'cancelled' as const };
  const style = TONE_STYLES[meta.tone];
  const Icon = style.icon;
  const isSpinner = meta.tone === 'sending';
  return (
    // 12px (prima 11px, rapporto 360 T22). Contrasti sul fondo della riga
    // #202C33: in coda ambra 6,9:1, in pausa 7,8:1, in invio 5,3:1, annullato 5,1:1.
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${style.bg} ${style.text} ${style.ring}`}
      data-testid="status-badge"
    >
      <Icon className={`w-3.5 h-3.5 ${isSpinner ? 'animate-spin' : ''}`} aria-hidden="true" />
      {meta.tone === 'pending' && countdown ? countdown : meta.label}
    </span>
  );
}

// Parole intere, non sigle: "23m fa" e "2mes fa" non si capivano (rapporto 360, T30).
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Giorni di calendario a Roma tra due istanti, come le date della lista. Con le
// 24 ore, 47 ore diventavano "tra 1 giorno" e si leggeva "domani" (revisione).
function romeDayDiff(from: Date, to: Date): number {
  const a = romeWallClock(from);
  const b = romeWallClock(to);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
}

// "Parte tra 5 minuti" / "Parte tra 3 ore" (oggi) / "Parte domani" /
// "Parte dopodomani" / "Parte tra 3 giorni"
export function formatCountdown(scheduledAt: string, now: Date = new Date()): string | null {
  const target = new Date(scheduledAt);
  const ms = target.getTime() - now.getTime();
  if (isNaN(ms) || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return 'Parte tra poco';
  if (totalMin < 60) return `Parte tra ${plural(totalMin, 'minuto', 'minuti')}`;
  const days = romeDayDiff(now, target);
  if (days <= 0) return `Parte tra ${plural(Math.floor(totalMin / 60), 'ora', 'ore')}`;
  if (days === 1) return 'Parte domani';
  if (days === 2) return 'Parte dopodomani';
  return `Parte tra ${days} giorni`;
}

// "3 ore fa" / "ieri" / "2 mesi fa" — for sent items. Da un giorno in su si
// contano i giorni di calendario: 47 ore fa può essere l'altro ieri.
export function formatRelativePast(scheduledAt: string, now: Date = new Date()): string {
  const then = new Date(scheduledAt);
  const ms = now.getTime() - then.getTime();
  if (isNaN(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'adesso';
  if (min < 60) return `${plural(min, 'minuto', 'minuti')} fa`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${plural(hr, 'ora', 'ore')} fa`;
  const d = romeDayDiff(then, now);
  if (d <= 1) return 'ieri';
  if (d < 7) return `${d} giorni fa`;
  if (d < 30) return `${plural(Math.floor(d / 7), 'settimana', 'settimane')} fa`;
  if (d < 365) return `${plural(Math.floor(d / 30), 'mese', 'mesi')} fa`;
  return `${plural(Math.floor(d / 365), 'anno', 'anni')} fa`;
}
