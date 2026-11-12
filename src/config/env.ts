// Public, build-time configuration. Every value here is shipped to the browser, so nothing
// secret may ever be added. Next.js only inlines literal `process.env.NEXT_PUBLIC_*` accesses.
//
// All variables are optional. Set them in `.env.local` or in the host's environment:
//
//   NEXT_PUBLIC_VATE_NETWORK            testnet (default) | mainnet
//   NEXT_PUBLIC_RPC_PRIMARY             extra RPC URL, tried before the public endpoints
//   NEXT_PUBLIC_RPC_FALLBACK_1 / _2     further RPC URLs (https, or http on localhost)
//   NEXT_PUBLIC_DATA_MODE               proxy (default, via /api/market) | direct (browser calls the APIs)
//   NEXT_PUBLIC_VATE_TOKEN_ADDRESS      VATE token contract; empty shows "Contract pending"
//   NEXT_PUBLIC_X_URL                   official X account; default https://x.com/VateVault
//   NEXT_PUBLIC_SITE_URL                canonical origin for metadata, and the link in a post shared from a card
//   NEXT_PUBLIC_TERMS_VERSION           version stamp of Terms/Privacy and of the risk acknowledgement
//   NEXT_PUBLIC_OPERATOR_NAME           legal entity shown in Terms/Privacy (empty: "Draft" banner)
//   NEXT_PUBLIC_OPERATOR_JURISDICTION   governing jurisdiction shown in Terms
//   NEXT_PUBLIC_CONTACT_EMAIL           contact address shown in Terms/Privacy
//   NEXT_PUBLIC_HOSTING_PROVIDER        hosting provider named in Privacy
//
// Server only (never sent to the browser), read in src/proxy.ts and next.config.ts:
//
//   VATE_FRAME_ANCESTORS                CSP frame-ancestors; default 'none'. Set it only to embed the site
//   VATE_DEV_ORIGINS                    comma-separated hostnames allowed to reach `next dev`
//   VATE_DIST_DIR                       alternative build directory (used by scripts/e2e.mjs)
//
// Scripts only: PRIVATE_KEY and RPC_URL (deploy-testnet), BASE_URL and QA_OUT (qa-screens, e2e),
// ANVIL_BIN, TESTNET_FORK_URL and MAINNET_FORK_URL (tests against local forks).
import { getAddress, isAddress, type Address } from 'viem';

export type NetworkKey = 'testnet' | 'mainnet';

function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.toString().replace(/\/$/, '');
  } catch {
    /* ignored: invalid URL */
  }
  return null;
}

function address(value: string | undefined): Address | null {
  const v = value?.trim();
  return v && isAddress(v) ? getAddress(v) : null;
}

function text(value: string | undefined, max = 120): string | null {
  const v = value?.trim();
  return v ? v.slice(0, max) : null;
}

export const env = {
  /** Testnet is the default: mainnet has to be switched on explicitly. */
  network: (process.env.NEXT_PUBLIC_VATE_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as NetworkKey,
  rpcOverrides: [
    httpUrl(process.env.NEXT_PUBLIC_RPC_PRIMARY),
    httpUrl(process.env.NEXT_PUBLIC_RPC_FALLBACK_1),
    httpUrl(process.env.NEXT_PUBLIC_RPC_FALLBACK_2),
  ].filter((u): u is string => u !== null),
  /** VATE token. Empty until launch: the widget then shows "Contract pending". */
  tokenAddress: address(process.env.NEXT_PUBLIC_VATE_TOKEN_ADDRESS),
  termsVersion: text(process.env.NEXT_PUBLIC_TERMS_VERSION, 32) ?? '2026-11-11',
  operatorName: text(process.env.NEXT_PUBLIC_OPERATOR_NAME),
  operatorJurisdiction: text(process.env.NEXT_PUBLIC_OPERATOR_JURISDICTION),
  contactEmail: text(process.env.NEXT_PUBLIC_CONTACT_EMAIL),
  hostingProvider: text(process.env.NEXT_PUBLIC_HOSTING_PROVIDER),
  /** The official X account, linked from every header and footer. */
  xUrl: httpUrl(process.env.NEXT_PUBLIC_X_URL) ?? 'https://x.com/VateVault',
  siteUrl: httpUrl(process.env.NEXT_PUBLIC_SITE_URL),
  /** `proxy` (default): read market data through this app's cached /api routes first. */
  dataMode: (process.env.NEXT_PUBLIC_DATA_MODE === 'direct' ? 'direct' : 'proxy') as 'proxy' | 'direct',
} as const;
