'use client';
import React from 'react';
import { Check, Clock, AlertCircle, Loader2, Pause } from 'lucide-react';

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
  failed:            { label: 'Fallito',          tone: 'failed'    },
  cancelled:         { label: 'Annullato',        tone: 'cancelled' },
  paused:            { label: 'In pausa',         tone: 'paused'    },
};

const TONE_STYLES: Record<string, { bg: string; text: string; ring: string; icon: any }> = {
  // Pending = waiting → AMBER (not green — waiting isn't a success state).
  pending:   { bg: 'bg-amber-500/12',   text: 'text-amber-400',   ring: 'ring-amber-500/30',    icon: Clock        },
  sending:   { bg: 'bg-sky-500/15',     text: 'text-sky-400',     ring: 'ring-sky-500/30',      icon: Loader2      },
  // Sent = past-tense success → NEUTRAL pill with a small green check icon.
  // Reserving solid green for the primary FAB only keeps the visual hierarchy.
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
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${style.bg} ${style.text} ${style.ring}`}
    >
      {/* Sent gets the green check; everything else takes the tone color. */}
      <Icon className={`w-3 h-3 ${meta.tone === 'sent' ? 'text-primary' : ''} ${isSpinner ? 'animate-spin' : ''}`} />
      {meta.tone === 'pending' && countdown ? countdown : meta.label}
    </span>
  );
}

// "Parte tra 2g 14h" / "Parte tra 3h 20m" / "Parte tra 5m"
export function formatCountdown(scheduledAt: string): string | null {
  const ms = new Date(scheduledAt).getTime() - Date.now();
  if (isNaN(ms) || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `Parte tra ${totalMin}m`;
  const totalHours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (totalHours < 24) return `Parte tra ${totalHours}h ${mins}m`;
  const days = Math.floor(totalHours / 24);
  const hrs = totalHours % 24;
  return `Parte tra ${days}g ${hrs}h`;
}

// "3h fa" / "ieri" / "2g fa" — for sent items
export function formatRelativePast(scheduledAt: string): string {
  const ms = Date.now() - new Date(scheduledAt).getTime();
  if (isNaN(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'adesso';
  if (min < 60) return `${min}m fa`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h fa`;
  const d = Math.floor(hr / 24);
  if (d === 1) return 'ieri';
  if (d < 7) return `${d}g fa`;
  if (d < 30) return `${Math.floor(d / 7)}sett fa`;
  if (d < 365) return `${Math.floor(d / 30)}mes fa`;
  return `${Math.floor(d / 365)}a fa`;
}
