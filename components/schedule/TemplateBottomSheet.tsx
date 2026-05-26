'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Star } from 'lucide-react';

export interface SeedTemplate {
  id: string;
  category: string;
  emoji: string | null;
  title: string;
  body: string;
  variables: string[];
  display_order: number;
  is_beta: boolean;
}

export interface UserTemplate {
  id: string;
  category: string | null;
  emoji: string | null;
  title: string;
  body: string;
  source_template_id: string | null;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export type TemplatePick =
  | { kind: 'seed'; id: string; body: string }
  | { kind: 'user'; id: string; body: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (pick: TemplatePick) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  allenatore: 'Allenatore',
  parroco: 'Parroco',
  scout: 'Scout',
  istruttore_guida: 'Istruttore guida',
  site_manager: 'Site manager',
  generico: 'Generico',
};

const CATEGORIES = ['allenatore', 'parroco', 'scout', 'istruttore_guida', 'site_manager'];

export function TemplateBottomSheet({ open, onClose, onSelect }: Props) {
  const [tab, setTab] = useState<'mine' | 'suggested'>('suggested');
  const [seeds, setSeeds] = useState<SeedTemplate[]>([]);
  const [mine, setMine] = useState<UserTemplate[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetch('/api/templates').then(r => r.ok ? r.json() : { templates: [] }),
      fetch('/api/templates/personal').then(r => r.ok ? r.json() : { templates: [] }),
    ]).then(([seedRes, mineRes]) => {
      if (cancelled) return;
      const seedList: SeedTemplate[] = seedRes.templates || [];
      const mineList: UserTemplate[] = mineRes.templates || [];
      setSeeds(seedList);
      setMine(mineList);
      setTab(mineList.length > 0 ? 'mine' : 'suggested');
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  function pickSeed(seed: SeedTemplate) {
    onSelect({ kind: 'seed', id: seed.id, body: seed.body });
    onClose();
  }

  async function pickUser(user: UserTemplate) {
    onSelect({ kind: 'user', id: user.id, body: user.body });
    // Fire-and-forget increment. Failure doesn't block the schedule flow.
    fetch(`/api/templates/personal/${user.id}/use`, { method: 'POST' }).catch(() => {});
    onClose();
  }

  const filteredSeeds = categoryFilter
    ? seeds.filter(s => s.category === categoryFilter)
    : seeds;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Scegli template"
    >
      <button
        type="button"
        aria-label="Chiudi"
        tabIndex={-1}
        data-testid="template-backdrop"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-sm bg-[#1F2C33] rounded-t-3xl pb-6 pt-3 max-h-[80vh] flex flex-col animate-slide-up">
        <div aria-hidden="true" className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-3 shrink-0" />

        <div className="px-3 shrink-0">
          <div role="tablist" aria-label="Tipo template" className="flex gap-2 bg-[#0B141A] rounded-xl p-1">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'mine'}
              onClick={() => setTab('mine')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                tab === 'mine' ? 'bg-primary text-white' : 'text-gray-300 hover:bg-white/5'
              }`}
            >
              ⭐ I miei {mine.length > 0 && `(${mine.length})`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'suggested'}
              onClick={() => setTab('suggested')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                tab === 'suggested' ? 'bg-primary text-white' : 'text-gray-300 hover:bg-white/5'
              }`}
            >
              🧪 Suggeriti Beta
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 mt-3">
          {loading ? (
            <div className="text-gray-400 text-sm text-center py-8">Caricamento…</div>
          ) : tab === 'mine' ? (
            <MineTab mine={mine} onPick={pickUser} />
          ) : (
            <SuggestedTab
              seeds={filteredSeeds}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
              onPick={pickSeed}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MineTab({ mine, onPick }: { mine: UserTemplate[]; onPick: (t: UserTemplate) => void }) {
  if (mine.length === 0) {
    return (
      <div className="text-center py-10 px-4">
        <Star className="w-10 h-10 text-gray-600 mx-auto mb-2" />
        <div className="text-gray-300 text-base mb-1">Nessun template personale</div>
        <div className="text-gray-500 text-sm">
          Quando schedulerai un messaggio editato, ti chiederemo se vuoi salvarlo qui.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {mine.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onPick(t)}
          className="w-full text-left px-4 py-3 hover:bg-white/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">{t.emoji || '⭐'}</span>
            <span className="text-white text-base font-medium flex-1 truncate">{t.title}</span>
            {t.use_count > 0 && (
              <span className="text-xs text-gray-500 shrink-0">{t.use_count} usi</span>
            )}
          </div>
          <div className="text-gray-400 text-sm mt-1 line-clamp-2">{t.body}</div>
        </button>
      ))}
    </div>
  );
}

function SuggestedTab({
  seeds,
  categoryFilter,
  onCategoryChange,
  onPick,
}: {
  seeds: SeedTemplate[];
  categoryFilter: string | null;
  onCategoryChange: (c: string | null) => void;
  onPick: (s: SeedTemplate) => void;
}) {
  return (
    <div>
      <div className="text-xs text-amber-400 bg-amber-950/30 rounded-lg px-3 py-2 mx-2 mb-2">
        🧪 Beta — aiutaci a migliorarli editando il testo prima di inviare
      </div>

      <div className="flex gap-2 overflow-x-auto px-2 pb-2 mb-1 -mx-2">
        <button
          type="button"
          onClick={() => onCategoryChange(null)}
          className={`shrink-0 px-3 py-1 rounded-full text-sm border ${
            categoryFilter === null
              ? 'bg-primary border-primary text-white'
              : 'border-gray-600 text-gray-300 hover:bg-white/5'
          }`}
        >
          Tutti
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onCategoryChange(c)}
            className={`shrink-0 px-3 py-1 rounded-full text-sm border ${
              categoryFilter === c
                ? 'bg-primary border-primary text-white'
                : 'border-gray-600 text-gray-300 hover:bg-white/5'
            }`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {seeds.length === 0 ? (
        <div className="text-gray-400 text-sm text-center py-8">Nessun template in questa categoria.</div>
      ) : (
        <div className="space-y-1">
          {seeds.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s)}
              className="w-full text-left px-4 py-3 hover:bg-white/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{s.emoji || '📝'}</span>
                <span className="text-white text-base font-medium flex-1 truncate">{s.title}</span>
                <span className="text-xs text-gray-500 shrink-0">{CATEGORY_LABELS[s.category] || s.category}</span>
              </div>
              <div className="text-gray-400 text-sm mt-1 line-clamp-2">{s.body}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface SaveDialogProps {
  open: boolean;
  defaultTitle: string;
  defaultEmoji: string | null;
  onCancel: () => void;
  onSave: (title: string) => void;
}

export function SaveTemplateDialog({ open, defaultTitle, defaultEmoji, onCancel, onSave }: SaveDialogProps) {
  const [title, setTitle] = useState(defaultTitle);

  useEffect(() => {
    if (open) setTitle(defaultTitle);
  }, [open, defaultTitle]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Salva template"
    >
      <button
        type="button"
        aria-label="Annulla"
        tabIndex={-1}
        className="absolute inset-0 bg-black/60"
        onClick={onCancel}
      />
      <div className="relative bg-[#1F2C33] rounded-2xl w-full max-w-sm p-5">
        <div className="text-white text-lg font-semibold mb-1">Vuoi salvare questo come tuo template?</div>
        <div className="text-gray-400 text-sm mb-4">Riutilizzerai questo testo con 1 tap.</div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          aria-label="Titolo template"
          className="w-full bg-[#0B141A] text-white placeholder-gray-500 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl text-gray-300 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            No grazie
          </button>
          <button
            type="button"
            onClick={() => onSave(title.trim() || defaultTitle)}
            disabled={title.trim().length === 0}
            className="flex-1 py-2 rounded-xl bg-primary text-white font-medium disabled:opacity-50 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 flex items-center justify-center gap-1"
          >
            <Star className="w-4 h-4" />
            Salva
          </button>
        </div>
        {defaultEmoji && <div className="hidden">{defaultEmoji}</div>}
      </div>
    </div>
  );
}
