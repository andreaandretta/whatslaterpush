// Single source of truth for the public site surface: canonical base URL,
// the guide pages that must stay reachable without a session, and the
// FAQPage JSON-LD builder used by every guide (answer-engine readability).
//
// Kept dependency-free on purpose: middleware.ts (Edge) imports GUIDE_PATHS.

export const DEFAULT_SITE_URL = 'https://whatslaterpush.vercel.app';

/** Canonical origin, no trailing slash. Falls back to the Vercel URL. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = raw && /^https?:\/\//i.test(raw) ? raw : DEFAULT_SITE_URL;
  return base.replace(/\/+$/, '');
}

export interface GuidePage {
  path: string;
  title: string;
  description: string;
  updated: string; // ISO date, shown on the page and used in the sitemap
}

export const GUIDE_PAGES: GuidePage[] = [
  {
    path: '/come-programmare-messaggi-whatsapp',
    title: 'Come programmare messaggi WhatsApp su iPhone, Android e Business (anche ricorrenti)',
    description:
      'Le strade che esistono oggi per programmare un messaggio WhatsApp, i limiti di ciascuna, e come mandare promemoria ricorrenti dal tuo numero.',
    updated: '2026-09-15',
  },
  {
    path: '/come-proteggiamo-il-tuo-numero',
    title: 'Come funziona, cosa può rompersi, come proteggiamo il tuo numero',
    description:
      'Le regole che WhatsLater applica da solo per tenere il tuo numero WhatsApp lontano dai blocchi, cosa non facciamo mai, e cosa significa davvero "inviato".',
    updated: '2026-09-15',
  },
];

export const GUIDE_PATHS: string[] = GUIDE_PAGES.map((g) => g.path);

/**
 * Lookup by path, never by array index: removing or reordering a guide must
 * not silently hand another page's title/canonical to a different route
 * (21 set 2026: the calendar guide was retired and index lookups would have
 * shifted every page by one).
 */
export function guideByPath(path: string): GuidePage {
  const g = GUIDE_PAGES.find((x) => x.path === path);
  if (!g) throw new Error(`Unknown guide path: ${path}`);
  return g;
}

/** Static SEO files served by app/sitemap.ts, app/robots.ts and public/llms.txt. */
export const SEO_FILE_PATHS = ['/sitemap.xml', '/robots.txt', '/llms.txt'];

export interface FaqItem {
  q: string;
  a: string;
}

/** schema.org FAQPage payload. Plain object so callers can JSON.stringify it. */
export function faqJsonLd(items: FaqItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
  };
}
