/**
 * cleanup-media, giro "errori reali" (audit 25 set 2026):
 *  1. un messaggio 'failed' creato >30 gg fa ma fallito IERI non perde
 *     l'allegato (un "Riprova" partirebbe senza il PDF);
 *  2. gli upload abbandonati (modale chiusa, file sostituito, POST rifiutato)
 *     non restano nel bucket per sempre: 6 file su 11 in prod erano orfani.
 */
import { createMockSupabase } from './helpers/mocks';

const mockSupa = createMockSupabase();

// La query "copie recenti che usano lo stesso file" (.or created_at/updated_at
// >= cutoff, audit 28 set 2026) risponde vuota: nei test le candidate sono
// tutte vecchie. Il caso della copia recente ha un test suo.
const baseSetResponse = mockSupa.setResponse;
(mockSupa as any).setResponse = (key: string, data: any, error: any = null, extra: Record<string, any> = {}) => {
  if (key !== 'scheduled_messages:select') return baseSetResponse(key, data, error, extra);
  mockSupa.setHandler(key, (call: any) =>
    call.chain.some((m: any) => m.method === 'or' && String(m.args[0]).includes('created_at.gte'))
      ? { data: [], error: null }
      : { data, error, ...extra });
};
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
    listing[''] = [{ name: '393330000001', id: null }];
    listing['393330000001'] = [
      { name: 'a-circolare.pdf', id: '1', created_at: old },      // usato da una riga
      { name: 'b-circolare.pdf', id: '2', created_at: old },      // orfano (POST rifiutato)
      { name: 'c-circolare.pdf', id: '3', created_at: old },      // orfano (file sostituito)
      { name: 'd-foto.jpg', id: '4', created_at: fresh },         // modale forse ancora aperta
    ];
    mockSupa.setResponse('scheduled_messages:select', [{ media_url: '393330000001/a-circolare.pdf' }]);

    const out = await sweepOrphanUploads();

    const sel = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'select')!;
    const inCall = sel.chain.find((c) => c.method === 'in' && c.args[0] === 'media_url')!;
    expect(inCall.args[1]).toEqual(['393330000001/a-circolare.pdf', '393330000001/b-circolare.pdf', '393330000001/c-circolare.pdf']);
    const rm = storageCalls.filter((c) => c.method === 'remove');
    expect(rm).toHaveLength(1);
    expect(rm[0].args[0]).toEqual(['393330000001/b-circolare.pdf', '393330000001/c-circolare.pdf']);
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

// Audit 28 set 2026, gruppo cron2.
describe('pulizia: il tipo di allegato resta come segnale', () => {
  test('azzera SOLO media_url e media_caption: media_type e media_filename restano (guard media_expired + banner)', async () => {
    mockSupa.setResponse('scheduled_messages:select', [{ id: 'm1', media_url: 'u/circolare.pdf' }]);
    mockSupa.setRpcResponse('recurring_media_in_use', []);
    await runMediaCleanup();
    const upd = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'update')!;
    expect(upd.args[0]).toEqual({ media_url: null, media_caption: null });
  });
});

// PostgREST ospitato restituisce al massimo 1000 righe per risposta, in
// silenzio. Il mock fa lo stesso: se la lista IN contiene il file "popolare"
// risponde con 1000 righe tutte sue, e il riferimento al secondo file resta
// oltre il taglio.
const PAGE_CAP = 1000;
function truncatingRefs(popular: string, other: string) {
  return (call: any) => {
    const inList: string[] = call.chain.find((m: any) => m.method === 'in' && m.args[0] === 'media_url')?.args[1] || [];
    if (inList.includes(popular)) return { data: Array.from({ length: PAGE_CAP }, () => ({ media_url: popular })), error: null };
    if (inList.includes(other)) return { data: [{ media_url: other }], error: null };
    return { data: [], error: null };
  };
}

describe('riferimenti oltre il tetto delle 1000 righe', () => {
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  test('BUG: orfani — un file usato da una riga oltre la 1000ª NON viene cancellato', async () => {
    listing[''] = [{ name: '39333', id: null }];
    listing['39333'] = [
      { name: 'ricorrente.pdf', id: '1', created_at: old },   // catena quotidiana: migliaia di righe
      { name: 'duplicato.pdf', id: '2', created_at: old },    // usato da UNA riga, oltre il taglio
      { name: 'orfano.pdf', id: '3', created_at: old },       // davvero orfano
    ];
    mockSupa.setHandler('scheduled_messages:select', truncatingRefs('39333/ricorrente.pdf', '39333/duplicato.pdf'));
    const out = await sweepOrphanUploads();
    const rm = storageCalls.filter((c) => c.method === 'remove');
    expect(rm).toHaveLength(1);
    expect(rm[0].args[0]).toEqual(['39333/orfano.pdf']);
    expect(out.removed).toBe(1);
  });

  test('BUG: retention — una copia recente (Duplica) oltre la 1000ª riga protegge ancora il suo file', async () => {
    mockSupa.setHandler('scheduled_messages:select', (call: any) => {
      const isRecent = call.chain.some((m: any) => m.method === 'or' && String(m.args[0]).includes('created_at.gte'));
      if (!isRecent) return { data: [{ id: 'a', media_url: 'u/popolare.pdf' }, { id: 'b', media_url: 'u/duplicato.pdf' }], error: null };
      return truncatingRefs('u/popolare.pdf', 'u/duplicato.pdf')(call);
    });
    mockSupa.setRpcResponse('recurring_media_in_use', []);
    const res = await runMediaCleanup();
    expect(storageCalls.filter((c) => c.method === 'remove')).toHaveLength(0);
    expect(res.removed_storage).toBe(0);
    expect(res.skipped_in_use).toBe(2);
  });

  test('risposte sempre piene oltre il tetto dei giri → nessuna cancellazione (fail-safe)', async () => {
    listing[''] = [{ name: '39333', id: null }];
    listing['39333'] = Array.from({ length: 40 }, (_, i) => ({ name: 'f' + i + '.pdf', id: String(i), created_at: old }));
    // Ogni risposta è piena e nomina un solo file: non si arriva mai a "visto tutto".
    mockSupa.setHandler('scheduled_messages:select', (call: any) => {
      const inList: string[] = call.chain.find((m: any) => m.method === 'in')?.args[1] || [];
      return { data: Array.from({ length: PAGE_CAP }, () => ({ media_url: inList[0] })), error: null };
    });
    await expect(sweepOrphanUploads()).rejects.toThrow(/troncat/i);
    expect(storageCalls.filter((c) => c.method === 'remove')).toHaveLength(0);
  });
});
