/**
 * Calendar sync — Google API client (app/lib/google-calendar.ts) con fetch
 * mockata: authorization-code exchange (+ userinfo best-effort), refresh del
 * token, listing eventi con paginazione (max 2 pagine), errori tipizzati
 * GoogleApiError con status HTTP, cache:'no-store' su ogni chiamata.
 */
import {
  exchangeAuthCode,
  refreshAccessToken,
  listUpcomingEvents,
  GoogleApiError,
} from '../app/lib/google-calendar';

const jsonRes = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

let fetchMock: jest.Mock;
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    GOOGLE_CALENDAR_CLIENT_ID: 'client-id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'client-secret',
  };
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('exchangeAuthCode', () => {
  test('scambia il code e recupera l\'email via userinfo', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ access_token: 'at-1', refresh_token: 'rt-1' }))
      .mockResolvedValueOnce(jsonRes({ email: 'user@gmail.com' }));

    const r = await exchangeAuthCode({ code: 'the-code', redirectUri: 'https://app/cb' });
    expect(r).toEqual({ refresh_token: 'rt-1', access_token: 'at-1', email: 'user@gmail.com' });

    const [tokenUrl, tokenOpts] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    expect(tokenOpts.method).toBe('POST');
    expect(tokenOpts.cache).toBe('no-store');
    expect(tokenOpts.signal).toBeDefined();
    const body = String(tokenOpts.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=the-code');
    expect(body).toContain('client_id=client-id');
    expect(body).toContain('redirect_uri=' + encodeURIComponent('https://app/cb'));

    const [uiUrl, uiOpts] = fetchMock.mock.calls[1];
    expect(uiUrl).toBe('https://www.googleapis.com/oauth2/v2/userinfo');
    expect(uiOpts.headers.authorization).toBe('Bearer at-1');
  });

  test('userinfo fallita (throw o !ok) → best-effort, email undefined', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ access_token: 'at-1', refresh_token: 'rt-1' }))
      .mockRejectedValueOnce(new Error('network'));
    const r1 = await exchangeAuthCode({ code: 'c', redirectUri: 'https://app/cb' });
    expect(r1.email).toBeUndefined();
    expect(r1.refresh_token).toBe('rt-1');

    fetchMock
      .mockResolvedValueOnce(jsonRes({ access_token: 'at-2', refresh_token: 'rt-2' }))
      .mockResolvedValueOnce(jsonRes({ error: 'nope' }, 401));
    const r2 = await exchangeAuthCode({ code: 'c', redirectUri: 'https://app/cb' });
    expect(r2.email).toBeUndefined();
  });

  test('risposta senza refresh_token → GoogleApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ access_token: 'at-only' }));
    await expect(exchangeAuthCode({ code: 'c', redirectUri: 'u' })).rejects.toThrow(GoogleApiError);
  });

  test('HTTP 400 → GoogleApiError con status', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'invalid_grant' }, 400));
    await expect(exchangeAuthCode({ code: 'c', redirectUri: 'u' })).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: 400,
    });
  });

  test('env credenziali mancanti → throw PRIMA di qualsiasi fetch', async () => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    await expect(exchangeAuthCode({ code: 'c', redirectUri: 'u' })).rejects.toThrow(
      /GOOGLE_CALENDAR_CLIENT_ID/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('refreshAccessToken', () => {
  test('ritorna il nuovo access_token', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ access_token: 'fresh-at' }));
    await expect(refreshAccessToken('rt-1')).resolves.toBe('fresh-at');
    const [, opts] = fetchMock.mock.calls[0];
    const body = String(opts.body);
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=rt-1');
    expect(opts.cache).toBe('no-store');
  });

  test('401 (revoca) → GoogleApiError status 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'invalid_grant' }, 401));
    await expect(refreshAccessToken('rt-dead')).rejects.toMatchObject({ status: 401 });
  });

  test('200 senza access_token → GoogleApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({}));
    await expect(refreshAccessToken('rt-1')).rejects.toThrow(GoogleApiError);
  });
});

describe('listUpcomingEvents', () => {
  const baseArgs = {
    accessToken: 'at-1',
    calendarId: 'primary',
    timeMin: '2026-09-01T10:00:00.000Z',
    timeMax: '2026-09-15T10:00:00.000Z',
  };

  test('pagina singola: parametri corretti + items', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ items: [{ id: 'a' }, { id: 'b' }] }));
    const events = await listUpcomingEvents(baseArgs);
    expect(events.map((e) => e.id)).toEqual(['a', 'b']);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('https://www.googleapis.com/calendar/v3/calendars/primary/events?');
    expect(url).toContain('singleEvents=true');
    expect(url).toContain('orderBy=startTime');
    expect(url).toContain('maxResults=250');
    expect(url).toContain('timeMin=' + encodeURIComponent(baseArgs.timeMin));
    expect(url).toContain('timeMax=' + encodeURIComponent(baseArgs.timeMax));
    expect(opts.headers.authorization).toBe('Bearer at-1');
    expect(opts.cache).toBe('no-store');
    expect(opts.signal).toBeDefined();
  });

  test('calendarId con @ → URL-encoded', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ items: [] }));
    await listUpcomingEvents({ ...baseArgs, calendarId: 'foo@group.calendar.google.com' });
    expect(fetchMock.mock.calls[0][0]).toContain('/calendars/foo%40group.calendar.google.com/events');
  });

  test('Date accettate per timeMin/timeMax', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ items: [] }));
    await listUpcomingEvents({
      ...baseArgs,
      timeMin: new Date('2026-09-01T10:00:00Z'),
      timeMax: new Date('2026-09-15T10:00:00Z'),
    });
    expect(fetchMock.mock.calls[0][0]).toContain(
      'timeMin=' + encodeURIComponent('2026-09-01T10:00:00.000Z')
    );
  });

  test('paginazione: segue nextPageToken ma si ferma a 2 pagine', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ items: [{ id: 'p1' }], nextPageToken: 'tok2' }))
      .mockResolvedValueOnce(jsonRes({ items: [{ id: 'p2' }], nextPageToken: 'tok3' }));
    const events = await listUpcomingEvents(baseArgs);
    expect(events.map((e) => e.id)).toEqual(['p1', 'p2']);
    expect(fetchMock).toHaveBeenCalledTimes(2); // tok3 mai seguito
    expect(fetchMock.mock.calls[1][0]).toContain('pageToken=tok2');
  });

  test('HTTP 403 → GoogleApiError con status', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'forbidden' }, 403));
    await expect(listUpcomingEvents(baseArgs)).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: 403,
    });
  });

  test('items assenti → array vuoto', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({}));
    await expect(listUpcomingEvents(baseArgs)).resolves.toEqual([]);
  });
});
