/**
 * Unit test for evolutionClient.findContacts.
 * Mocks global fetch; verifies request shape and response handling.
 */

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
});

describe('evolutionClient.findContacts', () => {
  test('POSTs to /chat/findContacts/{instance} with empty where filter and apikey header', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => [],
    });
    (global as any).fetch = mockFetch;

    jest.resetModules();
    const { evolutionClient } = await import('../lib/evolution/client');
    await evolutionClient.findContacts('SchedWhats-123');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://evo.test/chat/findContacts/SchedWhats-123');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ where: {} });
    expect(opts.headers.apikey).toBe('evo-key');
  });

  test('returns parsed array on 200', async () => {
    const sample = [
      { remoteJid: '393331234567@s.whatsapp.net', pushName: 'Mario', name: 'Mario Rossi' },
      { remoteJid: '393339998877@s.whatsapp.net', pushName: 'Anna', name: null },
    ];
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => sample,
    });

    jest.resetModules();
    const { evolutionClient } = await import('../lib/evolution/client');
    const result = await evolutionClient.findContacts('SchedWhats-123');

    expect(result).toEqual(sample);
  });

  test('throws on non-2xx', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Error',
    });

    jest.resetModules();
    const { evolutionClient } = await import('../lib/evolution/client');
    await expect(evolutionClient.findContacts('SchedWhats-123')).rejects.toThrow(/500/);
  });
});
