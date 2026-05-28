/**
 * Tests for the Sentry PII scrubber (app/lib/sentry-pii.ts).
 * The scrubber runs inside the Sentry beforeSend hook for all runtimes
 * (server, edge, client) — failures here would leak PII to Sentry, so we
 * cover the canonical WhatsLater shapes: WhatsApp JIDs, E.164 phone, email.
 */
import { scrubString, scrubObject, sentryBeforeSend } from '../app/lib/sentry-pii';

describe('scrubString', () => {
  test('redacts WhatsApp JIDs (s.whatsapp.net, g.us, newsletter)', () => {
    expect(scrubString('Failed to deliver to 393331234567@s.whatsapp.net'))
      .toBe('Failed to deliver to [REDACTED_JID]');
    expect(scrubString('group=123456789@g.us')).toBe('group=[REDACTED_JID]');
    expect(scrubString('newsletter 999888777@newsletter')).toBe('newsletter [REDACTED_JID]');
  });

  test('redacts E.164 phone numbers (with and without + prefix)', () => {
    expect(scrubString('User +393331234567 hit rate limit'))
      .toBe('User [REDACTED_PHONE] hit rate limit');
    expect(scrubString('phone=393331234567')).toBe('phone=[REDACTED_PHONE]');
  });

  test('redacts email addresses', () => {
    expect(scrubString('Notify mario.rossi+stripe@gmail.com immediately'))
      .toBe('Notify [REDACTED_EMAIL] immediately');
  });

  test('redacts a mix of all three in the same string', () => {
    const input = 'User 393331234567 (mario@example.com) JID 393331234567@s.whatsapp.net failed';
    const out = scrubString(input);
    expect(out).not.toMatch(/393331234567/);
    expect(out).not.toMatch(/mario@example\.com/);
    expect(out).toContain('[REDACTED_PHONE]');
    expect(out).toContain('[REDACTED_EMAIL]');
    expect(out).toContain('[REDACTED_JID]');
  });

  test('leaves short numerics + IDs alone (no false positives on small numbers)', () => {
    expect(scrubString('status=200 attempt=3 msg_id=abc-123')).toBe('status=200 attempt=3 msg_id=abc-123');
  });
});

describe('scrubObject', () => {
  test('recursively scrubs strings inside nested event-like objects', () => {
    const event = {
      message: 'Send failed for 393331234567@s.whatsapp.net',
      exception: {
        values: [
          { type: 'Error', value: 'Phone 393401234567 unreachable' },
        ],
      },
      extra: {
        user_email: 'op@example.com',
        nested: { phones: ['393331234567', '+393409876543'] },
      },
      tags: { status_code: 500 },
    };
    const out = scrubObject(event) as typeof event;
    expect(out.message).toBe('Send failed for [REDACTED_JID]');
    expect(out.exception.values[0].value).toBe('Phone [REDACTED_PHONE] unreachable');
    expect(out.extra.user_email).toBe('[REDACTED_EMAIL]');
    expect(out.extra.nested.phones).toEqual(['[REDACTED_PHONE]', '[REDACTED_PHONE]']);
    expect(out.tags.status_code).toBe(500); // numeric untouched
  });

  test('returns event unmodified when no PII present', () => {
    const event = { message: 'CPU usage 92%', tags: { region: 'eu-central-1' } };
    expect(scrubObject(event)).toEqual(event);
  });
});

describe('sentryBeforeSend', () => {
  test('never throws — returns event unmodified on internal failure', () => {
    // Pathological input with circular reference — recursion depth cap kicks
    // in but the wrapper must still return something usable.
    const ev: any = { message: 'leak 393331234567@s.whatsapp.net' };
    ev.self = ev;
    const out = sentryBeforeSend(ev);
    expect(out).toBeDefined();
    expect(out.message).toBe('leak [REDACTED_JID]');
  });
});
