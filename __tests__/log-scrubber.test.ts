/**
 * Unit tests for the webhook dbLog PII scrubber.
 */
import { scrubPiiForLog } from '../app/lib/log-scrubber';

describe('scrubPiiForLog', () => {
  test('redacts body-shaped fields to a length tag instead of the cleartext', () => {
    const out = scrubPiiForLog({
      text: 'di a Marco di portare il pallone domani alle 8',
      provider: 'groq',
    });
    expect(out.text).toBe('[REDACTED_BODY:46chars]');
    // Non-PII field passes through untouched.
    expect(out.provider).toBe('groq');
  });

  test('hashes phone-shaped fields (sender) to the h:xxxxxxxx token', () => {
    const out = scrubPiiForLog({
      sender: '393331234567',
      tag: 'MSG_RECEIVED',
    });
    expect(out.sender).toMatch(/^h:[0-9a-f]{8}$/);
    expect(out.tag).toBe('MSG_RECEIVED');
  });

  test('hashes phone-shaped fields (phone) and name-shaped fields (recipient_name)', () => {
    const out = scrubPiiForLog({
      phone: '393401234567',
      recipient_name: 'Suocera',
    });
    expect(out.phone).toMatch(/^h:[0-9a-f]{8}$/);
    expect(out.recipient_name).toMatch(/^h:[0-9a-f]{8}$/);
    expect(out.phone).not.toBe(out.recipient_name);
  });

  test('passes empty/non-PII payloads through unchanged', () => {
    expect(scrubPiiForLog({})).toEqual({});
    const passthrough = scrubPiiForLog({ provider: 'openai', status: 500, ok: false });
    expect(passthrough).toEqual({ provider: 'openai', status: 500, ok: false });
  });

  test('is deterministic — same input produces identical scrubbed output', () => {
    const payload = { sender: '393331234567', text: 'hello world' };
    const a = scrubPiiForLog(payload);
    const b = scrubPiiForLog(payload);
    expect(a).toEqual(b);
  });
});
