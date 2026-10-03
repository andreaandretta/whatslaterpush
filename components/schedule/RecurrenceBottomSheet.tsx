'use client';

import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { nextOccurrences } from '../../app/lib/recurrence';
import { dayOfMonthPhrase, mondayFirst, weekdaysPhrase } from '../../app/lib/schedule-quick';

export type RecurrenceValue = 'none' | 'daily' | 'weekly' | 'monthly';

interface RecurrenceBottomSheetProps {
  open: boolean;
  onClose: () => void;
  value: RecurrenceValue;
  /** days: i giorni della settimana scelti (Date.getDay()), solo per 'weekly'. */
  onChange: (v: RecurrenceValue, days: number[]) => void;
  /** Used to render context-aware labels like "ogni martedì" or "il 15 del mese". */
  referenceDate: Date;
  /** Giorni già scelti per la ripetizione settimanale (vuoto = il giorno della data). */
  days?: number[];
  /** Prima riga dell'elenco "Quando parte": "Primo invio", o "Questa volta" in modifica. */
  firstLabel?: string;
}

const WEEKDAY_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
// Chip dal lunedì alla domenica: L M M G V S D (il nome intero per i lettori di schermo).
const DAY_CHIPS: { day: number; short: string }[] = [
  { day: 1, short: 'L' }, { day: 2, short: 'M' }, { day: 3, short: 'M' }, { day: 4, short: 'G' },
  { day: 5, short: 'V' }, { day: 6, short: 'S' }, { day: 0, short: 'D' },
];

const DATE_FMT = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'long' });
const TIME_FMT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });

