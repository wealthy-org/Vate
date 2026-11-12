import type { Metadata } from 'next';
import { VateApp } from '@/components/app/VateApp';
import '@/styles/app.css';
import '@/styles/share-card.css';

export const metadata: Metadata = {
  title: 'App',
  description:
    'VATE app: compare curated USDG vaults on Robinhood Chain by live yield, depth and withdrawable liquidity, then deposit and withdraw directly from your own wallet.',
};

export default function AppPage() {
  return <VateApp />;
}
