'use client';

import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { nextOccurrences } from '../../app/lib/recurrence';
import { dayOfMonthPhrase } from '../../app/lib/schedule-quick';

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

const DATE_FMT = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'long' });
const TIME_FMT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });

export function RecurrenceBottomSheet({ open, onClose, value, onChange, referenceDate }: RecurrenceBottomSheetProps) {
  // Stage the user's pick locally so they can change their mind before the
  // explicit Confirm tap. Resync from the parent each time the sheet opens.
  const [localValue, setLocalValue] = useState<RecurrenceValue>(value);
  useEffect(() => {
    if (open) setLocalValue(value);
  }, [open, value]);

  if (!open) return null;

  const dow = WEEKDAY_NAMES[referenceDate.getDay()];
  const dom = referenceDate.getDate();

  const options: { value: RecurrenceValue; label: string }[] = [
    { value: 'none', label: 'Non ripetere' },
    { value: 'daily', label: 'Ogni giorno' },
    { value: 'weekly', label: `Ogni ${dow}` },
    { value: 'monthly', label: monthlyLabel(dom) },
  ];

  // Il primo invio è la data scelta: prima l'elenco partiva DOPO e sembrava
  // che la prima volta venisse saltata ("gio 8" scelto, elenco 15-22-29).
  const previewRule = buildRRule(localValue, referenceDate);
  const preview = previewRule ? [referenceDate, ...nextOccurrences(previewRule, referenceDate, 2)] : [];

  function confirm() {
    onChange(localValue);
    onClose();
  }

  const ctaLabel =
    localValue === 'none'
      ? 'Solo una volta'
      : `Conferma ${recurrenceLabel(localValue, referenceDate).toLowerCase()}`;

  return (
    <div
      className="fixed inset-0 z-sheet flex items-end justify-center"
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
            const selected = localValue === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setLocalValue(opt.value)}
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

        {preview.length > 0 && (
          <div className="mx-2 mt-4 p-3 rounded-xl bg-[#0B141A] ring-1 ring-[#2A3942]">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-3.5 h-3.5" style={{ color: '#8696A0' }} aria-hidden="true" />
              <span className="text-xs uppercase tracking-wide" style={{ color: '#8696A0' }}>
                Quando parte
              </span>
            </div>
            <ul>
              {preview.map((d, i) => (
                <li
                  key={i}
                  className={`flex items-baseline justify-between py-2 ${
                    i < preview.length - 1 ? 'border-b border-[#2A3942]' : ''
                  }`}
                >
                  <span className={`text-sm ${i === 0 ? 'text-white font-semibold' : 'text-white'}`}>
                    {i === 0 ? 'Primo invio: ' : ''}{DATE_FMT.format(d)}
                  </span>
                  <span className="text-sm tabular-nums" style={{ color: '#8696A0' }}>
                    {TIME_FMT.format(d)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={confirm}
          className="w-full mt-4 py-3 rounded-xl bg-primary text-[#0B141A] font-semibold hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {ctaLabel}
        </button>
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
  if (recurrence === 'monthly') return monthlyLabel(date.getDate());
  return 'Non ripetere';
}

// "L'8 di ogni mese", "Il 15 di ogni mese", "Il 31 di ogni mese (o l'ultimo giorno)".
function monthlyLabel(day: number): string {
  const phrase = dayOfMonthPhrase(day);
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} di ogni mese${day >= 29 ? ' (o l\'ultimo giorno)' : ''}`;
}
