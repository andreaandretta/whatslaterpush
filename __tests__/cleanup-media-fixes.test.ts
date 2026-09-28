/**
 * cleanup-media, giro "errori reali" (audit 25 set 2026):
 *  1. un messaggio 'failed' creato >30 gg fa ma fallito IERI non perde
 *     l'allegato (un "Riprova" partirebbe senza il PDF);
 *  2. gli upload abbandonati (modale chiusa, file sostituito, POST rifiutato)
 *     non restano nel bucket per sempre: 6 file su 11 in prod erano orfani.
 */
import { createMockSupabase } from './helpers/mocks';

const mockSupa = createMockSupabase();
const storageCalls: Array<{ method: string; args: any[] }> = [];
let listing: Record<string, any[]> = {};

const client: any = {
  ...mockSupa.client,
  storage: {
    from: (_bucket: string) => ({
      list: (prefix: string, opts?: any) => {
        storageCalls.push({ method: 'list', args: [prefix, opts] });
        return Promise.resolve({ data: listing[prefix || ''] || [], error: null });
      },
      remove: (paths: string[]) => {
        storageCalls.push({ method: 'remove', args: [paths] });
        return Promise.resolve({ data: paths.map((name) => ({ name })), error: null });
      },
    }),
  },
};
jest.mock('@supabase/supabase-js', () => ({ createClient: () => client }));

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  mockSupa.calls.length = 0;
  storageCalls.length = 0;
  listing = {};
  process.env = { ...ORIGINAL_ENV, SUPABASE_URL: 'https://t.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', CRON_SECRET: 'c' };
});
afterAll(() => { process.env = ORIGINAL_ENV; });

import { runMediaCleanup, sweepOrphanUploads, ORPHAN_MIN_AGE_HOURS } from '../app/api/cron/cleanup-media/route';

describe('retention dei failed: conta l\'ultimo aggiornamento, non la creazione', () => {
  test('la selezione filtra anche updated_at < now-30gg (un failed di ieri resta)', async () => {
    mockSupa.setResponse('scheduled_messages:select', []);
    await runMediaCleanup();
    const sel = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'select')!;
    const upd = sel.chain.find((c) => c.method === 'lt' && c.args[0] === 'updated_at');
    expect(upd).toBeDefined();
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(new Date(upd!.args[1]).getTime() - expected)).toBeLessThan(5000);
  });
});

describe('sweepOrphanUploads — file senza nessuna riga che li usi', () => {
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  test('rimuove SOLO gli orfani più vecchi della soglia; tiene i referenziati e quelli appena caricati', async () => {
    listing[''] = [{ name: '393442582226', id: null }];
    listing['393442582226'] = [
      { name: 'a-circolare.pdf', id: '1', created_at: old },      // usato da una riga
      { name: 'b-circolare.pdf', id: '2', created_at: old },      // orfano (POST rifiutato)
      { name: 'c-circolare.pdf', id: '3', created_at: old },      // orfano (file sostituito)
      { name: 'd-foto.jpg', id: '4', created_at: fresh },         // modale forse ancora aperta
    ];
    mockSupa.setResponse('scheduled_messages:select', [{ media_url: '393442582226/a-circolare.pdf' }]);

    const out = await sweepOrphanUploads();

    const sel = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'select')!;
    const inCall = sel.chain.find((c) => c.method === 'in' && c.args[0] === 'media_url')!;
    expect(inCall.args[1]).toEqual(['393442582226/a-circolare.pdf', '393442582226/b-circolare.pdf', '393442582226/c-circolare.pdf']);
    const rm = storageCalls.filter((c) => c.method === 'remove');
    expect(rm).toHaveLength(1);
    expect(rm[0].args[0]).toEqual(['393442582226/b-circolare.pdf', '393442582226/c-circolare.pdf']);
    expect(out).toEqual({ scanned: 4, orphans: 2, removed: 2 });
    expect(ORPHAN_MIN_AGE_HOURS).toBeGreaterThanOrEqual(24);
  });

  test('errore sulla query dei riferimenti → non cancella NIENTE (fail-safe)', async () => {
    listing[''] = [{ name: '39333', id: null }];
    listing['39333'] = [{ name: 'x.pdf', id: '1', created_at: old }];
    mockSupa.setResponse('scheduled_messages:select', null, { message: 'Gateway Timeout' });
    await expect(sweepOrphanUploads()).rejects.toThrow(/Gateway Timeout/);
    expect(storageCalls.filter((c) => c.method === 'remove')).toHaveLength(0);
  });

  test('bucket vuoto → nessuna chiamata di rimozione', async () => {
    const out = await sweepOrphanUploads();
    expect(out).toEqual({ scanned: 0, orphans: 0, removed: 0 });
    expect(storageCalls.filter((c) => c.method === 'remove')).toHaveLength(0);
  });
});
