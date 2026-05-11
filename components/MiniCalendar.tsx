'use client';

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  startOfMonth, endOfMonth, eachDayOfInterval, getDay,
  addMonths, subMonths, format, isSameDay, isBefore, startOfDay,
} from 'date-fns';
import { it } from 'date-fns/locale';

interface MiniCalendarProps {
  selectedDate: Date;
  onChange: (d: Date) => void;
  minDate?: Date;
}

export function MiniCalendar({ selectedDate, onChange, minDate }: MiniCalendarProps) {
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(selectedDate));
  const min = minDate ? startOfDay(minDate) : startOfDay(new Date());

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const firstDow = (getDay(monthStart) + 6) % 7;
  const blanks = Array.from({ length: firstDow });

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setViewMonth(subMonths(viewMonth, 1))}
          aria-label="Mese precedente"
          className="p-2 rounded-full hover:bg-gray-100"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="font-semibold text-text-primary">
          {format(viewMonth, 'MMMM yyyy', { locale: it })}
        </div>
        <button
          type="button"
          onClick={() => setViewMonth(addMonths(viewMonth, 1))}
          aria-label="Mese successivo"
          className="p-2 rounded-full hover:bg-gray-100"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-secondary mb-1">
        {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => <div key={i}>{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {blanks.map((_, i) => <div key={'b' + i} />)}
        {days.map((day) => {
          const isPast = isBefore(day, min);
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, new Date());

          let cls = 'w-9 h-9 rounded-full text-sm flex items-center justify-center mx-auto ';
          if (isPast) cls += 'text-gray-300 cursor-not-allowed';
          else if (isSelected) cls += 'bg-primary text-white font-semibold';
          else if (isToday) cls += 'ring-2 ring-primary text-primary font-semibold';
          else cls += 'hover:bg-gray-100 text-text-primary';

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={isPast}
              onClick={() => onChange(day)}
              className={cls}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
