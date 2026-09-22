'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { X, Search, UserPlus, ChevronDown, ChevronUp, AlertCircle, Loader2, Upload, Settings2 } from 'lucide-react';
import { validatePhone } from '../app/lib/phone';
import { pickerStateForResponseStatus } from '../app/lib/contacts-picker-state';
import { getContactsSnapshot, setContactsSnapshot, clearContactsSnapshots } from '../app/lib/contacts-client-cache';
import { Button } from './Button';
import { ContactAvatar } from './ContactAvatar';
import { LabelPicker } from './LabelPicker';
import { CsvImportDialog } from './CsvImportDialog';
import LabelManagerSheet from './LabelManagerSheet';

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

// Quante righe si montano per volta. La ricerca lavora SEMPRE sull'intera lista:
// è solo il render a essere a finestra.
const PAGE_SIZE = 60;

// Misure a richiesta: in console `localStorage.setItem('wl_perf','1')`, poi riapri la rubrica.
function perfEnabled(): boolean {
  try { return typeof window !== 'undefined' && window.localStorage.getItem('wl_perf') === '1'; } catch { return false; }
}

// Riga memoizzata: digitare in "Cerca" / "Nome" / "Numero" non riconcilia più tutte le righe.
const ContactRow = React.memo(function ContactRow({
  contact: c,
  onPick,
}: {
  contact: Contact;
  onPick: (contact: { number: string; name?: string }) => void;
}) {
  const formattedPhone = formatPhone(c.number);
  const hasRealName = !!c.name && c.name.trim() !== '' && c.name !== `+${c.number}`;
  // When there's no real name, send name=undefined so downstream
  // (ScheduleModal, avatar) shows the formatted phone instead of
  // a confusing "+digits" string.
  const onSelectName = hasRealName ? c.name : undefined;
  return (
    <button
      type="button"
      onClick={() => onPick({ number: c.number, name: onSelectName })}
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
});

interface ContactPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (contact: { number: string; name?: string }) => void;
}

