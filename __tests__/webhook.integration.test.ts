/**
 * Integration tests for /api/webhook route.
 * Mocks: Supabase client (module-level), global fetch, env vars.
 */
import { createMockSupabase, createFetchMock, mockRequest, makeMessagePayload, makeConnectionPayload } from './helpers/mocks';

// Mock Supabase before importing route (module-level client)
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

// Helper to call the POST handler
async function callWebhook(body: any, headers: Record<string, string> = {}) {
  // Always reset modules so webhook module re-evaluates with fresh env
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({
    createClient: () => mockSupa.client,
  }));
  (global as any).fetch = fetchMock.mockFetch;

  const { POST } = await import('../app/api/webhook/route');
  const req = mockRequest(body, { 'x-webhook-secret': 'test-webhook-secret', ...headers });
  return POST(req as any);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('Webhook: auth', () => {
  test('returns 401 without webhook secret header', async () => {
    const body = makeMessagePayload({ instance: 'SchedWhats-123', text: 'test' });
    // Call without x-webhook-secret header
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    (global as any).fetch = fetchMock.mockFetch;

    const { POST } = await import('../app/api/webhook/route');
    const req = mockRequest(body, {}); // no secret header
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  test('returns 401 with wrong webhook secret', async () => {
    const body = makeMessagePayload({ instance: 'SchedWhats-123', text: 'test' });
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    (global as any).fetch = fetchMock.mockFetch;

    const { POST } = await import('../app/api/webhook/route');
    const req = mockRequest(body, { 'x-webhook-secret': 'wrong-secret' });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  test('accepts request with correct webhook secret', async () => {
    const body = makeConnectionPayload('SchedWhats-123', 'open');
    // Connection update should succeed with correct secret
    mockSupa.setResponse('user_instances:update', { id: 'ui-1', phone_number: '393501234567' });
    mockSupa.setResponse('user_instances:select', { phone_number: '393501234567' });
    // For the notification fetch
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    const res = await callWebhook(body);
    expect(res.status).toBe(200);
  });
});

// ── Connection Update ─────────────────────────────────────────────────────────

describe('Webhook: connection update', () => {
  test('updates connection_status to open and sends onboarding', async () => {
    const body = makeConnectionPayload('SchedWhats-393501234567', 'open');

    // handleConnectionUpdate needs update
    mockSupa.setResponse('user_instances:update', [{ id: 'ui-1', phone_number: '393501234567' }]);
    // Second call: get phone for onboarding notification
    mockSupa.setResponse('user_instances:select', { phone_number: '393501234567' });
    // Notification send
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    const res = await callWebhook(body);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);

    // Verify disclaimer + onboarding messages were sent (2 calls)
    const evoCalls = fetchMock.calls.filter(c => c.url.includes('/message/sendText/'));
    expect(evoCalls.length).toBeGreaterThanOrEqual(2);
    // First call = disclaimer
    const disclaimerBody = JSON.parse(evoCalls[0].options.body as string);
    expect(disclaimerBody.text).toContain('Importante');
    expect(disclaimerBody.text).toContain('Dispositivi Collegati');
    // Second call = onboarding
    const onboardingBody = JSON.parse(evoCalls[1].options.body as string);
    expect(onboardingBody.text).toContain('Sono il tuo assistente WhatsLater');
  });

  test('handles disconnect (close state)', async () => {
    const body = makeConnectionPayload('SchedWhats-393501234567', 'close');
    mockSupa.setResponse('user_instances:update', [{ id: 'ui-1', phone_number: '393501234567' }]);

    const res = await callWebhook(body);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);

    // Verify DB was called with status update
    const updateCalls = mockSupa.calls.filter(c => c.table === 'user_instances' && c.operation === 'update');
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Message: non-fromMe ignored ───────────────────────────────────────────────

describe('Webhook: message filtering', () => {
  test('ignores messages not from user (fromMe=false)', async () => {
    const body = makeMessagePayload({
      instance: 'SchedWhats-393501234567',
      fromMe: false,
      text: 'Ciao!',
    });

    const res = await callWebhook(body);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);

    // No AI calls should be made
    const aiCalls = fetchMock.calls.filter(c => c.url.includes('groq.com') || c.url.includes('openai.com'));
    expect(aiCalls.length).toBe(0);
  });

  test('ignores fromMe messages sent to another contact (not self-chat)', async () => {
    // User 393501234567 sends a normal message to contact 393409999999
    // This should be IGNORED — only self-chat messages are processed
    const body = makeMessagePayload({
      instance: 'SchedWhats-393501234567',
      fromMe: true,
      remoteJid: '393409999999@s.whatsapp.net', // another contact, NOT self
      text: 'Ciao, come stai?',
    });

    // findUserStrict — instance phone matches owner, but remoteJid is someone else
    mockSupa.setResponse('user_instances:select', {
      id: 'ui-1', phone_number: '393501234567',
      instance_name: 'SchedWhats-393501234567',
      subscription_plan: 'trial',
      trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
    });
    // getPendingContext — no awaiting_confirm
    mockSupa.setResponse('scheduled_messages:select', null);
    mockSupa.setResponse('scheduled_messages:update', null);

    const res = await callWebhook(body);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);

    // No AI calls — message was ignored
    const aiCalls = fetchMock.calls.filter(c => c.url.includes('groq.com') || c.url.includes('openai.com'));
    expect(aiCalls.length).toBe(0);

    // No Evolution API notifications sent
    const evoCalls = fetchMock.calls.filter(c => c.url.includes('/message/sendText/'));
    expect(evoCalls.length).toBe(0);
  });

  test('processes fromMe self-chat messages (remoteJid matches owner phone)', async () => {
    // User 393501234567 sends a message to themselves (self-chat)
    // This SHOULD be processed
    const body = makeMessagePayload({
      instance: 'SchedWhats-393501234567',
      fromMe: true,
      remoteJid: '393501234567@s.whatsapp.net', // self-chat
      text: 'Invia a Marco domani alle 15: Test',
    });

    // findUserStrict
    mockSupa.setResponse('user_instances:select', {
      id: 'ui-1', phone_number: '393501234567',
      instance_name: 'SchedWhats-393501234567',
      subscription_plan: 'trial',
      trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
    });
    mockSupa.setResponse('pending_contacts:select', [
      { recipient_name: 'Marco', recipient_number: '393401234567' },
    ]);
    mockSupa.setResponse('scheduled_messages:select', null);
    mockSupa.setResponse('scheduled_messages:update', null);
    mockSupa.setResponse('scheduled_messages:insert', { id: 'sm-new' });
    mockSupa.setResponse('webhook_logs:insert', null);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(15, 0, 0, 0);
    fetchMock.setHandler('groq.com', () => ({
      ok: true, status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({
          action: 'schedule',
          recipient_name: 'Marco',
          datetime_iso: tomorrow.toISOString().replace(/Z$/, '').replace(/\+.*$/, ''),
          message_text: 'Test',
          reply: 'Programmato',
        }) } }],
      }),
      text: () => Promise.resolve('ok'),
      headers: new Headers(),
    }));
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    const res = await callWebhook(body);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);

    // AI WAS called — message was processed
    const aiCalls = fetchMock.calls.filter(c => c.url.includes('groq.com'));
    expect(aiCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('ignores empty text messages', async () => {
    const body = makeMessagePayload({
      instance: 'SchedWhats-393501234567',
      fromMe: true,
      remoteJid: '393501234567@s.whatsapp.net', // self-chat
      text: '',
    });
    // findUserStrict needs a DB response
    mockSupa.setResponse('user_instances:select', {
      id: 'ui-1', phone_number: '393501234567',
      instance_name: 'SchedWhats-393501234567',
      subscription_plan: 'trial',
      trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const res = await callWebhook(body);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);
  });
});

// ── vCard flow ────────────────────────────────────────────────────────────────

describe('Webhook: vCard contact saving', () => {
  test('saves vCard contact and confirms to user', async () => {
    const body = makeMessagePayload({
      instance: 'SchedWhats-393501234567',
      fromMe: true,
      remoteJid: '393501234567@s.whatsapp.net', // self-chat
      contactMessage: {
        displayName: 'Marco Rossi',
        vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Marco Rossi\nTEL;waid=393401234567:+393401234567\nEND:VCARD',
      },
    });

    // findUserStrict
    mockSupa.setResponse('user_instances:select', {
      id: 'ui-1', phone_number: '393501234567',
      instance_name: 'SchedWhats-393501234567',
      subscription_plan: 'trial',
      trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
    });
    // upsert contact
    mockSupa.setResponse('pending_contacts:upsert', null);
    // webhook_logs insert
    mockSupa.setResponse('webhook_logs:insert', null);
    // Notification
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    const res = await callWebhook(body);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);

    // Verify contact was saved (upsert call)
    const upsertCalls = mockSupa.calls.filter(c => c.table === 'pending_contacts' && c.operation === 'upsert');
    expect(upsertCalls.length).toBe(1);

    // Verify confirmation sent to user
    const evoCalls = fetchMock.calls.filter(c => c.url.includes('/message/sendText/'));
    expect(evoCalls.length).toBeGreaterThanOrEqual(1);
    const notifBody = JSON.parse(evoCalls[0].options.body as string);
    expect(notifBody.text).toContain('Marco Rossi');
    expect(notifBody.text).toContain('salvato');
  });
});

// ── vCard: contact limit enforcement ─────────────────────────────────────────

describe('Webhook: contact limit enforcement', () => {
  test('rejects vCard when contact limit reached (free plan)', async () => {
    const body = makeMessagePayload({
      instance: 'SchedWhats-393501234567',
      fromMe: true,
      remoteJid: '393501234567@s.whatsapp.net', // self-chat
      contactMessage: {
        displayName: 'Nuovo Contatto',
        vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Nuovo Contatto\nTEL;waid=393409999999:+393409999999\nEND:VCARD',
      },
    });

    // findUserStrict — free plan (limit: 5 contacts)
    mockSupa.setResponse('user_instances:select', {
      id: 'ui-1', phone_number: '393501234567',
      instance_name: 'SchedWhats-393501234567',
      subscription_plan: 'free',
      trial_ends_at: null,
    });
    // Contact count query returns count: 5 (at limit) + existing contact check returns null
    mockSupa.setResponse('pending_contacts:select', null, null, { count: 5 });
    // webhook_logs
    mockSupa.setResponse('webhook_logs:insert', null);
    // Notification for limit reached
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    const res = await callWebhook(body);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);

    // Should have sent limit warning, NOT the "salvato" confirmation
    const evoCalls = fetchMock.calls.filter(c => c.url.includes('/message/sendText/'));
    expect(evoCalls.length).toBeGreaterThanOrEqual(1);
    const notifBody = JSON.parse(evoCalls[0].options.body as string);
    expect(notifBody.text).toContain('limite');
    expect(notifBody.text).not.toContain('salvato');
  });
});

