import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell, Pending, Section } from '@/components/pages/PageShell';
import { env } from '@/config/env';
import { NETWORK } from '@/config/networks';
import { SITE } from '@/config/site';
import '@/styles/pages.css';

export const metadata: Metadata = { title: 'Privacy Policy', description: 'What the VATE interface stores, what it does not collect, and which third parties your browser talks to.' };

export default function PrivacyPage() {
  const draft = !SITE.operatorName || !SITE.contactEmail || !SITE.hostingProvider;
  const mainnetData = NETWORK.dataSource === 'morpho-defillama';
  return (
    <PageShell
      current="/privacy"
      eyebrow="Legal"
      title={<><span className="outline">Privacy</span><em>Policy</em></>}
      lede="Short version: VATE has no accounts, no sign-ups and no database of users. What little the app remembers stays in your own browser."
      updated={`Version ${SITE.termsVersion}`}
    >
      {draft ? (
        <div className="callout warn" role="note">
          <b>Draft.</b> The operator, contact and hosting provider have not been configured for this deployment. The technical
          description below matches what the software does; the marked fields must be completed before public launch.
        </div>
      ) : null}

      <Section id="who" n="01" title="Who is responsible">
        <p>
          The VATE website is operated by <Pending value={SITE.operatorName} what="operator name" />. Contact:{' '}
          {SITE.contactEmail ? <a className="lnk" href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> : <span className="ph">contact address pending</span>}.
        </p>
      </Section>

      <Section id="not-collected" n="02" title="What we do not collect">
        <ul>
          <li>No accounts, names, email addresses or passwords.</li>
          <li>No seed phrases or private keys. The app cannot see them and never asks for them.</li>
          <li>No cookies set by VATE, no advertising identifiers, no fingerprinting.</li>
          <li>No analytics or tracking scripts, and no third-party scripts or fonts loaded from other websites.</li>
          <li>No server-side record of your wallet address, balances, positions or transactions.</li>
        </ul>
      </Section>

      <Section id="browser" n="03" title="What stays in your browser">
        <p>The app saves a few items in your browser’s local storage so it works across visits. They never leave your device through VATE, and clearing your browser data removes them.</p>
        <div className="tbl">
          <table>
            <thead><tr><th>Key</th><th>Purpose</th></tr></thead>
            <tbody>
              <tr><td><code>vate-ack-v1-{SITE.termsVersion}</code></td><td>That you ticked the risk acknowledgement for this version of the Terms.</td></tr>
              <tr><td><code>vate-wallet-v1.*</code></td><td>Which wallet you last connected, so an already approved session can be restored without a popup.</td></tr>
              <tr><td><code>vate-tx-{'{chainId}'}-{'{address}'}</code></td><td>Up to 200 deposits and withdrawals you made through VATE, for the activity list.</td></tr>
              <tr><td><code>vate-pos-v1-{'{chainId}'}-{'{address}'}-{'{vault}'}</code></td><td>Running totals per vault, used only to calculate “Profit (tracked)”.</td></tr>
              <tr><td><code>vate-pending-{'{chainId}'}-{'{address}'}</code></td><td>Transactions that were sent but not yet confirmed, so they can be checked again after a reload.</td></tr>
              <tr><td><code>vate-sound-v1</code></td><td>Whether you switched the landing page music off or back on.</td></tr>
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 14 }}>This history exists only in the browser where it was created. It is not synchronised and cannot be recovered by us.</p>
      </Section>

      <Section id="chain" n="04" title="Your wallet address and the blockchain">
        <p>
          When you connect a wallet, the app learns your public address from the wallet and uses it to read your balances and
          positions from the chain. Transactions you sign are public and permanent on Robinhood Chain: anyone can see the address,
          the contract and the amounts. VATE cannot change or delete blockchain data.
        </p>
      </Section>

      <Section id="third-parties" n="05" title="Third parties your browser talks to">
        <p>To show live data, your browser sends requests to the services below. Each of them receives your IP address and technical request data, under its own privacy policy.</p>
        <div className="tbl">
          <table>
            <thead><tr><th>Service</th><th>Why</th><th>What it can see</th></tr></thead>
            <tbody>
              <tr>
                <td>RPC endpoints<br />{NETWORK.rpcUrls.map((u) => <div key={u}><code>{new URL(u).host}</code></div>)}</td>
                <td>Latest block, vault data, your balances, allowances and positions, transaction receipts.</td>
                <td>Your IP address and the public addresses being queried, which links the two.</td>
              </tr>
              {mainnetData ? (
                <tr>
                  <td>Morpho API, DeFiLlama<br /><code>api.morpho.org</code><br /><code>yields.llama.fi</code><br /><code>api.llama.fi</code></td>
                  <td>Vault statistics, APY history and chain TVL.</td>
                  <td>
                    {env.dataMode === 'proxy'
                      ? 'Normally nothing about you: the VATE server fetches and caches this data, so these services see the server. If that cache is unavailable, your browser asks them directly and they see your IP address. No wallet address is sent either way.'
                      : 'Your IP address. No wallet address is sent.'}
                  </td>
                </tr>
              ) : null}
              <tr>
                <td>Your wallet</td>
                <td>Connecting, switching network, signing.</td>
                <td>Your wallet has its own RPC provider and privacy policy, separate from VATE.</td>
              </tr>
              <tr>
                <td>Block explorer<br /><code>{new URL(NETWORK.explorerUrl).host}</code></td>
                <td>Only when you click an explorer link.</td>
                <td>Your IP address and the page you open.</td>
              </tr>
              <tr>
                <td>Hosting<br /><Pending value={SITE.hostingProvider} what="hosting provider" /></td>
                <td>Delivering this website.</td>
                <td>Your IP address, browser type and the pages requested, in standard server logs kept by the provider.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="analytics" n="06" title="Analytics">
        <p>VATE does not use analytics, tracking pixels or advertising networks. If that ever changes, this policy will be updated before it happens.</p>
      </Section>

      <Section id="rights" n="07" title="Your rights">
        <p>
          Because VATE keeps no user database, there is normally no personal data held by us to access, correct or delete. You
          control the local data by clearing your browser storage. Depending on where you live, you may have further rights under
          data-protection law, including the right to complain to a supervisory authority. For any request, use the contact above.
        </p>
      </Section>

      <Section id="children" n="08" title="Children">
        <p>The Interface is not directed at anyone under 18, and the <Link className="lnk" href="/terms">Terms</Link> do not allow them to use it.</p>
      </Section>

      <Section id="changes" n="09" title="Changes">
        <p>When this policy changes, the version identifier at the top changes with it. Material changes will be described on this page.</p>
      </Section>
    </PageShell>
  );
}
