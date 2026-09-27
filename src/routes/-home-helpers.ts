import type { CryptGlyph } from "@/components/crypt-icon";
import { needsAttention } from "@/lib/dashboard";
import { recordStanding, type StandingTone } from "@/lib/record-standing";
import type { ArchiveRecord, RecordType } from "@/lib/types";

export type HomeAttentionCopy = {
  heading: string;
  explanation: string;
};

export function homeAttentionCopy(hasAttention: boolean): HomeAttentionCopy {
  return hasAttention
    ? {
        heading: "Attention is needed.",
        explanation:
          "The Archive flags these records from their saved status and content. Each entry shows the matching reason.",
      }
    : {
        heading: "Nothing stirs.",
        explanation:
          "No archive records currently need your attention under the checks available here.",
      };
}

/** Records flagged for the same saved reason, shown as one tile. */
export type AttentionGroup = {
  key: string;
  count: number;
  /** Reads after the count: "6 documents are uncertain". */
  reason: string;
  glyph: CryptGlyph;
  tone: StandingTone;
  records: ArchiveRecord[];
};

type Reason = { key: string; one: string; many: string };

function reasonFor(record: ArchiveRecord): Reason {
  switch (record.recordType) {
    case "document":
      return {
        key: "document-uncertain",
        one: "document is uncertain",
        many: "documents are uncertain",
      };
    case "conversation":
      return {
        key: "conversation-open",
        one: "conversation left open",
        many: "conversations left open",
      };
    case "repository":
      return {
        key: "repository-awaiting",
        one: "repository awaits a verdict",
        many: "repositories await a verdict",
      };
    case "decision":
      return {
        key: "decision-tentative",
        one: "decision is tentative",
        many: "decisions are tentative",
      };
    case "tool": {
      const status = record.recordData.status.toLowerCase();
      return {
        key: `tool-${status.replace(/\s+/g, "-")}`,
        one: `tool is ${status}`,
        many: `tools are ${status}`,
      };
    }
  }
}

const REASON_ORDER = [
  "document-uncertain",
  "conversation-open",
  "decision-tentative",
  "repository-awaiting",
];

/**
 * Groups the records the Home attention checks flag (see `needsAttention`)
 * by identical reason, largest group first. Each group keeps its records,
 * newest first, so every record stays one click away.
 */
export function groupAttention(records: ArchiveRecord[]): AttentionGroup[] {
  const groups = new Map<string, AttentionGroup & { reasonText: Reason }>();
  const flagged = records
    .filter(needsAttention)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  for (const record of flagged) {
    const reason = reasonFor(record);
    const existing = groups.get(reason.key);
    if (existing) {
      existing.records.push(record);
      continue;
    }
    const standing = recordStanding(record);
    groups.set(reason.key, {
      key: reason.key,
      count: 0,
      reason: "",
      glyph: standing.glyph,
      tone: standing.tone,
      records: [record],
      reasonText: reason,
    });
  }
  const rank = (key: string) => {
    const index = REASON_ORDER.indexOf(key);
    return index === -1 ? REASON_ORDER.length : index;
  };
  return Array.from(groups.values())
    .map(({ reasonText, ...group }) => ({
      ...group,
      count: group.records.length,
      reason: group.records.length === 1 ? reasonText.one : reasonText.many,
    }))
    .sort((a, b) => b.count - a.count || rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** "seven" for small counts, digits beyond twelve. */
export function countWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The Custodian's Home greeting, built from live counts. `full` is the
 * desktop line beside the niche; `short` is the phone line beside the portrait.
 */
export function homeGreeting(
  totalRecords: number,
  attentionCount: number,
): { full: string; short: string } {
  if (totalRecords === 0) {
    return {
      full: "Ah… the lantern stirs over empty shelves. Nothing is kept here yet — bring me something worth keeping.",
      short: "Ah… empty shelves. Bring me something worth keeping.",
    };
  }
  if (attentionCount === 0) {
    return {
      full: "Ah… the lantern stirs. You have returned, and the dust has not been idle. Nothing calls for your eye tonight.",
      short: "Ah… you return. Nothing calls for your eye.",
    };
  }
  const calls =
    attentionCount === 1
      ? "One record calls for your eye — I have not touched it."
      : `${capitalised(countWord(attentionCount))} records call for your eye — I have touched none of them.`;
  const shortCalls =
    attentionCount === 1
      ? "One record calls for your eye."
      : `${capitalised(countWord(attentionCount))} records call for your eye.`;
  return {
    full: `Ah… the lantern stirs. You have returned, and the dust has not been idle. ${calls}`,
    short: `Ah… you return. ${shortCalls}`,
  };
}

/** The Home chambers, in canvas order, with singular and plural names. */
export const CHAMBERS: readonly { type: RecordType; one: string; many: string; href: string }[] = [
  { type: "document", one: "Document", many: "Documents", href: "/documents" },
  { type: "tool", one: "Tool", many: "Tools", href: "/tools" },
  { type: "conversation", one: "Conversation", many: "Conversations", href: "/conversations" },
  { type: "decision", one: "Decision", many: "Decisions", href: "/decisions" },
  { type: "repository", one: "Repository", many: "Repositories", href: "/repositories" },
];
