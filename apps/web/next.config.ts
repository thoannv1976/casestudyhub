import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Produces the minimal server bundle the Cloud Run image runs.
  output: 'standalone',
  reactStrictMode: true,
  // Workspace packages ship TypeScript source and are compiled by Next.
  transpilePackages: ['@casestudyhub/shared', '@casestudyhub/core'],
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
