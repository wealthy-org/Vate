// Content-Security-Policy with a per-request nonce. Everything the browser may talk to is
// listed explicitly: this app's own origin, the chain RPC endpoints and (mainnet only) the two
// read-only data APIs. No analytics, no third-party scripts, no remote fonts.
import { NextResponse, type NextRequest } from 'next/server';
import { NETWORK } from '@/config/networks';

const isDev = process.env.NODE_ENV !== 'production';

function origins(urls: readonly string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    try {
      out.add(new URL(u).origin);
    } catch {
      /* ignored: not a URL */
    }
  }
  return [...out];
}

/** `'none'` unless the operator explicitly allows embedding (e.g. a preview iframe). */
function frameAncestors(): string {
  const raw = (process.env.VATE_FRAME_ANCESTORS ?? '').trim();
  if (!raw) return "'none'";
  const parts = raw.split(/[\s,]+/).filter((p) => p === '*' || p === "'self'" || /^https:\/\/[A-Za-z0-9*.-]+(:\d+)?$/.test(p));
  return parts.length ? parts.join(' ') : "'none'";
}

export function buildCsp(nonce: string, secure: boolean): string {
  const connect = ["'self'", ...origins(NETWORK.rpcUrls), ...origins(NETWORK.dataHosts)];
  if (isDev) connect.push('ws:', 'wss:');
  const ancestors = frameAncestors();
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Stylesheets must come from this origin or carry the nonce. Inline style attributes stay
    // allowed: the orbital motion sets transforms on elements, and they cannot run code.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src-elem 'self' 'nonce-${nonce}'`,
    ...(isDev ? [] : ["style-src-attr 'unsafe-inline'"]),
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${ancestors}`,
    // Only meaningful (and only safe for plain-http local runs) when the page itself is HTTPS.
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? request.nextUrl.protocol.replace(':', '');
  const secure = proto === 'https';
  const csp = buildCsp(nonce, secure);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  if (frameAncestors() === "'none'") response.headers.set('X-Frame-Options', 'DENY');
  if (secure && !isDev) response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
