'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { TEST_USDG_ABI } from '@/abi/testnet.generated';
import { NETWORK } from '@/config/networks';
import { getPublicClient } from '@/lib/chain/client';
import { FIXTURE, fixtureDeployData, fixtureStatus } from '@/lib/fixture-deploy';
import { fmtClock } from '@/lib/format';
import { executePlainCall, type WalletPort } from '@/lib/tx/execute';

/**
 * Testnet only. Says plainly that everything here is a test contract, offers the test-token
 * faucet, and — while the fixture is missing on chain 46630 — the one-transaction deployment.
 */
export function TestnetBar({
  account,
  chainOk,
  getWalletPort,
  onConnect,
  onSwitch,
  notify,
}: {
  account: Address | null;
  chainOk: boolean;
  getWalletPort: () => Promise<WalletPort>;
  onConnect: () => void;
  onSwitch: () => void;
  notify: (text: string, bad?: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [working, setWorking] = useState<'faucet' | 'deploy' | null>(null);
  const lock = useRef(false);

  const fixture = useQuery({
    queryKey: ['fixture', NETWORK.key],
    queryFn: () => fixtureStatus(getPublicClient()),
    refetchInterval: (q) => (q.state.data === 'deployed' ? false : 20_000),
    staleTime: 10_000,
  });
  const deployed = fixture.data === 'deployed';

  const faucet = useQuery({
    queryKey: ['faucet', NETWORK.key, account?.toLowerCase() ?? 'none'],
    queryFn: async () =>
      Number(
        await getPublicClient().readContract({
          address: FIXTURE.usdg,
          abi: TEST_USDG_ABI,
          functionName: 'faucetAvailableAt',
          args: [account as Address],
        }),
      ) * 1000,
    enabled: deployed && account != null,
    refetchInterval: 60_000,
  });
  const availableAt = faucet.data ?? 0;
  const cooling = availableAt > Date.now();

  async function run(kind: 'faucet' | 'deploy') {
    if (lock.current || !account) return;
    lock.current = true;
    setWorking(kind);
    try {
      const wallet = await getWalletPort();
      const publicClient = getPublicClient();
      let to: Address;
      let data: Hex;
      let simulate: () => Promise<unknown>;
      if (kind === 'faucet') {
        to = FIXTURE.usdg;
        data = encodeFunctionData({ abi: TEST_USDG_ABI, functionName: 'faucet' });
        simulate = () => publicClient.simulateContract({ address: to, abi: TEST_USDG_ABI, functionName: 'faucet', account });
      } else {
        // ~32 KB of creation code, loaded only when someone actually deploys.
        const { initCode } = (await import('@/config/testnet-fixture.initcode.json')) as { initCode: string };
        to = FIXTURE.create2Factory;
        data = fixtureDeployData(initCode as Hex);
        simulate = () => publicClient.call({ account, to, data });
      }
      const out = await executePlainCall(
        { network: NETWORK, publicClient, wallet, account, receiptTimeoutMs: 180_000 },
        { to, data, simulate },
      );
      if (out.status === 'success') {
        notify(kind === 'faucet' ? `10,000 ${NETWORK.asset.symbol} claimed` : 'Test contracts deployed');
      } else if (out.status === 'unknown') {
        notify('Sent, but not confirmed yet. Check your wallet activity before trying again.', true);
      } else {
        notify(out.error.message, true);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message.slice(0, 180) : 'Something went wrong. Nothing was sent.', true);
    } finally {
      lock.current = false;
      setWorking(null);
      for (const key of ['fixture', 'faucet', 'wallet', 'checks', 'market']) {
        void queryClient.invalidateQueries({ queryKey: [key, NETWORK.key] });
      }
    }
  }

  const walletAction = !account ? (
    <button type="button" onClick={onConnect}>Connect wallet</button>
  ) : !chainOk ? (
    <button type="button" onClick={onSwitch}>Switch to {NETWORK.shortLabel}</button>
  ) : null;

  if (fixture.data && !deployed) {
    return (
      <div className="notice warn" role="status">
        <span className="tagline">TESTNET</span>
        <span>
          <b>The VATE test contracts are not on {NETWORK.label} yet.</b> One permissionless transaction creates the test token and four
          test vaults (≈ 9M gas, ≈ 0.0001 test ETH).
        </span>
        {walletAction ?? (
          <button type="button" disabled={working !== null} onClick={() => run('deploy')}>
            {working === 'deploy' ? 'Deploying… confirm in wallet' : 'Deploy test contracts'}
          </button>
        )}
        <a className="pill" href={NETWORK.gasFaucetUrl ?? '#'} target="_blank" rel="noopener noreferrer">Get test ETH ↗</a>
      </div>
    );
  }

  return (
    <div className="notice" role="note">
      <span className="tagline">TESTNET</span>
      <span>
        <b>{NETWORK.label}</b> · chain {NETWORK.chain.id} · the vaults and {NETWORK.asset.symbol} are VATE test contracts with no real
        value{fixture.isError ? ' · could not check deployment' : ''}
      </span>
      {deployed
        ? walletAction ?? (
            <button type="button" disabled={working !== null || cooling} onClick={() => run('faucet')}>
              {working === 'faucet' ? 'Claiming… confirm in wallet' : cooling ? `Faucet again at ${fmtClock(availableAt).slice(0, 5)}` : `Claim 10,000 ${NETWORK.asset.symbol}`}
            </button>
          )
        : null}
      <a className="pill" href={NETWORK.gasFaucetUrl ?? '#'} target="_blank" rel="noopener noreferrer">Get test ETH ↗</a>
    </div>
  );
}
