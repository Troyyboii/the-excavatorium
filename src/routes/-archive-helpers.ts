import type { ArchiveRecord, RecordType } from "@/lib/types";
import { RECORD_TYPES } from "@/lib/types";

export type ArchiveDirectorySummary = {
  recordType: RecordType;
  count: number;
  latestUpdatedAt: string | null;
};

export function buildArchiveDirectory(
  records: ArchiveRecord[],
): Record<RecordType, ArchiveDirectorySummary> {
  const summaries = Object.fromEntries(
    RECORD_TYPES.map((recordType) => [recordType, { recordType, count: 0, latestUpdatedAt: null }]),
  ) as Record<RecordType, ArchiveDirectorySummary>;

  for (const record of records) {
    const summary = summaries[record.recordType];
    summary.count += 1;
    if (!summary.latestUpdatedAt || record.updatedAt.localeCompare(summary.latestUpdatedAt) > 0) {
      summary.latestUpdatedAt = record.updatedAt;
    }
  }

  return summaries;
}
