/**
 * Tests for the Sentry PII scrubber (app/lib/sentry-pii.ts).
 * The scrubber runs inside the Sentry beforeSend hook for all runtimes
 * (server, edge, client) — failures here would leak PII to Sentry, so we
 * cover the canonical WhatsLater shapes: WhatsApp JIDs, E.164 phone, email.
 */
import { scrubString, scrubObject, sentryBeforeSend, scrubBreadcrumbData, sentryBeforeBreadcrumb } from '../app/lib/sentry-pii';

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

describe('gruppi WhatsApp (JID lunghi, formato vecchio, URL-encoded)', () => {
  test('18 cifre + @g.us → [REDACTED_JID]', () => {
    expect(scrubString('send to 120363012345678901@g.us failed')).toBe('send to [REDACTED_JID] failed');
  });

  test('formato con trattino → un solo [REDACTED_JID]', () => {
    const out = scrubString('group 393331234567-1600000000@g.us');
    expect(out).toBe('group [REDACTED_JID]');
    expect(out).not.toMatch(/\d{6}/);
  });

  test('?groupJid=…%40g.us → censurato', () => {
    const out = scrubString('/group/findGroupInfos/inst?groupJid=120363012345678901%40g.us');
    expect(out).toBe('/group/findGroupInfos/inst?groupJid=[REDACTED_JID]');
  });

  test('il caso da 9 cifre resta', () => {
    expect(scrubString('group=123456789@g.us')).toBe('group=[REDACTED_JID]');
  });
});

describe('breadcrumb delle fetch', () => {
  test("data['http.query'] con groupJid= → campo tolto", () => {
    const out = scrubBreadcrumbData({ url: 'http://evo.test/group/findGroupInfos/inst', method: 'GET', status_code: 200, 'http.query': 'groupJid=120363012345678901%40g.us' });
    expect(out).not.toHaveProperty('http.query');
    expect(out).toMatchObject({ method: 'GET', status_code: 200 });
  });

  test('le stringhe si ripuliscono dopo la decodifica', () => {
    const out = scrubBreadcrumbData({ url: 'http://evo.test/x?to=393331234567%40s.whatsapp.net', other: '%E0%A4%A' });
    expect(out.url).toBe('http://evo.test/x?to=[REDACTED_JID]');
    expect(out.other).toBe('%E0%A4%A'); // non decodificabile: resta com'è
    expect(JSON.stringify(out)).not.toMatch(/393331234567/);
  });

  test('sentryBeforeBreadcrumb ripulisce messaggio e data e non lancia mai', () => {
    const b = sentryBeforeBreadcrumb({ message: 'GET ?groupJid=120363012345678901%40g.us', data: { 'http.query': 'groupJid%3D120363012345678901%2540g.us', nested: { n: '393331234567' } } });
    expect(b.message).toBe('GET ?groupJid=[REDACTED_JID]');
    expect(b.data).not.toHaveProperty('http.query');
    expect(b.data!.nested).toEqual({ n: '[REDACTED_PHONE]' });
    const weird: any = { get data() { throw new Error('x'); } };
    expect(() => sentryBeforeBreadcrumb(weird)).not.toThrow();
  });
});
