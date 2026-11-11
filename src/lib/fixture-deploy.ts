// Deployment of the testnet fixture (contracts/). One transaction to the canonical CREATE2
// deployer creates the test token and the four test vaults at addresses known in advance, so it
// does not matter who sends it. Used by scripts/deploy-testnet.mjs, the in-app banner and tests.
import { concatHex, keccak256, type Address, type Hex, type PublicClient } from 'viem';
import fixture from '@/config/testnet-fixture.json';

export const FIXTURE = {
  chainId: fixture.chainId,
  create2Factory: fixture.create2Factory as Address,
  salt: fixture.salt as Hex,
  initCodeHash: fixture.initCodeHash as Hex,
  deployment: fixture.deployment as Address,
  usdg: fixture.usdg as Address,
  vaults: fixture.vaults.map((v) => ({ key: v.key, address: v.address as Address, marketAdapter: v.marketAdapter as Address })),
} as const;

/** Calldata for the CREATE2 deployer: salt followed by the creation code. */
export function fixtureDeployData(initCode: Hex): Hex {
  if (keccak256(initCode) !== FIXTURE.initCodeHash) {
    throw new Error('Creation code does not match the recorded hash. Run `pnpm contracts:export`.');
  }
  return concatHex([FIXTURE.salt, initCode]);
}

export type FixtureStatus = 'deployed' | 'missing' | 'partial';

/** Whether every fixture contract has bytecode on the connected chain. */
export async function fixtureStatus(client: PublicClient): Promise<FixtureStatus> {
  const addresses = [FIXTURE.deployment, FIXTURE.usdg, ...FIXTURE.vaults.map((v) => v.address)];
  const codes = await Promise.all(addresses.map((address) => client.getCode({ address })));
  const present = codes.filter((c) => c && c !== '0x').length;
  return present === addresses.length ? 'deployed' : present === 0 ? 'missing' : 'partial';
}