// ── Fast-path: OK confirm ─────────────────────────────────────────────────────

describe('Webhook: fast-path confirm', () => {
  test('OK confirms awaiting_confirm message without AI', async () => {
    const body = makeMessagePayload({
      instance: 'SchedWhats-393501234567',
      fromMe: true,
      remoteJid: '393501234567@s.whatsapp.net', // self-chat
      text: 'ok',
    });

    // findUserStrict
    mockSupa.setResponse('user_instances:select', {
      id: 'ui-1', phone_number: '393501234567',
      instance_name: 'SchedWhats-393501234567',
      subscription_plan: 'trial',
      trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
    });
    // Fast-path query for awaiting_confirm
    mockSupa.setResponse('scheduled_messages:select', {
      id: 'sm-1', recipient_name: 'Marco', recipient_number: '393401234567',
      parsed_message: 'Ciao Marco!', scheduled_at: new Date(Date.now() + 3600000).toISOString(),
    });
    // Update status to pending
    mockSupa.setResponse('scheduled_messages:update', null);
    // webhook_logs
    mockSupa.setResponse('webhook_logs:insert', null);
    // Notification
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    const res = await callWebhook(body);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);

    // Should NOT call AI
    const aiCalls = fetchMock.calls.filter(c => c.url.includes('groq.com') || c.url.includes('openai.com'));
    expect(aiCalls.length).toBe(0);

    // Should confirm via WhatsApp
    const evoCalls = fetchMock.calls.filter(c => c.url.includes('/message/sendText/'));
    expect(evoCalls.length).toBeGreaterThanOrEqual(1);
    const notifBody = JSON.parse(evoCalls[0].options.body as string);
    expect(notifBody.text).toContain('Confermato');
  });
});

