'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { X, Plus, Trash2, Loader2, Tag } from 'lucide-react';
import LabelCreateModal from './LabelCreateModal';

interface Label {
  id: string;
  name: string;
  color: string;
  contact_count?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  // Bumped whenever the user creates or deletes a label, so the parent
  // LabelPicker chip-bar can refetch and stay in sync.
  onChange?: () => void;
}

// Bottom sheet "Gestisci etichette" — list the user's labels with their
// assignment counts, lets them open LabelCreateModal to add new ones,
// and confirms before deleting (cascade removes the contact assignments
// for that label, per DB FK rule). Assignment of a specific contact to
// a specific label is NOT in this sheet — that flow lives elsewhere
// (separate follow-up PR, see issue #19 part B).
export default function LabelManagerSheet({ open, onClose, onChange }: Props) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/labels');
      if (!res.ok) {
        setError('Impossibile caricare le etichette.');
        setLabels([]);
        return;
      }
      const body = await res.json();
      setLabels(Array.isArray(body.labels) ? body.labels : []);
    } catch {
      setError('Errore di rete.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchLabels();
  }, [open, fetchLabels]);

  async function handleDelete(id: string, name: string) {
    if (typeof window !== 'undefined' && !window.confirm(`Eliminare "${name}"? I contatti assegnati perderanno questa etichetta.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/labels/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setLabels((prev) => prev.filter((l) => l.id !== id));
        onChange?.();
      } else {
        setError('Eliminazione fallita. Riprova.');
      }
    } catch {
      setError('Errore di rete.');
    } finally {
      setDeletingId(null);
    }
  }

  function handleCreated(label: Label) {
    setLabels((prev) => [...prev, { ...label, contact_count: 0 }]);
    onChange?.();
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-sheet flex items-end sm:items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-label="Gestisci etichette"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/60" />
        <div
          className="relative bg-[#202C33] w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border-t sm:border border-[#2A3942] max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle (mobile only) */}
          <div className="sm:hidden flex justify-center pt-2">
            <div className="w-10 h-1 rounded-full bg-gray-600" />
          </div>

          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="text-lg font-bold text-white">Gestisci etichette</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Chiudi"
              className="p-1 text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-3">
            {loading ? (
              <div className="py-10 text-center">
                <Loader2 className="w-5 h-5 text-primary animate-spin mx-auto" />
              </div>
            ) : labels.length === 0 ? (
              <div className="py-10 text-center text-gray-400">
                <Tag className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nessuna etichetta ancora.</p>
                <p className="text-xs text-gray-500 mt-0.5">Crea la prima per organizzare i contatti.</p>
              </div>
            ) : (
              <ul className="divide-y divide-[#2A3942]">
                {labels.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-3">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: l.color }}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{l.name}</p>
                      <p className="text-[11px] text-gray-500">
                        {l.contact_count || 0} contatt{l.contact_count === 1 ? 'o' : 'i'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(l.id, l.name)}
                      disabled={deletingId === l.id}
                      aria-label={`Elimina ${l.name}`}
                      className="p-2 -m-2 text-gray-500 hover:text-red-400 disabled:opacity-50 transition-colors"
                    >
                      {deletingId === l.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {error && (
              <div className="mt-3 text-xs text-red-400 bg-red-950/30 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-[#2A3942]">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nuova etichetta
            </button>
          </div>
        </div>
      </div>

      <LabelCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
