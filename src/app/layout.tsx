import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { SITE } from '@/config/site';
import { fontVariables } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: SITE.siteUrl ? new URL(SITE.siteUrl) : undefined,
  title: { default: SITE.title, template: '%s · VATE' },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: { type: 'website', siteName: SITE.name, title: SITE.title, description: SITE.description },
  twitter: { card: 'summary', title: SITE.title, description: SITE.description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F7FAF9',
  colorScheme: 'light',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every response carries a per-request CSP nonce (src/proxy.ts), so pages render per request.
  await connection();
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
