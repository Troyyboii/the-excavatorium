import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The Night Crypt icon set (24×24 grid, 1.6 stroke, `currentColor`).
 * Decorative by default: pair it with visible text. An icon-only control
 * names itself with its own `aria-label`; pass `label` only when the icon
 * alone must carry meaning.
 */
export const CRYPT_GLYPHS = [
  "candle",
  "chains",
  "chest",
  "coffin",
  "crypt",
  "ghost",
  "gravestone",
  "hood",
  "hourglass",
  "key",
  "lantern",
  "mound",
  "pickaxe",
  "quill",
  "raven",
  "scroll",
  "seal",
  "search",
  "shovel",
  "skull",
  "toppled",
  "urn",
] as const;

export type CryptGlyph = (typeof CRYPT_GLYPHS)[number];

const PATHS: Record<CryptGlyph, ReactNode> = {
  candle: (
    <>
      <path d="M12 2.5c1.9 2.1 1.9 4.2 0 5.8-1.9-1.6-1.9-3.7 0-5.8z" fill="currentColor" />
      <path d="M12 8.5v1.5" />
      <path d="M8.5 10.5h7v9h-7z" />
      <path d="M11 13v3" />
      <path d="M5.5 21h13" />
    </>
  ),
  chains: (
    <>
      <rect x="1.5" y="8.5" width="11" height="7" rx="3.5" />
      <rect x="11.5" y="8.5" width="11" height="7" rx="3.5" />
    </>
  ),
  chest: (
    <>
      <path d="M3 10c0-3.5 2.5-5.5 9-5.5s9 2 9 5.5v10H3z" />
      <path d="M3 12.5h18M7 5.5v15M17 5.5v15" />
      <rect x="10.5" y="11" width="3" height="4" rx="0.5" />
    </>
  ),
  coffin: (
    <>
      <path d="M9 2.5h6l3 5-2.5 14h-7L6 7.5z" />
      <path d="M11 3.5l8.5 1.5 1 3-1 2" strokeDasharray="2 2" />
      <path d="M10 9.5h4M12 8v5" />
    </>
  ),
  crypt: (
    <>
      <path d="M12 1.5v3M10.5 2.8h3" />
      <path d="M2.5 10.5L12 4.5l9.5 6" />
      <path d="M4.5 10.5v10M19.5 10.5v10M2.5 21h19" />
      <path d="M9.5 21v-5a2.5 2.5 0 0 1 5 0v5" />
    </>
  ),
  ghost: (
    <>
      <path d="M5.5 21V10.5a6.5 6.5 0 0 1 13 0V21l-2.2-1.6-2.1 1.6-2.2-1.6-2.1 1.6-2.2-1.6z" />
      <circle cx="9.7" cy="10.5" r="1" fill="currentColor" />
      <circle cx="14.3" cy="10.5" r="1" fill="currentColor" />
      <path d="M10.5 14.5c1 .7 2 .7 3 0" />
    </>
  ),
  gravestone: (
    <>
      <path d="M5.5 20.5V9.5a6.5 6.5 0 0 1 13 0v11" />
      <path d="M3 21h18" />
      <path d="M12 7.5v6.5M9.3 10h5.4" />
      <path d="M8.5 17h7" />
    </>
  ),
  hood: (
    <>
      <path d="M12 2.5c-4.5 0-7.5 4-7.5 9.5 0 4 1 7 2 9.5h11c1-2.5 2-5.5 2-9.5 0-5.5-3-9.5-7.5-9.5z" />
      <path d="M8.5 13c0-3 1.5-5 3.5-5s3.5 2 3.5 5-1.5 5-3.5 5-3.5-2-3.5-5z" />
      <circle cx="10.8" cy="12.3" r="0.8" fill="currentColor" />
      <circle cx="13.2" cy="12.3" r="0.8" fill="currentColor" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6.5 2.5h11M6.5 21.5h11" />
      <path d="M7.5 2.5c0 5 9 5 9 9.5s-9 4.5-9 9.5M16.5 2.5c0 5-9 5-9 9.5s9 4.5 9 9.5" />
      <path d="M10 19h4" />
    </>
  ),
  key: (
    <>
      <circle cx="6.5" cy="12" r="4" />
      <circle cx="6.5" cy="12" r="1.3" />
      <path d="M10.5 12h11M17.5 12v3.5M20.5 12v2.5" />
    </>
  ),
  lantern: (
    <>
      <path d="M12 1.5v2M9.5 3.5h5M7 6.5h10" />
      <path d="M8 6.5L7 9.5v8.5l1 2h8l1-2V9.5l-1-3" />
      <path d="M7 20h10M9.5 20.5v1.5M14.5 20.5v1.5" />
      <path
        d="M12 10.5c1.6 1.8 1.6 3.6 0 5-1.6-1.4-1.6-3.2 0-5z"
        fill="currentColor"
        fillOpacity="0.35"
      />
    </>
  ),
  mound: (
    <>
      <path d="M2.5 21c2.2-5 5.3-7.5 9.5-7.5s7.3 2.5 9.5 7.5z" />
      <path d="M12 2.5v9M9.2 5.5h5.6" />
    </>
  ),
  pickaxe: (
    <>
      <path d="M3 21l10.5-10.5" />
      <path d="M6.5 5.5c4-3 9.5-2.5 12.5.5" />
      <path d="M18 17.5c3-3 3.5-8.5.5-12.5" />
      <path d="M12 8.5l3.5 3.5" />
    </>
  ),
  quill: (
    <>
      <path d="M20.5 3c-7.5 1-12.5 6-14.5 14l-2.5 4.5" />
      <path d="M6 17c4.5-1 8.5-4.5 11-9.5" />
      <path d="M9.5 12h4.5" />
    </>
  ),
  raven: (
    <>
      <path d="M3 12.5c3-1 5-3.5 6.5-6.5 1-2 2.8-3 4.8-2.5l2.2.8-2 1.7c1.5 2.5 1.3 5.5-.5 8L20.5 21h-4l-4-4.5c-3 .5-6.5-.8-9.5-4z" />
      <circle cx="14" cy="6" r="0.6" fill="currentColor" />
    </>
  ),
  scroll: (
    <>
      <path d="M6 3.5h12.5a2 2 0 0 1 0 4H17" />
      <path d="M8 3.5a2 2 0 0 0-2 2V18" />
      <path d="M17 7.5v11a2 2 0 0 1-2 2H5a2 2 0 0 1 0-4h9" />
      <path d="M9.5 9.5h5M9.5 12.5h4" />
    </>
  ),
  seal: (
    <>
      <path d="M12 3.5c1.2 0 1.8 1 3 1.2 1.2.3 2.2-.1 2.9.8.8.8.3 1.9.6 3 .3 1.2 1.3 1.8 1.3 3s-1 1.8-1.3 3c-.3 1.1.2 2.2-.6 3-.7.9-1.7.5-2.9.8-1.2.2-1.8 1.2-3 1.2s-1.8-1-3-1.2c-1.2-.3-2.2.1-2.9-.8-.8-.8-.3-1.9-.6-3-.3-1.2-1.3-1.8-1.3-3s1-1.8 1.3-3c.3-1.1-.2-2.2.6-3 .7-.9 1.7-.5 2.9-.8 1.2-.2 1.8-1.2 3-1.2z" />
      <path d="M12 8.5v7M9 11h6" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M15 15l6 6" />
      <path
        d="M10 6.8c1.3 1.4 1.3 2.9 0 4.2-1.3-1.3-1.3-2.8 0-4.2z"
        fill="currentColor"
        fillOpacity="0.4"
      />
    </>
  ),
  shovel: (
    <>
      <path d="M17 2.5l4.5 4.5M19.2 4.8L11 13" />
      <path d="M11 13l-1.5-1.5-5 1.8L2.5 18l3.5 3.5 4.7-2-.2-5z" />
      <path d="M16 3.5l1 1" />
    </>
  ),
  skull: (
    <>
      <path d="M12 2.5a7.5 7.5 0 0 0-7.5 7.5c0 2.7 1.3 4.6 3.2 5.7v3.8h8.6v-3.8c1.9-1.1 3.2-3 3.2-5.7A7.5 7.5 0 0 0 12 2.5z" />
      <circle cx="9" cy="10.5" r="1.8" fill="currentColor" />
      <circle cx="15" cy="10.5" r="1.8" fill="currentColor" />
      <path d="M12 13.3l-1 1.7h2z" />
      <path d="M10 19.5v-2M12 19.5v-2M14 19.5v-2" />
    </>
  ),
  toppled: (
    <>
      <path d="M4 19.5l3.3-10.3a5.5 5.5 0 0 1 10.5 3.4L15 20" />
      <path d="M2 20.5h20" />
      <path d="M10.5 8.5l1.2 2.3-1.8 1.4 1.1 2.3" />
    </>
  ),
  urn: (
    <>
      <path d="M9 2.5h6M10 2.5v2.5M14 2.5v2.5" />
      <path d="M9 5h6c3.5 2 4.5 5.5 3.5 9-.8 2.8-2.5 4.5-3.5 5H9c-1-.5-2.7-2.2-3.5-5-1-3.5 0-7 3.5-9z" />
      <path d="M8 21.5h8" />
      <path d="M12 9v6M9.5 12.5L12 15l2.5-2.5" />
    </>
  ),
};

export function CryptIcon({
  glyph,
  size = 20,
  className,
  label,
}: {
  glyph: CryptGlyph;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={cn("shrink-0", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {PATHS[glyph]}
    </svg>
  );
}
