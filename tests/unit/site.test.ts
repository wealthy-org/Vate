import { afterEach, describe, expect, it, vi } from 'vitest';

/** The site configuration as built with NEXT_PUBLIC_X_URL set to `value` (undefined: not set). */
async function siteWith(value: string | undefined) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_X_URL', value);
  return (await import('@/config/site')).SITE;
}

describe('official X account', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is https://x.com/VateVault unless configured otherwise', async () => {
    const site = await siteWith(undefined);
    expect(site.xUrl).toBe('https://x.com/VateVault');
    expect(site.xHandle).toBe('@VateVault');
  });

  it('follows NEXT_PUBLIC_X_URL, and the handle follows the address', async () => {
    const site = await siteWith(' https://x.com/Other_Name1/ ');
    expect(site.xUrl).toBe('https://x.com/Other_Name1');
    expect(site.xHandle).toBe('@Other_Name1');
  });

  it('ignores a value that is not an https address', async () => {
    for (const bad of ['', '   ', 'VateVault', 'javascript:alert(1)', 'http://x.com/VateVault', 'ftp://x.com/VateVault']) {
      const site = await siteWith(bad);
      expect(site.xUrl, JSON.stringify(bad)).toBe('https://x.com/VateVault');
      expect(site.xHandle, JSON.stringify(bad)).toBe('@VateVault');
    }
  });

  it('shows no handle for an address that is not a profile', async () => {
    for (const other of ['https://x.com', 'https://x.com/i/communities/1234', 'https://x.com/not-a-handle', 'https://x.com/ANameThatIsTooLong']) {
      const site = await siteWith(other);
      expect(site.xUrl, other).toBe(other);
      expect(site.xHandle, other).toBeNull();
    }
  });
});
