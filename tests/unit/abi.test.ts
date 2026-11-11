import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAddress, isAddress, toFunctionSelector, toEventSelector } from 'viem';
import { describe, expect, it } from 'vitest';
import { ERC20_ABI, USDG_ERRORS_ABI, VAULT_V2_ABI, VAULT_V2_ERRORS_ABI } from '@/abi/vaultV2';
import { NETWORKS, TESTNET_FIXTURE } from '@/config/networks';
import fixture from '@/config/testnet-fixture.json';

type Item = { type: string; name?: string; inputs?: readonly { type: string; name?: string; indexed?: boolean }[]; outputs?: readonly { type: string }[]; stateMutability?: string };
const reference = (file: string): Item[] =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url)), 'utf8')).abi;
const key = (i: Item) =>
  JSON.stringify([i.type, i.name, (i.inputs ?? []).map((x) => [x.type, x.indexed ?? null]), (i.outputs ?? []).map((x) => x.type), i.stateMutability ?? null]);

describe('typed ABIs match the Sourcify-verified contracts', () => {
  const vaultRef = new Set(reference('VaultV2.sourcify.json').map(key));
  const usdgRef = new Set(reference('USDG.sourcify.json').map(key));

  it('every Vault V2 member used by the app exists with the same signature', () => {
    for (const item of [...VAULT_V2_ABI, ...VAULT_V2_ERRORS_ABI] as readonly Item[]) expect(vaultRef.has(key(item)), `${item.type} ${item.name}`).toBe(true);
  });

  it('every ERC-20 / USDG member used by the app exists with the same signature', () => {
    for (const item of [...ERC20_ABI, ...USDG_ERRORS_ABI] as readonly Item[]) expect(usdgRef.has(key(item)), `${item.type} ${item.name}`).toBe(true);
  });

  it('uses the selectors the brief lists for the write path', () => {
    const sel = (name: string) => toFunctionSelector(VAULT_V2_ABI.find((x) => x.type === 'function' && x.name === name) as never);
    expect(sel('deposit')).toBe('0x6e553f65');
    expect(sel('withdraw')).toBe('0xb460af94');
    expect(sel('redeem')).toBe('0xba087652');
    expect(toFunctionSelector(ERC20_ABI.find((x) => x.type === 'function' && x.name === 'approve') as never)).toBe('0x095ea7b3');
    expect(toEventSelector(VAULT_V2_ABI.find((x) => x.type === 'event' && x.name === 'Deposit') as never)).toBe('0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7');
    expect(toEventSelector(VAULT_V2_ABI.find((x) => x.type === 'event' && x.name === 'Withdraw') as never)).toBe('0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db');
  });
});

describe('network configuration', () => {
  it('mainnet matches the reviewed reference values', () => {
    const m = NETWORKS.mainnet;
    expect(m.chain.id).toBe(4663);
    expect(m.rpcUrls[0]).toBe('https://rpc.mainnet.chain.robinhood.com');
    expect(m.explorerUrl).toBe('https://robinhoodchain.blockscout.com');
    expect(m.asset).toMatchObject({ address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', decimals: 6, symbol: 'USDG' });
    expect(m.vaults.map((v) => [v.name, v.address, v.llamaPoolId])).toEqual([
      ['Steakhouse USDG', '0xBeEff033F34C046626B8D0A041844C5d1A5409dd', '32f586b4-5358-5aa2-88ee-c842139e7023'],
      ['Galaxy USDG RH Stock Tokens', '0xd0dACE70434fF7567b108B5a8c2a36C150C830FE', '07caf4ad-86b5-5c84-adaa-84e9efc34d1a'],
      ['Yearn Stonk USDG', '0x8c258F25fc6fBe3f01ccC828E2C3840A46a4a9A2', '22402907-75bd-5247-ba8f-41f35e3c8f25'],
      ['Purinta USDG', '0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8', '791ce169-afe8-58ba-b96c-c84effbc3487'],
    ]);
  });

  it('testnet points at the deterministic VATE fixture, never at mainnet contracts', () => {
    const t = NETWORKS.testnet;
    expect(t.chain.id).toBe(46630);
    expect(t.isTestnet).toBe(true);
    expect(t.asset.address).toBe(getAddress(fixture.usdg));
    expect(t.vaults.map((v) => v.address)).toEqual(fixture.vaults.map((v) => getAddress(v.address)));
    const mainnet = new Set([NETWORKS.mainnet.asset.address, ...NETWORKS.mainnet.vaults.map((v) => v.address)].map((a) => a.toLowerCase()));
    for (const a of [t.asset.address, ...t.vaults.map((v) => v.address)]) expect(mainnet.has(a.toLowerCase())).toBe(false);
    expect(TESTNET_FIXTURE.create2Factory).toBe('0x4e59b44847b379578588920cA78FbF26c0B4956C');
  });

  it('all configured addresses are checksummed and unique per network', () => {
    for (const n of Object.values(NETWORKS)) {
      const all = [n.asset.address, ...n.vaults.map((v) => v.address)];
      for (const a of all) expect(isAddress(a, { strict: true }), a).toBe(true);
      expect(new Set(all.map((a) => a.toLowerCase())).size).toBe(all.length);
      expect(n.vaults).toHaveLength(4);
      for (const url of [...n.rpcUrls, n.explorerUrl]) expect(url.startsWith('https://')).toBe(true);
    }
  });
});