type PickerState =
  | { kind: 'loading' }
  | { kind: 'list'; contacts: Contact[]; recents: Contact[] }
  | { kind: 'syncing' } // #3b: fresh instance, address book not synced yet — transient, retryable
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
  // Label manager sheet + its own bump so the LabelPicker chip-bar refetches
  // when the user creates or deletes a label from the manager.
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);
  const [labelRefetchKey, setLabelRefetchKey] = useState(0);
  // Render incrementale: quante righe della lista filtrata sono montate.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // onSelect arriva come arrow inline dal dashboard: il ref tiene stabile handlePick
  // (altrimenti React.memo su ContactRow non servirebbe a niente).
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handlePick = useCallback(
    (contact: { number: string; name?: string }) => onSelectRef.current(contact),
    [],
  );

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

  // Il filtro etichetta si azzera anche alla CHIUSURA: così alla riapertura
  // labelFilterId è già null e parte UN solo fetch (prima: un fetch ?label=X
  // subito abortito + quello vero, e l'abort finiva nel catch → "Sto sincronizzando…").
  useEffect(() => {
    if (!open) setLabelFilterId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // `cancelled` distingue l'abort del cleanup (chiusura / cambio etichetta / refetch)
    // dal timeout vero: solo il secondo deve portare a "syncing".
    let cancelled = false;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

    // Stale-while-revalidate: se per questo filtro c'è già una lista, mostrala subito.
    const snap = getContactsSnapshot(labelFilterId);
    if (snap) setState({ kind: 'list', contacts: snap.contacts, recents: snap.recents });
    // `shown` = c'è DAVVERO una lista a schermo per questo effetto. Non si guarda lo
    // store globale nei rami d'errore: il prefetch del dashboard può scriverlo mentre
    // questo fetch è in volo, e lo stato resterebbe 'loading' per sempre.
    let shown = !!snap;
    const showLateSnapshotOr = (fallback: PickerState) => {
      if (shown) return;
      const late = getContactsSnapshot(labelFilterId);
      if (late) { setState({ kind: 'list', contacts: late.contacts, recents: late.recents }); shown = true; }
      else setState(fallback);
    };

    const qs = labelFilterId ? `?label=${encodeURIComponent(labelFilterId)}` : '';
    fetch('/api/contacts' + qs, { signal: abort.signal })
      .then(async (res) => {
        clearTimeout(timer);
        if (cancelled) return;
        // #3b: 401 → hard auth error; any other non-2xx (notably 502/504 = fresh
        // instance, contacts not synced yet + Evolution unreachable) → transient
        // "syncing…" state with a retry, not a broken picker.
        const errState = pickerStateForResponseStatus(res.status);
        if (errState) {
          if (errState.kind === 'error') { clearContactsSnapshots(); setState(errState); return; }
          // Errore transitorio: se c'è già una lista a schermo, meglio vecchia che niente.
          showLateSnapshotOr(errState);
          return;
        }
        const tHeaders = typeof performance !== 'undefined' ? performance.now() : 0;
        const body = await res.json();
        if (cancelled) return;
        const contacts: Contact[] = Array.isArray(body.contacts) ? body.contacts : [];
        const recents: Contact[] = Array.isArray(body.recents) ? body.recents : [];
        // Una lettura parziale (una pagina della rubrica è fallita lato server) si
        // mostra ma non si mette in cache: alla prossima apertura si rilegge tutto.
        if (res.headers?.get?.('x-contacts-partial') !== '1') setContactsSnapshot(labelFilterId, contacts, recents);
        setState({ kind: 'list', contacts, recents });
        shown = true;
        if (contacts.length === 0 && !labelFilterId) setManualOpen(true);
        if (perfEnabled() && typeof requestAnimationFrame !== 'undefined') {
          const tParsed = performance.now();
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
            const e = entries.filter((r) => r.name.includes('/api/contacts')).pop();
            console.log('[wl_perf] rubrica', {
              da_cache: !!snap,
              contatti: contacts.length,
              header_ms: Math.round(tHeaders - t0),
              json_ms: Math.round(tParsed - tHeaders),
              render_ms: Math.round(performance.now() - tParsed),
              totale_ms: Math.round(performance.now() - t0),
              rete_kb: e ? Math.round(e.transferSize / 1024) : null,
              json_kb: e ? Math.round(e.decodedBodySize / 1024) : null,
              server_timing: res.headers?.get?.('server-timing') || null,
              sorgente: res.headers?.get?.('x-contacts-source') || null,
            });
          }));
        }
      })
      .catch(() => {
        clearTimeout(timer);
        if (cancelled) return; // abort del cleanup: NON è "sincronizzazione"
        // Timeout/network blip. Con una lista già a schermo la teniamo; senza, syncing + retry.
        showLateSnapshotOr({ kind: 'syncing' });
      });

    return () => { cancelled = true; clearTimeout(timer); abort.abort(); };
  }, [open, labelFilterId, refetchKey]);

  useEffect(() => {
    if (state.kind === 'error') setManualOpen(true);
  }, [state.kind]);

  // Ciò che si DISEGNA. Se lo stato è ancora 'loading' ma in cache c'è una lista per
  // questo filtro, si disegna quella: alla riapertura lo spinner non compare nemmeno
  // per un frame (l'effetto qui sopra riallinea lo stato subito dopo).
  const view: PickerState = useMemo(() => {
    if (state.kind !== 'loading') return state;
    const snap = getContactsSnapshot(labelFilterId);
    return snap ? { kind: 'list', contacts: snap.contacts, recents: snap.recents } : state;
  }, [state, labelFilterId]);

  // Nomi in minuscolo calcolati UNA volta per lista, non a ogni tasto.
  const lowerNames = useMemo(
    () => (view.kind === 'list' ? view.contacts.map((c) => c.name.toLowerCase()) : []),
    [view],
  );

  // La ricerca gira sull'INTERA lista (anche sulle righe non ancora montate).
  const filtered = useMemo(() => {
    if (view.kind !== 'list') return [];
    const q = search.trim().toLowerCase();
    if (!q) return view.contacts;
    return view.contacts.filter((c, i) => lowerNames[i].includes(q) || c.number.includes(q));
  }, [view, lowerNames, search]);

  // Finestra di render: prime N righe, le altre arrivano scorrendo (o col bottone).
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = filtered.length > visibleCount;

  // Nuova ricerca / nuovo filtro / riapertura → si riparte dalla prima pagina, in cima.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [open, search, labelFilterId]);

  // Scroll infinito. Senza IntersectionObserver (jsdom, browser vecchi) resta il bottone.
  useEffect(() => {
    if (!open || !hasMore) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisibleCount((n) => n + PAGE_SIZE);
      },
      { root: scrollRef.current, rootMargin: '800px 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [open, hasMore, visibleCount]);

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
      className="fixed inset-0 z-modal bg-black/60 sm:flex sm:items-center sm:justify-center sm:px-4"
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
          onImported={() => { clearContactsSnapshots(); setRefetchKey(k => k + 1); }}
        />

        <div className="flex items-center gap-1 border-b border-[#2A3942]">
          <div className="flex-1 min-w-0">
            <LabelPicker
              selectedId={labelFilterId}
              onChange={setLabelFilterId}
              refreshKey={labelRefetchKey}
            />
          </div>
          <button
            type="button"
            onClick={() => setLabelManagerOpen(true)}
            aria-label="Gestisci etichette"
            title="Gestisci etichette"
            className="shrink-0 p-2 mr-2 rounded-full text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>

        <LabelManagerSheet
          open={labelManagerOpen}
          onClose={() => setLabelManagerOpen(false)}
          onChange={() => setLabelRefetchKey((k) => k + 1)}
        />

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
          ref={scrollRef}
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

          {view.kind === 'list' && !search.trim() && view.recents.length > 0 && (
            <>
              <div
                className="px-4 pt-3 pb-1 text-xs font-semibold uppercase"
                style={{ color: '#25D366' }}
              >
                Recenti
              </div>
              {view.recents.map((c) => (
                <ContactRow key={`r:${c.number}`} contact={c} onPick={handlePick} />
              ))}
            </>
          )}

          {view.kind === 'list' && view.contacts.length > 0 && (
            <div
              className="px-4 pt-3 pb-1 text-xs font-semibold uppercase"
              style={{ color: '#25D366' }}
            >
              Contatti su WhatsApp ({view.contacts.length})
            </div>
          )}

          {view.kind === 'loading' && (
            <div className="p-8 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" style={{ color: '#25D366' }} />
              <p className="text-sm" style={{ color: '#AEBAC1' }}>Caricamento contatti…</p>
            </div>
          )}

          {view.kind === 'error' && (
            <div
              className="p-4 mx-4 my-3 rounded-xl text-sm flex items-start gap-2"
              style={{ backgroundColor: '#2A3942', color: '#F87171' }}
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {view.reason === 'timeout' && 'Caricamento contatti scaduto. '}
                {view.reason === 'unavailable' && 'Impossibile caricare i contatti. '}
                {view.reason === 'unauthorized' && 'Sessione scaduta. '}
                Puoi inserire il numero manualmente.
              </span>
            </div>
          )}

          {/* #3b: fresh instance whose address book hasn't synced yet (or a reconnect
              in progress). Not an error — a transient state with a Retry, so a
              just-registered user never sees a broken/empty picker. "Nuovo contatto"
              above stays available the whole time. */}
          {view.kind === 'syncing' && (
            <div className="p-6 mx-4 my-3 rounded-xl text-center" style={{ backgroundColor: '#2A3942' }}>
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" style={{ color: '#25D366' }} />
              <p className="text-sm font-medium text-white mb-1">Sto sincronizzando i tuoi contatti…</p>
              <p className="text-xs mb-3" style={{ color: '#AEBAC1' }}>
                Può richiedere qualche minuto dopo il collegamento di WhatsApp. Intanto puoi
                usare &quot;Nuovo contatto&quot; qui sopra.
              </p>
              <Button
                type="button"
                onClick={() => { setState({ kind: 'loading' }); setRefetchKey((k) => k + 1); }}
                className="!bg-[#25D366] hover:!bg-[#1DA851] !text-white !border-transparent"
                size="sm"
              >
                Riprova
              </Button>
            </div>
          )}

          {view.kind === 'list' && filtered.length === 0 && view.contacts.length > 0 && (
            <div className="p-8 text-center text-sm" style={{ color: '#AEBAC1' }}>
              Nessun risultato per &quot;{search}&quot;.
            </div>
          )}

          {view.kind === 'list' && view.contacts.length === 0 && (
            <div className="p-8 text-center text-sm" style={{ color: '#AEBAC1' }}>
              Nessun contatto in rubrica.
            </div>
          )}

          {view.kind === 'list' && visible.map((c) => (
            <ContactRow key={`a:${c.number}`} contact={c} onPick={handlePick} />
          ))}

          {view.kind === 'list' && hasMore && (
            <>
              <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                className="w-full px-4 py-3 text-sm font-medium hover:bg-[#1F2C34]"
                style={{ color: '#25D366' }}
              >
                Mostra altri ({filtered.length - visibleCount})
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
