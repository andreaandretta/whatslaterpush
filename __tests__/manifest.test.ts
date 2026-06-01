import manifest from '../public/manifest.json';

describe('public/manifest.json — PWA manifest shape', () => {
  test('name + short_name + lang sono coerenti con brand', () => {
    expect(manifest.name).toBe('WhatsLater');
    expect(manifest.short_name).toBe('WhatsLater');
    expect(manifest.lang).toBe('it');
  });

  test('start_url punta a /dashboard (entry post-install)', () => {
    expect(manifest.start_url).toBe('/dashboard');
    expect(manifest.scope).toBe('/');
  });

  test('display standalone + orientation portrait + colori brand', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');
    // WhatsApp dark bg + teal accent — vedi sprint5/PWA-SPEC-FINAL.html.
    expect(manifest.background_color).toBe('#111B21');
    expect(manifest.theme_color).toBe('#075E54');
  });

  test('icons: 192 + 512 + maskable-512 obbligatori per installabilità', () => {
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    const findIcon = (sizes: string, purpose?: string) =>
      manifest.icons.find(
        (i: { sizes: string; purpose?: string }) =>
          i.sizes === sizes && (purpose ? i.purpose === purpose : !i.purpose)
      );

    expect(findIcon('192x192')).toMatchObject({
      src: '/icons/icon-192.png',
      type: 'image/png',
    });
    expect(findIcon('512x512')).toMatchObject({
      src: '/icons/icon-512.png',
      type: 'image/png',
    });
    expect(findIcon('512x512', 'maskable')).toMatchObject({
      src: '/icons/maskable-512.png',
      type: 'image/png',
      purpose: 'maskable',
    });
  });
});
