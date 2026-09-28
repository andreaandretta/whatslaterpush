/**
 * Parser della chat con se stessi: spento di default, e quando acceso vede
 * solo comandi (audit fase 1b — ogni nota personale andava a Groq e nei log).
 */
import { createMockSupabase, mockRequest, makeMessagePayload } from './helpers/mocks';
import { isSelfChatCommand, isSelfChatShortReply, selfChatParserEnabled } from '../app/lib/webhook-utils';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const OWNER = '393331234567';
const INSTANCE = 'SchedWhats-' + OWNER;
const NOTE = 'Comprare latte, visita cardiologo giovedì, codice cancello 4471';
const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;
let fetchUrls: string[] = [];
let logSpy: jest.SpyInstance;

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchUrls = [];
  mockSupa.setResponse('user_instances:select', { id: 'u1', phone_number: OWNER, instance_name: INSTANCE, subscription_plan: 'trial', trial_ends_at: null });
  mockSupa.setResponse('scheduled_messages:select', []);
  // claim di dedup riuscito, altrimenti il messaggio si ferma come DUPLICATE
  mockSupa.setResponse('processed_webhook_events:upsert', [{ message_key: 'm' }]);
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    WEBHOOK_SECRET: 'whk-test',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    GROQ_API_KEY: 'groq-test',
  };
  delete process.env.SELF_CHAT_PARSER_ENABLED;
  (global as any).fetch = jest.fn(async (url: string) => {
    fetchUrls.push(String(url));
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'model not found' };
  });
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
  (global as any).fetch = ORIGINAL_FETCH;
  logSpy.mockRestore();
});

async function postSelfChat(text: string) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { POST } = await import('../app/api/webhook/route');
  const body = makeMessagePayload({ instance: INSTANCE, remoteJid: OWNER + '@s.whatsapp.net', text, msgId: 'm-' + Math.random() });
  return POST(mockRequest(body, { 'x-webhook-secret': 'whk-test', 'Content-Type': 'application/json' }) as any);
}

const llmCalls = () => fetchUrls.filter((u) => u.includes('groq.com') || u.includes('openai.com'));
const loggedText = () => logSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
const msgReceivedLogs = () => mockSupa.calls.filter((c) => c.table === 'webhook_logs' && c.args[0]?.tag === 'MSG_RECEIVED');

describe('SELF_CHAT_PARSER_ENABLED assente (default) → la nota non va da nessuna parte', () => {
  test('nessuna chiamata all\'LLM, nessun MSG_RECEIVED, nessun messaggio a Evolution', async () => {
    expect(selfChatParserEnabled()).toBe(false);
    const res = await postSelfChat(NOTE);
    expect(res.status).toBe(200);
    expect(llmCalls()).toHaveLength(0);
    expect(fetchUrls).toHaveLength(0);
    expect(msgReceivedLogs()).toHaveLength(0);
    expect(loggedText()).not.toContain('cardiologo');
    expect(loggedText()).toContain('parser spento');
  });

  test('anche un comando valido è ignorato finché il parser è spento', async () => {
    await postSelfChat('Invia a Mario domani alle 15: ciao');
    expect(llmCalls()).toHaveLength(0);
  });
});

describe('SELF_CHAT_PARSER_ENABLED=true → solo comandi', () => {
  beforeEach(() => { process.env.SELF_CHAT_PARSER_ENABLED = 'true'; });

  test('una nota senza parola chiave e senza promemoria in corso non arriva all\'LLM', async () => {
    const res = await postSelfChat(NOTE);
    expect(res.status).toBe(200);
    expect(llmCalls()).toHaveLength(0);
    expect(msgReceivedLogs()).toHaveLength(0);
    expect(loggedText()).not.toContain('cardiologo');
  });

  test('un comando arriva all\'LLM, ma il testo non finisce nei log', async () => {
    const cmd = 'Invia a Mario domani alle 15: portare il certificato medico';
    await postSelfChat(cmd);
    expect(llmCalls().length).toBeGreaterThan(0);
    expect(loggedText()).not.toContain('certificato medico');
  });

  test('con un promemoria in attesa di risposta, anche "alle 16" passa (conversazione in corso)', async () => {
    mockSupa.setResponse('scheduled_messages:select', [{ id: 's1', status: 'awaiting_time', recipient_name: 'Mario', parsed_message: 'x', scheduled_at: null }]);
    await postSelfChat('alle 16 per favore');
    expect(llmCalls().length).toBeGreaterThan(0);
  });
});

describe('filtro parole chiave', () => {
  test.each([
    'Invia a Mario domani: ciao', 'manda a Luca alle 9', 'Programma per venerdì', 'ricordami di', 'lista', 'annulla 2', 'Modifica messaggio 1: x', 'ok', 'Sì', 'no',
  ])('comando: %s', (t) => expect(isSelfChatCommand(t)).toBe(true));
  test.each([
    'Comprare latte', 'si deve pagare la bolletta', 'nota: indirizzo via Roma 3', 'okay ci vediamo', 'inviato il pacco', 'Listino prezzi',
  ])('nota: %s', (t) => expect(isSelfChatCommand(t)).toBe(false));
  test('risposte brevi solo a parola intera', () => {
    expect(isSelfChatShortReply(' ok ')).toBe(true);
    expect(isSelfChatShortReply('ok grazie')).toBe(false);
  });
});
