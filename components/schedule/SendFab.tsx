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
  // Perché il pulsante è spento: una riga sopra il pulsante, fuori dall'area
  // che scorre. Prima si spegneva senza dire niente.
  hint?: string | null;
}

// Verde con testo scuro (#0B141A, contrasto 8,8:1; il bianco era 2:1).
// Spento: grigio, non un verde più scuro che sembra ancora attivo.
const ON = 'bg-primary text-[#0B141A] hover:bg-primary-hover';
const OFF = 'disabled:bg-[#2A3942] disabled:text-[#8696A0] disabled:hover:bg-[#2A3942] disabled:cursor-not-allowed disabled:shadow-none';

export function SendFab({ disabled, loading, onClick, label, hint }: SendFabProps) {
  // Durante l'invio resta verde (con la rotellina): grigio solo se manca qualcosa.
  const off = loading ? 'disabled:cursor-wait' : OFF;
  if (label) {
    return (
      <div className="px-4 pb-4">
        {hint && (
          <p id="send-fab-hint" role="status" className="pt-2 pb-1.5 text-center text-[13px] leading-snug text-[#D1D7DB]" data-testid="send-fab-hint">
            {hint}
          </p>
        )}
        <button
          type="button"
          aria-label="Invia"
          aria-describedby={hint ? 'send-fab-hint' : undefined}
          onClick={onClick}
          disabled={disabled || loading}
          className={`w-full h-12 rounded-full font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 ${ON} ${off}`}
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
      className={`absolute bottom-4 right-4 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 ${ON} ${off}`}
    >
      {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
    </button>
  );
}