// ── AI scheduling flow ────────────────────────────────────────────────────────

describe('Webhook: AI scheduling flow', () => {
  test('schedules message via AI and creates awaiting_confirm record', async () => {
    const body = makeMessagePayload({
      instance: 'SchedWhats-393501234567',
      fromMe: true,
      remoteJid: '393501234567@s.whatsapp.net', // self-chat
      text: 'Invia a Marco domani alle 15: Ricordati la riunione!',
    });

    // findUserStrict
    mockSupa.setResponse('user_instances:select', {
      id: 'ui-1', phone_number: '393501234567',
      instance_name: 'SchedWhats-393501234567',
      subscription_plan: 'trial',
      trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
    });
    // getContactList queries
    mockSupa.setResponse('pending_contacts:select', [
      { recipient_name: 'Marco', recipient_number: '393401234567' },
    ]);
    // getPendingContext - no pending
    mockSupa.setResponse('scheduled_messages:select', null);
    mockSupa.setResponse('scheduled_messages:update', null);
    // isMessageProcessed (dedup check)
    // insert for new scheduled message
    mockSupa.setResponse('scheduled_messages:insert', { id: 'sm-new' });
    // findContactByName
    // webhook_logs
    mockSupa.setResponse('webhook_logs:insert', null);

    // AI returns schedule action
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(15, 0, 0, 0);
    const aiResponse = {
      action: 'schedule',
      recipient_name: 'Marco',
      datetime_iso: tomorrow.toISOString().replace(/Z$/, '').replace(/\+.*$/, ''),
      message_text: 'Ciao Marco! Ricordati della riunione! 📋',
      reply: 'Messaggio programmato per Marco domani alle 15:00',
    };

    fetchMock.setHandler('groq.com', () => ({
      ok: true, status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify(aiResponse) } }],
      }),
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiResponse) } }] })),
      headers: new Headers(),
    }));

    // Evolution API sendText for notification
    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    const res = await callWebhook(body);
    const resBody = await res.json();
    expect(resBody.ok).toBe(true);

    // Verify AI was called
    const aiCalls = fetchMock.calls.filter(c => c.url.includes('groq.com'));
    expect(aiCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Edge: malformed AI JSON ───────────────────────────────────────────────────

describe('Webhook: edge cases', () => {
  test('handles malformed AI JSON gracefully (falls back to regex)', async () => {
    const body = makeMessagePayload({
      instance: 'SchedWhats-393501234567',
      fromMe: true,
      remoteJid: '393501234567@s.whatsapp.net', // self-chat
      text: 'Manda a Marco domani alle 10: test message',
    });

    // findUserStrict
    mockSupa.setResponse('user_instances:select', {
      id: 'ui-1', phone_number: '393501234567',
      instance_name: 'SchedWhats-393501234567',
      subscription_plan: 'trial',
      trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
    });
    mockSupa.setResponse('pending_contacts:select', [
      { recipient_name: 'Marco', recipient_number: '393401234567' },
    ]);
    mockSupa.setResponse('scheduled_messages:select', null);
    mockSupa.setResponse('scheduled_messages:update', null);
    mockSupa.setResponse('scheduled_messages:insert', { id: 'sm-new' });
    mockSupa.setResponse('webhook_logs:insert', null);

    // AI returns invalid JSON
    fetchMock.setHandler('groq.com', () => ({
      ok: true, status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Sorry, I cannot parse this {invalid json' } }],
      }),
      text: () => Promise.resolve('Sorry'),
      headers: new Headers(),
    }));

    fetchMock.setJsonResponse('/message/sendText/', { ok: true });

    const res = await callWebhook(body);
    // Should not crash — either falls back to regex or sends error notification
    expect(res.status).toBeLessThan(500);
  });

  test('silently ignores user not found (phone not in DB)', async () => {
    const body = makeMessagePayload({
      instance: 'SchedWhats-Unknown',
      fromMe: true,
      remoteJid: '393501234567@s.whatsapp.net', // self-chat
      text: 'Ciao',
    });

    // findUserStrict returns null (no match)
    mockSupa.setResponse('user_instances:select', null);

    const res = await callWebhook(body);
    // Should silently ignore, not return 404
    expect(res.status).toBe(200);
  });

  test('cross-user message: user A sends to user B, both have instances — must be ignored', async () => {
    // Wife (393780858599, instance SchedWhats-3780858599) sends a message
    // to operator (393442582226, instance SchedWhats-393442582226).
    // On wife's instance: fromMe=true, remoteJid=operator's number.
    // findUserStrict(SchedWhats-3780858599, 393442582226) must NOT match.
    // The webhook must NOT reassign the operator's instance.
    const body = makeMessagePayload({
      instance: 'SchedWhats-3780858599',
      fromMe: true,
      remoteJid: '393442582226@s.whatsapp.net', // operator's number — NOT self-chat
      text: 'Ciao amore, ci vediamo stasera?',
    });

    // findUserStrict returns null — phone 393442582226 is not under SchedWhats-3780858599
    mockSupa.setResponse('user_instances:select', null);

    const res = await callWebhook(body);

    // Must be silently ignored (200), never processed or reassigned
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Verify NO update/upsert was made to user_instances (no reassignment)
    const updateCalls = mockSupa.calls.filter(
      c => c.table === 'user_instances' && c.operation === 'update'
    );
    expect(updateCalls.length).toBe(0);

    // Verify NO message was inserted into scheduled_messages
    const insertCalls = mockSupa.calls.filter(
      c => c.table === 'scheduled_messages' && c.operation === 'insert'
    );
    expect(insertCalls.length).toBe(0);
  });
});
