'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { X, Search, UserPlus, ChevronDown, ChevronUp, AlertCircle, Loader2, Upload, Settings2 } from 'lucide-react';
// Il parser dei numeri (libphonenumber, ~40 KB gzip di metadati) si carica solo
// quando serve: all'apertura di "Nuovo contatto", non con la dashboard.
import type { PhoneInputResult } from '../app/lib/phone';
import { pickerStateForResponseStatus } from '../app/lib/contacts-picker-state';
import { getContactsSnapshot, setContactsSnapshot, clearContactsSnapshots, getGroupsSnapshot, setGroupsSnapshot, type PickerGroup } from '../app/lib/contacts-client-cache';
import { isGroupJid } from '../app/lib/jid';
import { Button } from './Button';
import { ContactAvatar } from './ContactAvatar';
import { LabelPicker } from './LabelPicker';
import { useModalHistory } from '../app/lib/use-modal-history';
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

const loadPhone = () => import('../app/lib/phone');

// Ricerca: se la query è un numero ("+39 347 123 4567", "0039 347…", "081 555…")
// si confrontano solo le cifre, senza "00" iniziale. I numeri in lista sono cifre
// E.164 (39…), quindi "347 123 4567" e "+39 347…" trovano entrambi 393471234567.
// Prima "+39 347…" e "347 123 4567" non trovavano niente (spazi e "+").
function digitsQuery(q: string): string | null {
  if (!/^[\d\s+().-]+$/.test(q)) return null;
  const d = q.replace(/\D/g, '');
  if (d.length < 3) return null;
  return d.startsWith('00') ? d.slice(2) : d;
}

// Quante righe si montano per volta. La ricerca lavora SEMPRE sull'intera lista:
// è solo il render a essere a finestra.
const PAGE_SIZE = 60;

// Lo snapshot dei gruppi (solo in memoria) vale 10 minuti: dentro questa
// finestra riaprire il picker non rilegge i gruppi. Ogni lettura costa a
// WhatsApp 1+2N richieste, e il server ne concede una ogni 30 minuti.
const GROUPS_FRESH_MS = 10 * 60_000;
const GROUPS_TIMEOUT_MS = 30_000;

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
  onPick: (contact: PickedContact) => void;
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

// Sottotitolo di un gruppo: "Gruppo · 19 persone", "Gruppo · 1 persona", "Gruppo".
function groupSubtitle(g: PickerGroup): string {
  const parts = ['Gruppo'];
  if (typeof g.size === 'number' && g.size > 0) parts.push(g.size === 1 ? '1 persona' : `${g.size} persone`);
  if (g.hint) parts.push(g.hint);
  if (!g.can_send) parts.push('scrivono solo gli amministratori');
  return parts.join(' · ');
}

