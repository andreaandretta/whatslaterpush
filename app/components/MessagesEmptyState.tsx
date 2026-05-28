'use client';

import React from 'react';
import { MessageSquare, ArrowDown } from 'lucide-react';

export function MessagesEmptyState() {
  return (
    <div className="text-center py-12 px-4">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
        <MessageSquare className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-bold mb-2 text-white">Ciao!</h2>
      <p className="text-gray-300 max-w-sm mx-auto mb-2">
        Programma il tuo primo messaggio da mandare quando vuoi.
      </p>
      <p className="text-sm text-gray-500 max-w-sm mx-auto mb-8">
        Tocca il bottone verde qui sotto a destra.
      </p>
      <div className="flex justify-end pr-4 sm:pr-8">
        <ArrowDown
          className="w-8 h-8 text-primary"
          style={{ animation: 'onboarding-nudge 1.4s ease-in-out infinite' }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
