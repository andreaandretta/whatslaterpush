import { createMockSupabase } from './helpers/mocks';
import { claimWebhookEvent, releaseWebhookEvent } from '../app/lib/webhook-dedup';

describe('claimWebhookEvent', () => {
  test('no msgId -> true (nothing to dedup on, let it through; no DB call)', async () => {
    const m = createMockSupabase();
    expect(await claimWebhookEvent(m.client as any, '')).toBe(true);
    expect(m.calls.length).toBe(0);
  });

  test('fresh claim (upsert returns a row) -> true', async () => {
    const m = createMockSupabase();
    m.setResponse('processed_webhook_events:upsert', [{ message_key: 'abc' }]);
    expect(await claimWebhookEvent(m.client as any, 'abc')).toBe(true);
  });

  test('already claimed (upsert returns no rows) -> false', async () => {
    const m = createMockSupabase();
    m.setResponse('processed_webhook_events:upsert', []);
    expect(await claimWebhookEvent(m.client as any, 'abc')).toBe(false);
  });

  test('DB error -> true (fail-open: never drop a real message)', async () => {
    const m = createMockSupabase();
    m.setResponse('processed_webhook_events:upsert', null, { message: 'db down' });
    expect(await claimWebhookEvent(m.client as any, 'abc')).toBe(true);
  });
});

describe('releaseWebhookEvent', () => {
  test('deletes the claim by message_key', async () => {
    const m = createMockSupabase();
    await releaseWebhookEvent(m.client as any, 'abc');
    const del = m.calls.find((c) => c.table === 'processed_webhook_events' && c.operation === 'delete');
    expect(del).toBeDefined();
    expect(del!.chain).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['message_key', 'abc'] },
    ]));
  });

  test('no msgId -> no DB call (idempotent guard)', async () => {
    const m = createMockSupabase();
    await releaseWebhookEvent(m.client as any, '');
    expect(m.calls.length).toBe(0);
  });

  test('swallows a delete error (idempotent, never throws on the error path)', async () => {
    const m = createMockSupabase();
    m.setResponse('processed_webhook_events:delete', null, { message: 'boom' });
    await expect(releaseWebhookEvent(m.client as any, 'abc')).resolves.toBeUndefined();
  });
});
