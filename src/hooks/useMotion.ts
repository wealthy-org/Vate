'use client';

import { useSyncExternalStore } from 'react';

function subscribe(query: string) {
  return (onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  };
}

const reduced = '(prefers-reduced-motion: reduce)';
const subscribeReduced = subscribe(reduced);

/** True when the user asked the system to reduce motion. False during server rendering. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(reduced).matches,
    () => false,
  );
}

const subscribeNoop = () => () => {};
/** True after hydration. Lets a component render time-dependent content only on the client. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}
