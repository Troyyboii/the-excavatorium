import type { ReactNode } from "react";
import { CryptIcon } from "@/components/crypt-icon";
import { cn } from "@/lib/utils";

/**
 * Night Crypt Custodian crops, all derived from public/character/00-custodian-canon.png
 * (see night-crypt/cut-custodian.py). The full cut-out only ever appears inside
 * the arched niche; the portrait marks every place he speaks.
 */
export const CUSTODIAN_CUTOUT_SRC = "/character/custodian-cutout.webp";
export const CUSTODIAN_PORTRAIT_SRC = "/character/custodian-portrait.webp";
export const CUSTODIAN_LANTERN_SRC = "/character/custodian-lantern.webp";

/**
 * The Custodian standing in an arched stone niche, a raven above and a plinth
 * with his name between two candles below. Decorative: it carries no facts,
 * so it is hidden from assistive technology. Carries the screen's one
 * lantern glow.
 */
export function CustodianNiche({ width = 300, className }: { width?: number; className?: string }) {
  const scale = width / 300;
  const height = Math.round(640 * scale);
  const inset = Math.round(10 * scale);
  const radius = width / 2;
  return (
    <div aria-hidden="true" className={cn("flex select-none flex-col items-center", className)}>
      <CryptIcon glyph="raven" size={30} className="text-[color:var(--mortar-strong)]" />
      <div
        className="mt-1.5 box-border border border-[color:var(--mortar-strong)] bg-[color:var(--vault-deep)]"
        style={{
          width,
          height,
          padding: inset,
          borderRadius: `${radius}px ${radius}px 4px 4px`,
        }}
      >
        <div
          className="custodian-niche-well relative h-full w-full overflow-hidden border border-[color:var(--mortar)]"
          style={{ borderRadius: `${radius - inset}px ${radius - inset}px 2px 2px` }}
        >
          <img
            src={CUSTODIAN_CUTOUT_SRC}
            alt=""
            width={473}
            height={1200}
            decoding="async"
            draggable={false}
            className="pointer-events-none absolute left-1/2 w-auto max-w-none -translate-x-1/2"
            style={{ bottom: Math.round(-30 * scale), height: Math.round(660 * scale) }}
          />
        </div>
      </div>
      <div
        className="h-4 border border-t-0 border-[color:var(--mortar-strong)] bg-[color:var(--vault-raised)]"
        style={{ width: width + 40 }}
      />
      <div
        className="flex items-center justify-between border border-t-0 border-[color:var(--mortar-strong)] bg-[color:var(--vault-stone)] px-[18px] py-3"
        style={{ width: width + 40 }}
      >
        <CryptIcon glyph="candle" size={26} className="text-[color:var(--candlelight)]" />
        <span className="font-serif text-xl tracking-[0.08em] text-[color:var(--mist)]">
          The Custodian
        </span>
        <CryptIcon glyph="candle" size={26} className="text-[color:var(--candlelight)]" />
      </div>
    </div>
  );
}

/** The hooded Custodian in a circle, shown wherever he speaks. Decorative. */
export function CustodianPortrait({
  size = 56,
  ring = "stone",
  className,
}: {
  size?: number;
  ring?: "stone" | "candle";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 overflow-hidden rounded-full border bg-[color:var(--vault-deep)]",
        ring === "candle"
          ? "border-2 border-[color:var(--candlelight)]"
          : "border-[color:var(--mortar-strong)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={CUSTODIAN_PORTRAIT_SRC}
        alt=""
        width={410}
        height={368}
        decoding="async"
        draggable={false}
        className="pointer-events-none h-full w-full select-none object-cover object-[60%_30%]"
      />
    </span>
  );
}

const LINE_SIZE = {
  lg: "text-[1.6rem] leading-[1.35] sm:text-[1.95rem]",
  md: "text-xl leading-[1.45]",
  sm: "text-lg leading-[1.45]",
} as const;

/**
 * The Custodian's narration: IM Fell English italic. Only narration uses
 * this voice; buttons, costs, errors and warnings stay plain.
 */
export function CustodianLine({
  children,
  size = "md",
  className,
}: {
  children: ReactNode;
  size?: keyof typeof LINE_SIZE;
  className?: string;
}) {
  return (
    <p className={cn("font-serif italic text-foreground", LINE_SIZE[size], className)}>
      {children}
    </p>
  );
}
