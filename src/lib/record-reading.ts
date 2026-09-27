import type { StandingKind } from "./record-standing";
import type { ArchiveRecord, DecisionRecord } from "./types";

/**
 * The decision this one replaced (its saved `supersedesDecisionId`) and the
 * decisions that name it as the one they replaced. Built only from saved
 * fields; missing or non-decision targets are ignored.
 */
export function supersessionChain(
  record: ArchiveRecord,
  allRecords: ArchiveRecord[],
  byId: Map<string, ArchiveRecord>,
): { replaces: DecisionRecord | null; replacedBy: DecisionRecord[] } {
  if (record.recordType !== "decision") return { replaces: null, replacedBy: [] };
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
