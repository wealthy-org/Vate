import { env } from './env';
import { NETWORK } from './networks';

/** "@VateVault" from the account's address, so the handle shown can never disagree with the link. */
function xHandle(url: string): string | null {
  const [name, ...rest] = new URL(url).pathname.split('/').filter(Boolean);
  return name && rest.length === 0 && /^\w{1,15}$/.test(name) ? `@${name}` : null;
}

export const SITE = {
  name: 'VATE',
  title: 'VATE — curated USDG vaults on Robinhood Chain',
  description:
    'VATE is a non-custodial interface for comparing curated USDG lending vaults on Robinhood Chain. VATE Ranking scores each vault by live yield, deposit depth and withdrawable liquidity; you deposit and withdraw directly from your own wallet.',
  tokenSymbol: 'VATE',
  year: 2026,
  /** The official X account, and its handle for labels. */
  xUrl: env.xUrl,
  xHandle: xHandle(env.xUrl),
  /** Facts the operator still has to supply. Shown as "pending" wherever they would appear. */
  operatorName: env.operatorName,
  operatorJurisdiction: env.operatorJurisdiction,
  contactEmail: env.contactEmail,
  hostingProvider: env.hostingProvider,
  siteUrl: env.siteUrl,
  termsVersion: env.termsVersion,
  tokenAddress: env.tokenAddress,
} as const;

/** Refresh cadence required by the brief. */
export const REFRESH = {
  blockMs: 5_000,
  walletMs: 30_000,
  marketMs: 90_000,
  onchainCheckMs: 90_000,
} as const;

export const IS_TESTNET = NETWORK.isTestnet;
