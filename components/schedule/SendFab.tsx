'use client';

import React from 'react';
import { Send, Loader2 } from 'lucide-react';

interface SendFabProps {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}

export function SendFab({ disabled, loading, onClick }: SendFabProps) {
  return (
    <button
      type="button"
      aria-label="Invia"
      onClick={onClick}
      disabled={disabled || loading}
      className="absolute bottom-4 right-4 w-14 h-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-hover transition-colors"
    >
      {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
    </button>
  );
}
