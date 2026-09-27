import type { ArchiveRecord } from "./types";

// Fields searched: every user-entered string. Excludes IDs, timestamps,
// booleans, seed keys, and enum machine keys per spec §15.
export function toSearchableText(r: ArchiveRecord): string {
  const parts: string[] = [r.title, r.summary, r.tags.join(" ")];
  const d = r.recordData as Record<string, unknown>;
  if (r.recordType === "tool") {
    parts.push(r.recordData.category, r.recordData.status);
    parts.push(
      r.recordData.whatCaughtMyEye,
      r.recordData.whatItPromised,
      r.recordData.whatActuallyHappened,
      r.recordData.whatWorked,
      r.recordData.whatFailed,
      r.recordData.whyIKeptOrStoppedUsingIt,
      r.recordData.revisitCondition,
      r.recordData.finalVerdict,
    );
  } else if (r.recordType === "repository") {
    parts.push(
      r.recordData.githubUrl,
      r.recordData.whatCaughtMyEye,
      r.recordData.whatItClaims,
      r.recordData.whatItActuallyDoes,
      r.recordData.maintenanceImpression,
      r.recordData.finalVerdict,
      r.recordData.recommendedAction ?? "",
    );
  } else if (r.recordType === "conversation") {
    parts.push(
      r.recordData.projectRoute ?? "",
      r.recordData.highSignalFindings,
      r.recordData.decisionsMade,
      r.recordData.openLoops,
      r.recordData.reusablePrompts,
      r.recordData.memoryCandidates,
      r.recordData.rawConversationText,
    );
  } else if (r.recordType === "decision") {
    parts.push(
      r.recordData.reason,
      r.recordData.trigger,
      r.recordData.whatWouldChangeMyMind,
      r.recordData.status,
      r.recordData.confidence,
    );
  } else if (r.recordType === "document") {
    const insights = [
      ...r.recordData.highSignalFindings,
      ...r.recordData.keyClaims,
      ...r.recordData.contradictions,
      ...r.recordData.uncertainties,
    ];
    parts.push(
      r.recordData.originalFileName ?? "",
      r.recordData.documentDate ?? "",
      r.recordData.projectRoute ?? "",
      ...insights.flatMap((item) => [item.text, ...item.sourceReferenceIds]),
      ...r.recordData.sourceReferences.flatMap((ref) => [ref.label, ref.note, ref.locator]),
    );
  }
  void d;
  return parts.join("\n").toLowerCase();
}

/** Case-insensitive partial match across every user-entered field. */
export function matchesArchiveSearch(record: ArchiveRecord, text: string): boolean {
  const query = text.trim().toLowerCase();
  return !query || toSearchableText(record).includes(query);
}
