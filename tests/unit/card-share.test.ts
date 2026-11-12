import { describe, expect, it } from 'vitest';
import { cardFileName, shareText, xIntentUrl } from '@/lib/card-share';
import type { CardModel } from '@/lib/share-card';

const model = (kind: CardModel['headline']['kind'], value: string, unit: string | null, testnet = false, title = 'Galaxy USDG RH Stock Tokens') =>
  ({ title, testnet, headline: { kind, label: '', value, unit, tone: 'up' } }) satisfies Pick<CardModel, 'title' | 'headline' | 'testnet'>;

describe('cardFileName', () => {
  it('names the file after the vault', () => {
    expect(cardFileName('VATE Test Vault II')).toBe('vate-test-vault-ii-card.png');
    expect(cardFileName('Galaxy USDG RH Stock Tokens')).toBe('vate-galaxy-usdg-rh-stock-tokens-card.png');
  });

  it('keeps nothing a file system could trip over', () => {
    for (const title of ['../../etc/passwd', 'a\\b:c*d?"e<f>g|h', 'Ünïcödé Väult — №1', '   ', '', 'x'.repeat(300), '.hidden', 'CON']) {
      const name = cardFileName(title);
      expect(name, title).toMatch(/^vate(-[a-z0-9]+)*-card\.png$|^vate-card\.png$/);
      expect(name.length, title).toBeLessThanOrEqual(64);
    }
    expect(cardFileName('')).toBe('vate-card.png');
    expect(cardFileName('../../etc/passwd')).toBe('vate-etc-passwd-card.png');
  });
});

describe('shareText', () => {
  it('leads with the figure the card leads with', () => {
    expect(shareText(model('apy', '7.41%', null), '@VateVault')).toBe('Galaxy USDG RH Stock Tokens: 7.41% APY right now on @VateVault');
    expect(shareText(model('percent', '+2.88%', null), '@VateVault')).toBe('Galaxy USDG RH Stock Tokens: +2.88% so far on @VateVault');
    expect(shareText(model('profit', '+34,567.89', 'USDG'), '@VateVault')).toBe('Galaxy USDG RH Stock Tokens: +34,567.89 USDG so far on @VateVault');
  });

  it('gives no amount when the card falls back to the value in the vault', () => {
    expect(shareText(model('value', '9,000.06', 'tUSDG', true, 'VATE Test Vault II'), '@VateVault')).toBe('My position in VATE Test Vault II on @VateVault (testnet, no real value)');
  });

  it('says so on testnet, and never shows a dollar sign', () => {
    const text = shareText(model('profit', '+0.0655', 'tUSDG', true, 'VATE Test Vault II'), '@VateVault');
    expect(text).toBe('VATE Test Vault II: +0.0655 tUSDG so far on @VateVault (testnet, no real value)');
    expect(text).not.toContain('$');
  });

  it('names VATE when the account has no handle', () => {
    expect(shareText(model('apy', '7.41%', null), null)).toBe('Galaxy USDG RH Stock Tokens: 7.41% APY right now on VATE');
  });

  it('fits in a post with room to spare', () => {
    expect(shareText(model('profit', '+1,234,567,890.123456', 'tUSDG', true, 'A Vault With A Rather Long Name For Its Kind'), '@VateVault').length).toBeLessThan(200);
  });
});

describe('xIntentUrl', () => {
  it('opens the X composer with the text and the link', () => {
    const url = new URL(xIntentUrl('VATE Test Vault II: +2.88% so far on @VateVault & more #1', 'https://vate.example/app?x=1&y=2'));
    expect(url.origin + url.pathname).toBe('https://x.com/intent/post');
    expect([...url.searchParams.keys()]).toEqual(['text', 'url']);
    expect(url.searchParams.get('text')).toBe('VATE Test Vault II: +2.88% so far on @VateVault & more #1');
    expect(url.searchParams.get('url')).toBe('https://vate.example/app?x=1&y=2');
  });

  it('leaves the link out when there is none', () => {
    for (const none of [null, undefined, '']) {
      const url = new URL(xIntentUrl('hello', none));
      expect([...url.searchParams.keys()]).toEqual(['text']);
    }
  });
});
