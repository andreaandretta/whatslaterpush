/**
 * Integration tests for Quick Capture flow in /api/webhook.
 */
import { createMockSupabase, createFetchMock, mockRequest, makeMessagePayload, FetchCall } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const fetchMock = createFetchMock();
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    GROQ_API_KEY: 'groq-test-key',
    WEBHOOK_SECRET: 'test-webhook-secret',
    NEXT_PUBLIC_APP_URL: 'https://whatslaterpush.vercel.app',
  };
  (global as any).fetch = fetchMock.mockFetch;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function callWebhook(body: any, headers: Record<string, string> = {}) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  (global as any).fetch = fetchMock.mockFetch;
  const { POST } = await import('../app/api/webhook/route');
  const req = mockRequest(body, { 'x-webhook-secret': 'test-webhook-secret', ...headers });
  return POST(req as any);
}

describe('UNDO command', () => {
  test('cancels last pending message within 60s window', async () => {
    // findUserStrict: user_instances lookup
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    // UNDO query: scheduled_messages select for last pending within 60s
    mockSupa.setResponse('scheduled_messages:select',
      { id: 'msg-1', recipient_name: 'Mario', scheduled_at: new Date(Date.now() + 3600000).toISOString() }, null);
    // UNDO update: cancel the message
    mockSupa.setResponse('scheduled_messages:update', [{ id: 'msg-1' }], null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'undo',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    const res = await callWebhook(payload);
    expect(res.status).toBe(200);

    const updateCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'update');
    expect(updateCall).toBeTruthy();
  });

  test('replies "Niente da annullare" when no recent pending message', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_auth_sessions:select', null, null);
    // No recent pending message
    mockSupa.setResponse('scheduled_messages:select', null, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'undo',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    const res = await callWebhook(payload);
    expect(res.status).toBe(200);

    // Verify NO update happened (since no row to cancel)
    const updateCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'update');
    expect(updateCall).toBeFalsy();

    // Verify notifyOwner was called via Evolution API fetch
    const notifyCalls = fetchMock.calls.filter((c: FetchCall) => /sendText/.test(c.url));
    expect(notifyCalls.length).toBeGreaterThan(0);
  });

  test('CAS prevents cancelling already-sending message', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_auth_sessions:select', null, null);
    // SELECT returns a pending row...
    mockSupa.setResponse('scheduled_messages:select',
      { id: 'msg-1', recipient_name: 'Mario', scheduled_at: new Date(Date.now() + 3600000).toISOString() }, null);
    // ...but UPDATE returns null (CAS lost — row already moved to 'sending')
    mockSupa.setResponse('scheduled_messages:update', null, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'undo',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    const res = await callWebhook(payload);
    expect(res.status).toBe(200);

    // Bot should reply with "Troppo tardi" (sent via Evolution API sendText)
    const notifyCalls = fetchMock.calls.filter((c: FetchCall) => /sendText/.test(c.url));
    const lastCall = notifyCalls[notifyCalls.length - 1];
    const body = lastCall ? JSON.parse(lastCall.options.body as string) : {};
    expect((body.text || '').toLowerCase()).toContain('troppo tardi');
  });

  test('does NOT trigger UNDO for "annulla 3" (existing list command)', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    // No awaiting_confirm
    mockSupa.setResponse('scheduled_messages:select', null, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'annulla 3',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    // The UNDO query has a specific filter `.gt('created_at', NOW-60s)`. If the UNDO
    // path was triggered by mistake, that filter would appear in the calls.
    const undoQuery = mockSupa.calls.find(c =>
      c.table === 'scheduled_messages' &&
      c.operation === 'select' &&
      c.chain.some((s: any) => s.method === 'gt' && s.args[0] === 'created_at')
    );
    expect(undoQuery).toBeFalsy();
  });
});

