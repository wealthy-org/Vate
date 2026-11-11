import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell, Section, type TocItem } from '@/components/pages/PageShell';
import { TokenChip } from '@/components/shared/TokenChip';
import { explorerAddress, NETWORK, NETWORKS, type NetworkConfig } from '@/config/networks';
import { SITE } from '@/config/site';
import { shortAddress } from '@/lib/format';
import '@/styles/pages.css';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'How VATE works: getting started, depositing, withdrawing, how VATE Ranking scores vaults, APY, portfolio, risks, network and contracts, FAQ.',
};

const TOC: TocItem[] = [
  { id: 'what', label: 'What is VATE' },
  { id: 'start', label: 'Getting started' },
  { id: 'deposit', label: 'Depositing' },
  { id: 'withdraw', label: 'Withdrawing' },
  { id: 'ranking', label: 'How VATE Ranking scores' },
  { id: 'apy', label: 'Understanding APY' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'risks', label: 'Risks' },
  { id: 'network', label: 'Network & contracts' },
  { id: 'faq', label: 'FAQ' },
];

const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="lnk" href={href} target="_blank" rel="noopener noreferrer">{children}</a>
);

function NetworkTable({ n }: { n: NetworkConfig }) {
  return (
    <div className="tbl">
      <table>
        <tbody>
          <tr><td>Network</td><td>{n.label}{n.isTestnet ? ' (test network, no real value)' : ' (Ethereum Layer 2)'}</td></tr>
          <tr><td>Chain ID</td><td><code>{n.chain.id}</code> (<code>0x{n.chain.id.toString(16)}</code>)</td></tr>
          <tr><td>Gas token</td><td>ETH</td></tr>
          <tr><td>RPC</td><td>{n.rpcUrls.map((u) => <div key={u}><code>{u}</code></div>)}</td></tr>
          <tr><td>Explorer</td><td><Ext href={n.explorerUrl}>{new URL(n.explorerUrl).host}</Ext></td></tr>
          <tr><td>{n.asset.symbol}</td><td><code>{n.asset.address}</code> · {n.asset.decimals} decimals</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function VaultTable({ n }: { n: NetworkConfig }) {
  return (
    <div className="tbl">
      <table>
        <thead><tr><th>Vault</th><th>Curator</th><th>Address</th></tr></thead>
        <tbody>
          {n.vaults.map((v) => (
            <tr key={v.address}>
              <td>{v.name}{v.profile ? <div style={{ fontSize: 12.5 }}>{v.profile}</div> : null}</td>
              <td>{v.curator}</td>
              <td><a className="lnk mono" href={explorerAddress(n, v.address)} target="_blank" rel="noopener noreferrer" title={v.address}>{shortAddress(v.address)}</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  const test = NETWORK.isTestnet;
  const sym = NETWORK.asset.symbol;
  return (
    <PageShell
      current="/docs"
      eyebrow="Documentation"
      title={<><span className="outline">Navigating</span>with <em>VATE</em></>}
      lede="Everything you need to put USDG to work on Robinhood Chain: setting up, depositing, withdrawing, and how VATE Ranking decides which vault comes first."
      toc={TOC}
    >
      {test ? (
        <div className="callout warn" role="note">
          <b>This deployment runs on {NETWORK.label}.</b> The four vaults and the {sym} token here are VATE test contracts with no
          real value, built to behave like the mainnet vaults. Section 09 lists both the test contracts and the mainnet contracts.
        </div>
      ) : null}

      <Section id="what" n="01" title="What is VATE">
        <p>
          VATE is a <strong>non-custodial interface</strong> for earning yield on USDG on Robinhood Chain. It shows a small set of
          curated lending vaults, compares them with one transparent formula, and lets you deposit into and withdraw from the vault
          you choose.
        </p>
        <p>
          VATE never holds your funds. Your USDG moves from your wallet straight into the vault you pick, and the vault gives you
          shares in return. Only your wallet can move those shares.
        </p>
        <div className="callout">
          <b>In one line:</b> you pick a vault, you sign the transaction, the vault pays the yield, and you can leave whenever the
          vault has liquidity.
        </div>
      </Section>

      <Section id="start" n="02" title="Getting started">
        <p>You need three things: a browser wallet, a little ETH on Robinhood Chain for gas, and USDG.</p>
        <ol className="steps">
          <li><strong>Install a wallet.</strong> Rabby or MetaMask both work, and so does any wallet that announces itself to the page (EIP-6963). VATE never asks for your seed phrase, so never type it into a website.</li>
          <li><strong>Connect.</strong> Open the <Link className="lnk" href="/app">app</Link> and press <em>Connect wallet</em>. VATE asks your wallet to switch to {NETWORK.label} and adds the network if it is missing.</li>
          {test ? (
            <>
              <li><strong>Get test ETH for gas.</strong> Use the <Ext href={NETWORK.gasFaucetUrl ?? '#'}>Robinhood Chain testnet faucet</Ext>. A small amount covers many transactions.</li>
              <li><strong>Get {sym}.</strong> Press <em>Claim 10,000 {sym}</em> in the bar at the top of the app. It can be used once an hour per wallet and the tokens are worthless by design.</li>
            </>
          ) : (
            <>
              <li><strong>Bring ETH for gas.</strong> Bridge ETH from Ethereum with the <Ext href={NETWORK.bridgeUrl ?? '#'}>official Arbitrum portal</Ext>. A small amount covers many transactions.</li>
              <li><strong>Get USDG.</strong> Swap ETH or another token for USDG on a Robinhood Chain exchange. USDG is the only asset these vaults accept.</li>
            </>
          )}
        </ol>
      </Section>

      <Section id="deposit" n="03" title="Depositing">
        <ol className="steps">
          <li>Choose a vault from the list. The one tagged <strong>VATE Pick</strong> currently has the best score among vaults that passed the on-chain check.</li>
          <li>Enter an amount, or press <strong>MAX</strong> to use your whole {sym} balance.</li>
          <li>Tick the risk acknowledgement. It is remembered in this browser until the Terms change.</li>
          <li>Confirm in your wallet. If the vault is not yet allowed to take the amount, you first approve <strong>exactly</strong> the amount you entered, never an unlimited amount. Then you sign the deposit itself. If an earlier approval already covers the amount, the approval step is skipped.</li>
        </ol>
        <p>
          Right before each step VATE re-reads your balance, allowance and the vault, and <strong>simulates the transaction</strong>
          with the real amount. If the simulation fails, your wallet is not opened and nothing is sent. Each step shows a link to the
          explorer, and a deposit counts as done only when its receipt confirms success, never because the approval went through.
        </p>
        <p>
          In return for your USDG you receive <strong>vault shares</strong>. Shares grow in value as the vault earns, so the same
          number of shares is worth more USDG over time.
        </p>
      </Section>

      <Section id="withdraw" n="04" title="Withdrawing">
        <p>
          Switch the panel to <strong>Withdraw</strong>, enter an amount in {sym} or use 25 / 50 / 75 / MAX, and confirm in your
          wallet. A partial amount is withdrawn as that exact amount. Choosing <strong>MAX</strong> redeems every share you hold, so
          no rounding dust is left behind; the exact amount you received is read from the transaction receipt.
        </p>
        <div className="callout warn">
          <b>Liquidity matters.</b> Vaults lend most deposits out to earn yield. You can withdraw up to what the vault can pay right
          now. Some vaults can only pay from the balance they hold idle; VATE shows that limit and blocks a larger request before
          you sign. If you need more, withdraw part now and the rest later, as borrowers repay.
        </div>
      </Section>

      <Section id="ranking" n="05" title="How VATE Ranking scores">
        <p>VATE Ranking looks at three live numbers for every vault and combines them into one score. There is no model and no guesswork: the same inputs always give the same score.</p>
        <div className="formula"><span>Score</span> = APY × Depth × Liquidity</div>
        <div className="tbl">
          <table>
            <thead><tr><th>Factor</th><th>What it measures</th><th>Full marks</th></tr></thead>
            <tbody>
              <tr><td><strong>APY</strong></td><td>Total yield right now in percentage points, base plus rewards.</td><td>Higher is better</td></tr>
              <tr><td><strong>Depth</strong></td><td>How much money is deposited. Scaled from 0.30 up to 1.00: <code>clamp(log10(TVL) / 9)</code>.</td><td>$1B deposited</td></tr>
              <tr><td><strong>Liquidity</strong></td><td>How much could be withdrawn today. Scaled from 0.30 up to 1.00: <code>clamp(log10(withdrawable) / 7)</code>. If the figure is unknown, a neutral 0.60 is used and the panel says “Unknown”.</td><td>$10M withdrawable</td></tr>
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 16 }}>
          Depth and liquidity use a logarithmic scale, so going from $100K to $1M counts as much as going from $10M to $100M. For
          example, 7.25% APY on $539.9M of deposits with $55.3M withdrawable scores about 7.03.
        </p>
        <p>
          The <strong>VATE Reasoning</strong> panel in the app shows each factor for every vault and explains in plain words why the
          top vault scores highest, including why a vault with a higher APY can rank lower. A vault can only be ranked after its
          on-chain check passes; ties keep the order of the vault list.
        </p>
        <div className="callout">
          <b>VATE Ranking is a guide, not advice.</b> The score is a transparent formula, not a prediction or a guarantee. It does
          not move your money: you decide and sign every transaction yourself.
        </div>
      </Section>

      <Section id="apy" n="06" title="Understanding APY">
        <p>Each vault shows a <strong>total APY</strong> split into two parts:</p>
        <ul>
          <li><strong>Base yield:</strong> interest paid by borrowers. It moves with lending demand.</li>
          <li><strong>Rewards:</strong> extra incentives on top. These are temporary and can change or end at any time.</li>
        </ul>
        <p>
          APY is variable and is not a promise of future returns. The history chart shows how it moved; hover, tap or use the arrow
          keys on the chart to read a point. Every figure carries its source and time. When a source is unavailable VATE falls back
          to another one and says so, and when a number is not known it shows <strong>Unknown</strong> rather than zero.
        </p>
      </Section>

      <Section id="portfolio" n="07" title="Portfolio">
        <p>
          The Portfolio tab reads your shares directly from each vault contract and converts them into {sym} at the current rate. It
          shows your total, an estimate of daily earnings and your blended APY.
        </p>
        <p>
          <strong>Profit</strong> is calculated from deposits and withdrawals made through VATE in the same browser: current value
          plus tracked withdrawals minus tracked deposits. A position that was opened elsewhere shows <em>not tracked</em>, and one
          whose shares changed outside this browser shows <em>incomplete</em>. Its value is still correct; only the cost basis is
          unknown here. Clearing the browser data removes this local history, not your position.
        </p>
      </Section>

      <Section id="risks" n="08" title="Risks">
        <ul>
          <li><strong>Smart-contract risk:</strong> vault, token or lending contracts could have bugs.</li>
          <li><strong>Curator risk:</strong> curators choose where vault funds are lent, and they can make mistakes.</li>
          <li><strong>Borrower and market risk:</strong> sharp price moves can cause bad debt in lending markets.</li>
          <li><strong>Liquidity risk:</strong> you may not be able to withdraw everything at once.</li>
          <li><strong>Stablecoin and issuer risk:</strong> USDG could lose its dollar peg, and its issuer can pause the token or freeze addresses.</li>
          <li><strong>Network risk:</strong> Robinhood Chain or its RPC providers could be congested or unavailable.</li>
          <li><strong>Interface risk:</strong> this website could be unavailable or show delayed data. Your shares stay in your wallet regardless, and can be redeemed directly at the vault contract.</li>
        </ul>
        <p>Only deposit what you can afford to lose. Read the <Link className="lnk" href="/terms">Terms</Link> before using the app.</p>
      </Section>

      <Section id="network" n="09" title="Network & contracts">
        <h3>{test ? 'This deployment: testnet' : 'Network'}</h3>
        <NetworkTable n={NETWORK} />
        <h3>{test ? 'Test vaults (VATE test fixture, ERC-4626)' : 'Supported vaults (Morpho Vault V2, ERC-4626)'}</h3>
        <VaultTable n={NETWORK} />
        {test ? (
          <>
            <p style={{ marginTop: 14 }}>
              The test contracts live in the <code>contracts/</code> folder of the VATE repository. They are deployed by one
              permissionless transaction through the canonical CREATE2 deployer, so their addresses are fixed in advance and nobody
              keeps a privileged role. Their yield is simulated. They are not Morpho contracts and are not operated by any curator.
            </p>
            <h3>Mainnet reference</h3>
            <NetworkTable n={NETWORKS.mainnet} />
            <VaultTable n={NETWORKS.mainnet} />
          </>
        ) : null}
        <h3>VATE token</h3>
        <TokenChip />
        <p className="token-note">
          {SITE.tokenAddress
            ? 'This is the only VATE token contract. Check the address before interacting with it.'
            : 'VATE has not published a token contract. Any token claiming to be VATE today is not from this project. The token is not needed to use the vaults.'}
        </p>
      </Section>

      <Section id="faq" n="10" title="FAQ">
        <details>
          <summary>Does VATE charge a fee?</summary>
          <p>VATE adds no fee of its own. Vaults may take a performance or management fee from yield, shown in the app, and you pay network gas in ETH.</p>
        </details>
        <details>
          <summary>Can VATE access or freeze my funds?</summary>
          <p>No. VATE is only an interface. Your shares sit in your own wallet and only you can withdraw them. Disconnecting your wallet here does not revoke token approvals on-chain; VATE only ever asks for the exact amount of a deposit, which the deposit then uses up.</p>
        </details>
        <details>
          <summary>Why can’t I deposit ETH or other tokens directly?</summary>
          <p>These vaults accept USDG only. Swap to USDG on a Robinhood Chain exchange first.</p>
        </details>
        <details>
          <summary>My wallet says “wrong network”.</summary>
          <p>Press the button in the app and approve the switch to {NETWORK.label} (chain ID {NETWORK.chain.id}) in your wallet. No transaction is sent while your wallet is on another network.</p>
        </details>
        <details>
          <summary>The app says the transaction was rejected in simulation.</summary>
          <p>Nothing was sent and no gas was spent. Common causes: not enough USDG, the amount is above what the vault can pay out right now, or your balance changed. Try a smaller amount or wait a moment.</p>
        </details>
        <details>
          <summary>A transaction is “still waiting for confirmation”. What now?</summary>
          <p>It was sent, but no receipt has arrived yet. Do not send it again. VATE keeps looking for the receipt, also after you reload the page, and updates your activity when it arrives. You can follow it on the explorer.</p>
        </details>
        <details>
          <summary>Does VATE Ranking move my money automatically?</summary>
          <p>No. VATE Ranking ranks vaults and explains why. You decide and sign every move yourself.</p>
        </details>
      </Section>
    </PageShell>
  );
}