export function RecurrenceBottomSheet({ open, onClose, value, onChange, referenceDate, days, firstLabel = 'Primo invio' }: RecurrenceBottomSheetProps) {
  // Stage the user's pick locally so they can change their mind before the
  // explicit Confirm tap. Resync from the parent each time the sheet opens.
  const [localValue, setLocalValue] = useState<RecurrenceValue>(value);
  const [localDays, setLocalDays] = useState<number[]>(() => weeklyDays(referenceDate, days));
  const daysKey = (days || []).join(',');
  useEffect(() => {
    if (open) {
      setLocalValue(value);
      setLocalDays(weeklyDays(referenceDate, days));
    }
  }, [open, value, daysKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const dom = referenceDate.getDate();

  const options: { value: RecurrenceValue; label: string }[] = [
    { value: 'none', label: 'Non ripetere' },
    { value: 'daily', label: 'Ogni giorno' },
    { value: 'weekly', label: capitalize(weekdaysPhrase(localDays)) },
    { value: 'monthly', label: monthlyLabel(dom) },
  ];

  // Tutti e sette i giorni = ogni giorno: si salva come tale.
  const allWeek = localValue === 'weekly' && localDays.length === 7;
  const effectiveValue: RecurrenceValue = allWeek ? 'daily' : localValue;

  // Il primo invio è la data scelta: prima l'elenco partiva DOPO e sembrava
  // che la prima volta venisse saltata ("gio 8" scelto, elenco 15-22-29).
  // Con giorni che non comprendono quello della data, il primo invio è il primo
  // giorno scelto dopo la data (alla conferma la data si sposta lì). Ma se la
  // scelta è quella con cui il foglio si è aperto, confermarla non sposta
  // niente (ScheduleModal, applyRecurrence): il primo invio resta la data a
  // schermo, anche se cade in un altro giorno ("Questa volta mar 6 ott").
  const sameAsOpened = localValue === value
    && (localValue !== 'weekly' || mondayFirst(localDays).join(',') === weeklyDays(referenceDate, days).join(','));
  const firstDate = effectiveValue === 'weekly' && !sameAsOpened ? firstWeeklySend(referenceDate, localDays) : referenceDate;
  const previewRule = buildRRule(effectiveValue, firstDate, localDays);
  const preview = previewRule ? [firstDate, ...nextOccurrences(previewRule, firstDate, 2)] : [];

  function toggleDay(day: number) {
    setLocalDays((cur) => {
      if (cur.includes(day)) {
        // Almeno un giorno resta sempre scelto.
        return cur.length > 1 ? cur.filter((d) => d !== day) : cur;
      }
      return mondayFirst([...cur, day]);
    });
  }

  function confirm() {
    onChange(effectiveValue, effectiveValue === 'weekly' ? mondayFirst(localDays) : []);
    onClose();
  }

  const ctaLabel =
    effectiveValue === 'none'
      ? 'Solo una volta'
      : `Conferma ${recurrenceLabel(effectiveValue, firstDate, localDays).toLowerCase()}`;

  return (
    <div
      className="wl-viewport z-sheet flex items-end justify-center"
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
      <div className="relative w-full sm:max-w-sm bg-[#1F2C33] rounded-t-3xl pb-6 pt-4 px-2 animate-slide-up max-h-[90%] overflow-y-auto overscroll-contain">
        <div aria-hidden="true" className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4" />
        <div role="radiogroup" aria-label="Ripetizione">
          {options.map((opt) => {
            const selected = localValue === opt.value;
            return (
              <React.Fragment key={opt.value}>
                <button
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
                {/* Più giorni insieme (rapporto 360 B2): "lunedì e giovedì" per
                    l'allenamento, senza programmare due serie. */}
                {opt.value === 'weekly' && selected && (
                  // Tutta la larghezza e sette colonne uguali: cerchi alti 44px,
                  // larghi quanto c'è (47px a 402px). Prima 36×36 con 48px di
                  // rientro, e con lo zoom di Safari diventavano ovali da 27px:
                  // le due M vicine (martedì, mercoledì) si sbagliavano.
                  <div className="px-4 pb-2" data-testid="weekday-picker">
                    <div className="text-[13px] text-gray-400 mb-2">Scegli i giorni (anche più di uno)</div>
                    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Giorni della settimana">
                      {DAY_CHIPS.map(({ day, short }) => {
                        const on = localDays.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={on}
                            aria-label={WEEKDAY_NAMES[day]}
                            onClick={() => toggleDay(day)}
                            className={`h-11 w-full min-w-0 rounded-full text-base font-semibold inline-flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                              on ? 'bg-primary text-[#0B141A]' : 'bg-[#0B141A] text-gray-300 ring-1 ring-[#2A3942]'
                            }`}
                          >
                            {short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </React.Fragment>
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
                    {i === 0 ? `${firstLabel}: ` : ''}{DATE_FMT.format(d)}
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Giorni della ripetizione settimanale (Date.getDay()). Due o più giorni
 * scelti nel foglio valgono così come sono; altrimenti comanda la data, come
 * prima di B2: spostare la data di un "ogni martedì" a mercoledì lo fa
 * diventare "ogni mercoledì".
 */
export function weeklyDays(date: Date, days?: number[] | null): number[] {
  const ds = mondayFirst(days || []);
  return ds.length >= 2 ? ds : [date.getDay()];
}

/**
 * Primo invio di una ripetizione settimanale: la data scelta se il suo giorno è
 * tra quelli scelti, altrimenti il primo giorno scelto dopo, alla stessa ora.
 */
export function firstWeeklySend(date: Date, days: number[]): Date {
  const ds = mondayFirst(days);
  if (ds.length === 0 || ds.includes(date.getDay())) return date;
  for (let i = 1; i <= 6; i++) {
    const d = new Date(date);
    d.setDate(d.getDate() + i);
    if (ds.includes(d.getDay())) return d;
  }
  return date;
}

// Builds the RRULE string sent to the API. Returns null for 'none' (one-shot).
// Mirror of the parser in app/lib/recurrence.ts — kept inline here to avoid
// importing server-side code from a client component.
// Settimanale con più giorni: BYDAY=MO,TH (dal lunedì), già accettato da server
// e cron (recurrence.ts). Con un giorno solo la regola è identica a prima.
export function buildRRule(recurrence: RecurrenceValue, date: Date, days?: number[] | null): string | null {
  if (recurrence === 'none') return null;
  if (recurrence === 'daily') return 'FREQ=DAILY';
  if (recurrence === 'weekly') return `FREQ=WEEKLY;BYDAY=${weeklyDays(date, days).map((d) => DAY_CODES[d]).join(',')}`;
  if (recurrence === 'monthly') return `FREQ=MONTHLY;BYMONTHDAY=${date.getDate()}`;
  return null;
}

export function recurrenceLabel(recurrence: RecurrenceValue, date: Date, days?: number[] | null): string {
  if (recurrence === 'none') return 'Non ripetere';
  if (recurrence === 'daily') return 'Ogni giorno';
  if (recurrence === 'weekly') return capitalize(weekdaysPhrase(weeklyDays(date, days)));
  if (recurrence === 'monthly') return monthlyLabel(date.getDate());
  return 'Non ripetere';
}

// "L'8 di ogni mese", "Il 15 di ogni mese", "Il 31 di ogni mese (o l'ultimo giorno)".
function monthlyLabel(day: number): string {
  const phrase = dayOfMonthPhrase(day);
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} di ogni mese${day >= 29 ? ' (o l\'ultimo giorno)' : ''}`;
}
