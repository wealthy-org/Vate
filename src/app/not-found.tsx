import Link from 'next/link';
import { Mark } from '@/components/shared/Mark';

export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      <div className="bg-glow" />
      <div>
        <Mark className="mx-auto h-16 w-16" />
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.28em] text-accent-hover">404 · off the chart</p>
        <h1 className="mt-4 text-4xl font-bold uppercase tracking-tight text-ink" style={{ fontVariationSettings: '"wdth" 108' }}>
          No orbit <em className="font-serif font-normal normal-case text-accent">here</em>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-ink-2">This page does not exist. The vaults, the docs and the landing page do.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/" className="rounded-full border border-line-strong bg-surface px-5 py-3 text-[13px] font-semibold text-ink hover:border-accent">Home</Link>
          <Link href="/app" className="rounded-full bg-accent px-5 py-3 text-[13px] font-semibold text-white hover:bg-accent-hover">Launch app ↗</Link>
        </div>
      </div>
    </main>
  );
}
