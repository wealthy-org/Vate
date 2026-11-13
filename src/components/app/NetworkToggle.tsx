'use client';

export function NetworkToggle({ active, onSwitch, disabled = false }: {
  active: 'mainnet' | 'testnet';
  onSwitch: (key: 'mainnet' | 'testnet') => void;
  disabled?: boolean;
}) {
  return (
    <div className="net-toggle" role="group" aria-label="Network">
      {(['mainnet', 'testnet'] as const).map((key) => (
        <button type="button" key={key} className={`net-btn${active === key ? ' net-active' : ''}`}
          aria-label={key === 'mainnet' ? 'Mainnet' : 'Testnet'} aria-pressed={active === key} disabled={disabled} onClick={() => { if (active !== key) onSwitch(key); }}>
          <span className="net-dot" aria-hidden="true" />
          <span>{key === 'mainnet' ? 'Mainnet' : 'Testnet'}</span>
          {key === 'mainnet' ? <span className="net-live">LIVE</span> : null}
        </button>
      ))}
    </div>
  );
}
