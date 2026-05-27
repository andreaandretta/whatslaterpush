'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { X, Search, UserPlus, ChevronDown, ChevronUp, AlertCircle, Loader2, Upload } from 'lucide-react';
import { validatePhone } from '../app/lib/phone';
import { Button } from './Button';
import { ContactAvatar } from './ContactAvatar';
import { LabelPicker } from './LabelPicker';
import { CsvImportDialog } from './CsvImportDialog';

interface Contact {
  number: string;
  name: string;
  pushName?: string;
  photoUrl?: string;
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
  | { kind: 'list'; contacts: Contact[]; recents: Contact[] }
  | { kind: 'error'; reason: 'timeout' | 'unavailable' | 'unauthorized' };

export default function ContactPickerModal({ open, onClose, onSelect }: ContactPickerModalProps) {
  const [state, setState] = useState<PickerState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualNumber, setManualNumber] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  // Label filter — null = no filter, string = filter by label_id.
  // Refetches /api/contacts when changed.
  const [labelFilterId, setLabelFilterId] = useState<string | null>(null);
  // CSV import dialog.
  const [csvOpen, setCsvOpen] = useState(false);
  // Bump to force refetch (e.g. after CSV import adds new contacts).
  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    setState({ kind: 'loading' });
    setSearch('');
    setManualOpen(false);
    setManualName('');
    setManualNumber('');
    setManualError(null);
    setLabelFilterId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);

    const qs = labelFilterId ? `?label=${encodeURIComponent(labelFilterId)}` : '';
    fetch('/api/contacts' + qs, { signal: abort.signal })
      .then(async (res) => {
        clearTimeout(timer);
        if (res.status === 401) { setState({ kind: 'error', reason: 'unauthorized' }); return; }
        if (!res.ok) { setState({ kind: 'error', reason: 'unavailable' }); return; }
        const body = await res.json();
        const contacts: Contact[] = Array.isArray(body.contacts) ? body.contacts : [];
        const recents: Contact[] = Array.isArray(body.recents) ? body.recents : [];
        setState({ kind: 'list', contacts, recents });
        if (contacts.length === 0 && !labelFilterId) setManualOpen(true);
      })
      .catch((e) => {
        clearTimeout(timer);
        if (e?.name === 'AbortError') setState({ kind: 'error', reason: 'timeout' });
        else setState({ kind: 'error', reason: 'unavailable' });
      });

    return () => { clearTimeout(timer); abort.abort(); };
  }, [open, labelFilterId, refetchKey]);

  useEffect(() => {
    if (state.kind === 'error') setManualOpen(true);
  }, [state.kind]);

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

  function renderContactButton(c: Contact, keyPrefix: string) {
    const formattedPhone = formatPhone(c.number);
    const hasRealName = !!c.name && c.name.trim() !== '' && c.name !== `+${c.number}`;
    // When there's no real name, send name=undefined so downstream
    // (ScheduleModal, avatar) shows the formatted phone instead of
    // a confusing "+digits" string.
    const onSelectName = hasRealName ? c.name : undefined;
    return (
      <button
        key={`${keyPrefix}${c.number}`}
        type="button"
        onClick={() => onSelect({ number: c.number, name: onSelectName })}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#1F2C34]"
      >
        <ContactAvatar
          name={hasRealName ? c.name : undefined}
          number={c.number}
          photoSrc={c.photoUrl}
        />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">
            {hasRealName ? c.name : formattedPhone}
          </div>
          {hasRealName && (
            <div className="text-xs truncate" style={{ color: '#AEBAC1' }}>
              {formattedPhone}
            </div>
          )}
        </div>
      </button>
    );
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 sm:flex sm:items-center sm:justify-center sm:px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="fixed inset-0 sm:static sm:h-auto sm:max-h-[85vh] sm:max-w-md sm:rounded-3xl sm:shadow-soft flex flex-col overflow-hidden"
        style={{ backgroundColor: '#111B21' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 text-white shrink-0"
          style={{ backgroundColor: '#1F2C34' }}
        >
          <h2 className="font-semibold">Nuovo messaggio</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCsvOpen(true)}
              aria-label="Importa da CSV"
              title="Importa da CSV"
              className="p-1.5 rounded-full hover:bg-white/10"
            >
              <Upload className="w-4 h-4" />
            </button>
            <button onClick={onClose} aria-label="Chiudi" className="p-1 rounded-full hover:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <CsvImportDialog
          open={csvOpen}
          onClose={() => setCsvOpen(false)}
          onImported={() => setRefetchKey(k => k + 1)}
        />

        <LabelPicker selectedId={labelFilterId} onChange={setLabelFilterId} />

        <div className="px-4 py-2" style={{ backgroundColor: '#111B21' }}>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: '#AEBAC1' }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca contatto…"
              className="w-full pl-9 pr-3 py-2 rounded-full text-sm text-white placeholder:text-[#8696A0] focus:outline-none focus:ring-2"
              style={{ backgroundColor: '#2A3942', boxShadow: 'none' }}
            />
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto"
          style={{ backgroundColor: '#111B21' }}
        >
          <button
            type="button"
            onClick={() => setManualOpen(!manualOpen)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1F2C34]"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center border"
                style={{ borderColor: '#25D366', backgroundColor: 'rgba(37, 211, 102, 0.12)' }}
              >
                <UserPlus className="w-5 h-5" style={{ color: '#25D366' }} />
              </div>
              <span className="font-medium text-white">Nuovo contatto</span>
            </div>
            {manualOpen
              ? <ChevronUp className="w-4 h-4" style={{ color: '#AEBAC1' }} />
              : <ChevronDown className="w-4 h-4" style={{ color: '#AEBAC1' }} />}
          </button>

          {manualOpen && (
            <div className="px-4 pb-4 space-y-2">
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Nome (opzionale)"
                className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder:text-[#8696A0] focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                style={{ backgroundColor: '#2A3942' }}
              />
              <input
                type="tel"
                inputMode="tel"
                value={manualNumber}
                onChange={(e) => setManualNumber(e.target.value)}
                placeholder="Numero (es. 3331234567)"
                className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder:text-[#8696A0] focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                style={{ backgroundColor: '#2A3942' }}
              />
              {manualError && <div className="text-xs text-red-400">{manualError}</div>}
              <Button
                type="button"
                onClick={handleManualSubmit}
                className="w-full !bg-[#25D366] hover:!bg-[#1DA851] !text-white !border-transparent"
                size="sm"
              >
                Continua
              </Button>
            </div>
          )}

          {state.kind === 'list' && !search.trim() && state.recents.length > 0 && (
            <>
              <div
                className="px-4 pt-3 pb-1 text-xs font-semibold uppercase"
                style={{ color: '#25D366' }}
              >
                Recenti
              </div>
              {state.recents.map((c) => renderContactButton(c, 'r:'))}
            </>
          )}

          {state.kind === 'list' && state.contacts.length > 0 && (
            <div
              className="px-4 pt-3 pb-1 text-xs font-semibold uppercase"
              style={{ color: '#25D366' }}
            >
              Contatti su WhatsApp ({state.contacts.length})
            </div>
          )}

          {state.kind === 'loading' && (
            <div className="p-8 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" style={{ color: '#25D366' }} />
              <p className="text-sm" style={{ color: '#AEBAC1' }}>Caricamento contatti…</p>
            </div>
          )}

          {state.kind === 'error' && (
            <div
              className="p-4 mx-4 my-3 rounded-xl text-sm flex items-start gap-2"
              style={{ backgroundColor: '#2A3942', color: '#F87171' }}
            >
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
            <div className="p-8 text-center text-sm" style={{ color: '#AEBAC1' }}>
              Nessun risultato per &quot;{search}&quot;.
            </div>
          )}

          {state.kind === 'list' && state.contacts.length === 0 && (
            <div className="p-8 text-center text-sm" style={{ color: '#AEBAC1' }}>
              Nessun contatto in rubrica.
            </div>
          )}

          {state.kind === 'list' && filtered.map((c) => renderContactButton(c, 'a:'))}
        </div>
      </div>
    </div>
  );
}
