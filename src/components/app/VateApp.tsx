'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { Address } from 'viem';
import '@/config/money';
import { ActiveNetworkProvider, useActiveNetwork } from '@/lib/chain/networkContext';
import { getPublicClient } from '@/lib/chain/client';
import { explorerAddress, findVault, type NetworkConfig } from '@/config/networks';
import { SITE } from '@/config/site';
import { Mark } from '@/components/shared/Mark';
import { Providers } from '@/components/shared/Providers';
import { TokenChip } from '@/components/shared/TokenChip';
import { XLink } from '@/components/shared/XLink';
import { useLatestBlock, useRanking, useRpcStatus } from '@/hooks/useMarketData';
import {
  useReconciler,
  useTxStore,
  useWalletConnection,
  useWalletData,
  type WalletOption,
} from '@/hooks/useWallet';
import { evaluateForm } from '@/lib/form';
import { shortAddress } from '@/lib/format';
import { readAck, storageStore, writeAck } from '@/lib/storage';
import { classifyError } from '@/lib/tx/errors';
import { errorContext, executeDeposit, executeWithdraw, type ExecContext } from '@/lib/tx/execute';
import { flowReducer, INITIAL_FLOW, isBusy } from '@/lib/tx/machine';
import type { Reconciled } from '@/lib/tx/reconcile';
import type { RankedVault } from '@/lib/types';
import { percentOf, toDecimalString } from '@/lib/units';
import { TxModal, WalletModal } from './Modals';
import { NetworkToggle } from './NetworkToggle';
import { PortfolioView } from './Portfolio';
import { InsightsFeed, ReasoningPanel } from './Reasoning';
import { Stars } from './Stars';
import { TestnetBar } from './TestnetBar';
import { TxPanel, type PanelMode } from './TxPanel';
import { Toast, useNow, useToast } from './ui';
import { StatCards, VaultDetail, VaultList } from './VaultViews';

type View = 'vaults' | 'portfolio';

export function VateApp() {
  return (
    <Providers>
      <ActiveNetworkProvider>
        <NetworkApp />
      </ActiveNetworkProvider>
    </Providers>
  );
}

function NetworkApp() {
  const { key } = useActiveNetwork();
  return <AppInner key={key} />;
}

