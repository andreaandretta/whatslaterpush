'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Copy, Pencil, Pause, Play, Trash2, RotateCcw, X, Clock } from 'lucide-react';
import { snoozePlusHour, snoozeTonight, snoozeTomorrowSameTime } from '../lib/schedule-quick';

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

  // Lock scroll while open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

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
      className="fixed inset-0 z-sheet flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-sm sm:mx-4 sm:rounded-2xl bg-[#1F2C33] border-t sm:border border-[#2A3942] rounded-t-2xl pb-safe shadow-2xl animate-slide-up"
      >
        {/* Drag handle (mobile only) */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-[#3B4A54] rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 sm:pt-5 pb-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Messaggio</div>
            <div className="text-white font-semibold truncate">{title}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            className="text-gray-500 hover:text-gray-300 p-2 -m-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="h-px bg-[#2A3942] mx-5 my-2" />

        {/* Snooze one-tap: reschedule presets without the full edit modal.
            Options computed at render so "Stasera" disappears after 19:00. */}
        {canSnooze && onSnooze && (() => {
          const now = new Date();
          const tonight = snoozeTonight(now);
          const opts: { label: string; date: Date }[] = [
            { label: '+1 ora', date: snoozePlusHour(now) },
            ...(tonight ? [{ label: 'Stasera 20:00', date: tonight }] : []),
            ...(scheduledAt
              ? [{ label: 'Domani stessa ora', date: snoozeTomorrowSameTime(new Date(scheduledAt), now) }]
              : []),
          ];
          return (
            <div className="px-5 pt-1 pb-2">
              <div className="flex items-center gap-2 text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-2">
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

        <div className="px-5 pb-5 pt-2 text-[11px] text-gray-500">
          Tap lungo su un messaggio per riaprire questo menu.
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
