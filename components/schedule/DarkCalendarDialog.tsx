'use client';

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  startOfMonth, endOfMonth, eachDayOfInterval, getDay,
  addMonths, subMonths, format, isSameDay, isBefore, startOfDay,
} from 'date-fns';
import { it } from 'date-fns/locale';

interface DarkCalendarDialogProps {
  open: boolean;
  onClose: () => void;
  value: Date;
  minDate?: Date;
  onConfirm: (d: Date) => void;
}

export function DarkCalendarDialog({ open, onClose, value, minDate, onConfirm }: DarkCalendarDialogProps) {
  const [picked, setPicked] = useState<Date>(value);
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(value));

  useEffect(() => {
    if (open) {
      setPicked(value);
      setViewMonth(startOfMonth(value));
    }
  }, [open, value]);

  if (!open) return null;

  const min = minDate ? startOfDay(minDate) : startOfDay(new Date());
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const firstDow = (getDay(monthStart) + 6) % 7;
  const blanks = Array.from({ length: firstDow });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Seleziona data"
    >
      <button
        type="button"
        aria-label="Chiudi"
        tabIndex={-1}
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xs bg-[#1F2C33] rounded-3xl p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setViewMonth(subMonths(viewMonth, 1))}
            aria-label="Mese precedente"
            className="p-2 rounded-full hover:bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="font-semibold text-white capitalize">
            {format(viewMonth, 'MMMM yyyy', { locale: it })}
          </div>
          <button
            type="button"
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            aria-label="Mese successivo"
            className="p-2 rounded-full hover:bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-1">
          {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => <div key={i}>{d}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {blanks.map((_, i) => <div key={'b' + i} />)}
          {days.map((day) => {
            const isPast = isBefore(day, min);
            const isSelected = isSameDay(day, picked);
            const isToday = isSameDay(day, new Date());

            let cls = 'w-9 h-9 rounded-full text-sm flex items-center justify-center mx-auto focus:outline-none focus:ring-2 focus:ring-primary/30 ';
            if (isPast) cls += 'text-gray-600 cursor-not-allowed';
            else if (isSelected) cls += 'bg-primary text-black font-semibold';
            else if (isToday) cls += 'ring-1 ring-primary text-primary font-semibold';
            else cls += 'hover:bg-white/10 text-white';

            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={isPast}
                onClick={() => setPicked(day)}
                className={cls}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-primary text-sm font-medium hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(picked); onClose(); }}
            className="px-4 py-2 rounded-full text-primary text-sm font-semibold hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
