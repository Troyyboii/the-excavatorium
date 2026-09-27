import type { CryptGlyph } from "@/components/crypt-icon";
import type { ArchiveRecord, RecordType, RepositoryAction, ToolStatus } from "./types";

/**
 * How a record stands, derived only from fields it already saves. The same
 * checks drive the Home attention list (see `needsAttention` in dashboard.ts),
 * so the two never disagree.
 *
 * Vocabulary decision (pending reconciliation with the Signs of the Crypt
 * legend): the canvas legend shows five standings, but "Awaiting verdict" is
 * kept as a deliberate sixth. It marks records the owner has not yet judged:
 * a repository with no recommended action, a Tentative decision, and tools
 * that are Worth revisiting, Useful but dormant or Experimental. None of the
 * five fits them without claiming a judgment that was never made. DESIGN.md's
 * icon map already names it (hourglass, mist). Do not add further standings
 * without the same explicit decision.
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

const TOOL_STANDING: Record<ToolStatus, StandingKind> = {
  Active: "current",
  "Useful but dormant": "awaiting",
  Experimental: "awaiting",
  "Worth revisiting": "awaiting",
  Disappointing: "superseded",
  Buried: "buried",
  "Grok-tier cursed": "buried",
};

const BURIED_REPOSITORY_ACTIONS: readonly RepositoryAction[] = ["Skip", "Pour down sink"];

export function recordStanding(record: ArchiveRecord): RecordStanding {
  switch (record.recordType) {
    case "tool":
      return standing(TOOL_STANDING[record.recordData.status], record.recordData.status);
    case "decision": {
      const status = record.recordData.status;
      if (status === "Current") return standing("current", status);
      if (status === "Tentative") return standing("awaiting", status);
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
      const action = record.recordData.recommendedAction;
      if (action === null) return standing("awaiting");
      return BURIED_REPOSITORY_ACTIONS.includes(action)
        ? standing("buried", action)
        : standing("current", action);
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
