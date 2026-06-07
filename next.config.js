const { withSentryConfig } = require('@sentry/nextjs');
const withPWA = require('@ducanh2912/next-pwa').default({
    dest: 'public',
    disable: process.env.NODE_ENV === 'development',
    cacheOnFrontEndNav: true,
    fallbacks: { document: '/offline' },
    // Exclude /api from the SW runtime cache: API responses are per-user and a
    // shared 'apis' cache would serve one user's data to the next on a shared
    // device. Providing runtimeCaching replaces next-pwa's default set, so the
    // (non-PII) static-asset caching is re-declared here; the /offline document
    // fallback above is independent and still works.
    workboxOptions: {
        runtimeCaching: [
            { urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
            { urlPattern: /\/_next\/(static|image)\/.*/i, handler: 'StaleWhileRevalidate', options: { cacheName: 'next-assets', expiration: { maxEntries: 200, maxAgeSeconds: 2592000 } } },
            { urlPattern: /\.(?:js|css|woff2?|png|jpe?g|svg|gif|webp|ico)$/i, handler: 'StaleWhileRevalidate', options: { cacheName: 'static-assets', expiration: { maxEntries: 200, maxAgeSeconds: 2592000 } } },
        ],
    },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    typescript: {
          ignoreBuildErrors: true,
    },
    images: {
          unoptimized: true,
          // Whitelist WhatsApp's profile picture CDN. ContactAvatar loads
          // these URLs (cached in whatsapp_contacts.profile_pic_url) directly
          // as <img src>. Inert today because of `unoptimized: true`, but
          // documented so future next/image migrations or CSP additions
          // already have it covered.
          remotePatterns: [
              { protocol: 'https', hostname: 'pps.whatsapp.net' },
          ],
    },
    env: {
          SYSTEM_STATUS: process.env.SYSTEM_STATUS || 'active',
    },
    // Baseline security headers. CSP is limited to frame-ancestors (clickjacking)
    // on purpose: a full script/connect CSP needs a tested allowlist (Supabase,
    // Sentry tunnel, pps.whatsapp.net, the inline beforeinstallprompt script) and
    // a wrong directive would break prod — left to a dedicated pass.
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
                    { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
                ],
            },
        ];
    },
}

// Compose order: PWA wraps base config (so SW + manifest + offline fallback are
// generated), then Sentry wraps the result for source-map upload + tunnel route.
// Both are passthroughs when their respective env (NODE_ENV / SENTRY_AUTH_TOKEN)
// is unset, so local dev stays clean.
module.exports = withSentryConfig(withPWA(nextConfig), {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.CI,
    // Upload source maps for ALL client bundles (incl. shared chunks like
    // _next/static/chunks/NNN-*.js), not just page/route entrypoints. Without
    // this, client-side errors (e.g. unhandledrejection on /) stayed MINIFIED
    // in Sentry even though server source maps uploaded fine.
    widenClientFileUpload: true,
    // Strip emitted .map files from the deployed output after upload so they
    // are never served publicly or precached by the PWA service worker.
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    // Avoid ad-blocker drops by tunneling client SDK ingest through our own
    // domain. Disable by removing this line if you'd rather hit Sentry direct.
    tunnelRoute: '/monitoring',
})
