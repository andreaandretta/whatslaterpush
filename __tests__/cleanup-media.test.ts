/**
 * Tests for the media cleanup cron (/api/cron/cleanup-media).
 *
 * Covers: selection criteria (status + media_url + retention cutoff),
 * Storage.remove call shape, DB nullification on UPDATE, and audit log row.
 */
import { createMockSupabase } from './helpers/mocks';
import { MAX_HISTORY_DAYS } from '../app/lib/plans';

const mockSupa = createMockSupabase();

// Track storage calls so tests can assert remove() was called with the right
// bucket + paths.
const storageCalls: Array<{ bucket: string; method: string; args: any[] }> = [];
let storageError: { message: string } | null = null;

const clientWithStorage: any = {
  ...mockSupa.client,
  storage: {
    from: (bucket: string) => ({
      remove: (paths: string[]) => {
        storageCalls.push({ bucket, method: 'remove', args: [paths] });
        return Promise.resolve({ data: paths.map(name => ({ name })), error: storageError });
      },
    }),
  },
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => clientWithStorage,
}));

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  mockSupa.calls.length = 0;
  storageCalls.length = 0;
  storageError = null;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    CRON_SECRET: 'test-cron',
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function findSelect() {
  return mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'select');
}
function findUpdate() {
  return mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'update');
}
function findAuditInsert() {
  return mockSupa.calls.find(c => c.table === 'audit_events' && c.operation === 'insert');
}

describe('runMediaCleanup — selection criteria', () => {
  test('retention covers the longest plan history window (beta/business = 90d), never less', () => {
    // Regression guard for #52: a fixed 30d cutoff stripped attachments from
    // rows a beta user (historyDays 90) could still open — text present, photo
    // gone. Retention must be >= the max history any plan promises.
    expect(MAX_HISTORY_DAYS).toBe(90);
  });

  test('queries scheduled_messages filtered by terminal status, non-null media_url, and the retention cutoff', async () => {
    mockSupa.setResponse('scheduled_messages:select', [
      { id: 'm1', media_url: '393331234567/abc-foto.jpg' },
      { id: 'm2', media_url: '393331234567/xyz-video.mp4' },
    ]);
    const { runMediaCleanup } = await import('../app/api/cron/cleanup-media/route');
    await runMediaCleanup();

    const sel = findSelect()!;
    expect(sel).toBeDefined();
    // .select('id, media_url')
    expect(sel.args[0]).toBe('id, media_url');
    // .in('status', ['sent', 'cancelled', 'failed'])
    const inCall = sel.chain.find(c => c.method === 'in' && c.args[0] === 'status');
    expect(inCall).toBeDefined();
    expect(inCall!.args[1]).toEqual(['sent', 'cancelled', 'failed']);
    // .not('media_url', 'is', null)
    const notCall = sel.chain.find(c => c.method === 'not' && c.args[0] === 'media_url');
    expect(notCall).toBeDefined();
    expect(notCall!.args[1]).toBe('is');
    expect(notCall!.args[2]).toBeNull();
    // .lt('created_at', <ISO 30d ago>)
    const ltCall = sel.chain.find(c => c.method === 'lt' && c.args[0] === 'created_at');
    expect(ltCall).toBeDefined();
    const cutoffMs = new Date(ltCall!.args[1] as string).getTime();
    const expectedMs = Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
    // Allow 5s drift between code path and assertion.
    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(5_000);
    // .limit(100) — Vercel Hobby 10s budget
    const limCall = sel.chain.find(c => c.method === 'limit');
    expect(limCall).toBeDefined();
    expect(limCall!.args[0]).toBe(100);
  });
});

describe('runMediaCleanup — Storage remove', () => {
  test('removes exactly the candidate paths from the message-media bucket', async () => {
    mockSupa.setResponse('scheduled_messages:select', [
      { id: 'm1', media_url: '393331234567/abc-foto.jpg' },
      { id: 'm2', media_url: '393331234567/xyz-video.mp4' },
    ]);
    const { runMediaCleanup } = await import('../app/api/cron/cleanup-media/route');
    const result = await runMediaCleanup();

    expect(storageCalls).toHaveLength(1);
    expect(storageCalls[0].bucket).toBe('message-media');
    expect(storageCalls[0].method).toBe('remove');
    expect(storageCalls[0].args[0]).toEqual([
      '393331234567/abc-foto.jpg',
      '393331234567/xyz-video.mp4',
    ]);
    expect(result.removed_storage).toBe(2);
  });

  test('no-op when no candidates — skips Storage and UPDATE entirely', async () => {
    mockSupa.setResponse('scheduled_messages:select', []);
    const { runMediaCleanup } = await import('../app/api/cron/cleanup-media/route');
    const result = await runMediaCleanup();

    expect(result.status).toBe('noop');
    expect(storageCalls).toHaveLength(0);
    expect(findUpdate()).toBeUndefined();
    expect(findAuditInsert()).toBeUndefined();
  });
});

