import { computeTypingDelay, sendTypingPresence } from '../app/lib/typing-presence';

describe('computeTypingDelay', () => {
  test('returns 0 for empty / non-positive length', () => {
    expect(computeTypingDelay(0)).toBe(0);
    expect(computeTypingDelay(-5)).toBe(0);
    expect(computeTypingDelay(NaN)).toBe(0);
  });

  test('linear 50ms/char for short messages', () => {
    expect(computeTypingDelay(10)).toBe(500);
    expect(computeTypingDelay(30)).toBe(1500);
  });

  test('caps at 4000ms for long messages', () => {
    expect(computeTypingDelay(80)).toBe(4000);
    expect(computeTypingDelay(200)).toBe(4000);
    expect(computeTypingDelay(3500)).toBe(4000);
  });

  test('rounds non-integer lengths down', () => {
    expect(computeTypingDelay(10.9)).toBe(500);
  });
});

describe('sendTypingPresence', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  test('returns ok=true and skips network when typingMs=0', async () => {
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    const res = await sendTypingPresence({
      evoUrl: 'https://evo.test', evoKey: 'k', instanceName: 'inst', recipientJid: '393401234567', typingMs: 0,
    });
    expect(res.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('calls Evolution sendPresence with correct payload', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    (global as any).fetch = fetchMock;

    const res = await sendTypingPresence({
      evoUrl: 'https://evo.test',
      evoKey: 'evo-key',
      instanceName: 'SchedWhats-393501234567',
      recipientJid: '393401234567',
      typingMs: 1500,
    });

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://evo.test/chat/sendPresence/SchedWhats-393501234567');
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).apikey).toBe('evo-key');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({
      number: '393401234567',
      presence: 'composing',
      delay: 1500,
    });
  });

  test('returns ok=false on 5xx without throwing (graceful fallback)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });
    (global as any).fetch = fetchMock;

    const res = await sendTypingPresence({
      evoUrl: 'https://evo.test', evoKey: 'k', instanceName: 'inst', recipientJid: '393401234567', typingMs: 1500,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });

  test('returns ok=false on network error without throwing', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network refused'));
    (global as any).fetch = fetchMock;

    const res = await sendTypingPresence({
      evoUrl: 'https://evo.test', evoKey: 'k', instanceName: 'inst', recipientJid: '393401234567', typingMs: 1500,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBeUndefined();
  });
});
