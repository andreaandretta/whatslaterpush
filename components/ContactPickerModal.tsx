'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { X, Search, UserPlus, ChevronDown, ChevronUp, AlertCircle, Loader2 } from 'lucide-react';
import { validatePhone } from '../app/lib/phone';
import { Button } from './Button';
import { ContactAvatar } from './ContactAvatar';

interface Contact {
  number: string;
  name: string;
  pushName?: string;
}

function formatPhone(digits: string): string {
  if (digits.startsWith('39') && digits.length >= 11 && digits.length <= 12) {
    const local = digits.slice(2);
    if (local.length === 10) return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
    if (local.length === 9) return `${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
  }
  return `+${digits}`;
}

interface ContactPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (contact: { number: string; name?: string }) => void;
}

type PickerState =
  | { kind: 'loading' }
  | { kind: 'list'; contacts: Contact[] }
  | { kind: 'error'; reason: 'timeout' | 'unavailable' | 'unauthorized' };

export default function ContactPickerModal({ open, onClose, onSelect }: ContactPickerModalProps) {
  const [state, setState] = useState<PickerState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualNumber, setManualNumber] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  // Tracks which contact numbers have entered the viewport at least once.
  // Once a row is observed, we keep its photo loading flag forever so the
  // <img> stays mounted even if the user scrolls past — IntersectionObserver
  // is purely an "opt-in to network request" trigger, not a mount gate.
  const [visiblePhones, setVisiblePhones] = useState<Set<string>>(() => new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setState({ kind: 'loading' });
    setSearch('');
    setManualOpen(false);
    setManualName('');
    setManualNumber('');
    setManualError(null);
    setVisiblePhones(new Set());

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);

    fetch('/api/contacts', { signal: abort.signal })
      .then(async (res) => {
        clearTimeout(timer);
        if (res.status === 401) { setState({ kind: 'error', reason: 'unauthorized' }); return; }
        if (!res.ok) { setState({ kind: 'error', reason: 'unavailable' }); return; }
        const body = await res.json();
        const contacts: Contact[] = Array.isArray(body.contacts) ? body.contacts : [];
        setState({ kind: 'list', contacts });
        if (contacts.length === 0) setManualOpen(true);
      })
      .catch((e) => {
        clearTimeout(timer);
        if (e?.name === 'AbortError') setState({ kind: 'error', reason: 'timeout' });
        else setState({ kind: 'error', reason: 'unavailable' });
      });

    return () => { clearTimeout(timer); abort.abort(); };
  }, [open]);

  useEffect(() => {
    if (state.kind === 'error') setManualOpen(true);
  }, [state.kind]);

  // Set up the IntersectionObserver once the list is rendered. Reuse a single
  // observer for all rows — much cheaper than one per item.
  useEffect(() => {
    if (!open || state.kind !== 'list') return;
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const newlyVisible: string[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const phone = (entry.target as HTMLElement).dataset.phone;
          if (phone) newlyVisible.push(phone);
          // Once revealed, stop observing — we never need to unload a photo.
          observer.unobserve(entry.target);
        }
        if (newlyVisible.length > 0) {
          setVisiblePhones((prev) => {
            const next = new Set(prev);
            for (const p of newlyVisible) next.add(p);
            return next;
          });
        }
      },
      { root, rootMargin: '100px 0px', threshold: 0.01 }
    );

    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [open, state.kind]);

  // Callback ref attached to each row — registers it with the observer.
  const registerRow = useCallback((el: HTMLButtonElement | null) => {
    if (!el) return;
    const observer = observerRef.current;
    if (!observer) return;
    observer.observe(el);
  }, []);

  const filtered = useMemo(() => {
    if (state.kind !== 'list') return [];
    const q = search.trim().toLowerCase();
    if (!q) return state.contacts;
    return state.contacts.filter((c) =>
      c.name.toLowerCase().includes(q) || c.number.includes(q)
    );
  }, [state, search]);

  function handleManualSubmit() {
    setManualError(null);
    const normalized = validatePhone(manualNumber);
    if (!normalized) {
      setManualError('Numero non valido (min 10 cifre).');
      return;
    }
    onSelect({ number: normalized, name: manualName.trim() || undefined });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center sm:px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-md sm:rounded-3xl sm:shadow-soft flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-primary text-white">
          <h2 className="font-semibold">Nuovo messaggio</h2>
          <button onClick={onClose} aria-label="Chiudi" className="p-1 rounded-full hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca contatto…"
              className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-full text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <button
            type="button"
            onClick={() => setManualOpen(!manualOpen)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-primary" />
              </div>
              <span className="font-semibold text-text-primary">Nuovo contatto</span>
            </div>
            {manualOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {manualOpen && (
            <div className="px-4 pb-4 space-y-2">
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Nome (opzionale)"
                className="w-full px-3 py-2 border border-border rounded-xl text-sm focus:outline-none focus:border-primary"
              />
              <input
                type="tel"
                inputMode="tel"
                value={manualNumber}
                onChange={(e) => setManualNumber(e.target.value)}
                placeholder="Numero (es. 3331234567)"
                className="w-full px-3 py-2 border border-border rounded-xl text-sm focus:outline-none focus:border-primary"
              />
              {manualError && <div className="text-xs text-error-dark">{manualError}</div>}
              <Button type="button" onClick={handleManualSubmit} className="w-full" size="sm">
                Continua
              </Button>
            </div>
          )}

          {state.kind === 'list' && state.contacts.length > 0 && (
            <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase text-text-secondary border-t border-gray-100">
              Contatti su WhatsApp ({state.contacts.length})
            </div>
          )}

          {state.kind === 'loading' && (
            <div className="p-8 text-center">
              <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-2" />
              <p className="text-sm text-text-secondary">Caricamento contatti…</p>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="p-4 mx-4 my-3 rounded-xl bg-error-light text-error-dark text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {state.reason === 'timeout' && 'Caricamento contatti scaduto. '}
                {state.reason === 'unavailable' && 'Impossibile caricare i contatti. '}
                {state.reason === 'unauthorized' && 'Sessione scaduta. '}
                Puoi inserire il numero manualmente.
              </span>
            </div>
          )}

          {state.kind === 'list' && filtered.length === 0 && state.contacts.length > 0 && (
            <div className="p-8 text-center text-sm text-text-secondary">Nessun risultato per &quot;{search}&quot;.</div>
          )}

          {state.kind === 'list' && state.contacts.length === 0 && (
            <div className="p-8 text-center text-sm text-text-secondary">Nessun contatto in rubrica.</div>
          )}

          {state.kind === 'list' && filtered.map((c) => {
            const formattedPhone = formatPhone(c.number);
            const hasRealName = !!c.name && c.name.trim() !== '' && c.name !== `+${c.number}`;
            // When there's no real name, send name=undefined so downstream
            // (ScheduleModal, avatar) shows the formatted phone instead of
            // a confusing "+digits" string.
            const onSelectName = hasRealName ? c.name : undefined;
            const photoSrc = visiblePhones.has(c.number)
              ? `/api/contacts/${c.number}/photo`
              : undefined;
            return (
              <button
                key={c.number}
                ref={registerRow}
                data-phone={c.number}
                type="button"
                onClick={() => onSelect({ number: c.number, name: onSelectName })}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
              >
                <ContactAvatar
                  name={hasRealName ? c.name : undefined}
                  number={c.number}
                  photoSrc={photoSrc}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-text-primary truncate">
                    {hasRealName ? c.name : formattedPhone}
                  </div>
                  {hasRealName && (
                    <div className="text-xs text-text-secondary truncate">{formattedPhone}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
