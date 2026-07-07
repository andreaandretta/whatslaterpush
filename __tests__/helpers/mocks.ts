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
    const chainMethods = ['select', 'eq', 'neq', 'in', 'not', 'ilike', 'like', 'or', 'lt', 'lte', 'gte', 'gt', 'order', 'limit', 'filter', 'is'];

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

  const rpcResponseMap = new Map<string, { data: any; error: any }>();
  const rpcHandlerMap = new Map<string, (args: any) => { data: any; error: any } | Promise<{ data: any; error: any }>>();
  function setRpcResponse(name: string, data: any, error: any = null) {
    rpcResponseMap.set(name, { data, error });
  }
  // For tests that need dynamic per-call responses (e.g. simulating atomic
  // Postgres UPSERT to verify concurrent recordSend never loses an increment).
  function setRpcHandler(name: string, handler: (args: any) => { data: any; error: any } | Promise<{ data: any; error: any }>) {
    rpcHandlerMap.set(name, handler);
  }

  // Storage mock: storage.from(bucket).list(prefix) / .remove(paths). Keyed
  // '<bucket>:list' / '<bucket>:remove'; calls tracked as table='storage:<bucket>'.
  const storageResponseMap = new Map<string, { data: any; error: any }>();
  function setStorageResponse(key: string, data: any, error: any = null) {
    storageResponseMap.set(key, { data, error });
  }

  const client = {
    from: (table: string) => ({
      select: (...args: any[]) => makeChain(table, 'select', args),
      insert: (...args: any[]) => makeChain(table, 'insert', args),
      update: (...args: any[]) => makeChain(table, 'update', args),
      delete: () => makeChain(table, 'delete', []),
      upsert: (...args: any[]) => makeChain(table, 'upsert', args),
    }),
    rpc: (name: string, args?: any) => {
      // Track in the same `calls` array so existing assertions still work.
      calls.push({ table: '__rpc__', operation: name, args: [args], chain: [] });
      const handler = rpcHandlerMap.get(name);
      if (handler) return Promise.resolve(handler(args));
      const resp = rpcResponseMap.get(name) || { data: null, error: null };
      return Promise.resolve(resp);
    },
    storage: {
      from: (bucket: string) => ({
        list: (...args: any[]) => {
          calls.push({ table: 'storage:' + bucket, operation: 'list', args, chain: [] });
          return Promise.resolve(storageResponseMap.get(bucket + ':list') || { data: [], error: null });
        },
        remove: (...args: any[]) => {
          calls.push({ table: 'storage:' + bucket, operation: 'remove', args, chain: [] });
          return Promise.resolve(storageResponseMap.get(bucket + ':remove') || { data: [], error: null });
        },
      }),
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  };

  return { client, calls, setResponse, setRpcResponse, setRpcHandler, setStorageResponse };
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
  // Webhook route now reads raw body via req.text() to enable HMAC verification.
  // We provide both .json() and .text() so existing tests that pass parsed bodies
  // continue to work, and signature-aware paths get a deterministic raw string.
  const rawText = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(rawText),
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

// Evolution contact webhook payload builders

export function makeContactsSetPayload(opts: {
  instance: string;
  contacts: Array<{ id?: string; jid?: string; name?: string | null; pushName?: string | null; notify?: string | null; profilePicUrl?: string | null }>;
}) {
  return {
    event: 'CONTACTS_SET',
    instance: opts.instance,
    data: opts.contacts.map(c => ({
      id: c.id || c.jid,
      remoteJid: c.jid || c.id,
      name: c.name ?? null,
      pushName: c.pushName ?? null,
      notify: c.notify ?? null,
      profilePicUrl: c.profilePicUrl ?? null,
    })),
  };
}

export function makeContactsUpsertPayload(opts: {
  instance: string;
  contacts: Array<{ id?: string; jid?: string; name?: string | null; pushName?: string | null; notify?: string | null; profilePicUrl?: string | null }>;
}) {
  return {
    event: 'CONTACTS_UPSERT',
    instance: opts.instance,
    data: opts.contacts.map(c => ({
      id: c.id || c.jid,
      remoteJid: c.jid || c.id,
      name: c.name ?? null,
      pushName: c.pushName ?? null,
      notify: c.notify ?? null,
      profilePicUrl: c.profilePicUrl ?? null,
    })),
  };
}

export function makeContactsUpdatePayload(opts: {
  instance: string;
  contacts: Array<{ id?: string; jid?: string; name?: string | null; pushName?: string | null; profilePicUrl?: string | null }>;
}) {
  return {
    event: 'CONTACTS_UPDATE',
    instance: opts.instance,
    data: opts.contacts.map(c => ({
      id: c.id || c.jid,
      remoteJid: c.jid || c.id,
      name: c.name ?? null,
      pushName: c.pushName ?? null,
      profilePicUrl: c.profilePicUrl ?? null,
    })),
  };
}

export function makeMessagingHistorySetPayload(opts: {
  instance: string;
  contacts?: Array<{ id?: string; jid?: string; name?: string | null; pushName?: string | null; notify?: string | null; profilePicUrl?: string | null }>;
  chats?: Array<{ id?: string; name?: string | null }>;
  messages?: any[];
}) {
  return {
    event: 'MESSAGING_HISTORY_SET',
    instance: opts.instance,
    data: {
      contacts: (opts.contacts || []).map(c => ({
        id: c.id || c.jid,
        remoteJid: c.jid || c.id,
        name: c.name ?? null,
        pushName: c.pushName ?? null,
        notify: c.notify ?? null,
        profilePicUrl: c.profilePicUrl ?? null,
      })),
      chats: opts.chats || [],
      messages: opts.messages || [],
    },
  };
}
