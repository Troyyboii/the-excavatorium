import type { ArchiveRecord } from "@/lib/types";
import { plural } from "@/components/record-list";
import { formatArchiveDateTime } from "@/lib/date-format";

export function archiveRecordHref(record: ArchiveRecord): string {
  return `/${plural(record.recordType)}/${record.id}`;
}

export function formatRecordDate(value: string | null | undefined): string {
  return formatArchiveDateTime(value);
}

export function valueOrNotRecorded(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "Not recorded" : String(value);
}
