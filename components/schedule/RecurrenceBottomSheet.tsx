'use client';

import React from 'react';

export type RecurrenceValue = 'none' | 'daily' | 'weekly' | 'monthly';

interface RecurrenceBottomSheetProps {
  open: boolean;
  onClose: () => void;
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
  /** Used to render context-aware labels like "ogni martedì" or "il 15 del mese". */
  referenceDate: Date;
}

const WEEKDAY_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

export function RecurrenceBottomSheet({ open, onClose, value, onChange, referenceDate }: RecurrenceBottomSheetProps) {
  if (!open) return null;

  const dow = WEEKDAY_NAMES[referenceDate.getDay()];
  const dom = referenceDate.getDate();

  const options: { value: RecurrenceValue; label: string }[] = [
    { value: 'none', label: 'Non ripetere' },
    { value: 'daily', label: 'Ogni giorno' },
    { value: 'weekly', label: `Ogni ${dow}` },
    { value: 'monthly', label: `Il ${dom} di ogni mese` },
  ];

  function pick(v: RecurrenceValue) {
    onChange(v);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Ripetizione"
    >
      <button
        type="button"
        aria-label="Chiudi"
        tabIndex={-1}
        data-testid="recurrence-backdrop"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-sm bg-[#1F2C33] rounded-t-3xl pb-6 pt-4 px-2 animate-slide-up">
        <div aria-hidden="true" className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4" />
        <div role="radiogroup" aria-label="Ripetizione">
          {options.map((opt) => {
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

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

// Builds the RRULE string sent to the API. Returns null for 'none' (one-shot).
// Mirror of the parser in app/lib/recurrence.ts — kept inline here to avoid
// importing server-side code from a client component.
export function buildRRule(recurrence: RecurrenceValue, date: Date): string | null {
  if (recurrence === 'none') return null;
  if (recurrence === 'daily') return 'FREQ=DAILY';
  if (recurrence === 'weekly') return `FREQ=WEEKLY;BYDAY=${DAY_CODES[date.getDay()]}`;
  if (recurrence === 'monthly') return `FREQ=MONTHLY;BYMONTHDAY=${date.getDate()}`;
  return null;
}

export function recurrenceLabel(recurrence: RecurrenceValue, date: Date): string {
  if (recurrence === 'none') return 'Non ripetere';
  if (recurrence === 'daily') return 'Ogni giorno';
  if (recurrence === 'weekly') return `Ogni ${WEEKDAY_NAMES[date.getDay()]}`;
  if (recurrence === 'monthly') return `Il ${date.getDate()} di ogni mese`;
  return 'Non ripetere';
}
