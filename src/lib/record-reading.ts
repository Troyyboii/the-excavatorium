import type { StandingKind } from "./record-standing";
import type { ArchiveRecord, DecisionRecord } from "./types";

export type SupersessionInvalidity = {
  kind: "self-reference" | "cycle";
  /** Decision ids walked before the invalidity was confirmed, ending on the repeat. */
  path: string[];
};

export type SupersessionChain = {
  replaces: DecisionRecord | null;
  replacedBy: DecisionRecord[];
  /** Set when saved pointers would present a contradictory replacement chain. */
  invalid: SupersessionInvalidity | null;
};

/**
 * Walks `fromId`'s `supersedesDecisionId` chain. Returns a cycle/self path when
 * the walk revisits an id; otherwise null. Missing or non-decision targets end
 * the walk without error.
 */
export function findSupersessionCycle(
  fromId: string,
  firstTargetId: string | null | undefined,
  byId: Map<string, ArchiveRecord>,
): SupersessionInvalidity | null {
  if (!firstTargetId) return null;
  if (firstTargetId === fromId) {
    return { kind: "self-reference", path: [fromId, firstTargetId] };
  }

  const path = [fromId];
  const seen = new Set<string>([fromId]);
  let current: string | null = firstTargetId;

  while (current) {
    path.push(current);
    if (seen.has(current)) {
      return { kind: "cycle", path };
    }
    seen.add(current);
    const next = byId.get(current);
    if (!next || next.recordType !== "decision") return null;
    current = next.recordData.supersedesDecisionId;
  }
  return null;
}

/**
 * The decision this one replaced (its saved `supersedesDecisionId`) and the
 * decisions that name it as the one they replaced. Built only from saved
 * fields; missing or non-decision targets are ignored. Cycles and self-links
 * surface as `invalid` instead of a misleading ancestry.
 */
export function supersessionChain(
  record: ArchiveRecord,
  allRecords: ArchiveRecord[],
  byId: Map<string, ArchiveRecord>,
): SupersessionChain {
  if (record.recordType !== "decision") {
    return { replaces: null, replacedBy: [], invalid: null };
  }

  const invalid = findSupersessionCycle(record.id, record.recordData.supersedesDecisionId, byId);
  if (invalid) {
    return { replaces: null, replacedBy: [], invalid };
  }

  const target = record.recordData.supersedesDecisionId
    ? byId.get(record.recordData.supersedesDecisionId)
    : undefined;
  const replacedBy = allRecords
    .filter(
      (candidate): candidate is DecisionRecord =>
        candidate.recordType === "decision" &&
        candidate.id !== record.id &&
        candidate.recordData.supersedesDecisionId === record.id,
    )
    .sort(
      (a, b) =>
        b.recordData.decisionDate.localeCompare(a.recordData.decisionDate) ||
        a.title.localeCompare(b.title),
    );
  return {
    replaces: target?.recordType === "decision" ? target : null,
    replacedBy,
    invalid: null,
  };
}

const STANDING_LINE: Record<StandingKind, string> = {
  current: "It stands, and it still holds.",
  "open-loop": "A thread was left hanging here. It waits for your hand.",
  uncertain: "Its ground is unsure; not all of it is settled.",
  awaiting: "No verdict has been given. It waits on your judgment.",
  superseded: "Set aside, yet it still bears witness to what came after.",
  buried: "Laid to rest. Kept, not forgotten.",
};

/**
 * The Custodian's narration on a record page. `findingCount` is the number of
 * persisted Custodian findings linked to the record, or `undefined` while that
 * is unknown (loading, offline, unavailable) — then he says nothing about it.
 */
export function custodianReadingLine(
  standing: StandingKind,
  findingCount: number | undefined,
  canExamine: boolean,
): string {
  const parts = [STANDING_LINE[standing]];
  if (findingCount === 0) parts.push("I have not read it.");
  if (findingCount && findingCount > 0) {
    parts.push("I have read it before; what I found is kept apart from your word.");
  }
  if (canExamine)
    parts.push(findingCount ? "Bid me, and I shall read it again." : "Bid me, and I shall.");
  return parts.join(" ");
}
