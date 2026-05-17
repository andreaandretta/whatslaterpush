/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    typescript: {
          ignoreBuildErrors: true,
    },
    serverExternalPackages: ['vcf'],
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
}

module.exports = nextConfig
