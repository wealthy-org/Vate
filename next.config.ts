import type { NextConfig } from 'next';

// Headers that never vary per request. The Content-Security-Policy (per-request nonce) and
// Strict-Transport-Security (HTTPS responses only) are set in src/proxy.ts.
const staticSecurityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a second build (e.g. the end-to-end test build) live next to the main one.
  distDir: process.env.VATE_DIST_DIR || '.next',
  poweredByHeader: false,
  // Hosts besides localhost that may use the dev server. Without an entry here `next dev` serves
  // the page but refuses its own scripts' live connection, so the page never becomes interactive.
  // 127.0.0.1 is this machine; VATE_DEV_ORIGINS adds others (a tunnel, a sandbox preview, a phone
  // on the LAN). Has no effect on production builds.
  allowedDevOrigins: ['127.0.0.1', ...(process.env.VATE_DEV_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)],
  async headers() {
    return [
      { source: '/:path*', headers: staticSecurityHeaders },
      {
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }],
      },
    ];
  },
};

export default nextConfig;
