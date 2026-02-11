/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['vcf'],
  },
  images: {
    unoptimized: true,
  },
  env: {
    SYSTEM_STATUS: process.env.SYSTEM_STATUS || 'active',
  },
}

module.exports = nextConfig
