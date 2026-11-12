import logo from './vate-logo.png';

/**
 * The VATE logo (glass "V" with the orbit swoosh), a transparent PNG so it sits on any light
 * surface. Decorative by default: the links around it carry the accessible name. Its size comes
 * from CSS (`.brand img`, `.logo img`) or from the classes passed in.
 */
export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <img
      className={className}
      src={logo.src}
      width={logo.width}
      height={logo.height}
      alt={title ?? ''}
      decoding="async"
      draggable={false}
    />
  );
}
