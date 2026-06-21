import { mapErrorReason } from '../app/lib/message-error';

describe('mapErrorReason', () => {
  describe('disconnected (→ "Ricollega")', () => {
    test.each([
      'HTTP 401: unauthorized',
      'HTTP 403: Forbidden',
      'HTTP 404: instance not found',
      'Connection Closed',
      'Connection Terminated by server',
      'Stream Errored (conflict): logged out',
      'logout',
      'session expired, please reconnect',
      'Istanza disconnessa, retry 3/12 fra 5 min',
    ])('%s → disconnected', (raw) => {
      const r = mapErrorReason(raw);
      expect(r.kind).toBe('disconnected');
      expect(r.label).toBe('WhatsApp disconnesso — ricollega');
    });
  });

  describe('invalid_number (→ "Numero non su WhatsApp")', () => {
    test.each([
      'HTTP 400: {"status":400,"message":"number does not exist"}',
      'HTTP 400: Bad Request',
      'recipient not on whatsapp',
      '{"exists":false}',
      'invalid jid for recipient',
    ])('%s → invalid_number', (raw) => {
      expect(mapErrorReason(raw).kind).toBe('invalid_number');
    });
  });

  describe('rate_limited (→ "Troppi invii")', () => {
    test.each([
      'HTTP 429: Too Many Requests',
      'rate-limit exceeded',
      'rate_limit hit',
    ])('%s → rate_limited', (raw) => {
      expect(mapErrorReason(raw).kind).toBe('rate_limited');
    });
  });

  describe('generic fallback (raw code never leaks)', () => {
    test.each([
      'HTTP 500: internal server error',
      'Failed to sign media URL',
      'fetch failed',
      'Unknown error',
      '',
      undefined,
      null,
    ])('%s → generic', (raw) => {
      const r = mapErrorReason(raw as string | null | undefined);
      expect(r.kind).toBe('generic');
      expect(r.label).toBe('Invio non riuscito — riprova');
    });
  });

  test('a disconnected session inside a 4xx body wins over the 400 → number heuristic', () => {
    // Evolution can return HTTP 400 whose body says the socket is closed.
    // Reconnect is the fix, not "the number is wrong".
    expect(mapErrorReason('HTTP 400: Connection Closed').kind).toBe('disconnected');
  });
});