describe('Smart-confirm skip', () => {
  test('contact known + explicit HH:MM → status=pending (no awaiting_confirm)', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_auth_sessions:select', null, null);
    mockSupa.setResponse('pending_contacts:select',
      [{ recipient_name: 'Mario', recipient_number: '393334445555' }], null);
    fetchMock.setHandler('api.groq.com', () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        action: 'schedule', recipient_name: 'Mario', recipient_number: '393334445555',
        message_text: 'ciao', datetime_iso: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 19), confidence: 'high',
      }) } }] }),
    }));
    mockSupa.setResponse('scheduled_messages:insert', [{ id: 'm1' }], null);
    mockSupa.setResponse('scheduled_messages:select', null, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'Mario alle 9: ciao',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    const insertCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'insert');
    expect(insertCall).toBeTruthy();
    const insertedRow = insertCall?.args[0];
    expect(insertedRow.status).toBe('pending');
  });

  test('contact NEW + inline phone → status=awaiting_confirm (no skip)', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_auth_sessions:select', null, null);
    mockSupa.setResponse('pending_contacts:select', null, null); // no contact found
    fetchMock.setHandler('api.groq.com', () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        action: 'schedule', recipient_name: 'Mario Cementi', recipient_number: '393334445555',
        message_text: 'preventivo?', datetime_iso: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString().slice(0, 19), confidence: 'high',
      }) } }] }),
    }));
    mockSupa.setResponse('scheduled_messages:insert', [{ id: 'm1' }], null);
    mockSupa.setResponse('scheduled_messages:select', null, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'Invia a Mario Cementi 3334445555 oggi alle 17: preventivo?',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    const insertCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'insert');
    const insertedRow = insertCall?.args[0];
    expect(insertedRow.status).toBe('awaiting_confirm');
  });

  test('contact known + ambiguous time → awaiting_confirm', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_auth_sessions:select', null, null);
    mockSupa.setResponse('pending_contacts:select',
      [{ recipient_name: 'Mario', recipient_number: '393334445555' }], null);
    fetchMock.setHandler('api.groq.com', () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        action: 'schedule', recipient_name: 'Mario', recipient_number: '393334445555',
        message_text: 'ciao', datetime_iso: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString().slice(0, 19), confidence: 'low',
      }) } }] }),
    }));
    mockSupa.setResponse('scheduled_messages:insert', [{ id: 'm1' }], null);
    mockSupa.setResponse('scheduled_messages:select', null, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'Mario tra un po: ciao',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    const insertCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'insert');
    const insertedRow = insertCall?.args[0];
    expect(insertedRow.status).toBe('awaiting_confirm');
  });
});

describe('Auto-save contact', () => {
  test('inline phone + name → contact saved in pending_contacts', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_auth_sessions:select', null, null);
    mockSupa.setResponse('pending_contacts:select', null, null);  // no existing contact, count=0
    mockSupa.setResponse('pending_contacts:insert', [{ id: 'c1' }], null);
    fetchMock.setHandler('api.groq.com', () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        action: 'schedule', recipient_name: 'Mario Cementi', recipient_number: '393334445555',
        message_text: 'ciao', datetime_iso: '2026-12-31T17:00:00', confidence: 'high',
      }) } }] }),
    }));
    mockSupa.setResponse('scheduled_messages:insert', [{ id: 'm1' }], null);
    mockSupa.setResponse('scheduled_messages:select', null, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'Invia a Mario Cementi 3334445555 alle 17: ciao',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    const insertContact = mockSupa.calls.find(c => c.table === 'pending_contacts' && c.operation === 'insert');
    expect(insertContact).toBeTruthy();
  });

  test('does NOT overwrite existing contact with different number', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_auth_sessions:select', null, null);
    // Existing contact "Mario" already saved with DIFFERENT number — use array so getContactList can iterate
    mockSupa.setResponse('pending_contacts:select',
      [{ recipient_number: '393331234567', recipient_name: 'Mario' }], null);
    fetchMock.setHandler('api.groq.com', () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        action: 'schedule', recipient_name: 'Mario', recipient_number: '393334445555',
        message_text: 'ciao', datetime_iso: '2026-12-31T17:00:00', confidence: 'high',
      }) } }] }),
    }));
    mockSupa.setResponse('scheduled_messages:insert', [{ id: 'm1' }], null);
    mockSupa.setResponse('scheduled_messages:select', null, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'Invia a Mario 3334445555 alle 17: ciao',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    const insertContact = mockSupa.calls.find(c => c.table === 'pending_contacts' && c.operation === 'insert');
    expect(insertContact).toBeFalsy();
  });
});