describe('runMediaCleanup — DB nullification', () => {
  test('updates rows by id IN list with all media_* columns NULL', async () => {
    mockSupa.setResponse('scheduled_messages:select', [
      { id: 'm1', media_url: 'a/foo.jpg' },
      { id: 'm2', media_url: 'b/bar.mp4' },
    ]);
    const { runMediaCleanup } = await import('../app/api/cron/cleanup-media/route');
    await runMediaCleanup();

    const upd = findUpdate()!;
    expect(upd).toBeDefined();
    expect(upd.args[0]).toEqual({
      media_url: null,
      media_type: null,
      media_filename: null,
      media_caption: null,
    });
    const inCall = upd.chain.find(c => c.method === 'in' && c.args[0] === 'id');
    expect(inCall).toBeDefined();
    expect(inCall!.args[1]).toEqual(['m1', 'm2']);
  });
});

describe('runMediaCleanup — audit log', () => {
  test('writes audit_events row with media_cleanup event_type and stats payload', async () => {
    mockSupa.setResponse('scheduled_messages:select', [
      { id: 'm1', media_url: 'a/foo.jpg' },
      { id: 'm2', media_url: 'b/bar.mp4' },
      { id: 'm3', media_url: 'c/baz.pdf' },
    ]);
    const { runMediaCleanup } = await import('../app/api/cron/cleanup-media/route');
    await runMediaCleanup();

    const ins = findAuditInsert()!;
    expect(ins).toBeDefined();
    const row = ins.args[0];
    expect(row.event_type).toBe('media_cleanup');
    expect(row.payload.removed_count).toBe(3);
    expect(row.payload.batch_size).toBe(100);
  });
});

describe('partitionRemovableMedia (H8 pure)', () => {
  test('no in-use -> everything removable, nothing skipped', async () => {
    const { partitionRemovableMedia } = await import('../app/api/cron/cleanup-media/route');
    const r = partitionRemovableMedia([{ id: 'a', media_url: 'x/1.jpg' }, { id: 'b', media_url: 'x/2.jpg' }], new Set());
    expect(r.removablePaths).toEqual(['x/1.jpg', 'x/2.jpg']);
    expect(r.removableIds).toEqual(['a', 'b']);
    expect(r.skipped).toBe(0);
  });

  test('a shared (in-use) path is excluded from removal', async () => {
    const { partitionRemovableMedia } = await import('../app/api/cron/cleanup-media/route');
    const r = partitionRemovableMedia(
      [{ id: 'a', media_url: 'x/shared.jpg' }, { id: 'b', media_url: 'x/free.mp4' }],
      new Set(['x/shared.jpg']),
    );
    expect(r.removablePaths).toEqual(['x/free.mp4']);
    expect(r.removableIds).toEqual(['b']);
    expect(r.skipped).toBe(1);
  });

  test('duplicate media_urls collapse to one removable path (both ids nullified)', async () => {
    const { partitionRemovableMedia } = await import('../app/api/cron/cleanup-media/route');
    const r = partitionRemovableMedia([{ id: 'a', media_url: 'x/dup.jpg' }, { id: 'b', media_url: 'x/dup.jpg' }], new Set());
    expect(r.removablePaths).toEqual(['x/dup.jpg']);
    expect(r.removableIds).toEqual(['a', 'b']);
  });
});

describe('runMediaCleanup — H8 in-use exclusion', () => {
  test('skips a media_url still referenced by a LIVE recurring row (preserves its file)', async () => {
    mockSupa.setResponse('scheduled_messages:select', [
      { id: 'm1', media_url: 'u/shared-recurring.jpg' }, // shared with a live future occurrence
      { id: 'm2', media_url: 'u/one-shot.mp4' },          // safe
    ]);
    mockSupa.setRpcResponse('recurring_media_in_use', [{ media_url: 'u/shared-recurring.jpg' }]);
    const { runMediaCleanup } = await import('../app/api/cron/cleanup-media/route');
    const result = await runMediaCleanup();

    expect(storageCalls).toHaveLength(1);
    expect(storageCalls[0].args[0]).toEqual(['u/one-shot.mp4']); // recurring file NOT removed
    expect(result.removed_storage).toBe(1);
    expect(result.skipped_in_use).toBe(1);
    const upd = findUpdate()!;
    expect(upd.chain.find(c => c.method === 'in' && c.args[0] === 'id')!.args[1]).toEqual(['m2']);
  });

  test('all candidates in use -> no Storage remove, no UPDATE, reports skipped_in_use', async () => {
    mockSupa.setResponse('scheduled_messages:select', [{ id: 'm1', media_url: 'u/a.jpg' }]);
    mockSupa.setRpcResponse('recurring_media_in_use', [{ media_url: 'u/a.jpg' }]);
    const { runMediaCleanup } = await import('../app/api/cron/cleanup-media/route');
    const result = await runMediaCleanup();

    expect(storageCalls).toHaveLength(0);
    expect(findUpdate()).toBeUndefined();
    expect(result.removed_storage).toBe(0);
    expect(result.skipped_in_use).toBe(1);
  });
});
