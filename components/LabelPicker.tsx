'use client';

import React, { useEffect, useState } from 'react';

export interface ContactLabel {
  id: string;
  name: string;
  color: string;
  display_order: number;
  contact_count?: number;
}

interface Props {
  selectedId: string | null;
  onChange: (id: string | null) => void;
  // Re-fetch trigger. Bump from parent (e.g. after a label is created/deleted)
  // to force a reload without remounting.
  refreshKey?: number;
}

// Horizontal scrollable chip bar of the user's labels. Tap a chip to filter,
// tap the active chip (or "Tutti") to clear. Empty list collapses to nothing
// — the picker is invisible until the user has at least one label.
export function LabelPicker({ selectedId, onChange, refreshKey = 0 }: Props) {
  const [labels, setLabels] = useState<ContactLabel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/labels')
      .then(r => r.ok ? r.json() : { labels: [] })
      .then(body => {
        if (cancelled) return;
        setLabels(Array.isArray(body.labels) ? body.labels : []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (loading) return null;
  if (labels.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto px-3 py-2 border-b border-[#2A3942]">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${
          selectedId === null
            ? 'bg-primary border-primary text-white'
            : 'border-gray-600 text-gray-300 hover:bg-white/5'
        }`}
      >
        Tutti
      </button>
      {labels.map((l) => {
        const active = selectedId === l.id;
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => onChange(active ? null : l.id)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border inline-flex items-center gap-1.5 ${
              active ? 'text-white' : 'text-gray-300 hover:bg-white/5'
            }`}
            style={
              active
                ? { backgroundColor: l.color, borderColor: l.color }
                : { borderColor: l.color + '66' }
            }
            aria-pressed={active}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: l.color }}
              aria-hidden="true"
            />
            <span>{l.name}</span>
            {typeof l.contact_count === 'number' && (
              <span className={`text-[10px] ${active ? 'text-white/80' : 'text-gray-500'}`}>
                ({l.contact_count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
