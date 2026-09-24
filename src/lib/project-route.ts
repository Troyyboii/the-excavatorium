import type { ArchiveRecord } from "./types";

/**
 * Project route is optional, owner-defined metadata. There is no global list:
 * a route is null or a short non-blank string the owner typed. Historical
 * values (for example "The Forge") are ordinary strings and are never rewritten.
 */
export const PROJECT_ROUTE_MAX_LENGTH = 120;

/** Blank input persists as null, never as an empty-string pseudo-value. */
export function normalizeProjectRoute(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed === "" ? null : trimmed;
}

export function isValidProjectRoute(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= PROJECT_ROUTE_MAX_LENGTH)
  );
}

/** Distinct routes already used by the given (owner-scoped) records, most recent first. */
export function ownerProjectRoutes(records: readonly ArchiveRecord[]): string[] {
  const seen = new Set<string>();
  const ordered = [...records].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  for (const record of ordered) {
    if (record.recordType !== "conversation" && record.recordType !== "document") continue;
    const route = (record.recordData as { projectRoute?: unknown }).projectRoute;
    if (typeof route === "string" && route.trim() !== "") seen.add(route);
  }
  return [...seen];
}

/** Record data with any project route normalized (trimmed; blank becomes null). */
export function withNormalizedProjectRoute(
  recordType: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if ((recordType !== "conversation" && recordType !== "document") || !("projectRoute" in data)) {
    return data;
  }
  return { ...data, projectRoute: normalizeProjectRoute(data.projectRoute as string | null) };
}
