/**
 * The canonical Custodian identity (public/character/00-custodian-canon.png).
 *
 * Decorative only: it is a crop of the approved sheet, never redrawn, and is
 * hidden below `lg` so facts and actions always come first on small screens.
 * Use it at a meaningful Custodian moment (quiet/attention Home, an empty
 * Investigations state, Finding output) — never in Settings, tables, generic
 * loading or diagnostics.
 */
export const CUSTODIAN_FIGURE_SRC = "/character/00-custodian-figure.webp";

export function CustodianFigure({ className = "" }: { className?: string }) {
  return (
    <img
      src={CUSTODIAN_FIGURE_SRC}
      alt=""
      aria-hidden="true"
      width={392}
      height={1024}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`custodian-figure pointer-events-none hidden select-none lg:block ${className}`}
    />
  );
}
