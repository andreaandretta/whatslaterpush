// Cache in memoria (a livello di modulo) dell'ultima risposta di GET /api/contacts,
// una voce per filtro etichetta. Serve allo stale-while-revalidate del ContactPicker:
// alla riapertura si mostra SUBITO l'ultima lista e la si aggiorna dietro le quinte.
//
// Vive finché vive la pagina: logout e re-pair fanno `window.location.href`, quindi
// si azzera da sola. Niente localStorage/IndexedDB di proposito: nomi e numeri dei
// clienti dell'utente non devono finire su disco.
import { isGroupJid } from './jid';

export interface PickerContact {
  number: string;
  name: string;
  pushName?: string;
  photoUrl?: string;
}

// Gruppo WhatsApp come lo vede il picker. UNICA definizione del tipo: la
// riesporta app/lib/groups.ts (lato server). Mai partecipanti né JID grezzi
// oltre a `jid`, che la UI non mostra.
export interface PickerGroup {
  jid: string;
  name: string;
  size: number | null;
  can_send: boolean;
  locked_reason?: 'solo_admin';
  hint?: string | null;
}

export interface ContactsSnapshot {
  contacts: PickerContact[];
  recents: PickerContact[];
  fetchedAt: number;
}

const ALL_KEY = '__all__';
const snapshots = new Map<string, ContactsSnapshot>();
// Un solo snapshot dei gruppi, solo in memoria come la rubrica.
let groupsSnapshot: { groups: PickerGroup[]; fetchedAt: number } | null = null;
// Cresce a ogni azzeramento: una lettura dei gruppi partita prima non scrive più.
let epoch = 0;
// Lettura dei gruppi in volo (vedi fetchGroupsShared).
let groupsFetch: { epoch: number; p: Promise<GroupsReply> } | null = null;

function resetGroups(): void {
  groupsSnapshot = null;
  groupsFetch = null;
  epoch++;
}

// La cache appartiene a UN numero. Logout e re-pair ricaricano la pagina, ma due
// casi tengono vivo l'heap JS dopo un cambio di sessione: un'altra scheda che
// collega un altro numero (il cookie è condiviso) e il ripristino dal bfcache con
// "Indietro". In entrambi la rubrica del numero precedente non deve comparire.
let owner: string | null = null;

export function setContactsCacheOwner(phone: string | null): void {
  if (owner === phone) return;
  owner = phone;
  snapshots.clear();
  resetGroups();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) {
      snapshots.clear();
      resetGroups();
    }
  });
}

function keyFor(labelId: string | null): string {
  return labelId || ALL_KEY;
}

export function getContactsSnapshot(labelId: string | null): ContactsSnapshot | null {
  return snapshots.get(keyFor(labelId)) || null;
}

export function setContactsSnapshot(
  labelId: string | null,
  contacts: PickerContact[],
  recents: PickerContact[],
): ContactsSnapshot {
  const snap: ContactsSnapshot = { contacts, recents, fetchedAt: Date.now() };
  snapshots.set(keyFor(labelId), snap);
  return snap;
}

// Da chiamare quando la lista cambia di sicuro (import CSV, 401) e nei test
// (afterEach), per non far trapelare lo stato da un test all'altro.
export function clearContactsSnapshots(): void {
  snapshots.clear();
  resetGroups();
}

export function getGroupsSnapshot(): { groups: PickerGroup[]; fetchedAt: number } | null {
  return groupsSnapshot;
}

export function setGroupsSnapshot(groups: PickerGroup[]): void {
  groupsSnapshot = { groups, fetchedAt: Date.now() };
}

/** Solo gruppi con JID di gruppo e nome: il resto si scarta. */
export function validGroups(raw: unknown): PickerGroup[] {
  return Array.isArray(raw) ? raw.filter((g) => g && isGroupJid(g.jid) && typeof g.name === 'string') : [];
}

// ── Lettura dei gruppi (GET /api/groups) ──
// Una sola alla volta, e NON si interrompe quando il selettore si chiude: il
// server ha già speso il gettone (una lettura ogni 30 minuti) e il risultato
// finisce comunque nello snapshot. Prima la chiusura la buttava via e la
// riapertura trovava "Gruppi: riprova tra qualche minuto." (rapporto 360, T31).

/** null = rete giù o tempo scaduto. */
export type GroupsReply = { status: number; body: any } | null;

const GROUPS_TIMEOUT_MS = 30_000;

export function fetchGroupsShared(refresh: boolean): Promise<GroupsReply> {
  // Una lettura in volo vale anche per Aggiorna: il risultato arriva fresco.
  if (groupsFetch && groupsFetch.epoch === epoch) return groupsFetch.p;
  const mine = epoch;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), GROUPS_TIMEOUT_MS);
  const p: Promise<GroupsReply> = fetch('/api/groups' + (refresh ? '?refresh=1' : ''), { signal: abort.signal })
    .then(async (res) => {
      const body = res.status === 401 ? null : await res.json().catch(() => null);
      if (mine === epoch && res.ok && body && body.enabled !== false && body.connected !== false) {
        const groups = validGroups(body.groups);
        // "lento"/"throttled" senza lista: lo snapshot vecchio resta com'è.
        if (!(body.slow || body.throttled) || groups.length > 0) setGroupsSnapshot(groups);
      }
      return { status: res.status, body };
    })
    .catch(() => null)
    .finally(() => {
      clearTimeout(timer);
      if (groupsFetch?.p === p) groupsFetch = null;
    });
  groupsFetch = { epoch: mine, p };
  return p;
}

// Riscaldamento: il dashboard lo chiama a pagina ferma, così alla PRIMA apertura del
// picker la lista è già in memoria. `?prefetch=1` → il server non tocca mai Evolution.
// Una lista vuota non si salva: all'apertura deve restare lo spinner/syncing vero,
// non un "Nessun contatto in rubrica" prematuro.
let inflight: Promise<void> | null = null;

export function prefetchContacts(): Promise<void> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return Promise.resolve();
  if (snapshots.has(ALL_KEY)) return Promise.resolve();
  if (inflight) return inflight;
  inflight = fetch('/api/contacts?prefetch=1')
    .then(async (res) => {
      if (!res.ok) return;
      const body = await res.json();
      const contacts: PickerContact[] = Array.isArray(body.contacts) ? body.contacts : [];
      const recents: PickerContact[] = Array.isArray(body.recents) ? body.recents : [];
      // Si salva SOLO una rubrica che il server considera completa: 'cache-only'.
      // 'cache-only-prefetch' = cache sottile (numero appena collegato, sync in corso):
      // mostrarla come rubrica intera darebbe "Nessun risultato" per contatti veri.
      const source = res.headers?.get?.('x-contacts-source');
      const partial = res.headers?.get?.('x-contacts-partial') === '1';
      if (source !== 'cache-only' || partial) return;
      // Non sovrascrivere una lista più fresca arrivata nel frattempo dal picker.
      if (contacts.length > 0 && !snapshots.has(ALL_KEY)) setContactsSnapshot(null, contacts, recents);
    })
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}
