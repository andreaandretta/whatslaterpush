/**
 * Public site surface: canonical URL, sitemap/robots metadata routes, FAQ
 * JSON-LD builder, and the guarantee that every guide page + SEO file is
 * reachable without a session (middleware PUBLIC_PATHS is fed by
 * app/lib/site.ts, so a new guide added there is public by construction).
 */
import fs from 'fs';
import path from 'path';
import { siteUrl, DEFAULT_SITE_URL, GUIDE_PAGES, GUIDE_PATHS, SEO_FILE_PATHS, faqJsonLd, guideByPath } from '../app/lib/site';
import sitemap from '../app/sitemap';
import robots from '../app/robots';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('siteUrl', () => {
  test('falls back to the Vercel URL when NEXT_PUBLIC_APP_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(siteUrl()).toBe(DEFAULT_SITE_URL);
  });

  test('uses NEXT_PUBLIC_APP_URL and strips trailing slashes', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://whatslater.it/';
    expect(siteUrl()).toBe('https://whatslater.it');
  });

  test('ignores a malformed NEXT_PUBLIC_APP_URL (no scheme)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'whatslater.it';
    expect(siteUrl()).toBe(DEFAULT_SITE_URL);
  });
});

describe('guide pages', () => {
  test('every guide has a leading-slash path, title, description and ISO date', () => {
    expect(GUIDE_PAGES.length).toBeGreaterThanOrEqual(2);
    for (const g of GUIDE_PAGES) {
      expect(g.path.startsWith('/')).toBe(true);
      expect(g.title.length).toBeGreaterThan(10);
      expect(g.description.length).toBeGreaterThan(20);
      expect(g.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(GUIDE_PATHS).toEqual(GUIDE_PAGES.map((g) => g.path));
  });
});

describe('guide lookup and internal links', () => {
  test('guideByPath returns the matching page and throws on an unknown path', () => {
    for (const g of GUIDE_PAGES) expect(guideByPath(g.path)).toBe(g);
    expect(() => guideByPath('/non-esiste')).toThrow();
  });

  // 21 set 2026: the calendar guide was retired. Index lookups (GUIDE_PAGES[1])
  // would have handed another page's title/canonical to the wrong route.
  test('no page looks a guide up by array index', () => {
    const appDir = path.join(__dirname, '..', 'app');
    for (const g of GUIDE_PATHS) {
      const src = fs.readFileSync(path.join(appDir, g.slice(1), 'page.tsx'), 'utf8');
      expect(src.includes('GUIDE_PAGES[')).toBe(false);
      expect(src.includes(`guideByPath('${g}')`)).toBe(true);
    }
  });

  test('every guide route has a page file, and the retired calendar guide is linked from nowhere', () => {
    const root = path.join(__dirname, '..');
    for (const g of GUIDE_PATHS) expect(fs.existsSync(path.join(root, 'app', g.slice(1), 'page.tsx'))).toBe(true);
    const retired = '/promemoria-appuntamenti-whatsapp-google-calendar';
    const files = [
      'app/components/Footer.tsx',
      'app/layout.tsx',
      'public/llms.txt',
      ...GUIDE_PATHS.map((g) => `app/${g.slice(1)}/page.tsx`),
    ];
    for (const f of files) expect(fs.readFileSync(path.join(root, f), 'utf8').includes(retired)).toBe(false);
  });
});

describe('canonical', () => {
  // '/' nel root layout veniva ereditato da /privacy, /terms, /cookie: dichiaravano
  // la home come canonical. './' rende ogni pagina canonical di sé stessa.
  test('the root layout uses a self-referencing canonical', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');
    expect(src.includes("canonical: './'")).toBe(true);
    expect(src.includes("canonical: '/'")).toBe(false);
  });
});

describe('sitemap + robots', () => {
  test('sitemap lists home, every guide and the legal pages on the canonical origin', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://whatslater.it';
    const urls = sitemap().map((e) => e.url);
    expect(urls[0]).toBe('https://whatslater.it');
    for (const p of GUIDE_PATHS) expect(urls).toContain(`https://whatslater.it${p}`);
    for (const p of ['/privacy', '/terms', '/cookie']) expect(urls).toContain(`https://whatslater.it${p}`);
    expect(urls.some((u) => u.includes('/dashboard'))).toBe(false);
  });

  test('robots allows the site, hides app/admin/api, and points at the sitemap', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://whatslater.it';
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules.allow).toBe('/');
    expect(rules.disallow).toEqual(expect.arrayContaining(['/dashboard', '/admin', '/api/']));
    expect(r.sitemap).toBe('https://whatslater.it/sitemap.xml');
  });
});

describe('faqJsonLd', () => {
  test('builds a schema.org FAQPage with one Question per item', () => {
    const ld = faqJsonLd([
      { q: 'Domanda 1?', a: 'Risposta 1.' },
      { q: 'Domanda 2?', a: 'Risposta 2.' },
    ]) as any;
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity).toHaveLength(2);
    expect(ld.mainEntity[1]).toEqual({
      '@type': 'Question',
      name: 'Domanda 2?',
      acceptedAnswer: { '@type': 'Answer', text: 'Risposta 2.' },
    });
  });
});

describe('middleware: guides and SEO files are public', () => {
  function makeReq(pathname: string) {
    const url = `http://localhost${pathname}`;
    const req: any = new Request(url, { method: 'GET' });
    req.cookies = { get: () => undefined };
    const parsed = new URL(url);
    req.nextUrl = { pathname: parsed.pathname, search: '', clone: () => new URL(parsed.toString()) as any };
    return req;
  }

  test.each([...GUIDE_PATHS, ...SEO_FILE_PATHS])('%s passes through without a session', async (p) => {
    jest.resetModules();
    process.env.AUTH_COOKIE_SECRET = '0'.repeat(128);
    const { middleware } = await import('../middleware');
    const res = await middleware(makeReq(p));
    // NextResponse.next() → 200 with the x-middleware-next marker, never a
    // 401 JSON or a redirect to "/".
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
