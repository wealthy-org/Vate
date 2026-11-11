'use client';

import { useEffect, useState } from 'react';
import type { TocItem } from './PageShell';

/** Table of contents that highlights the section currently in view. */
export function TocNav({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: '-35% 0px -60% 0px' },
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [items]);
  return (
    <nav className="toc" aria-label="On this page">
      <div className="t">On this page</div>
      {items.map((item) => (
        <a key={item.id} href={`#${item.id}`} aria-current={active === item.id ? 'true' : undefined}>{item.label}</a>
      ))}
    </nav>
  );
}
