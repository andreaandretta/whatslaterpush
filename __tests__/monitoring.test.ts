/**
 * Tests for app/lib/monitoring.ts
 * Mocks Supabase and fetch to test check logic, alert cascade, anti-spam.
 */

import { createMockSupabase, createFetchMock } from './helpers/mocks';

// Set up mocks BEFORE importing
const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const fetchMock = createFetchMock();

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'test-key',
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-role-key',
    RESEND_API_KEY: 'test-resend-key',
    MONITORING_SECRET: 'test-secret',
  };
  (global as any).fetch = fetchMock.mockFetch;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

import {
  checkEvolutionApi,
  checkCronStalled,
  checkWebhookInactive,
  checkSupabaseDown,
  checkMessagesStalled,
  checkFailedSpike,
  runAllChecks,
  shouldAlert,
  sendAlert,
  sendRecovery,
  CheckResult,
} from '../app/lib/monitoring';

// --- Check 1: Evolution API ---

describe('checkEvolutionApi', () => {
  test('returns ok when API responds 200', async () => {
    fetchMock.setJsonResponse('/instance/fetchInstances', [{ id: 1 }], 200);
    const result = await checkEvolutionApi();
    expect(result.name).toBe('evolution_api');
    expect(result.status).toBe('ok');
  });

  test('returns critical when API responds 500', async () => {
    fetchMock.setJsonResponse('/instance/fetchInstances', { error: 'down' }, 500);
    const result = await checkEvolutionApi();
    expect(result.status).toBe('critical');
    expect(result.message).toContain('500');
  });

  test('returns critical on fetch error', async () => {
    fetchMock.setHandler('/instance/fetchInstances', () => { throw new Error('Network error'); });
    const result = await checkEvolutionApi();
    expect(result.status).toBe('critical');
    expect(result.message).toContain('Network error');
  });
});

// --- Check 2: Cron Stalled ---

describe('checkCronStalled', () => {
  test('returns ok when no stalled messages', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    const result = await checkCronStalled();
    expect(result.status).toBe('ok');
  });

  test('returns critical when stalled messages exist', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 3 });
    const result = await checkCronStalled();
    expect(result.status).toBe('critical');
    expect(result.message).toContain('3');
  });
});

// --- Check 3: Webhook Inactive ---

describe('checkWebhookInactive', () => {
  test('returns ok when no active instances', async () => {
    mockSupa.setResponse('user_instances:select', null, null, { count: 0 });
    const result = await checkWebhookInactive();
    expect(result.status).toBe('ok');
    expect(result.message).toContain('Nessuna istanza attiva');
  });

  test('returns ok when recent messages exist with active instances', async () => {
    mockSupa.setResponse('user_instances:select', null, null, { count: 2 });
    mockSupa.setResponse('scheduled_messages:select', [{ created_at: new Date().toISOString() }]);
    const result = await checkWebhookInactive();
    expect(result.status).toBe('ok');
  });
});

// --- Check 4: Supabase Down ---

describe('checkSupabaseDown', () => {
  test('returns ok when query succeeds', async () => {
    mockSupa.setResponse('user_instances:select', [{ id: '1' }]);
    const result = await checkSupabaseDown();
    expect(result.status).toBe('ok');
  });

  test('returns critical on query error', async () => {
    mockSupa.setResponse('user_instances:select', null, { message: 'connection refused' });
    const result = await checkSupabaseDown();
    expect(result.status).toBe('critical');
    expect(result.message).toContain('connection refused');
  });
});

// --- Check 5: Messages Stalled ---

describe('checkMessagesStalled', () => {
  test('returns ok when no stalled messages', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    const result = await checkMessagesStalled();
    expect(result.status).toBe('ok');
  });

  test('returns critical when messages stuck in sending', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 2 });
    const result = await checkMessagesStalled();
    expect(result.status).toBe('critical');
  });
});

// --- Check 6: Failed Spike ---

