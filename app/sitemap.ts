import type { MetadataRoute } from 'next';
import { GUIDE_PAGES, siteUrl } from './lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const guides = GUIDE_PAGES.map((g) => ({
    url: `${base}${g.path}`,
    lastModified: new Date(g.updated),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));
  return [
    { url: base, lastModified: new Date('2026-09-15'), changeFrequency: 'weekly' as const, priority: 1 },
    ...guides,
    { url: `${base}/privacy`, lastModified: new Date('2026-09-21'), changeFrequency: 'yearly' as const, priority: 0.2 },
    { url: `${base}/terms`, lastModified: new Date('2026-09-21'), changeFrequency: 'yearly' as const, priority: 0.2 },
    { url: `${base}/cookie`, lastModified: new Date('2026-05-31'), changeFrequency: 'yearly' as const, priority: 0.1 },
  ];
}
