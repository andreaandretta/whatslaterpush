'use client';
import React from 'react';
import { AlertCircle, Check, CheckCheck } from 'lucide-react';

interface MsgLike {
  status: string;
  sent_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  ack_error_at?: string | null;
  server_ack_at?: string | null;
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
// Gruppi: Evolution non inoltra le ricevute dei gruppi, quindi solo ✓ (un
// delivered_at/read_at su un gruppo non dice niente di tutti i membri).
// `showLabel`: spunte + parola ("✓ Inviato", "✓✓ Consegnato", "✓✓ Letto"), un
// solo segno di stato per riga della lista. Prima la riga diceva lo stato tre
// volte: pillola "✓ Inviato", spunta a parte e pillola "Gruppo" (rapporto 360, T34).
// Parola 12px #AEBAC1 su #202C33 = 7,2:1; spunte blu sky-400 = 6,7:1.
export function DeliveryStatusIcon({ msg, isGroup = false, showLabel = false }: { msg: MsgLike; isGroup?: boolean; showLabel?: boolean }) {
  const view = deliveryView(msg, isGroup);
  if (!view) return null;
  if (!showLabel) {
    return (
      <span title={view.title} aria-label={view.label} data-testid={view.testId} className={view.kind === 'ack_error' ? 'text-red-400 font-bold' : undefined}>
        {view.kind === 'ack_error' ? '!' : view.icon}
      </span>
    );
  }
  return (
    <span
      title={view.title}
      aria-label={view.label}
      data-testid={view.testId}
      className={`inline-flex items-center gap-1 text-xs font-medium ${view.kind === 'ack_error' ? 'text-red-400' : 'text-[#AEBAC1]'}`}
    >
      {view.kind === 'ack_error' ? <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : view.icon}
      {view.label}
    </span>
  );
}

type DeliveryKind = 'ack_error' | 'sent' | 'delivered' | 'read';

function deliveryView(msg: MsgLike, isGroup: boolean): { kind: DeliveryKind; label: string; title: string; testId: string; icon: React.ReactNode } | null {
  // Custody ack: WhatsApp ha rifiutato il messaggio DOPO il nostro 'sent'.
  if (msg.ack_error_at) {
    return { kind: 'ack_error', label: 'Non accettato da WhatsApp', title: `Non accettato da WhatsApp ${formatTime(msg.ack_error_at)}`, testId: 'status-ack-error', icon: null };
  }
  const single = <Check className="w-3.5 h-3.5 text-gray-400 shrink-0" aria-hidden="true" />;
  if (isGroup) {
    if (msg.status !== 'sent') return null;
    return { kind: 'sent', label: 'Inviato', title: 'Inviato nel gruppo (per i gruppi WhatsApp non ci manda le spunte di consegna)', testId: 'status-sent', icon: single };
  }
  if (msg.read_at) {
    return { kind: 'read', label: 'Letto', title: `Letto ${formatTime(msg.read_at)}`, testId: 'status-read', icon: <CheckCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" /> };
  }
  if (msg.delivered_at) {
    return { kind: 'delivered', label: 'Consegnato', title: `Consegnato ${formatTime(msg.delivered_at)}`, testId: 'status-delivered', icon: <CheckCheck className="w-3.5 h-3.5 text-gray-300 shrink-0" aria-hidden="true" /> };
  }
  if (msg.status === 'sent') {
    return { kind: 'sent', label: 'Inviato', title: `Inviato ${formatTime(msg.sent_at || msg.scheduled_at)}`, testId: 'status-sent', icon: single };
  }
  return null;
}
