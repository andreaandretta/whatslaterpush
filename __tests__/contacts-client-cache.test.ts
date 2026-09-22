/**
 * @jest-environment jsdom
 */
import { prefetchContacts, getContactsSnapshot, setContactsSnapshot, clearContactsSnapshots, setContactsCacheOwner } from '../app/lib/contacts-client-cache';

function okResponse(body: any, headers: Record<string, string> = { 'x-contacts-source': 'cache-only' }) {
  return { ok: true, status: 200, json: () => Promise.resolve(body), headers: new Headers(headers) };
}

afterEach(() => { clearContactsSnapshots(); jest.restoreAllMocks(); });

describe('contacts-client-cache', () => {
  test('snapshot separati per etichetta; clear li azzera tutti', () => {
    setContactsSnapshot(null, [{ number: '1', name: 'A' }], []);
    setContactsSnapshot('lab-1', [{ number: '2', name: 'B' }], []);
    expect(getContactsSnapshot(null)!.contacts[0].name).toBe('A');
    expect(getContactsSnapshot('lab-1')!.contacts[0].name).toBe('B');
    expect(getContactsSnapshot('lab-2')).toBeNull();
    clearContactsSnapshots();
    expect(getContactsSnapshot(null)).toBeNull();
  });

  test('prefetch: chiama /api/contacts?prefetch=1 una volta sola e salva lo snapshot', async () => {
    const f = jest.fn().mockResolvedValue(okResponse({ contacts: [{ number: '393331111111', name: 'Mario' }], recents: [] }));
    (global as any).fetch = f;
    await Promise.all([prefetchContacts(), prefetchContacts()]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('/api/contacts?prefetch=1');
    expect(getContactsSnapshot(null)!.contacts.length).toBe(1);
    await prefetchContacts(); // snapshot già presente → nessuna nuova chiamata
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('prefetch: lista vuota o errore NON creano snapshot', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse({ contacts: [], recents: [] }));
    await prefetchContacts();
    expect(getContactsSnapshot(null)).toBeNull();
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('network'));
    await prefetchContacts();
    expect(getContactsSnapshot(null)).toBeNull();
  });

  // Revisione 21 set: una cache sottile (numero appena collegato) o una lettura
  // parziale non devono diventare "la rubrica" mostrata all'istante dal picker.
  test('prefetch: NON salva una lista che il server non considera completa', async () => {
    const body = { contacts: [{ number: '393331111111', name: 'Mario' }], recents: [] };
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse(body, { 'x-contacts-source': 'cache-only-prefetch' }));
    await prefetchContacts();
    expect(getContactsSnapshot(null)).toBeNull();
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse(body, { 'x-contacts-source': 'cache-only', 'x-contacts-partial': '1' }));
    await prefetchContacts();
    expect(getContactsSnapshot(null)).toBeNull();
    (global as any).fetch = jest.fn().mockResolvedValue(okResponse(body, {}));
    await prefetchContacts();
    expect(getContactsSnapshot(null)).toBeNull();
  });

  test('la cache appartiene a un numero: cambiando numero si svuota, con lo stesso no', () => {
    setContactsCacheOwner('393330000001');
    setContactsSnapshot(null, [{ number: '1', name: 'Cliente di A' }], []);
    setContactsCacheOwner('393330000001');
    expect(getContactsSnapshot(null)).not.toBeNull();
    setContactsCacheOwner('393330000002');
    expect(getContactsSnapshot(null)).toBeNull();
    setContactsCacheOwner(null);
  });
});
