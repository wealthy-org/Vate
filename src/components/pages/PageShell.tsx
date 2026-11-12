import Link from 'next/link';
import type { ReactNode } from 'react';
import { Mark } from '@/components/shared/Mark';
import { XLink } from '@/components/shared/XLink';
import { SITE } from '@/config/site';
import { TocNav } from './TocNav';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
] as const;

export interface TocItem {
  id: string;
  label: string;
}

export function PageShell({
  current,
  eyebrow,
  title,
  lede,
  updated,
  toc,
  children,
}: {
  current: '/docs' | '/terms' | '/privacy';
  eyebrow: string;
  title: ReactNode;
  lede: string;
  updated?: string;
  toc?: TocItem[];
  children: ReactNode;
}) {
  return (
    <div className="dp">
      <div className="bg-glow" />
      <div className="grain" />
      <header className="dp-header">
        <Link className="brand" href="/" aria-label="VATE home">
          <Mark />
          VATE
        </Link>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.href === current ? 'page' : undefined}>{n.label}</Link>
          ))}
        </nav>
        <XLink />
        <Link className="launch" href="/app">Launch App ↗</Link>
      </header>
      <div className="dp-hero">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        {updated ? <div className="updated">{updated}</div> : null}
      </div>
      <div className={`layout${toc ? '' : ' single'}`}>
        {toc ? <TocNav items={toc} /> : null}
        <article>{children}</article>
      </div>
      <footer className="dp-footer">
        <span>© {SITE.year} VATE</span>
        <div className="right">
          <nav aria-label="Footer">
            <Link href="/">Home</Link>
            <Link href="/app">Launch App</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/terms">Terms &amp; Conditions</Link>
            <Link href="/privacy">Privacy Policy</Link>
          </nav>
          <XLink />
        </div>
      </footer>
    </div>
  );
}

export function Section({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return (
    <section id={id}>
      <h2><span className="n">{n}</span>{title}</h2>
      {children}
    </section>
  );
}

/** Operator facts that are not configured yet are shown as an explicit placeholder. */
export function Pending({ value, what }: { value: string | null; what: string }) {
  return value ? <>{value}</> : <span className="ph">{what} pending</span>;
}
