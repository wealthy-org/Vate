// What goes with a share card when it leaves the dialog: the name of the saved file, the sentence
// for a post and the address that opens the X composer. Pure, like the card model itself.
import type { CardModel } from './share-card';

/** "VATE Test Vault II" → "vate-test-vault-ii-card.png". Only letters, digits and hyphens. */
export function cardFileName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  if (!slug) return 'vate-card.png';
  return `${slug.startsWith('vate') ? slug : `vate-${slug}`}-card.png`;
}

/**
 * One sentence for a post, built from the card's big figure. It says nothing the card does not
 * show: with the amounts switched off, no amount appears here either.
 */
export function shareText(model: Pick<CardModel, 'title' | 'headline' | 'testnet'>, handle: string | null): string {
  const { headline } = model;
  let lead: string;
  if (headline.kind === 'apy') lead = `${model.title}: ${headline.value} APY right now`;
  else if (headline.kind === 'percent') lead = `${model.title}: ${headline.value} so far`;
  else if (headline.kind === 'profit') lead = `${model.title}: ${headline.value} ${headline.unit ?? ''}`.trimEnd() + ' so far';
  else lead = `My position in ${model.title}`;
  return `${lead} on ${handle ?? 'VATE'}${model.testnet ? ' (testnet, no real value)' : ''}`;
}

/**
 * The address that opens the X composer with the text, and the link if there is one, filled in.
 * A link can carry no image: X takes those only from the person posting.
 */
export function xIntentUrl(text: string, url?: string | null): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}${url ? `&url=${encodeURIComponent(url)}` : ''}`;
}
