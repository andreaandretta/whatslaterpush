/**
 * sentry.server.config.ts / sentry.edge.config.ts: beforeBreadcrumb è quello
 * condiviso di app/lib/sentry-pii.ts (decodifica + scrub, query di
 * findGroupInfos tolta). JID finti.
 */
export {}; // modulo, non script: ORIGINAL_ENV non si scontra con altri file di test

const initMock = jest.fn();
jest.mock('@sentry/nextjs', () => ({ init: initMock }));

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  initMock.mockReset();
  jest.resetModules();
  jest.mock('@sentry/nextjs', () => ({ init: initMock }));
  process.env = { ...ORIGINAL_ENV, SENTRY_DSN: 'https://public@sentry.example/1' };
});
afterEach(() => { process.env = ORIGINAL_ENV; });

describe.each([['server', '../sentry.server.config'], ['edge', '../sentry.edge.config']])('sentry.%s.config', (_name, path) => {
  test('usa sentryBeforeBreadcrumb', async () => {
    await import(path);
    const { sentryBeforeBreadcrumb } = await import('../app/lib/sentry-pii');
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0].beforeBreadcrumb).toBe(sentryBeforeBreadcrumb);
  });

  test('la query di findGroupInfos non arriva a Sentry, nemmeno URL-encoded', async () => {
    await import(path);
    const hook = initMock.mock.calls[0][0].beforeBreadcrumb;
    const out = hook({
      category: 'fetch',
      data: {
        url: 'http://evo.test/group/findGroupInfos/SchedWhats-test?groupJid=120363000000000001%40g.us',
        'http.query': 'groupJid=120363000000000001%40g.us',
        status_code: 404,
      },
    });
    const text = JSON.stringify(out);
    expect(out.data).not.toHaveProperty('http.query');
    expect(text).not.toContain('120363000000000001');
    expect(out.data.status_code).toBe(404);
  });

  test('senza SENTRY_DSN non inizializza', async () => {
    delete process.env.SENTRY_DSN;
    await import(path);
    expect(initMock).not.toHaveBeenCalled();
  });
});
