'use client';

import { useRef, useState } from 'react';
import { explorerToken, NETWORK } from '@/config/networks';
import { SITE } from '@/config/site';

/**
 * VATE token contract widget. Until a contract address is configured it shows
 * "Contract pending" with copy and explorer disabled — never a placeholder address.
 */
export function TokenChip({ className }: { className?: string }) {
  const address = SITE.tokenAddress;
  const [label, setLabel] = useState('Copy');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeRef = useRef<HTMLElement>(null);

  async function copy() {
    if (!address) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(address);
      ok = true;
    } catch {
      // Clipboard blocked: select the address so Ctrl+C works.
      const el = codeRef.current;
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    setLabel(ok ? 'Copied ✓' : 'Press Ctrl+C');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel('Copy'), 1800);
  }

  return (
    <div className={`ca${className ? ` ${className}` : ''}`}>
      <span className="ca-tag">${SITE.tokenSymbol} · CA</span>
      {address ? (
        <code className="ca-addr" ref={codeRef}>{address}</code>
      ) : (
        <span className="ca-addr pending">Contract pending</span>
      )}
      <button
        className={`ca-copy${label.startsWith('Copied') ? ' ok' : ''}`}
        type="button"
        onClick={copy}
        disabled={!address}
        aria-label={address ? 'Copy VATE contract address' : 'Copy unavailable: the VATE contract is not published yet'}
      >
        {label}
      </button>
      {address ? (
        <a className="ca-link" href={explorerToken(NETWORK, address)} target="_blank" rel="noopener noreferrer" aria-label="View VATE on the explorer">↗</a>
      ) : (
        <span className="ca-link" aria-disabled="true" role="link" aria-label="Explorer link unavailable: the VATE contract is not published yet">↗</span>
      )}
    </div>
  );
}
