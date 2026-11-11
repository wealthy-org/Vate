// Landing page copy. VATE wording: the ranking is a formula that informs a choice; nothing here
// promises automatic movement of funds or a return.
export const FEATURES: { title: string; body: string }[] = [
  {
    title: 'Robinhood Chain Native',
    body: 'Built for Robinhood Chain, an Ethereum Layer 2. Low fees and quick confirmations every time you put USDG to work or take it back.',
  },
  {
    title: 'Real Yield',
    body: 'Vault yield comes from lending demand. VATE shows how much of each APY is base yield and how much is temporary rewards, and says so when the split is unknown.',
  },
  {
    title: 'VATE Ranking',
    body: 'Every vault gets a score from its yield, deposit depth and withdrawable liquidity, refreshed every 90 seconds, so the pick reflects today’s market, not last month’s.',
  },
  {
    title: 'Non-Custodial',
    body: 'VATE never holds your funds. You sign every transaction in your own wallet and can exit whenever the vault has liquidity.',
  },
  {
    title: 'Curated Vaults Only',
    body: 'Only a short, reviewed list of curated vaults is shown, and each one is verified on-chain before it can receive funds. DeFi still carries risk: only commit what you can afford to lose.',
  },
];

export const ECOSYSTEM: { name: string; body: string }[] = [
  { name: 'Robinhood Chain', body: 'Ethereum Layer 2 built on Arbitrum technology. VATE reads from it and sends your signed transactions to it; gas is paid in ETH.' },
  { name: 'USDG', body: 'Dollar-backed stablecoin and the single asset these vaults accept, so your balance stays in dollars.' },
  { name: 'Curated vaults', body: 'Morpho Vault V2 lending vaults run by third-party risk curators. VATE only ranks vaults that pass its on-chain check.' },
  { name: 'Your wallet', body: 'Connect MetaMask, Rabby or any browser wallet that announces itself. No sign-ups, no seed phrases, no custody.' },
  { name: 'Blockscout explorer', body: 'Every transaction you make links to the public explorer, so anyone can verify it.' },
  { name: 'Arbitrum bridge', body: 'The official portal for moving funds from Ethereum onto Robinhood Chain before you start.' },
];

export const PRINCIPLES: { name: string; role: string; body: string; numeral: string }[] = [
  { name: 'Non-custodial', role: 'Principle 01', numeral: 'I', body: 'Funds move from your wallet into the vault and back to you. VATE never holds them, and no one else can move them.' },
  { name: 'You sign everything', role: 'Principle 02', numeral: 'II', body: 'Nothing happens without your approval. Every step opens in your own wallet, and you can say no at any point.' },
  { name: 'Curated only', role: 'Principle 03', numeral: 'III', body: 'VATE ranks a fixed, reviewed list of vaults. Each one is verified on-chain before it can receive a single dollar.' },
  { name: 'Transparent by default', role: 'Principle 04', numeral: 'IV', body: 'Yield is split into base and rewards, liquidity is shown up front, unknowns are labelled, and every transaction links to the explorer.' },
];

/** Decorative marginalia (Latin). "Vates" is the seer who reads the sky; it does not steer it. */
export const LORE = {
  heroLeft: 'Vates caelum legit, non regit. Numeri in catena scripti sunt; clavem tu solus tenes.',
  heroRight: 'Tres mensurae, una via: fructus, altitudo, exitus. Qui omnes tres videt, tutius navigat.',
  auto: 'Machina monstrat, manus signat. Nihil movetur sine sigillo tuo.',
};

export const YEARS = Array.from({ length: 60 }, (_, i) => 1571 + i);