// Riga di un gruppo: stesso layout di ContactRow. Mai le cifre del JID a schermo.
// Un gruppo in cui scrivono solo gli amministratori resta visibile ma non si sceglie.
const GroupRow = React.memo(function GroupRow({
  group: g,
  onPick,
}: {
  group: PickerGroup;
  onPick: (contact: PickedContact) => void;
}) {
  return (
    <button
      type="button"
      disabled={!g.can_send}
      onClick={() => onPick({ number: g.jid, name: g.name, kind: 'group', size: g.size, hint: g.hint ?? null })}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${g.can_send ? 'hover:bg-[#1F2C34]' : 'opacity-50 cursor-not-allowed'}`}
    >
      <ContactAvatar name={g.name} number={g.jid} variant="group" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-white truncate">{g.name}</div>
        <div className="text-xs truncate" style={{ color: '#AEBAC1' }}>
          {groupSubtitle(g)}
        </div>
      </div>
    </button>
  );
});

// manualEntry: il numero è stato scritto a mano in "Nuovo contatto" (non scelto
// dalla rubrica o dai Recenti). La POST /api/messages lo salva come contatto
// manuale SOLO in quel caso (body.manual_entry).
// kind 'group': `number` è il JID del gruppo; size e hint (omonimi) servono
// solo alla ScheduleModal, il server rilegge nome e persone da WhatsApp.
export type PickedContact = {
  number: string;
  name?: string;
  manualEntry?: boolean;
  kind?: 'contact' | 'group';
  size?: number | null;
  hint?: string | null;
};

interface ContactPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (contact: PickedContact) => void;
}

type PickerState =
  | { kind: 'loading' }
  | { kind: 'list'; contacts: Contact[]; recents: Contact[] }
  | { kind: 'syncing' } // #3b: fresh instance, address book not synced yet — transient, retryable
  | { kind: 'error'; reason: 'timeout' | 'unavailable' | 'unauthorized' };

// Sezione Gruppi. `visible` sugli stati di attesa/errore: con i gruppi spenti
// (GROUPS_ENABLED assente) la sezione non deve comparire nemmeno per un attimo,
// quindi "Carico i gruppi…" e l'errore si mostrano solo se c'è un indizio che i
// gruppi siano accesi (uno snapshot con gruppi, o groups_status dalla rubrica).
// `groups` su loading/error: durante e dopo un Aggiorna la lista a schermo resta.
// `refreshed`: la risposta viene da un Aggiorna, e il motivo va detto anche
// se sotto c'è la lista (altrimenti Aggiorna sembra non fare niente).
type GroupsState =
  | { kind: 'off' }
  | { kind: 'waiting'; visible: boolean }   // aspetta la risposta di /api/contacts
  | { kind: 'loading'; visible: boolean; groups: PickerGroup[] }
  | { kind: 'list'; groups: PickerGroup[] }
  | { kind: 'throttled'; groups: PickerGroup[]; refreshed: boolean }
  | { kind: 'slow'; groups: PickerGroup[]; refreshed: boolean }
  | { kind: 'error'; visible: boolean; groups: PickerGroup[] }
  | { kind: 'disconnected' };

function validGroups(raw: unknown): PickerGroup[] {
  return Array.isArray(raw) ? raw.filter((g) => g && isGroupJid(g.jid) && typeof g.name === 'string') : [];
}

export default function ContactPickerModal({ open, onClose, onSelect }: ContactPickerModalProps) {
  const [state, setState] = useState<PickerState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualNumber, setManualNumber] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  // Numero estero letto dal parser, in attesa di "Sì, è giusto" / "Correggi".
  const [manualConfirm, setManualConfirm] = useState<{ digits: string; label: string } | null>(null);
  const manualNumberRef = useRef<HTMLInputElement | null>(null);
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
  // Gruppi: /api/groups parte solo DOPO la risposta di /api/contacts (che può
  // già portarli, D18). contactsPendingRef copre il run in cui l'effetto della
  // rubrica è appena ripartito ma contactsSettled è ancora quello vecchio.
  const [contactsSettled, setContactsSettled] = useState(false);
  const contactsPendingRef = useRef(false);
  const contactsGroupsRef = useRef<{ status: string | null; brought: boolean }>({ status: null, brought: false });
  const [groupsState, setGroupsState] = useState<GroupsState>({ kind: 'off' });
  const [groupsRefreshKey, setGroupsRefreshKey] = useState(0);
  const groupsRefreshRef = useRef(false);
  // Render incrementale: quante righe della lista filtrata sono montate.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // onSelect arriva come arrow inline dal dashboard: il ref tiene stabile handlePick
  // (altrimenti React.memo su ContactRow non servirebbe a niente).
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handlePick = useCallback(
    (contact: PickedContact) => onSelectRef.current(contact),
    [],
  );

  // Indietro (Android/iOS) chiude il foglio in cima, poi il selettore: mai l'app intera.
  useModalHistory(open, onClose);
  useModalHistory(open && (csvOpen || labelManagerOpen), () => { setCsvOpen(false); setLabelManagerOpen(false); });

  useEffect(() => {
    if (!open) return;
    setState({ kind: 'loading' });
    setSearch('');
    setManualOpen(false);
    setManualName('');
    setManualNumber('');
    setManualError(null);
    setManualConfirm(null);
    setLabelFilterId(null);
  }, [open]);

  // Il parser si scarica mentre l'utente scrive, così "Continua" risponde subito.
  useEffect(() => {
    if (open && manualOpen) void loadPhone().catch(() => {});
  }, [open, manualOpen]);

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
    contactsPendingRef.current = true;
    contactsGroupsRef.current = { status: null, brought: false };
    setContactsSettled(false);
    const settle = () => { contactsPendingRef.current = false; setContactsSettled(true); };

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
          if (errState.kind === 'error') { clearContactsSnapshots(); setState(errState); settle(); return; }
          // Errore transitorio: se c'è già una lista a schermo, meglio vecchia che niente.
          showLateSnapshotOr(errState);
          settle();
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
        // Gruppi letti insieme alla rubrica (solo con i gruppi accesi): niente /api/groups.
        const broughtGroups = Array.isArray(body.groups);
        if (broughtGroups) setGroupsSnapshot(validGroups(body.groups));
        contactsGroupsRef.current = {
          status: typeof body.groups_status === 'string' ? body.groups_status : null,
          brought: broughtGroups,
        };
        setState({ kind: 'list', contacts, recents });
        shown = true;
        settle();
        // Rubrica vuota → Nuovo contatto aperto, tranne quando ci sono gruppi da scegliere.
        if (contacts.length === 0 && !labelFilterId && !(getGroupsSnapshot()?.groups.length)) setManualOpen(true);
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
        settle();
      });

    return () => { cancelled = true; clearTimeout(timer); abort.abort(); };
  }, [open, labelFilterId, refetchKey]);

  // Gruppi (D18). Mai in parallelo a /api/contacts: prima lo snapshot fresco,
  // poi si aspetta la rubrica, che può averli già portati o aver detto che il
  // server è lento. Un errore qui non tocca mai la rubrica né "Nuovo contatto".
  useEffect(() => {
    if (!open || labelFilterId !== null) return;
    const refresh = groupsRefreshRef.current;
    const snap = getGroupsSnapshot();
    const fromContacts = contactsGroupsRef.current;
    const likelyOn = (snap?.groups.length ?? 0) > 0 || fromContacts.status !== null;

    if (!refresh && snap && Date.now() - snap.fetchedAt < GROUPS_FRESH_MS) {
      setGroupsState({ kind: 'list', groups: snap.groups });
      return;
    }
    if (!contactsSettled || contactsPendingRef.current) {
      setGroupsState({ kind: 'waiting', visible: likelyOn });
      return;
    }
    if (!refresh) {
      if (fromContacts.brought) {
        setGroupsState({ kind: 'list', groups: snap?.groups ?? [] });
        return;
      }
      // La rubrica ha aspettato i gruppi 5 s senza risposta: niente fetch automatica.
      if (fromContacts.status === 'timeout') {
        setGroupsState({ kind: 'slow', groups: snap?.groups ?? [], refreshed: false });
        return;
      }
    }

    groupsRefreshRef.current = false;
    let cancelled = false;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), GROUPS_TIMEOUT_MS);
    const kept = refresh ? (snap?.groups ?? []) : [];
    setGroupsState({ kind: 'loading', visible: likelyOn, groups: kept });
    fetch('/api/groups' + (refresh ? '?refresh=1' : ''), { signal: abort.signal })
      .then(async (res) => {
        clearTimeout(timer);
        if (cancelled) return;
        if (res.status === 401) { setGroupsState({ kind: 'off' }); return; }
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          // groups_timeout / groups_unavailable arrivano solo con i gruppi accesi.
          const known = typeof body?.error === 'string' && body.error.startsWith('groups_');
          setGroupsState({ kind: 'error', visible: known || likelyOn, groups: kept });
          return;
        }
        if (body?.enabled === false) { setGroupsState({ kind: 'off' }); return; }
        if (body?.connected === false) { setGroupsState({ kind: 'disconnected' }); return; }
        const groups = validGroups(body?.groups);
        if (body?.slow || body?.throttled) {
          // Il server non ha letto: si mostra quello che c'è, anche uno snapshot vecchio.
          if (groups.length > 0) setGroupsSnapshot(groups);
          const shown = groups.length > 0 ? groups : (getGroupsSnapshot()?.groups ?? []);
          setGroupsState({ kind: body.slow ? 'slow' : 'throttled', groups: shown, refreshed: refresh });
          return;
        }
        setGroupsSnapshot(groups);
        setGroupsState({ kind: 'list', groups });
      })
      .catch(() => {
        clearTimeout(timer);
        if (cancelled) return;
        setGroupsState({ kind: 'error', visible: likelyOn, groups: kept });
      });

    return () => { cancelled = true; clearTimeout(timer); abort.abort(); };
  }, [open, labelFilterId, contactsSettled, groupsRefreshKey]);

  const refreshGroups = useCallback(() => {
    groupsRefreshRef.current = true;
    setGroupsRefreshKey((k) => k + 1);
  }, []);

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

  // Nomi in minuscolo calcolati UNA volta per lista, non a ogni tasto. Dentro c'è
  // anche il nome WhatsApp (pushName): chi è salvato col numero si trova per nome.
  const lowerNames = useMemo(
    () => (view.kind === 'list'
      ? view.contacts.map((c) => (c.pushName && c.pushName !== c.name ? `${c.name}\n${c.pushName}` : c.name).toLowerCase())
      : []),
    [view],
  );

  // La ricerca gira sull'INTERA lista (anche sulle righe non ancora montate).
  // Difesa: un JID (con '@') non è mai un contatto da mostrare.
  const filtered = useMemo(() => {
    if (view.kind !== 'list') return [];
    const q = search.trim().toLowerCase();
    if (!q) return view.contacts.filter((c) => !c.number.includes('@'));
    const qd = digitsQuery(q);
    return view.contacts.filter((c, i) => !c.number.includes('@') && (lowerNames[i].includes(q) || c.number.includes(q) || (qd !== null && c.number.includes(qd))));
  }, [view, lowerNames, search]);

  // Gruppi a schermo: la ricerca guarda solo il nome, mai le cifre del JID.
  // Con un filtro etichetta la sezione è nascosta: nessun gruppo conta.
  const allGroups = useMemo(
    () => (labelFilterId !== null || groupsState.kind === 'off' || groupsState.kind === 'waiting' || groupsState.kind === 'disconnected'
      ? []
      : groupsState.groups),
    [groupsState, labelFilterId],
  );
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allGroups;
    return allGroups.filter((g) => g.name.toLowerCase().includes(q));
  }, [allGroups, search]);

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

  // "Continua" di Nuovo contatto. Senza "+" o "00" il numero è italiano: un
  // cellulare con una cifra in più viene rifiutato (prima diventava Spagna,
  // Francia, Ungheria… e il promemoria poteva arrivare a uno sconosciuto). Un
  // numero estero si accetta solo dopo averne mostrato la lettura.
  async function handleManualSubmit() {
    setManualError(null);
    setManualConfirm(null);
    let parsed: PhoneInputResult;
    let errorText: (e: Extract<PhoneInputResult, { ok: false }>['error']) => string;
    let describe: (country?: string) => string;
    try {
      const phone = await loadPhone();
      parsed = phone.parsePhoneInput(manualNumber);
      errorText = phone.phoneInputErrorMessage;
      describe = (country) => [phone.flagEmoji(country), phone.countryNameIt(country)].filter(Boolean).join(' ');
    } catch {
      setManualError('Non riesco a controllare il numero. Riprova.');
      return;
    }
    if (!parsed.ok) {
      setManualError(errorText(parsed.error));
      return;
    }
    if (!parsed.italian) {
      const where = describe(parsed.country);
      setManualConfirm({ digits: parsed.digits, label: `${where ? where + ' · ' : ''}${parsed.international}` });
      return;
    }
    onSelect({ number: parsed.digits, name: manualName.trim() || undefined, manualEntry: true });
  }

  function confirmForeignNumber() {
    if (!manualConfirm) return;
    onSelect({ number: manualConfirm.digits, name: manualName.trim() || undefined, manualEntry: true });
  }

  // Dalla ricerca senza risultati: apre Nuovo contatto già compilato con quello
  // che l'utente ha scritto (cifre → Numero, testo → Nome).
  function openManualFromSearch() {
    const q = search.trim();
    if (digitsQuery(q) !== null) setManualNumber(q);
    else if (q) setManualName(q);
    setManualError(null);
    setManualConfirm(null);
    setManualOpen(true);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setTimeout(() => manualNumberRef.current?.focus(), 0);
  }

  if (!open) return null;

  const searching = search.trim() !== '';
  const recents = view.kind === 'list' ? view.recents.filter((c) => !c.number.includes('@')) : [];
  // Righe di stato della sezione Gruppi (mai durante una ricerca).
  let groupsStatus: string | null = null;
  if (!searching) {
    if ((groupsState.kind === 'waiting' || groupsState.kind === 'loading') && groupsState.visible) groupsStatus = 'Carico i gruppi…';
    else if (groupsState.kind === 'error' && groupsState.visible) groupsStatus = 'Non riesco a leggere i gruppi. Tocca Aggiorna per riprovare.';
    else if (groupsState.kind === 'throttled' && (allGroups.length === 0 || groupsState.refreshed)) groupsStatus = 'Gruppi: riprova tra qualche minuto.';
    else if (groupsState.kind === 'slow' && (allGroups.length === 0 || groupsState.refreshed)) groupsStatus = 'Hai tanti gruppi: la lista non è ancora pronta. Riprova più tardi.';
    else if (groupsState.kind === 'disconnected') groupsStatus = 'Ricollega WhatsApp per vedere i tuoi gruppi.';
  }
  const showGroups = labelFilterId === null && (filteredGroups.length > 0 || groupsStatus !== null);
  const canRefreshGroups = groupsState.kind === 'list' || groupsState.kind === 'error'
    || groupsState.kind === 'throttled' || groupsState.kind === 'slow';
  // Con i gruppi spenti, o nascosti dal filtro etichetta, la ricerca dice "Cerca contatto…" come prima.
  const groupsOn = labelFilterId === null && (
    groupsState.kind === 'list' || groupsState.kind === 'throttled' || groupsState.kind === 'slow'
    || groupsState.kind === 'disconnected'
    || ((groupsState.kind === 'waiting' || groupsState.kind === 'loading' || groupsState.kind === 'error') && groupsState.visible));

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
              placeholder={groupsOn ? 'Cerca contatto o gruppo…' : 'Cerca contatto…'}
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
                ref={manualNumberRef}
                type="tel"
                inputMode="tel"
                value={manualNumber}
                onChange={(e) => { setManualNumber(e.target.value); setManualConfirm(null); }}
                placeholder="Numero (es. 333 123 4567, estero con +)"
                aria-label="Numero"
                aria-invalid={manualError ? true : undefined}
                className="w-full px-3 py-2 rounded-xl text-sm text-white placeholder:text-[#8696A0] focus:outline-none focus:ring-2 focus:ring-[#25D366]"
                style={{ backgroundColor: '#2A3942' }}
              />
              {manualError && <div role="alert" className="text-xs text-red-400">{manualError}</div>}
              {manualConfirm ? (
                <div className="rounded-xl p-3 space-y-2" style={{ backgroundColor: '#1F2C34' }} role="group" aria-label="Conferma numero estero">
                  <p className="text-sm text-white">{manualConfirm.label} — è giusto?</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={confirmForeignNumber}
                      className="flex-1 !bg-[#25D366] hover:!bg-[#1DA851] !text-white !border-transparent"
                      size="sm"
                    >
                      Sì, è giusto
                    </Button>
                    <Button
                      type="button"
                      onClick={() => { setManualConfirm(null); manualNumberRef.current?.focus(); }}
                      className="flex-1 !bg-transparent !text-white !border-[#2A3942]"
                      size="sm"
                    >
                      Correggi
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  onClick={() => { void handleManualSubmit(); }}
                  className="w-full !bg-[#25D366] hover:!bg-[#1DA851] !text-white !border-transparent"
                  size="sm"
                >
                  Continua
                </Button>
              )}
            </div>
          )}

          {showGroups && (
            <div data-testid="groups-section">
              {/* Aggiorna: area di tocco 44×44 che sborda nel padding dell'intestazione
                  (-my-3 dentro pt-3/pb-3) senza coprire la prima riga di gruppo. */}
              <div className="flex items-center justify-between min-h-[44px] px-4 pt-3 pb-3">
                <span className="text-xs font-semibold uppercase" style={{ color: '#25D366' }}>
                  Gruppi
                </span>
                {canRefreshGroups && (
                  <button
                    type="button"
                    onClick={refreshGroups}
                    className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -my-3 -mr-3 px-3 rounded-full text-xs font-medium hover:bg-white/5"
                    style={{ color: '#25D366' }}
                  >
                    Aggiorna
                  </button>
                )}
              </div>
              {filteredGroups.map((g) => (
                <GroupRow key={`g:${g.jid}`} group={g} onPick={handlePick} />
              ))}
              {groupsStatus && (
                <div className="px-4 py-2 text-xs flex items-center gap-2" style={{ color: '#AEBAC1' }} role="status">
                  {(groupsState.kind === 'waiting' || groupsState.kind === 'loading') && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: '#25D366' }} />
                  )}
                  <span>{groupsStatus}</span>
                </div>
              )}
            </div>
          )}

          {view.kind === 'list' && !searching && recents.length > 0 && (
            <>
              <div
                className="px-4 pt-3 pb-1 text-xs font-semibold uppercase"
                style={{ color: '#25D366' }}
              >
                Recenti
              </div>
              {recents.map((c) => (
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

          {view.kind === 'list' && searching && filtered.length === 0 && filteredGroups.length === 0
            && (view.contacts.length > 0 || allGroups.length > 0) && (
            <div className="p-8 text-center text-sm space-y-3" style={{ color: '#AEBAC1' }}>
              <p>Nessun risultato per &quot;{search}&quot;.</p>
              <p className="text-xs">
                Alcuni contatti WhatsApp non mostrano il numero: compaiono appena ti scrivono,
                oppure aggiungili col numero.
              </p>
              <Button
                type="button"
                onClick={openManualFromSearch}
                className="!bg-[#25D366] hover:!bg-[#1DA851] !text-white !border-transparent"
                size="sm"
              >
                Scrivi il numero
              </Button>
            </div>
          )}

          {view.kind === 'list' && view.contacts.length === 0 && allGroups.length === 0 && (
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
