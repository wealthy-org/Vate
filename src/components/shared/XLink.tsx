import { SITE } from '@/config/site';

/**
 * The link to VATE's official X account: a round icon button, in every header and footer.
 * `named` adds the handle beside the logo, for places with room for it. Styled by `.xlink`
 * in globals.css. A plain link: nothing is loaded from X unless it is clicked.
 */
export function XLink({ named = false, className, onMouseEnter }: { named?: boolean; className?: string; onMouseEnter?: () => void }) {
  const handle = SITE.xHandle;
  return (
    <a
      className={`xlink${named && handle ? ' named' : ''}${className ? ` ${className}` : ''}`}
      href={SITE.xUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`VATE on X${handle ? `, ${handle}` : ''} (opens in a new tab)`}
      title={`VATE on X${handle ? ` · ${handle}` : ''}`}
      onMouseEnter={onMouseEnter}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
      </svg>
      {named && handle ? <span>{handle}</span> : null}
    </a>
  );
}
