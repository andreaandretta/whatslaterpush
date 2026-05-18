'use client';

import React from 'react';

export type ReminderValue = 'never' | '15min' | '30min' | '1h' | '1day';

interface ReminderBottomSheetProps {
  open: boolean;
  onClose: () => void;
  value: ReminderValue;
  onChange: (v: ReminderValue) => void;
}

const OPTIONS: { value: ReminderValue; label: string }[] = [
  { value: '15min', label: '15 minuti prima' },
  { value: '30min', label: '30 minuti prima' },
  { value: '1h', label: '1 ora prima' },
  { value: '1day', label: '1 giorno prima' },
  { value: 'never', label: 'Mai' },
];

export function ReminderBottomSheet({ open, onClose, value, onChange }: ReminderBottomSheetProps) {
  if (!open) return null;

  function pick(v: ReminderValue) {
    onChange(v);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Promemoria"
    >
      <button
        type="button"
        aria-label="Chiudi"
        tabIndex={-1}
        data-testid="reminder-backdrop"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-sm bg-[#1F2C33] rounded-t-3xl pb-6 pt-4 px-2 animate-slide-up">
        <div aria-hidden="true" className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4" />
        <div role="radiogroup" aria-label="Promemoria">
          {OPTIONS.map((opt) => {
            const selected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => pick(opt.value)}
                className="w-full flex items-center gap-4 px-4 py-3 hover:bg-white/5 rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <span
                  className={`w-5 h-5 rounded-full border-2 ${
                    selected ? 'border-primary bg-primary' : 'border-gray-500'
                  } flex items-center justify-center`}
                >
                  {selected && <span className="w-2 h-2 rounded-full bg-white" />}
                </span>
                <span className="text-white text-base">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
