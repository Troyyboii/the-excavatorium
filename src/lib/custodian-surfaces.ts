import type { InboxItem, InboxStatus, JsonValue } from "./custodian-types";

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
