'use client';

import React, { useState, useEffect } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { LABEL_PALETTE, type LabelColor } from '../app/lib/labels';

interface LabelCreated {
  id: string;
  name: string;
  color: string;
  display_order: number;
  created_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (label: LabelCreated) => void;
}

// Modal "Nuova etichetta" — name input + 8-swatch color grid. Posts to
// /api/labels which enforces palette validity (isValidLabelColor) and
// the Free-plan tier gate. Errors are surfaced inline so the user can
// retry without losing what they typed.
export default function LabelCreateModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor>(LABEL_PALETTE[0].hex);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset on close so the next open starts clean. Avoids leftover error
      // messages from the previous attempt blinking on re-open.
      setName('');
      setColor(LABEL_PALETTE[0].hex);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 60 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, color }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 200) {
        onCreated(body.label);
        onClose();
        return;
      }
      switch (body.error) {
        case 'invalid_name':       setError('Nome non valido (max 60 caratteri).'); break;
        case 'invalid_color':      setError('Colore non valido.'); break;
        case 'duplicate_name':     setError('Esiste già un\'etichetta con questo nome.'); break;
        case 'plan_label_locked':  setError('Funzione disponibile da Personal in su.'); break;
        default:                   setError('Errore inatteso. Riprova.');
      }
    } catch {
      setError('Errore di rete. Riprova.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Nuova etichetta"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-[#202C33] w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-[#2A3942]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Nuova etichetta</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="p-1 text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">
          Nome
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          placeholder="Es. U12 Squadra"
          autoFocus
          className="w-full bg-[#0B141A] text-white rounded-xl px-3 py-2.5 border border-[#2A3942] focus:border-primary focus:outline-none text-sm"
        />
        <div className="text-[10px] text-gray-500 mt-1 text-right tabular-nums">
          {trimmed.length}/60
        </div>

        <label className="block text-xs font-medium uppercase tracking-wider text-gray-400 mb-2 mt-3">
          Colore
        </label>
        <div className="grid grid-cols-4 gap-2.5">
          {LABEL_PALETTE.map(({ hex, name: cName }) => {
            const selected = color === hex;
            return (
              <button
                key={hex}
                type="button"
                onClick={() => setColor(hex)}
                aria-label={cName}
                aria-pressed={selected}
                className={`aspect-square rounded-xl ring-2 ${
                  selected ? 'ring-white' : 'ring-transparent'
                } relative focus:outline-none focus:ring-white/60 transition-shadow`}
                style={{ backgroundColor: hex }}
              >
                {selected && (
                  <Check
                    className="w-5 h-5 text-white absolute inset-0 m-auto drop-shadow"
                    strokeWidth={3}
                  />
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mt-3 text-xs text-red-400 bg-red-950/30 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="mt-5 w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Crea etichetta
        </button>
      </div>
    </div>
  );
}
