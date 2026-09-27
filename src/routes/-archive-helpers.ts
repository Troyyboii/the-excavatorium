import { matchesArchiveSearch } from "@/lib/archive-search";
import { recordStanding, STANDING_KINDS, type StandingKind } from "@/lib/record-standing";
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

export type ArchiveFilters = {
  type?: RecordType;
  standing?: StandingKind;
  q?: string;
};

/** Reads /archive search params, dropping anything that is not a known filter. */
export function parseArchiveFilters(search: Record<string, unknown>): ArchiveFilters {
  const filters: ArchiveFilters = {};
  if (RECORD_TYPES.includes(search.type as RecordType)) filters.type = search.type as RecordType;
  if (STANDING_KINDS.includes(search.standing as StandingKind)) {
    filters.standing = search.standing as StandingKind;
  }
  if (typeof search.q === "string" && search.q) filters.q = search.q;
  return filters;
}

/** Newest first, then by title; narrowed by chamber, standing and text. */
export function filterArchive(records: ArchiveRecord[], filters: ArchiveFilters): ArchiveRecord[] {
  return records
    .filter(
      (record) =>
        (!filters.type || record.recordType === filters.type) &&
        (!filters.standing || recordStanding(record).kind === filters.standing) &&
        matchesArchiveSearch(record, filters.q ?? ""),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

const ONES = [
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
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** "forty-seven" up to 999; digits beyond. */
export function numberInWords(count: number): string {
  if (!Number.isInteger(count) || count < 0 || count > 999) return String(count);
  if (count < 20) return ONES[count];
  if (count < 100) {
    const rest = count % 10;
    return rest ? `${TENS[Math.floor(count / 10)]}-${ONES[rest]}` : TENS[count / 10];
  }
  const rest = count % 100;
  const hundreds = `${ONES[Math.floor(count / 100)]} hundred`;
  return rest ? `${hundreds} and ${numberInWords(rest)}` : hundreds;
}

/** The Custodian's line under the Archive chambers, from the live total. */
export function archiveCustodianLine(total: number): string {
  if (total === 0) return "No remains yet. The shelves wait for your first find.";
  const count = numberInWords(total);
  const spoken = count.charAt(0).toUpperCase() + count.slice(1);
  return total === 1
    ? `${spoken} remnant, catalogued. Nothing forgotten — only unread.`
    : `${spoken} remains, catalogued. None forgotten — only unread.`;
}
