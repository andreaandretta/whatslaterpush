/**
 * Shared mock infrastructure for integration tests.
 * Mocks Supabase client and global fetch.
 */

// Chainable Supabase mock that tracks all operations
export interface MockSupabaseCall {
  table: string;
  operation: string;
  args: any[];
  chain: { method: string; args: any[] }[];
}

export function createMockSupabase() {
  const calls: MockSupabaseCall[] = [];
  const responseMap = new Map<string, any>();

  function setResponse(key: string, data: any, error: any = null, extra: Record<string, any> = {}) {
    responseMap.set(key, { data, error, ...extra });
  }

  function makeChain(table: string, operation: string, args: any[]) {
    const call: MockSupabaseCall = { table, operation, args, chain: [] };
    calls.push(call);

    const defaultResponse = { data: null, error: null };

    const chain: any = {};
    const chainMethods = ['select', 'eq', 'neq', 'in', 'not', 'ilike', 'lt', 'lte', 'gte', 'gt', 'order', 'limit', 'filter', 'is'];

    const originalResponse = () => {
      const key = `${table}:${operation}`;
      return responseMap.get(key) || defaultResponse;
    };

    // Create proxy first so chain methods can return it
    const proxy: any = new Proxy(chain, {
      get(target, prop) {
        if (prop === 'then') {
          return (resolve: any) => resolve(originalResponse());
        }
        return target[prop];
      }
    });

    for (const method of chainMethods) {
      chain[method] = (...a: any[]) => {
        call.chain.push({ method, args: a });
        return proxy; // Return proxy so .then always works
      };
    }

    chain.maybeSingle = () => {
      call.chain.push({ method: 'maybeSingle', args: [] });
      // If the mock data is an array, return the first element (simulates real Supabase maybeSingle behavior)
      const resp = originalResponse();
      if (Array.isArray(resp.data)) {
        return Promise.resolve({ ...resp, data: resp.data[0] ?? null });
      }
      return Promise.resolve(resp);
    };

    chain.single = chain.maybeSingle;

    // Override select on update/delete to return response
    if (operation === 'update' || operation === 'delete' || operation === 'insert' || operation === 'upsert') {
      chain.select = (...a: any[]) => {
        call.chain.push({ method: 'select', args: a });
        return proxy;
      };
    }

    return proxy;
  }

  const client = {
    from: (table: string) => ({
      select: (...args: any[]) => makeChain(table, 'select', args),
      insert: (...args: any[]) => makeChain(table, 'insert', args),
      update: (...args: any[]) => makeChain(table, 'update', args),
      delete: () => makeChain(table, 'delete', []),
      upsert: (...args: any[]) => makeChain(table, 'upsert', args),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  };

  return { client, calls, setResponse };
}

// Fetch mock helper
export interface FetchCall {
  url: string;
  options: RequestInit;
}

export function createFetchMock() {
  const calls: FetchCall[] = [];
  const handlers = new Map<string | RegExp, (url: string, opts: RequestInit) => any>();

  function setHandler(urlPattern: string | RegExp, handler: (url: string, opts: RequestInit) => any) {
    handlers.set(urlPattern, handler);
  }

  function setJsonResponse(urlPattern: string | RegExp, body: any, status = 200) {
    handlers.set(urlPattern, () => ({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
      headers: new Headers(),
    }));
  }

  const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const opts = init || {};
    calls.push({ url: urlStr, options: opts });

    for (const [pattern, handler] of handlers) {
      const matches = pattern instanceof RegExp ? pattern.test(urlStr) : urlStr.includes(pattern);
      if (matches) {
        return handler(urlStr, opts);
      }
    }

    // Default: return ok response
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve('ok'),
      headers: new Headers(),
    };
  };

  return { mockFetch, calls, setHandler, setJsonResponse };
}

// Helper to create a mock NextRequest-like object
export function mockRequest(body: any, headers: Record<string, string> = {}) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    json: () => Promise.resolve(body),
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) || null,
    },
    url: 'https://whatslaterpush.vercel.app/api/webhook',
  };
}

// Evolution API webhook payload builders
export function makeMessagePayload(opts: {
  instance: string;
  fromMe?: boolean;
  remoteJid?: string;
  msgId?: string;
  text?: string;
  contactMessage?: any;
}) {
  return {
    event: 'MESSAGES_UPSERT',
    instance: opts.instance,
    data: {
      key: {
        remoteJid: opts.remoteJid || '393401234567@s.whatsapp.net',
        fromMe: opts.fromMe ?? true,
        id: opts.msgId || 'msg-' + Date.now(),
      },
      message: opts.contactMessage
        ? { contactMessage: opts.contactMessage }
        : { conversation: opts.text || '' },
    },
  };
}

export function makeConnectionPayload(opts: { instance: string; state: string; ownerJid?: string } | string, state?: string) {
  // Support both new object form and legacy positional args
  if (typeof opts === 'string') {
    return {
      event: 'connection.update',
      instance: opts,
      data: { state: state || '' },
    };
  }
  return {
    event: 'connection.update',
    instance: opts.instance,
    data: {
      state: opts.state,
      ...(opts.ownerJid ? { ownerJid: opts.ownerJid } : {}),
    },
  };
}

export function setAuthCookieEnv() {
  process.env.AUTH_COOKIE_SECRET = '0'.repeat(128); // deterministic for tests
}

export function makeRequestWithCookie(body: any, cookieValue: string, headers: Record<string, string> = {}) {
  return mockRequest(body, {
    ...headers,
    cookie: `sw_session=${cookieValue}`,
  });
}
