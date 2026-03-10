/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    typescript: {
          ignoreBuildErrors: true,
    },
    serverExternalPackages: ['vcf'],
    images: {
          unoptimized: true,
    },
    env: {
          SYSTEM_STATUS: process.env.SYSTEM_STATUS || 'active',
    },
}

module.exports = nextConfig
