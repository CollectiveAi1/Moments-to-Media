import path from 'node:path';
import type { NextConfig } from 'next';
import { SECURITY_HEADERS } from './lib/security-headers';

// The workspace root, not this app: the design tokens come from
// packages/shared and the logos from assets/brand, both outside apps/admin.
const repoRoot = path.join(import.meta.dirname, '..', '..');

const config: NextConfig = {
  transpilePackages: ['@mtm/shared'],
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default config;
