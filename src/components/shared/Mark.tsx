/** VATE's own orbital mark: two tilted orbits, a "V" keel and one satellite. */
export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.3" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <circle cx="20" cy="20" r="17" />
      <ellipse cx="20" cy="20" rx="17" ry="6.5" transform="rotate(-28 20 20)" />
      <ellipse cx="20" cy="20" rx="17" ry="6.5" transform="rotate(32 20 20)" opacity=".5" />
      <path d="M14 13.4 20 27l6-13.6" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="34.6" cy="12.4" r="2.1" fill="var(--accent-secondary)" stroke="none" />
    </svg>
  );
}
