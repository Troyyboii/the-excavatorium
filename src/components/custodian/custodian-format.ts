import type { ArchiveRecord } from "@/lib/types";
import { plural } from "@/components/record-list";

export function archiveRecordHref(record: ArchiveRecord): string {
  return `/${plural(record.recordType)}/${record.id}`;
}

export function formatRecordDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function valueOrNotRecorded(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "Not recorded" : String(value);
}