function AppInner() {
  const queryClient = useQueryClient();
  const { network, key, switchNetwork } = useActiveNetwork();
  const DECIMALS = network.asset.decimals;
  const SYMBOL = network.asset.symbol;
  const data = useRanking();
  const block = useLatestBlock();
  const rpc = useRpcStatus();
  const now = useNow();
  const wallet = useWalletConnection();
  const { account, chainOk } = wallet;
  const walletQuery = useWalletData(account);
  const { store, activity, pending } = useTxStore(account);
  const { toast, visible, show } = useToast();
  const [flow, dispatch] = useReducer(flowReducer, INITIAL_FLOW);

  const [view, setView] = useState<View>('vaults');
  const [selected, setSelected] = useState<Address>(network.vaults[0]!.address);
  const [mode, setMode] = useState<PanelMode>('deposit');
  const [amountText, setAmountText] = useState('');
  const [maxWithdraw, setMaxWithdraw] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [walletModal, setWalletModal] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [txModal, setTxModal] = useState(false);
  const submitting = useRef(false);
  const walletBtn = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Subscribing re-renders on storage changes; the value itself is read fresh below.
  useSyncExternalStore(storageStore.subscribe, storageStore.getSnapshot, storageStore.getServerSnapshot);
  const [ackReady, setAckReady] = useState(false);
  useEffect(() => setAckReady(true), []);
  const ack = ackReady && readAck();

  const vault: RankedVault = data.ranking.all.find((v) => v.market.address === selected) ?? (data.ranking.all[0] as RankedVault);
  const vaultState = walletQuery.data?.vaults[selected.toLowerCase()];
  const position = vaultState?.assets ?? 0n;

  // MAX on the withdraw tab follows the position as interest accrues.
  useEffect(() => {
    if (maxWithdraw && mode === 'withdraw' && vaultState) setAmountText(toDecimalString(vaultState.assets, DECIMALS));
  }, [maxWithdraw, mode, vaultState]);

  const resetForm = useCallback(() => {
    setAmountText('');
    setMaxWithdraw(false);
    setPercent(null);
  }, []);

  // A different account means different balances, allowances and positions: start clean.
  useEffect(() => {
    resetForm();
    setMenuOpen(false);
  }, [account, resetForm]);

  useEffect(() => {
    if (window.location.hash === '#portfolio') setView('portfolio');
  }, []);

  const goView = useCallback((next: View) => {
    setView(next);
    window.history.replaceState(null, '', next === 'portfolio' ? '#portfolio' : window.location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const selectVault = useCallback(
    (address: Address) => {
      setSelected(address);
      resetForm();
    },
    [resetForm],
  );

  const refreshChain = useCallback(() => {
    const run = () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet', key] });
      void queryClient.invalidateQueries({ queryKey: ['checks', key] });
      if (network.dataSource === 'onchain-fixture') void queryClient.invalidateQueries({ queryKey: ['market', key] });
    };
    run();
    setTimeout(run, 2_500); // a load-balanced RPC can lag a block behind the receipt
  }, [queryClient, key, network.dataSource]);

  useReconciler(account, (items: Reconciled[]) => {
    for (const it of items) {
      if (it.outcome === 'expired') {
        show('Stopped tracking a transaction the network never reported.', true);
        continue;
      }
      dispatch({ type: 'RESOLVED', hash: it.hash, outcome: it.outcome, record: it.record });
      const name = findVault(network, it.vault)?.name ?? 'vault';
      if (it.outcome === 'failed') show(`A pending ${it.kind} reverted on-chain. No funds were moved by it.`, true);
      else if (it.kind === 'approve') show('Approval confirmed. You can start the deposit again.');
      else show(`${it.kind === 'deposit' ? 'Deposit into' : 'Withdrawal from'} ${name} confirmed.`);
    }
    refreshChain();
  });

  const form = useMemo(
    () =>
      evaluateForm({
        mode,
        networkLabel: network.label,
        symbol: SYMBOL,
        decimals: DECIMALS,
        vaultName: vault.market.name,
        connected: account != null,
        chainOk,
        wallet: !account ? undefined : (walletQuery.data ?? (walletQuery.isError ? null : undefined)),
        vaultState,
        check: vault.onchain,
        rawAmount: amountText,
        maxWithdraw,
        ack,
        busy: isBusy(flow),
        hasPending: pending.length > 0,
        liquidityUsd: vault.market.liquidityUsd,
      }),
    [mode, vault, account, chainOk, walletQuery.data, walletQuery.isError, vaultState, amountText, maxWithdraw, ack, flow, pending.length, network.label, SYMBOL, DECIMALS],
  );

  const friendly = useCallback((e: unknown) => classifyError(e, errorContext(network)).message, [network]);

  const openWalletModal = useCallback(() => {
    setConnectError(null);
    setWalletModal(true);
  }, []);

  const doSwitch = useCallback(async () => {
    try {
      await wallet.switchChain();
    } catch (e) {
      show(friendly(e), true);
    }
  }, [wallet, show, friendly]);

  async function pickWallet(option: WalletOption) {
    setConnectError(null);
    try {
      const result = await wallet.connect(option.connector);
      setWalletModal(false);
      show(`${option.name} connected`);
      if (result.chainId !== network.chain.id) void wallet.switchChain().catch(() => {});
    } catch (e) {
      setConnectError(friendly(e));
    }
  }

  async function submit() {
    if (submitting.current || !account || !store || form.cta.action !== 'submit' || form.amount == null) return;
    const cfg = findVault(network, selected);
    if (!cfg) return;
    submitting.current = true; // synchronous guard against a double click
    try {
      const port = await wallet.getWalletPort();
      const ctx: ExecContext = { network, publicClient: getPublicClient(network), wallet: port, account, store, dispatch };
      setTxModal(true);
      const out =
        mode === 'deposit'
          ? await executeDeposit(ctx, { vault: cfg, vaultName: vault.market.name, amount: form.amount })
          : await executeWithdraw(ctx, { vault: cfg, vaultName: vault.market.name, amount: form.amount, redeemAll: form.redeemAll });
      if (out.status === 'success') {
        resetForm();
        show(mode === 'deposit' ? `Deposited into ${vault.market.name}` : `Withdrew from ${vault.market.name}`);
      }
    } catch (e) {
      show(friendly(e), true);
    } finally {
      submitting.current = false;
      refreshChain();
    }
  }

  function onAction() {
    switch (form.cta.action) {
      case 'connect':
        openWalletModal();
        break;
      case 'switch':
        void doSwitch();
        break;
      case 'retry':
        void walletQuery.refetch();
        break;
      case 'submit':
        void submit();
        break;
      default:
        break;
    }
  }

  // Account menu: close on outside click or Escape, and give focus back to the button.
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('a,button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !walletBtn.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        walletBtn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const rpcDown = block.isError || !rpc.ok;
  const netLabel = rpcDown ? 'RPC offline' : block.data == null ? 'Connecting…' : network.shortLabel;
  const issues = data.market?.issues ?? [];

  return (
    <div className="va">
      <div className="bg-glow" />
      <Stars />
      <div className="grain" />

      <header className="va-header">
        <Link className="brand" href="/" aria-label="Back to VATE home">
          <Mark />
          VATE
        </Link>
        <nav className="tabs" role="tablist" aria-label="App sections">
          <button type="button" role="tab" aria-selected={view === 'vaults'} onClick={() => goView('vaults')}>Vaults</button>
          <button type="button" role="tab" aria-selected={view === 'portfolio'} onClick={() => goView('portfolio')}>Portfolio</button>
        </nav>
        <div className="hdr-r">
          <Link className="status" href="/docs">Docs ↗</Link>
          <span className={`status${rpcDown ? ' off' : block.data == null ? ' idle' : ''}`} role="status">
            <i /><span>{netLabel}</span>
          </span>
          <XLink />
          <NetworkToggle active={key} disabled={isBusy(flow)} onSwitch={(next) => {
            switchNetwork(next);
            if (account) void wallet.switchToNetwork(next);
          }} />
          <button
            ref={walletBtn}
            className="btn wallet"
            type="button"
            aria-haspopup={account ? 'menu' : 'dialog'}
            aria-expanded={account ? menuOpen : undefined}
            onClick={() => (account ? setMenuOpen((o) => !o) : openWalletModal())}
          >
            {account ? (
              <>
                <span className={`dot${chainOk ? '' : ' wrong'}`} />
                <span className="mono">{shortAddress(account)}</span>
                {chainOk ? null : <span className="wrong-t">wrong network</span>}
              </>
            ) : wallet.status === 'reconnecting' ? 'Reconnecting…' : 'Connect wallet'}
          </button>
          {menuOpen && account ? (
            <div className="acct-menu" ref={menuRef} role="menu" aria-label="Account">
              <div className="a"><small>{wallet.walletName ?? 'Wallet'}</small>{account}</div>
              {chainOk ? null : (
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void doSwitch(); }}>
                  Switch to {network.label}
                </button>
              )}
              <a role="menuitem" href={explorerAddress(network, account)} target="_blank" rel="noopener noreferrer">View on explorer ↗</a>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  navigator.clipboard?.writeText(account).then(() => show('Address copied'), () => show('Could not copy. Select the address above and copy it manually.', true));
                  setMenuOpen(false);
                }}
              >
                Copy address
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void wallet.disconnect().catch(() => {}); }}>Disconnect</button>
              <div className="fine">Disconnecting only forgets this wallet here. It does not revoke token approvals on-chain.</div>
            </div>
          ) : null}
        </div>
      </header>

      {network.isTestnet ? (
        <TestnetBar account={account} chainOk={chainOk} getWalletPort={wallet.getWalletPort} onConnect={openWalletModal} onSwitch={() => void doSwitch()} notify={show} />
      ) : null}

      <main className="va-main">
        {view === 'vaults' ? (
          <section className="view" aria-labelledby="vaults-title">
            <div className="hero">
              <div>
                <h1 className="title" id="vaults-title">
                  Put your <span className="sym">{SYMBOL}</span> <em>in orbit</em>
                </h1>
                <p className="sub">
                  VATE Ranking scores curated {SYMBOL} vaults on {network.isTestnet ? network.label : 'Robinhood Chain'} by live yield, depth and
                  withdrawable liquidity. You pick, you sign, your wallet stays in control.
                </p>
              </div>
              <StatCards
                market={data.market}
                ranking={data.ranking}
                loading={data.loading}
                marketError={data.marketError}
                checksLoading={data.checksLoading}
                block={block.data ?? null}
                blockError={rpcDown}
                rpcHost={rpc.host}
              />
            </div>
            {issues.length > 0 || (data.marketError && data.market) ? (
              <details className="data-note" style={{ margin: '0 0 16px' }}>
                <summary style={{ cursor: 'pointer' }}>
                  Data notice{issues.length ? ` (${issues.length})` : ''}: some figures are unavailable or come from a fallback source
                </summary>
                <ul style={{ margin: '8px 0 0 18px', listStyle: 'disc' }}>
                  {data.marketError && data.market ? <li>The last refresh failed. Showing data fetched earlier; it is marked stale.</li> : null}
                  {issues.map((i) => <li key={i}>{i}</li>)}
                </ul>
              </details>
            ) : null}

            {/* Five blocks placed by name (styles/app.css): where each one sits depends on the width. */}
            <div className="grid">
              <VaultList ranking={data.ranking} selected={selected} loading={data.loading} onSelect={selectVault} />
              <VaultDetail
                vault={vault}
                isPick={data.ranking.pick?.market.address === vault.market.address}
                market={data.market}
                loading={data.loading}
                marketError={data.marketError}
                now={now}
              />
              <ReasoningPanel
                ranking={data.ranking}
                market={data.market}
                selected={selected}
                loading={data.loading}
                marketError={data.marketError}
                checksLoading={data.checksLoading}
                onSelect={selectVault}
              />
              <InsightsFeed ranking={data.ranking} market={data.market} loading={data.loading} marketError={data.marketError} />
              <TxPanel
                vault={vault}
                mode={mode}
                onMode={(m) => { setMode(m); resetForm(); }}
                amountText={amountText}
                onAmount={(text) => { setAmountText(text); setMaxWithdraw(false); setPercent(null); }}
                onMax={() => {
                  if (!account) return openWalletModal();
                  if (mode === 'deposit') {
                    if (walletQuery.data) setAmountText(toDecimalString(walletQuery.data.assetBalance, DECIMALS));
                  } else {
                    setAmountText(toDecimalString(position, DECIMALS));
                    setMaxWithdraw(position > 0n);
                    setPercent(100);
                  }
                }}
                onPercent={(p) => {
                  setPercent(p);
                  setMaxWithdraw(p === 100 && position > 0n);
                  setAmountText(toDecimalString(p === 100 ? position : percentOf(position, p), DECIMALS));
                }}
                percent={percent}
                form={form}
                connected={account != null}
                wallet={!account ? undefined : (walletQuery.data ?? (walletQuery.isError ? null : undefined))}
                ack={ack}
                onAck={writeAck}
                onAction={onAction}
              />
            </div>
          </section>
        ) : (
          <PortfolioView
            account={account}
            ranking={data.ranking}
            wallet={walletQuery.data}
            walletLoading={walletQuery.isPending}
            walletError={walletQuery.isError}
            store={store}
            activity={activity}
            pending={pending}
            onConnect={openWalletModal}
            onRetry={() => void walletQuery.refetch()}
            onWithdraw={(address) => {
              setSelected(address);
              setMode('withdraw');
              resetForm();
              goView('vaults');
            }}
            onGoVaults={() => goView('vaults')}
            onDismissPending={(hash) => store?.removePending(hash)}
          />
        )}
      </main>

      <footer className="va-footer">
        <span className="left"><span>© {SITE.year} VATE</span> <TokenChip /></span>
        <div className="right">
          <nav aria-label="Footer">
            <Link href="/">Home</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/terms">Terms &amp; Conditions</Link>
            <Link href="/privacy">Privacy Policy</Link>
          </nav>
          <XLink />
        </div>
      </footer>

      <WalletModal open={walletModal} onClose={() => setWalletModal(false)} options={wallet.options} onPick={pickWallet} connecting={wallet.connecting} error={connectError} />
      <TxModal
        open={txModal}
        flow={flow}
        onClose={() => {
          if (isBusy(flow)) return;
          setTxModal(false);
          dispatch({ type: 'RESET' });
        }}
      />
      <Toast toast={toast} visible={visible} />
    </div>
  );
}
