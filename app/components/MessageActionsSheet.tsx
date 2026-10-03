'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Copy, Pencil, Pause, Play, Trash2, RotateCcw, X, Clock } from 'lucide-react';
import { snoozeOptions } from '../lib/schedule-quick';
import { useModalHistory } from '../lib/use-modal-history';

export interface MessageActions {
  onDuplicate: () => void;
  onEdit: () => void;
  onPauseToggle: () => void;
  onRetry: () => void;
  onDelete: () => void;
  isPaused: boolean;
  // Capabilities — when a message is already sent, only "duplicate" makes
  // sense. Edit/pause/delete are hidden for sent items. A failed message
  // gets "retry" (re-queue) + delete, but not edit/pause.
  canEdit: boolean;
  canPause: boolean;
  canRetry: boolean;
  canDelete: boolean;
  // Snooze one-tap — reschedules without opening the edit modal. Needs the
  // row's current scheduled_at for "Domani stessa ora".
  canSnooze?: boolean;
  scheduledAt?: string;
  onSnooze?: (iso: string, label: string) => void;
}

interface Props extends MessageActions {
  open: boolean;
  onClose: () => void;
  title: string;
}

export function MessageActionsSheet({
  open, onClose, title,
  onDuplicate, onEdit, onPauseToggle, onRetry, onDelete,
  isPaused, canEdit, canPause, canRetry, canDelete,
  canSnooze, scheduledAt, onSnooze,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Indietro (swipe dal bordo, tasto di Android) chiude solo il foglio: prima
  // usciva dalla pagina e la dashboard restava grigia e vuota sotto il foglio
  // (rapporto 360, T13). Lo stesso strato blocca anche la pagina sotto
  // (page-layer.ts): il vecchio body.style.overflow qui non serve più.
  useModalHistory(open, onClose);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const Item = ({ icon: Icon, label, onClick, danger, disabled }: {
    icon: any; label: string; onClick: () => void; danger?: boolean; disabled?: boolean;
  }) => (
    <button
      onClick={() => { onClick(); onClose(); }}
      disabled={disabled}
      className={`w-full flex items-center gap-4 px-5 py-4 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-gray-100 hover:bg-[#2A3942]'
      }`}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <span className="text-[15px] font-medium">{label}</span>
    </button>
  );

  return (
    <div
      className="wl-viewport z-sheet flex items-end sm:items-center justify-center"
      data-testid="message-actions-sheet"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-h-full overflow-y-auto overscroll-contain sm:max-w-sm sm:mx-4 sm:rounded-2xl bg-[#1F2C33] border-t sm:border border-[#2A3942] rounded-t-2xl pb-safe shadow-2xl animate-slide-up"
      >
        {/* Drag handle (mobile only) */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-[#3B4A54] rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 sm:pt-5 pb-2">
          <div className="min-w-0">
            {/* 12px #8696A0 su #1F2C33 = 4,7:1 (prima 11px gray-500, 2,96:1). */}
            <div className="text-xs uppercase tracking-wider text-[#8696A0] font-semibold">Messaggio</div>
            <div className="text-white font-semibold truncate">{title}</div>
          </div>
          {/* X da 44×44 (rapporto 360, T33/T14). */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="shrink-0 w-11 h-11 -mr-2.5 inline-flex items-center justify-center rounded-full text-[#AEBAC1] hover:text-white hover:bg-white/5"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="h-px bg-[#2A3942] mx-5 my-2" />

        {/* Snooze one-tap: reschedule presets without the full edit modal.
            Options computed at render so "Stasera" disappears after 19:00.
            Tutti i preset partono dall'orario del MESSAGGIO (non da adesso):
            "Posticipa" non deve mai farlo partire prima. */}
        {canSnooze && onSnooze && (() => {
          const opts = snoozeOptions(scheduledAt ? new Date(scheduledAt) : null, new Date());
          return (
            <div className="px-5 pt-1 pb-2">
              <div className="flex items-center gap-2 text-[#8696A0] text-xs uppercase tracking-wider font-semibold mb-2">
                <Clock className="w-3.5 h-3.5" /> Posticipa
              </div>
              <div className="flex gap-2 flex-wrap">
                {opts.map((o) => (
                  <button
                    key={o.label}
                    onClick={() => { onSnooze(o.date.toISOString(), o.label); onClose(); }}
                    className="text-xs px-3 py-2 rounded-full bg-[#2A3942] text-gray-200 hover:bg-[#3B4A54] transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Actions */}
        <div className="py-1">
          {canRetry && (
            <Item icon={RotateCcw} label="Riprova invio" onClick={onRetry} />
          )}
          <Item icon={Copy} label="Duplica" onClick={onDuplicate} />
          {canEdit && (
            <Item icon={Pencil} label="Modifica orario / testo" onClick={onEdit} />
          )}
          {canPause && (
            <Item
              icon={isPaused ? Play : Pause}
              label={isPaused ? 'Riprendi invio' : 'Metti in pausa'}
              onClick={onPauseToggle}
            />
          )}
          {canDelete && (
            <Item icon={Trash2} label="Elimina" onClick={onDelete} danger />
          )}
        </div>

        {/* 12px #8696A0 su #1F2C33: 4,7:1 (prima 11px gray-500, 2,96:1).
            Basta un tocco sulla riga (rapporto 360, T14): prima serviva la
            pressione lunga, che resta ma non va più insegnata. */}
        <div className="px-5 pb-5 pt-2 text-xs text-[#8696A0]">
          Tocca un messaggio della lista per aprire questo menu.
        </div>
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up {
          animation: slideUp 220ms cubic-bezier(0.2, 0, 0, 1);
        }
      `}</style>
    </div>
  );
}
