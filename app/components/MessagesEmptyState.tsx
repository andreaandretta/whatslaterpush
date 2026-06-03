'use client';

import React from 'react';
import { Calendar } from 'lucide-react';

interface Props {
  className?: string;
}

// Empty queue state for the dashboard. Lives inside a flex-col parent that
// passes `flex-1` so this block stretches to fill — `justify-center` then
// centres the content in whatever vertical space remains. No fixed heights:
// the FAB pulse downstairs is the call-to-action, not an arrow inside here.
export function MessagesEmptyState({ className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-6 ${className}`}>
      <div className="w-14 h-14 rounded-2xl bg-[#0b141a] flex items-center justify-center mb-4">
        <Calendar className="w-7 h-7 text-[#3a4a52]" />
      </div>
      <p className="text-base font-semibold text-white mb-1">Nessun messaggio in coda</p>
      <p className="text-sm text-gray-400 leading-relaxed max-w-[260px]">
        Programma il tuo primo promemoria col bottone verde qui sotto.
      </p>
    </div>
  );
}
