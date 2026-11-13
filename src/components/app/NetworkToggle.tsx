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
          aria-pressed={active === key} disabled={disabled} onClick={() => { if (active !== key) onSwitch(key); }}>
          {key === 'mainnet' ? 'Mainnet' : 'Testnet'}
        </button>
      ))}
    </div>
  );
}