describe('checkFailedSpike', () => {
  test('returns ok when count <= 5', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 3 });
    const result = await checkFailedSpike();
    expect(result.status).toBe('ok');
  });

  test('returns warning when count 6-10', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 8 });
    const result = await checkFailedSpike();
    expect(result.status).toBe('warning');
  });

  test('returns critical when count > 10', async () => {
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 15 });
    const result = await checkFailedSpike();
    expect(result.status).toBe('critical');
  });
});

// --- runAllChecks ---

describe('runAllChecks', () => {
  test('returns 6 results', async () => {
    fetchMock.setJsonResponse('/instance/fetchInstances', [{ id: 1 }], 200);
    mockSupa.setResponse('scheduled_messages:select', null, null, { count: 0 });
    mockSupa.setResponse('user_instances:select', [{ id: '1' }], null, { count: 0 });
    const results = await runAllChecks();
    expect(results).toHaveLength(6);
    results.forEach((r) => {
      expect(['ok', 'warning', 'critical']).toContain(r.status);
      expect(r.name).toBeTruthy();
    });
  });
});

// --- shouldAlert (anti-spam) ---

describe('shouldAlert', () => {
  test('returns true when no previous alerts', async () => {
    mockSupa.setResponse('monitoring_alerts:select', []);
    const result = await shouldAlert('evolution_api');
    expect(result).toBe(true);
  });

  test('returns false when alert was sent recently', async () => {
    mockSupa.setResponse('monitoring_alerts:select', [
      { created_at: new Date().toISOString() },
    ]);
    const result = await shouldAlert('evolution_api');
    expect(result).toBe(false);
  });

  test('returns true when last alert was >1h ago', async () => {
    mockSupa.setResponse('monitoring_alerts:select', [
      { created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
    ]);
    const result = await shouldAlert('evolution_api');
    expect(result).toBe(true);
  });
});

// --- Alert Cascade ---

describe('sendAlert', () => {
  test('sends WhatsApp first, logs whatsapp channel', async () => {
    mockSupa.setResponse('user_instances:select', [{ instance_name: 'SchedWhats-test' }]);
    fetchMock.setJsonResponse('/message/sendText/', { key: { id: '1' } }, 200);
    mockSupa.setResponse('monitoring_alerts:insert', { id: '1' });

    await sendAlert({ name: 'evolution_api', status: 'critical', message: 'down', checked_at: new Date().toISOString() });

    const sendTextCalls = fetchMock.calls.filter(c => c.url.includes('sendText'));
    expect(sendTextCalls.length).toBe(1);

    const insertCalls = mockSupa.calls.filter(c => c.table === 'monitoring_alerts' && c.operation === 'insert');
    expect(insertCalls.length).toBe(1);
  });

  test('falls back to email when WhatsApp fails', async () => {
    mockSupa.setResponse('user_instances:select', []);
    fetchMock.setJsonResponse('api.resend.com', { id: 'email-1' }, 200);
    mockSupa.setResponse('monitoring_alerts:insert', { id: '1' });

    await sendAlert({ name: 'supabase_down', status: 'critical', message: 'unreachable', checked_at: new Date().toISOString() });

    const resendCalls = fetchMock.calls.filter(c => c.url.includes('resend.com'));
    expect(resendCalls.length).toBe(1);
  });
});

// --- Recovery ---

describe('sendRecovery', () => {
  test('sends recovery message via WhatsApp', async () => {
    mockSupa.setResponse('user_instances:select', [{ instance_name: 'SchedWhats-test' }]);
    fetchMock.setJsonResponse('/message/sendText/', { key: { id: '1' } }, 200);
    mockSupa.setResponse('monitoring_alerts:insert', { id: '1' });

    await sendRecovery({ name: 'evolution_api', status: 'ok', message: 'recovered', checked_at: new Date().toISOString() });

    const sendTextCalls = fetchMock.calls.filter(c => c.url.includes('sendText'));
    expect(sendTextCalls.length).toBe(1);

    // Verify the message contains recovery text
    const body = JSON.parse(sendTextCalls[0].options.body as string);
    expect(body.text).toContain('Risolto');
  });
});
