// Morpho API adapter. Units: netApy and fees are fractions (0.039 = 3.9%).
import { fetchJson, isRecord, num, str, type FetchJsonOptions } from './http';

export const MORPHO_GRAPHQL_URL = 'https://api.morpho.org/graphql';

export interface MorphoVault {
  address: string;
  name: string | null;
  curator: string | null;
  listed: boolean | null;
  assetAddress: string | null;
  totalAssetsUsd: number | null;
  liquidityUsd: number | null;
  /** Fraction, net of fees. */
  netApy: number | null;
  /** Fraction of yield. */
  performanceFee: number | null;
  /** Fraction per year. */
  managementFee: number | null;
}

/**
 * Asks for the allowlisted vaults by address. A "top N by TVL" page would silently lose a small
 * vault once the chain has more than N vaults (55 on Robinhood Chain on 2026-11-11).
 */
export function morphoQuery(chainId: number, addresses: readonly string[]): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError('Invalid chain id');
  if (addresses.length === 0 || addresses.length > 100) throw new RangeError('Expected 1 to 100 vault addresses');
  for (const a of addresses) if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new RangeError('Invalid vault address');
  const list = addresses.map((a) => `"${a}"`).join(', ');
  return `query VateVaults {
  vaultV2s(first: ${addresses.length}, where: { chainId_in: [${chainId}], address_in: [${list}] }) {
    items {
      address
      name
      listed
      totalAssetsUsd
      liquidityUsd
      netApy
      performanceFee
      managementFee
      curators { items { name } }
      asset { address symbol decimals }
    }
  }
}`;
}

export function parseMorphoResponse(json: unknown): Map<string, MorphoVault> {
  if (!isRecord(json)) throw new Error('Morpho: unexpected response');
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const first = json.errors[0];
    throw new Error(`Morpho: ${isRecord(first) ? (str(first.message, 200) ?? 'GraphQL error') : 'GraphQL error'}`);
  }
  const data = isRecord(json.data) ? json.data : null;
  const list = data && isRecord(data.vaultV2s) ? data.vaultV2s.items : null;
  if (!Array.isArray(list)) throw new Error('Morpho: vault list missing');
  const out = new Map<string, MorphoVault>();
  for (const it of list) {
    if (!isRecord(it)) continue;
    const address = str(it.address, 42);
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
    const curators = isRecord(it.curators) && Array.isArray(it.curators.items) ? it.curators.items : [];
    const firstCurator = curators.find(isRecord);
    const asset = isRecord(it.asset) ? it.asset : null;
    const nonNegative = (v: unknown) => {
      const n = num(v);
      return n != null && n >= 0 ? n : null;
    };
    out.set(address.toLowerCase(), {
      address,
      name: str(it.name, 80),
      curator: firstCurator ? str(firstCurator.name, 80) : null,
      listed: typeof it.listed === 'boolean' ? it.listed : null,
      assetAddress: asset ? str(asset.address, 42) : null,
      totalAssetsUsd: nonNegative(it.totalAssetsUsd),
      liquidityUsd: nonNegative(it.liquidityUsd),
      netApy: num(it.netApy),
      performanceFee: nonNegative(it.performanceFee),
      managementFee: nonNegative(it.managementFee),
    });
  }
  return out;
}

export async function fetchMorphoVaults(
  chainId: number,
  addresses: readonly string[],
  opts: FetchJsonOptions = {},
): Promise<Map<string, MorphoVault>> {
  const json = await fetchJson(MORPHO_GRAPHQL_URL, {
    ...opts,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: morphoQuery(chainId, addresses) }),
    },
  });
  return parseMorphoResponse(json);
}
