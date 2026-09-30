/**
 * Parser self-chat e gruppi (D20): le ricerche per nome e l'elenco per l'LLM
 * escludono le righe @g.us; i messaggi al proprietario nominano un gruppo
 * senza mai le cifre del JID. Il mock applica davvero il filtro
 * .not('recipient_number','like','%@g.us'): senza, la riga di gruppo esce.
 * Numeri e JID finti.
 */
import { createMockSupabase, createFetchMock, mockRequest, makeMessagePayload } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const fetchMock = createFetchMock();
const ORIGINAL_ENV = process.env;

const OWNER = '393501234567';
const INSTANCE = 'SchedWhats-' + OWNER;
const GROUP = '120363000000000001@g.us';
const GROUP_ROW = { id: 'g-1', recipient_number: GROUP, recipient_name: 'Genitori di Luca' };

const excludesGroups = (call: any) => call.chain.some((m: any) => m.method === 'not' && m.args[0] === 'recipient_number' && m.args[1] === 'like' && m.args[2] === '%@g.us');

let pendingQueue: any[] = [];

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  pendingQueue = [];
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    GROQ_API_KEY: 'groq-test-key',
    SELF_CHAT_PARSER_ENABLED: 'true',
    WEBHOOK_SECRET: 'test-webhook-secret',
  };
  (global as any).fetch = fetchMock.mockFetch;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  mockSupa.setResponse('user_instances:select', {
    id: 'ui-1', phone_number: OWNER, instance_name: INSTANCE, subscription_plan: 'trial',
    trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
  });
  mockSupa.setResponse('processed_webhook_events:upsert', [{ message_key: 'm' }]);
  mockSupa.setResponse('pending_contacts:select', null);
  mockSupa.setHandler('scheduled_messages:select', (call: any) => {
    const cols = String(call.args[0]);
    // findContactByName (storico per nome) e getContactList (elenco per l'LLM)
    if (cols === 'recipient_number, recipient_name' || cols === 'recipient_name, recipient_number') {
      return { data: excludesGroups(call) ? null : (cols === 'recipient_name, recipient_number' ? [GROUP_ROW] : GROUP_ROW), error: null };
    }
    // "lista": la coda pending
    if (cols === 'id, recipient_name, recipient_number, parsed_message, scheduled_at') return { data: pendingQueue, error: null };
    return { data: null, error: null };
  });
  mockSupa.setResponse('scheduled_messages:insert', { id: 'sm-new' });
  fetchMock.setJsonResponse('/message/sendText/', { ok: true });
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
});

function aiReturns(result: any) {
  fetchMock.setHandler('groq.com', () => ({
    ok: true, status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify(result) } }] }),
    text: () => Promise.resolve('ok'),
    headers: new Headers(),
  }));
}

async function selfChat(text: string) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  (global as any).fetch = fetchMock.mockFetch;
  const { POST } = await import('../app/api/webhook/route');
  const body = makeMessagePayload({ instance: INSTANCE, fromMe: true, remoteJid: OWNER + '@s.whatsapp.net', text });
  const res = await POST(mockRequest(body, { 'x-webhook-secret': 'test-webhook-secret' }) as any);
  return res.json();
}

const ownerTexts = () => fetchMock.calls
  .filter((c) => c.url.includes('/message/sendText/'))
  .map((c) => JSON.parse(String(c.options.body)).text as string);

describe('parser self-chat e gruppi (D20)', () => {
  test('"manda a Luca" non si risolve mai nel gruppo "Genitori di Luca"', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    aiReturns({
      action: 'schedule', recipient_name: 'Luca',
      datetime_iso: tomorrow.toISOString().replace(/Z$/, ''), message_text: 'Ciao! Domani allenamento', reply: 'ok',
    });
    await selfChat('Invia a Luca domani alle 15: allenamento');

    const byName = mockSupa.calls.filter((c) => c.table === 'scheduled_messages' && c.operation === 'select' && c.args[0] === 'recipient_number, recipient_name');
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.every(excludesGroups)).toBe(true);
    const writes = mockSupa.calls.filter((c) => c.table === 'scheduled_messages' && (c.operation === 'insert' || c.operation === 'update'));
    expect(writes.some((c) => JSON.stringify(c.args[0] || {}).includes('@g.us'))).toBe(false);
  });

  test('l\'elenco dei contatti per l\'LLM non contiene i nomi dei gruppi', async () => {
    aiReturns({ action: 'chat', reply: 'ciao' });
    await selfChat('Invia a Luca domani alle 15: allenamento');
    const list = mockSupa.calls.filter((c) => c.table === 'scheduled_messages' && c.args[0] === 'recipient_name, recipient_number');
    expect(list.length).toBeGreaterThan(0);
    expect(list.every(excludesGroups)).toBe(true);
    const ai = fetchMock.calls.filter((c) => c.url.includes('groq.com'));
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.map((c) => String(c.options.body)).join('\n')).not.toContain('Genitori di Luca');
  });

  test('"lista": un gruppo senza nome è "Gruppo senza nome", mai il JID; le persone come prima', async () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    pendingQueue = [
      { id: 'a', recipient_name: null, recipient_number: GROUP, parsed_message: 'Domani allenamento', scheduled_at: at },
      { id: 'b', recipient_name: 'Under 12', recipient_number: '120363000000000002@g.us', parsed_message: 'Partita', scheduled_at: at },
      { id: 'c', recipient_name: null, recipient_number: '393331234567', parsed_message: 'Ciao', scheduled_at: at },
    ];
    aiReturns({ action: 'list', reply: 'ok' });
    await selfChat('lista');
    const text = ownerTexts().find((t) => t.startsWith('Messaggi programmati'))!;
    expect(text).toContain('1. Gruppo senza nome - ');
    expect(text).toContain('2. Under 12 - ');
    expect(text).toContain('3. 393331234567 - ');
    expect(text).not.toContain('@g.us');
    expect(text).not.toContain('120363');
  });
});
