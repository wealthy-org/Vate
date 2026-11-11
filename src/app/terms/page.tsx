import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell, Pending, Section } from '@/components/pages/PageShell';
import { NETWORK } from '@/config/networks';
import { SITE } from '@/config/site';
import '@/styles/pages.css';

export const metadata: Metadata = { title: 'Terms & Conditions', description: 'Terms and conditions for using the VATE interface.' };

export default function TermsPage() {
  const draft = !SITE.operatorName || !SITE.operatorJurisdiction || !SITE.contactEmail;
  const operator = <Pending value={SITE.operatorName} what="operator name" />;
  return (
    <PageShell
      current="/terms"
      eyebrow="Legal"
      title={<><span className="outline">Terms &amp;</span><em>Conditions</em></>}
      lede="Please read these terms carefully. By using VATE you agree to them. If you do not agree, do not use the interface."
      updated={`Version ${SITE.termsVersion}`}
    >
      {draft ? (
        <div className="callout warn" role="note">
          <b>Draft, not yet in force.</b> The operator’s legal name, jurisdiction and contact have not been configured for this
          deployment, and this text has not been reviewed by counsel. The marked fields below must be completed before VATE is
          offered to the public.
        </div>
      ) : null}

      <Section id="who" n="01" title="Who we are">
        <p>
          VATE (the “Interface”) is operated by {operator}, established in <Pending value={SITE.operatorJurisdiction} what="jurisdiction" />
          {' '}(“we”, “us”). These terms are an agreement between you and us about your use of the Interface.
        </p>
      </Section>

      <Section id="what" n="02" title="What the Interface is">
        <p>
          The Interface is a website that displays information about third-party lending vaults on Robinhood Chain and helps you
          prepare transactions that <strong>you</strong> sign and send from your own wallet. Specifically:
        </p>
        <ul>
          <li>We do not hold, control or have access to your assets, private keys or seed phrase at any time.</li>
          <li>We do not operate the vaults, the USDG token, the lending markets, Robinhood Chain or your wallet. They are run by third parties under their own terms.</li>
          <li>Deposits go directly from your wallet to the vault contract you select. The vault issues shares to your wallet.</li>
          <li>VATE Ranking is a published formula applied to public data. It does not move funds and does not act on your behalf.</li>
          <li>You can interact with the vault contracts without the Interface. If the Interface is unavailable, your position is unaffected.</li>
        </ul>
        {NETWORK.isTestnet ? (
          <p>
            This deployment is connected to a test network. The vaults and the token shown are VATE test contracts with no monetary
            value, provided for trying the Interface only.
          </p>
        ) : null}
      </Section>

      <Section id="eligibility" n="03" title="Eligibility">
        <p>You may use the Interface only if all of the following are true:</p>
        <ul>
          <li>You are at least 18 years old and able to enter into a binding agreement.</li>
          <li>Using the Interface and the underlying protocols is lawful where you live and are located.</li>
          <li>You are not subject to sanctions and are not located in a sanctioned or embargoed territory.</li>
        </ul>
        <p>You are responsible for finding out which laws and taxes apply to you.</p>
      </Section>

      <Section id="advice" n="04" title="No advice">
        <p>
          Nothing on the Interface is financial, investment, legal or tax advice. Scores, rankings, the “VATE Pick” label, APY
          figures, estimates and explanations are information generated from public data by a fixed formula. They are not a
          recommendation to deposit into any vault and not a prediction of returns. You alone decide what to do.
        </p>
      </Section>

      <Section id="risks" n="05" title="Risks you accept">
        <p>Using decentralised finance involves significant risk, including the loss of everything you deposit. In particular:</p>
        <ul>
          <li><strong>Smart-contract risk:</strong> vault, token and lending contracts may contain bugs or be exploited.</li>
          <li><strong>Curator and market risk:</strong> third-party curators allocate vault funds; borrowers may default and markets may suffer bad debt.</li>
          <li><strong>Liquidity risk:</strong> you may be unable to withdraw some or all of your position when you want to.</li>
          <li><strong>Stablecoin and issuer risk:</strong> USDG may lose its peg; its issuer can pause the token or freeze addresses.</li>
          <li><strong>Network risk:</strong> Robinhood Chain, bridges, RPC providers or your wallet may fail, be congested or be attacked.</li>
          <li><strong>Data risk:</strong> figures shown come from third-party sources and may be delayed, incomplete or wrong. Yields are variable.</li>
          <li><strong>Irreversibility:</strong> blockchain transactions cannot be undone by us or by anyone else.</li>
        </ul>
      </Section>

      <Section id="responsibilities" n="06" title="Your responsibilities">
        <ul>
          <li>Keep your wallet, device and seed phrase secure. We will never ask for your seed phrase or private key.</li>
          <li>Check every transaction in your wallet before you sign it, including the contract address and the amount.</li>
          <li>Make sure you are on the genuine VATE website before connecting a wallet.</li>
          <li>Do not use the Interface for unlawful purposes, to interfere with it, or to access it by automated means that burden it.</li>
        </ul>
      </Section>

      <Section id="fees" n="07" title="Fees">
        <p>
          We currently charge no fee for using the Interface. Vaults may charge performance or management fees, which are shown in
          the app as reported by their data sources, and every transaction costs network gas paid in ETH. If we introduce a fee, it
          will be shown before you sign and these terms will be updated first.
        </p>
      </Section>

      <Section id="third-parties" n="08" title="Third-party services">
        <p>
          The Interface relies on services we do not control: the vault contracts and their curators, the USDG token, Robinhood
          Chain and its RPC endpoints, block explorers, data providers such as the Morpho API and DeFiLlama, bridges, and your
          wallet software. Links to them are provided for convenience. We are not responsible for their availability, accuracy,
          security or terms, and listing a vault does not mean we endorse or have audited it.
        </p>
      </Section>

      <Section id="ip" n="09" title="Intellectual property">
        <p>
          The VATE name, logo, design and website content belong to us or our licensors. You may use the Interface for its intended
          purpose. Third-party names and marks belong to their owners and are used only to identify their products.
        </p>
      </Section>

      <Section id="warranty" n="10" title="No warranty">
        <p>
          The Interface is provided “as is” and “as available”, without warranties of any kind, whether express or implied,
          including accuracy of data, fitness for a particular purpose, uninterrupted availability and absence of errors, to the
          extent the law allows.
        </p>
      </Section>

      <Section id="liability" n="11" title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, we are not liable for any loss of assets, profits or data, or for any indirect,
          incidental or consequential loss, arising from your use of the Interface, the vaults, the token, the network, your wallet
          or any third-party service. Nothing in these terms excludes liability that cannot be excluded by law.
        </p>
      </Section>

      <Section id="indemnity" n="12" title="Indemnity">
        <p>
          You agree to indemnify us against claims, losses and costs that arise from your breach of these terms or your unlawful use
          of the Interface.
        </p>
      </Section>

      <Section id="changes" n="13" title="Changes and termination">
        <p>
          We may change the Interface or these terms. The version identifier at the top changes when the terms do, and the app asks
          for your acknowledgement again. We may suspend or restrict access to the Interface at any time, for example for legal or
          security reasons. This does not affect assets in your wallet or in the vaults.
        </p>
      </Section>

      <Section id="law" n="14" title="Governing law and disputes">
        <p>
          These terms are governed by the laws of <Pending value={SITE.operatorJurisdiction} what="governing law" />. Disputes are
          subject to the courts of that jurisdiction, unless mandatory consumer law where you live says otherwise.
        </p>
      </Section>

      <Section id="contact" n="15" title="Contact">
        <p>
          Questions about these terms: {SITE.contactEmail ? <a className="lnk" href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> : <span className="ph">contact address pending</span>}.
          See also the <Link className="lnk" href="/privacy">Privacy Policy</Link> and the <Link className="lnk" href="/docs">documentation</Link>.
        </p>
      </Section>
    </PageShell>
  );
}
