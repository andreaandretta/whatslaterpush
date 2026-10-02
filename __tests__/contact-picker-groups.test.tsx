/**
 * @jest-environment jsdom
 *
 * ContactPickerModal — sezione "Gruppi" (D4, D18, D19). /api/groups parte solo
 * dopo la risposta di /api/contacts, mai le cifre del JID a schermo, e con i
 * gruppi spenti la sezione non compare nemmeno per un attimo.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ContactPickerModal, { throttledText } from '../components/ContactPickerModal';
import { clearContactsSnapshots, setGroupsSnapshot } from '../app/lib/contacts-client-cache';

const G1 = { jid: '120363000000000001@g.us', name: 'Under 12 – Genitori', size: 19, can_send: true };
const G2 = { jid: '120363000000000002@g.us', name: 'Staff', size: 1, can_send: true };
const LOCKED = { jid: '120363000000000003@g.us', name: 'Avvisi società', size: 40, can_send: false, locked_reason: 'solo_admin' };
const H1 = { jid: '120363000000000004@g.us', name: 'Genitori', size: 20, can_send: true, hint: 'creato a set 2024' };
const H2 = { jid: '120363000000000005@g.us', name: 'Genitori', size: 22, can_send: true, hint: 'nella community «Polisportiva»' };
const MARIO = { number: '393331234567', name: 'Mario' };

type Reply = { status?: number; body?: unknown } | Promise<any> | 'reject';

function resp(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body), headers: new Headers() };
}

// fetch diverso per URL: rubrica, gruppi, etichette.
function mockFetch(routes: { contacts?: Reply; groups?: Reply; labels?: Reply }) {
  const pick = (r: Reply | undefined, fallback: unknown) => {
    if (r === 'reject') return Promise.reject(new Error('network'));
    if (r instanceof Promise) return r;
    return Promise.resolve(resp(r ? r.body : fallback, r?.status ?? 200));
  };
  const fn = jest.fn((url: string) => {
    const u = String(url);
    if (u.startsWith('/api/contacts')) return pick(routes.contacts, { contacts: [MARIO], recents: [] });
    if (u.startsWith('/api/groups')) return pick(routes.groups, { enabled: true, connected: true, groups: [] });
    if (u.startsWith('/api/labels')) return pick(routes.labels, { labels: [] });
    return Promise.resolve(resp({}));
  });
  (global as any).fetch = fn;
  return fn;
}

const groupCalls = (fn: jest.Mock) => fn.mock.calls.filter((c) => String(c[0]).startsWith('/api/groups'));
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

function deferred() {
  let resolve: (v: any) => void = () => {};
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Snapshot "vecchio" (più di 10 minuti): indica che i gruppi sono accesi ma non vale come fresco.
function staleSnapshot(groups: any[]) {
  const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() - 11 * 60_000);
  setGroupsSnapshot(groups);
  spy.mockRestore();
}

afterEach(() => {
  jest.restoreAllMocks();
  clearContactsSnapshots();
});

describe('sezione Gruppi', () => {
  test('compare sopra "Contatti su WhatsApp" con "Gruppo · 19 persone" e "1 persona"', async () => {
    mockFetch({ groups: { body: { enabled: true, connected: true, groups: [G1, G2] } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    expect(screen.getByText('Gruppo · 19 persone')).toBeInTheDocument();
    expect(screen.getByText('Gruppo · 1 persona')).toBeInTheDocument();
    const gruppi = screen.getByText('Gruppi');
    const contatti = screen.getByText(/Contatti su WhatsApp/);
    expect(gruppi.compareDocumentPosition(contatti) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('/api/groups parte solo DOPO la risposta di /api/contacts', async () => {
    const contacts = deferred();
    const fn = mockFetch({ contacts: contacts.promise, groups: { body: { enabled: true, connected: true, groups: [G1] } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await flush();
    expect(groupCalls(fn)).toHaveLength(0);
    await act(async () => { contacts.resolve(resp({ contacts: [MARIO], recents: [] })); });
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    expect(groupCalls(fn)).toHaveLength(1);
    expect(groupCalls(fn)[0][0]).toBe('/api/groups');
  });

  test('se /api/contacts porta già i gruppi, /api/groups non si chiama', async () => {
    const fn = mockFetch({ contacts: { body: { contacts: [MARIO], recents: [], groups: [G1], groups_status: 'live' } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    await flush();
    expect(groupCalls(fn)).toHaveLength(0);
  });

  test('groups_status "timeout": niente chiamata automatica, "Hai tanti gruppi…", Aggiorna rilegge con refresh=1', async () => {
    const fn = mockFetch({
      contacts: { body: { contacts: [MARIO], recents: [], groups_status: 'timeout' } },
      groups: { body: { enabled: true, connected: true, groups: [G1] } },
    });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Hai tanti gruppi: la lista non è ancora pronta/)).toBeInTheDocument());
    await flush();
    expect(groupCalls(fn)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    expect(groupCalls(fn).map((c) => c[0])).toEqual(['/api/groups?refresh=1']);
  });

  test('riaperto entro 10 minuti: nessuna nuova lettura dei gruppi', async () => {
    const fn = mockFetch({ groups: { body: { enabled: true, connected: true, groups: [G1] } } });
    const { rerender } = render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    rerender(<ContactPickerModal open={false} onClose={() => {}} onSelect={() => {}} />);
    rerender(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument();
    await flush();
    expect(groupCalls(fn)).toHaveLength(1);
  });

  test('la ricerca filtra i gruppi per nome; le cifre del JID non trovano niente', async () => {
    mockFetch({ groups: { body: { enabled: true, connected: true, groups: [G1, G2] } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Staff')).toBeInTheDocument());
    const input = screen.getByPlaceholderText('Cerca contatto o gruppo…');
    fireEvent.change(input, { target: { value: 'genitori' } });
    expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument();
    expect(screen.queryByText('Staff')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '120363' } });
    expect(screen.queryByText('Under 12 – Genitori')).not.toBeInTheDocument();
    expect(screen.queryByText('Staff')).not.toBeInTheDocument();
    expect(screen.queryByText('Gruppi')).not.toBeInTheDocument();
  });

  test('tap su un gruppo → onSelect con jid, nome, kind, size e hint', async () => {
    const onSelect = jest.fn();
    mockFetch({ groups: { body: { enabled: true, connected: true, groups: [G1, H1, H2] } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Under 12 – Genitori'));
    expect(onSelect).toHaveBeenCalledWith({ number: G1.jid, name: G1.name, kind: 'group', size: 19, hint: null });
    fireEvent.click(screen.getByText('Gruppo · 22 persone · nella community «Polisportiva»'));
    expect(onSelect).toHaveBeenLastCalledWith({ number: H2.jid, name: 'Genitori', kind: 'group', size: 22, hint: 'nella community «Polisportiva»' });
  });

  test('omonimi: il distintivo si vede nel sottotitolo', async () => {
    mockFetch({ groups: { body: { enabled: true, connected: true, groups: [H1, H2] } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Gruppo · 20 persone · creato a set 2024')).toBeInTheDocument());
    expect(screen.getByText('Gruppo · 22 persone · nella community «Polisportiva»')).toBeInTheDocument();
  });

  test('gruppo solo-admin: disattivato, spiegato e non selezionabile', async () => {
    const onSelect = jest.fn();
    mockFetch({ groups: { body: { enabled: true, connected: true, groups: [G1, LOCKED] } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('Avvisi società')).toBeInTheDocument());
    expect(screen.getByText('Gruppo · 40 persone · scrivono solo gli amministratori')).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Avvisi società/ });
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('nel DOM mai "@g.us" né le cifre del JID, anche se un JID arriva tra i Recenti', async () => {
    mockFetch({
      contacts: { body: { contacts: [MARIO], recents: [{ number: G2.jid, name: 'Staff vecchio' }] } },
      groups: { body: { enabled: true, connected: true, groups: [G1, LOCKED] } },
    });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain('@g.us');
    expect(document.body.innerHTML).not.toContain('120363');
    expect(screen.queryByText('Staff vecchio')).not.toBeInTheDocument();
  });
});

describe('sezione Gruppi nascosta', () => {
  test('gruppi spenti (enabled:false): la sezione non compare mai, nemmeno durante la lettura', async () => {
    const groups = deferred();
    mockFetch({ groups: groups.promise });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());
    await flush();
    expect(screen.queryByText('Gruppi')).not.toBeInTheDocument();
    expect(screen.queryByText(/Carico i gruppi/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Cerca contatto…')).toBeInTheDocument();
    await act(async () => { groups.resolve(resp({ enabled: false, connected: false, groups: [] })); });
    await flush();
    expect(screen.queryByText('Gruppi')).not.toBeInTheDocument();
    // La ricerca non promette gruppi che non ci sono.
    expect(screen.getByPlaceholderText('Cerca contatto…')).toBeInTheDocument();
  });

  test('0 gruppi: sezione nascosta', async () => {
    mockFetch({ groups: { body: { enabled: true, connected: true, groups: [] } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());
    await flush();
    expect(screen.queryByText('Gruppi')).not.toBeInTheDocument();
  });

  test('con un filtro etichetta la sezione sparisce', async () => {
    mockFetch({
      groups: { body: { enabled: true, connected: true, groups: [G1] } },
      labels: { body: { labels: [{ id: 'l1', name: 'Squadra', color: '#FF0000' }] } },
    });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Squadra/ }));
    await flush();
    expect(screen.queryByText('Gruppi')).not.toBeInTheDocument();
    expect(screen.queryByText('Under 12 – Genitori')).not.toBeInTheDocument();
  });

  // fetch con etichette: /api/contacts?label=… risponde `labelled`.
  function mockFetchWithLabel(labelled: unknown[]) {
    const fn = jest.fn((url: string) => {
      const u = String(url);
      if (u.startsWith('/api/contacts?label=')) return Promise.resolve(resp({ contacts: labelled, recents: [] }));
      if (u.startsWith('/api/contacts')) return Promise.resolve(resp({ contacts: [MARIO], recents: [] }));
      if (u.startsWith('/api/groups')) return Promise.resolve(resp({ enabled: true, connected: true, groups: [G1] }));
      if (u.startsWith('/api/labels')) return Promise.resolve(resp({ labels: [{ id: 'l1', name: 'Squadra', color: '#FF0000' }] }));
      return Promise.resolve(resp({}));
    });
    (global as any).fetch = fn;
    return fn;
  }

  test('etichetta senza contatti: "Nessun contatto in rubrica." anche con gruppi letti, ricerca "Cerca contatto…"', async () => {
    mockFetchWithLabel([]);
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Squadra/ }));
    await waitFor(() => expect(screen.getByText('Nessun contatto in rubrica.')).toBeInTheDocument());
    expect(screen.queryByText('Under 12 – Genitori')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Cerca contatto…')).toBeInTheDocument();
  });

  test('ricerca dentro un\'etichetta che trova solo un gruppo → "Nessun risultato" e "Scrivi il numero"', async () => {
    mockFetchWithLabel([MARIO]);
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Squadra/ }));
    await flush();
    fireEvent.change(screen.getByPlaceholderText('Cerca contatto…'), { target: { value: 'genitori' } });
    expect(screen.getByText(/Nessun risultato per/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scrivi il numero' })).toBeInTheDocument();
    expect(screen.queryByText('Under 12 – Genitori')).not.toBeInTheDocument();
  });

  test('401 su /api/groups: sezione nascosta, la rubrica resta', async () => {
    mockFetch({ groups: { status: 401, body: { error: 'Unauthorized' } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());
    await flush();
    expect(screen.queryByText('Gruppi')).not.toBeInTheDocument();
  });

  test('rete giù su /api/groups senza indizi di gruppi accesi: nessun errore dei gruppi a schermo', async () => {
    mockFetch({ groups: 'reject' });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Mario')).toBeInTheDocument());
    await flush();
    expect(screen.queryByText('Gruppi')).not.toBeInTheDocument();
    expect(screen.queryByText(/Non riesco a leggere i gruppi/)).not.toBeInTheDocument();
  });
});

describe('stati della sezione Gruppi', () => {
  test('errore dei gruppi → "Tocca Aggiorna", la rubrica resta visibile e "Nuovo contatto" chiuso', async () => {
    mockFetch({ groups: { status: 502, body: { error: 'groups_unavailable', message: 'Non riesco a leggere i gruppi adesso: riprova tra poco.' } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Non riesco a leggere i gruppi. Tocca Aggiorna per riprovare.')).toBeInTheDocument());
    expect(screen.getByText('Mario')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiorna' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nome (opzionale)')).not.toBeInTheDocument();
  });

  test('tutte le fetch rifiutate: un solo bottone "Riprova" (quello della rubrica)', async () => {
    staleSnapshot([G1]); // gruppi accesi: l'errore dei gruppi si vede
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('network'));
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Sto sincronizzando/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Non riesco a leggere i gruppi/)).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /Riprova/i })).toHaveLength(1);
  });

  test('"Carico i gruppi…" solo quando i gruppi sono accesi (groups_status dalla rubrica)', async () => {
    const groups = deferred();
    mockFetch({ contacts: { body: { contacts: [MARIO], recents: [], groups_status: 'skipped' } }, groups: groups.promise });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Carico i gruppi…')).toBeInTheDocument());
    await act(async () => { groups.resolve(resp({ enabled: true, connected: true, groups: [G1] })); });
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    expect(screen.queryByText('Carico i gruppi…')).not.toBeInTheDocument();
  });

  test('WhatsApp scollegato → "Ricollega WhatsApp per vedere i tuoi gruppi."', async () => {
    mockFetch({ groups: { body: { enabled: true, connected: false, groups: [] } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Ricollega WhatsApp per vedere i tuoi gruppi.')).toBeInTheDocument());
  });

  // Rapporto 360, T31: all'apertura "throttled" senza lista non è più subito un
  // vicolo cieco. "Carico i gruppi…", un solo nuovo tentativo dopo 4 s, poi i minuti.
  test('throttled senza cache all\'apertura → "Carico i gruppi…", un nuovo tentativo, poi "riprova tra 12 minuti"', async () => {
    jest.useFakeTimers();
    try {
      const fn = mockFetch({ groups: { body: { enabled: true, connected: true, groups: [], throttled: true, retry_in_s: 690 } } });
      render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
      await waitFor(() => expect(screen.getByText('Carico i gruppi…')).toBeInTheDocument());
      expect(screen.queryByText(/Gruppi: riprova/)).not.toBeInTheDocument();
      expect(groupCalls(fn)).toHaveLength(1);
      await act(async () => { jest.advanceTimersByTime(4_000); });
      await waitFor(() => expect(screen.getByText('Gruppi: riprova tra 12 minuti.')).toBeInTheDocument());
      // Un solo tentativo automatico, mai con refresh (non spende il gettone).
      expect(groupCalls(fn).map((c) => c[0])).toEqual(['/api/groups', '/api/groups']);
      await act(async () => { jest.advanceTimersByTime(60_000); });
      expect(groupCalls(fn)).toHaveLength(2);
      expect(screen.getByRole('button', { name: 'Aggiorna' })).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('throttled all\'apertura, il nuovo tentativo trova la lista → si mostra, nessun messaggio', async () => {
    jest.useFakeTimers();
    try {
      const fn = mockFetchGroupsQueue([
        { body: { enabled: true, connected: true, groups: [], throttled: true, retry_in_s: 600 } },
        { body: { enabled: true, connected: true, groups: [G1], source: 'cache' } },
      ]);
      render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
      await waitFor(() => expect(screen.getByText('Carico i gruppi…')).toBeInTheDocument());
      await act(async () => { jest.advanceTimersByTime(4_000); });
      await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
      expect(screen.queryByText(/Gruppi: riprova/)).not.toBeInTheDocument();
      expect(groupCalls(fn)).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('throttled senza minuti dal server → "Gruppi: riprova tra qualche minuto." dopo il nuovo tentativo', async () => {
    jest.useFakeTimers();
    try {
      mockFetch({ groups: { body: { enabled: true, connected: true, groups: [], throttled: true } } });
      render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
      await waitFor(() => expect(screen.getByText('Carico i gruppi…')).toBeInTheDocument());
      await act(async () => { jest.advanceTimersByTime(4_000); });
      await waitFor(() => expect(screen.getByText('Gruppi: riprova tra qualche minuto.')).toBeInTheDocument());
    } finally {
      jest.useRealTimers();
    }
  });

  test('chiuso durante il nuovo tentativo: nessuna chiamata in più', async () => {
    jest.useFakeTimers();
    try {
      const fn = mockFetch({ groups: { body: { enabled: true, connected: true, groups: [], throttled: true, retry_in_s: 600 } } });
      const { rerender } = render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
      await waitFor(() => expect(screen.getByText('Carico i gruppi…')).toBeInTheDocument());
      rerender(<ContactPickerModal open={false} onClose={() => {}} onSelect={() => {}} />);
      await act(async () => { jest.advanceTimersByTime(10_000); });
      expect(groupCalls(fn)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('throttled con uno snapshot vecchio → si mostra lo snapshot', async () => {
    staleSnapshot([G2]);
    mockFetch({ groups: { body: { enabled: true, connected: true, groups: [], throttled: true } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Staff')).toBeInTheDocument());
    expect(screen.queryByText('Gruppi: riprova tra qualche minuto.')).not.toBeInTheDocument();
  });

  test('slow dal server → "Hai tanti gruppi…"', async () => {
    mockFetch({ groups: { body: { enabled: true, connected: true, groups: [], slow: true } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Hai tanti gruppi/)).toBeInTheDocument());
  });

  // fetch con risposte in fila per /api/groups (una per chiamata).
  function mockFetchGroupsQueue(queue: Array<Promise<any> | { status?: number; body: unknown }>) {
    const fn = jest.fn((url: string) => {
      const u = String(url);
      if (u.startsWith('/api/contacts')) return Promise.resolve(resp({ contacts: [MARIO], recents: [] }));
      if (u.startsWith('/api/groups')) {
        const next = queue.shift();
        if (next instanceof Promise) return next;
        return Promise.resolve(resp(next!.body, next!.status ?? 200));
      }
      if (u.startsWith('/api/labels')) return Promise.resolve(resp({ labels: [] }));
      return Promise.resolve(resp({}));
    });
    (global as any).fetch = fn;
    return fn;
  }

  test('Aggiorna: la lista resta a schermo durante la rilettura; "throttled" dice di riprovare anche con la lista', async () => {
    const second = deferred();
    mockFetchGroupsQueue([{ body: { enabled: true, connected: true, groups: [G1] } }, second.promise]);
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    await flush();
    expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument();
    expect(screen.getByText('Carico i gruppi…')).toBeInTheDocument();
    await act(async () => { second.resolve(resp({ enabled: true, connected: true, groups: [G1], throttled: true, source: 'cache' })); });
    await waitFor(() => expect(screen.getByText('Gruppi: riprova tra qualche minuto.')).toBeInTheDocument());
    expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument();
  });

  test('Aggiorna con "slow" dal server: la lista resta e compare "Hai tanti gruppi…"', async () => {
    mockFetchGroupsQueue([
      { body: { enabled: true, connected: true, groups: [G1] } },
      { body: { enabled: true, connected: true, groups: [G1], slow: true } },
    ]);
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    await waitFor(() => expect(screen.getByText(/Hai tanti gruppi/)).toBeInTheDocument());
    expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument();
  });

  test('Aggiorna in errore: la lista resta e compare "Tocca Aggiorna"', async () => {
    mockFetchGroupsQueue([
      { body: { enabled: true, connected: true, groups: [G1] } },
      { status: 502, body: { error: 'groups_unavailable' } },
    ]);
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    await waitFor(() => expect(screen.getByText('Non riesco a leggere i gruppi. Tocca Aggiorna per riprovare.')).toBeInTheDocument());
    expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument();
  });

  test('Aggiorna ha un\'area di tocco di almeno 44×44', async () => {
    mockFetch({ groups: { body: { enabled: true, connected: true, groups: [G1] } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    const btn = await screen.findByRole('button', { name: 'Aggiorna' });
    expect(btn.className).toMatch(/\bmin-h-\[44px\]/);
    expect(btn.className).toMatch(/\bmin-w-\[44px\]/);
  });

  test('Aggiorna rilegge con ?refresh=1 anche con lo snapshot fresco', async () => {
    const fn = mockFetch({ groups: { body: { enabled: true, connected: true, groups: [G1] } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna' }));
    await waitFor(() => expect(groupCalls(fn)).toHaveLength(2));
    expect(groupCalls(fn)[1][0]).toBe('/api/groups?refresh=1');
  });
});

// Rapporto 360, T31, causa: la lettura dei gruppi (fino a 25 s) veniva
// interrotta quando il selettore si chiudeva. Il server spendeva il gettone e la
// pagina perdeva la lista: alla riapertura "Gruppi: riprova tra qualche minuto.".
describe('lettura dei gruppi non interrotta dalla chiusura', () => {
  test('chiuso a metà lettura: la risposta finisce nello snapshot e la riapertura la mostra senza rileggere', async () => {
    const groups = deferred();
    const fn = mockFetch({ groups: groups.promise });
    const { rerender } = render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(groupCalls(fn)).toHaveLength(1));
    rerender(<ContactPickerModal open={false} onClose={() => {}} onSelect={() => {}} />);
    await act(async () => { groups.resolve(resp({ enabled: true, connected: true, groups: [G1] })); });
    await flush();
    rerender(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    expect(groupCalls(fn)).toHaveLength(1);
  });

  test('riaperto mentre la lettura è ancora in corso: si aggancia a quella, nessuna seconda chiamata', async () => {
    const groups = deferred();
    const fn = mockFetch({ groups: groups.promise });
    const { rerender } = render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(groupCalls(fn)).toHaveLength(1));
    rerender(<ContactPickerModal open={false} onClose={() => {}} onSelect={() => {}} />);
    rerender(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await flush();
    await act(async () => { groups.resolve(resp({ enabled: true, connected: true, groups: [G1] })); });
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    expect(groupCalls(fn)).toHaveLength(1);
    // La fetch non riceve più il segnale di chi apre il selettore: nessun abort alla chiusura.
    const signal = groupCalls(fn)[0][1]?.signal as AbortSignal | undefined;
    expect(signal?.aborted).not.toBe(true);
  });
});

describe('throttledText', () => {
  test('minuti dal server, 1 minuto, nessun dato', () => {
    expect(throttledText(690)).toBe('Gruppi: riprova tra 12 minuti.');
    expect(throttledText(30)).toBe('Gruppi: riprova tra 1 minuto.');
    expect(throttledText(null)).toBe('Gruppi: riprova tra qualche minuto.');
    expect(throttledText(0)).toBe('Gruppi: riprova tra qualche minuto.');
  });
});

describe('rubrica vuota + gruppi', () => {
  test('niente "Nessun contatto in rubrica." e, a ricerca vuota, niente "Nessun risultato"', async () => {
    mockFetch({
      contacts: { body: { contacts: [], recents: [] } },
      groups: { body: { enabled: true, connected: true, groups: [G1, G2] } },
    });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Staff')).toBeInTheDocument());
    expect(screen.queryByText('Nessun contatto in rubrica.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nessun risultato per/)).not.toBeInTheDocument();
  });

  test('gruppi portati dalla rubrica: "Nuovo contatto" non si apre da solo', async () => {
    mockFetch({ contacts: { body: { contacts: [], recents: [], groups: [G1, G2], groups_status: 'live' } } });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Staff')).toBeInTheDocument());
    expect(screen.queryByPlaceholderText('Nome (opzionale)')).not.toBeInTheDocument();
  });

  test('ricerca senza corrispondenze tra contatti e gruppi → "Nessun risultato"', async () => {
    mockFetch({
      contacts: { body: { contacts: [], recents: [] } },
      groups: { body: { enabled: true, connected: true, groups: [G1] } },
    });
    render(<ContactPickerModal open onClose={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText('Under 12 – Genitori')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Cerca contatto o gruppo…'), { target: { value: 'zzz' } });
    expect(screen.getByText(/Nessun risultato per/)).toBeInTheDocument();
  });
});
