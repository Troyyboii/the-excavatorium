import type { CryptGlyph } from "@/components/crypt-icon";
import type { ArchiveRecord, RecordType, RepositoryAction, ToolStatus } from "./types";

/**
 * How a record stands, derived only from fields it already saves. The same
 * helper drives Archive filters and Home attention glyphs, so the two never
 * disagree on kind/tone.
 *
 * "Awaiting verdict" is a deliberate sixth standing (the canvas legend shows
 * five). It means owner judgment is actually absent — not merely that a status
 * label is soft or provisional. Status labels stay visible; they do not by
 * themselves prove judgment is missing.
 */
export type StandingKind =
  | "current"
  | "open-loop"
  | "uncertain"
  | "awaiting"
  | "superseded"
  | "buried";

export type StandingTone = "candle" | "spectre" | "ember" | "mist" | "ash";

export type RecordStanding = {
  kind: StandingKind;
  label: string;
  glyph: CryptGlyph;
  tone: StandingTone;
};

export const STANDING_KINDS: readonly StandingKind[] = [
  "current",
  "open-loop",
  "uncertain",
  "awaiting",
  "superseded",
  "buried",
];

const SIGN: Record<StandingKind, { label: string; glyph: CryptGlyph; tone: StandingTone }> = {
  current: { label: "Current", glyph: "candle", tone: "candle" },
  "open-loop": { label: "Open loop", glyph: "coffin", tone: "spectre" },
  uncertain: { label: "Uncertain", glyph: "skull", tone: "ember" },
  awaiting: { label: "Awaiting verdict", glyph: "hourglass", tone: "mist" },
  superseded: { label: "Superseded", glyph: "toppled", tone: "ash" },
  buried: { label: "Buried", glyph: "mound", tone: "ash" },
};

/** The generic sign for a standing, e.g. for filter chips. */
export function standingSign(kind: StandingKind): RecordStanding {
  return { kind, ...SIGN[kind] };
}

function standing(kind: StandingKind, label = SIGN[kind].label): RecordStanding {
  return { ...standingSign(kind), label };
}

const TOOL_STATUS_KIND: Record<ToolStatus, StandingKind> = {
  Active: "current",
  "Useful but dormant": "current",
  Experimental: "current",
  "Worth revisiting": "current",
  Disappointing: "superseded",
  Buried: "buried",
  "Grok-tier cursed": "buried",
};

/** Soft tool statuses that need a written verdict before they leave awaiting. */
const TOOL_AWAITING_WITHOUT_VERDICT: readonly ToolStatus[] = [
  "Useful but dormant",
  "Experimental",
  "Worth revisiting",
];

const BURIED_REPOSITORY_ACTIONS: readonly RepositoryAction[] = ["Skip", "Pour down sink"];

function hasWrittenVerdict(value: string): boolean {
  return value.trim() !== "";
}

export function recordStanding(record: ArchiveRecord): RecordStanding {
  switch (record.recordType) {
    case "tool": {
      const { status, finalVerdict } = record.recordData;
      if (TOOL_AWAITING_WITHOUT_VERDICT.includes(status) && !hasWrittenVerdict(finalVerdict)) {
        return standing("awaiting", status);
      }
      return standing(TOOL_STATUS_KIND[status], status);
    }
    case "decision": {
      const status = record.recordData.status;
      if (status === "Current") return standing("current", status);
      // Tentative is a provisional judgment, not the absence of one.
      if (status === "Tentative") return standing("uncertain", status);
      if (status === "Archived") return standing("buried", status);
      return standing("superseded", status);
    }
    case "conversation":
      return record.recordData.openLoops.trim() ? standing("open-loop") : standing("current");
    case "document":
      return record.recordData.uncertainties.length > 0
        ? standing("uncertain")
        : standing("current");
    case "repository": {
      const { recommendedAction, finalVerdict } = record.recordData;
      if (recommendedAction === null && !hasWrittenVerdict(finalVerdict)) {
        return standing("awaiting");
      }
      if (recommendedAction && BURIED_REPOSITORY_ACTIONS.includes(recommendedAction)) {
        return standing("buried", recommendedAction);
      }
      return standing("current", recommendedAction ?? SIGN.current.label);
    }
  }
}

/** Text colour for each standing tone. */
export const STANDING_TONE_CLASS: Record<StandingTone, string> = {
  candle: "text-[color:var(--candlelight)]",
  spectre: "text-[color:var(--spectre)]",
  ember: "text-[color:var(--ember)]",
  mist: "text-[color:var(--mist)]",
  ash: "text-[color:var(--ash)]",
};

/** The icon and colour that mark each kind of record. */
export const RECORD_KIND_SIGN: Record<RecordType, { glyph: CryptGlyph; toneClass: string }> = {
  decision: { glyph: "gravestone", toneClass: "text-[color:var(--candlelight)]" },
  conversation: { glyph: "ghost", toneClass: "text-[color:var(--spectre)]" },
  document: { glyph: "scroll", toneClass: "text-[color:var(--parchment)]" },
  repository: { glyph: "chest", toneClass: "text-[color:var(--moonwater)]" },
  tool: { glyph: "pickaxe", toneClass: "text-[color:var(--moonbone)]" },
};
