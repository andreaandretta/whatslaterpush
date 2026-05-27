'use client';
import React from 'react';
import { Check, CheckCheck } from 'lucide-react';

interface MsgLike {
  status: string;
  sent_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  scheduled_at?: string;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

// WhatsApp-style delivery indicator. Tri-state progression:
//   sent  (no receipt yet) → ✓        gray  (1 tick)
//   delivered_at IS NOT NULL → ✓✓     gray  (2 ticks)
//   read_at IS NOT NULL → ✓✓          sky   (2 ticks blue)
// Returns null when the message is not yet sent (status != 'sent') so the
// caller can keep the existing pending/awaiting badge unchanged.
export function DeliveryStatusIcon({ msg }: { msg: MsgLike }) {
  if (msg.read_at) {
    return (
      <span title={`Letto ${formatTime(msg.read_at)}`} aria-label="Letto" data-testid="status-read">
        <CheckCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
      </span>
    );
  }
  if (msg.delivered_at) {
    return (
      <span title={`Consegnato ${formatTime(msg.delivered_at)}`} aria-label="Consegnato" data-testid="status-delivered">
        <CheckCheck className="w-3.5 h-3.5 text-gray-300 shrink-0" />
      </span>
    );
  }
  if (msg.status === 'sent') {
    return (
      <span title={`Inviato ${formatTime(msg.sent_at || msg.scheduled_at)}`} aria-label="Inviato" data-testid="status-sent">
        <Check className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      </span>
    );
  }
  return null;
}
