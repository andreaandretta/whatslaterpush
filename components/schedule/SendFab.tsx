'use client';

import React from 'react';
import { Send, Loader2 } from 'lucide-react';

interface SendFabProps {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
  // Dynamic CTA label restating the resolved schedule in words
  // ("Invia domani alle 9:00") — the native-WhatsApp-beta pattern: the user
  // reads the button and knows exactly what will happen, no ambiguity.
  // Falls back to a plain icon FAB when absent.
  label?: string;
}

export function SendFab({ disabled, loading, onClick, label }: SendFabProps) {
  if (label) {
    return (
      <div className="px-4 pb-4">
        <button
          type="button"
          aria-label="Invia"
          onClick={onClick}
          disabled={disabled || loading}
          className="w-full h-12 rounded-full bg-primary text-white font-semibold text-[15px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary hover:bg-primary-hover transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          <span>{label}</span>
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label="Invia"
      onClick={onClick}
      disabled={disabled || loading}
      className="absolute bottom-4 right-4 w-14 h-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary hover:bg-primary-hover transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
    >
      {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
    </button>
  );
}
