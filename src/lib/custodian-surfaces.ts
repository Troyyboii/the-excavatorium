import { UUID_RE } from "./types";
import {
  CASE_ARCHIVE_CONTEXT_MAX_CHARS,
  CASE_ARCHIVE_SCOPE_MAX_RECORDS,
  type CaseArchiveScope,
  type InboxItem,
  type InboxStatus,
  type JsonValue,
} from "./custodian-types";

export type InboxFilter = "all" | InboxStatus;

export const INBOX_FILTERS: readonly InboxFilter[] = [
  "all",
  "new",
  "triaged",
  "promoted",
  "dismissed",
  "archived",
];

export function filterInboxItems(items: readonly InboxItem[], filter: InboxFilter): InboxItem[] {
  return items.filter((item) => filter === "all" || item.status === filter);
}

export function countInboxStatuses(items: readonly InboxItem[]): Record<InboxStatus, number> {
  const counts: Record<InboxStatus, number> = {
    new: 0,
    triaged: 0,
    promoted: 0,
    dismissed: 0,
    archived: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

export function isPromotionReady(input: {
  caseId: string;
  confirmed: boolean;
  busy: boolean;
}): boolean {
  return input.caseId.trim().length > 0 && input.confirmed && !input.busy;
}

export function parseWorkingSet(value: string): JsonValue[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return JSON.parse(entry) as JsonValue;
      } catch {
        return entry;
      }
    });
}

export function displayJson(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function serializeWorkingSetEntry(value: JsonValue): string {
  return JSON.stringify(value);
}

export function parseCaseArchiveScope(value: unknown): CaseArchiveScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("archive_scope must be a JSON object");
  }
  const scope = value as Record<string, unknown>;
  const recordIds = scope.record_ids;
  const freeTextContext = scope.free_text_context;
  if (!Array.isArray(recordIds)) throw new Error("archive_scope.record_ids must be an array");
  if (recordIds.length > CASE_ARCHIVE_SCOPE_MAX_RECORDS) {
    throw new Error(
      `archive_scope.record_ids must contain at most ${CASE_ARCHIVE_SCOPE_MAX_RECORDS} records`,
    );
  }
  if (recordIds.some((recordId) => typeof recordId !== "string" || !UUID_RE.test(recordId))) {
    throw new Error("archive_scope.record_ids must contain UUID strings");
  }
  if (new Set(recordIds).size !== recordIds.length) {
    throw new Error("archive_scope.record_ids must not contain duplicates");
  }
  if (typeof freeTextContext !== "string") {
    throw new Error("archive_scope.free_text_context must be text");
  }
  if (freeTextContext.length > CASE_ARCHIVE_CONTEXT_MAX_CHARS) {
    throw new Error(
      `archive_scope.free_text_context exceeds ${CASE_ARCHIVE_CONTEXT_MAX_CHARS} characters`,
    );
  }
  return { recordIds: [...recordIds], freeTextContext };
}

export function caseArchiveScopePayload(scope: CaseArchiveScope): Record<string, unknown> {
  const normalized = parseCaseArchiveScope({
    record_ids: scope.recordIds,
    free_text_context: scope.freeTextContext,
  });
  return {
    record_ids: normalized.recordIds,
    free_text_context: normalized.freeTextContext,
  };
}
