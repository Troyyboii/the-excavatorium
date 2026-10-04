import type { ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase";
import {
  authResult,
  boundedLimit,
  buildRecordDataSearchFilter,
  buildSearchFilter,
  buildSearchSelect,
  compareProjectedRecords,
  errorResult,
  isCanonicalRecordType,
  jsonResult,
  mapSupabaseError,
  projectRecord,
  projectSearchRow,
  RECORD_DETAIL_SELECT,
  RECORD_LIST_SELECT,
  sanitizeSearchQuery,
  SEARCHABLE_DATA_FIELDS,
  withoutRecordData,
  type CanonicalRecordType,
  type JsonToolResult,
  type SafeRecord,
} from "./mcp-utils";
import { DECISION_STATUSES, type DecisionStatus } from "../types";

export type SearchInput = {
  recordType?: CanonicalRecordType;
  query?: string;
  limit?: number;
  tags?: string[];
  updatedAfter?: string;
  projectRoute?: string;
  cursor?: string;
};

export type SearchCursor = { updated_at: string; id: string };

export function encodeSearchCursor(cursor: SearchCursor): string {
  return btoa(JSON.stringify({ updated_at: cursor.updated_at, id: cursor.id }));
}

export function decodeSearchCursor(cursor: string): SearchCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(cursor));
  } catch {
    return null;
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as { updated_at?: unknown }).updated_at === "string" &&
    typeof (parsed as { id?: unknown }).id === "string" &&
    STRICT_ISO_DATETIME_PATTERN.test((parsed as { updated_at: string }).updated_at) &&
    CURSOR_ID_PATTERN.test((parsed as { id: string }).id)
  ) {
    return {
      updated_at: (parsed as { updated_at: string }).updated_at,
      id: (parsed as { id: string }).id,
    };
  }
  return null;
}

// Mirrors the UUID shape enforced for security-sensitive identifiers in
// security.ts (kept local so security.ts stays untouched).
const CURSOR_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRICT_ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function validIsoDatetime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    STRICT_ISO_DATETIME_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function validExactTag(tag: unknown): tag is string {
  return (
    typeof tag === "string" &&
    tag.trim().length >= 1 &&
    tag.trim().length <= 100 &&
    !/[,{}"\\]/.test(tag)
  );
}

function matchedFieldsFor(
  record: SafeRecord,
  safeQuery: string | null,
  filterTags: readonly string[] | undefined,
): string[] {
  const fields: string[] = [];
  if (safeQuery) {
    const query = safeQuery.toLowerCase();
    if (record.title.toLowerCase().includes(query)) fields.push("title");
    if (record.summary.toLowerCase().includes(query)) fields.push("summary");
    if (record.tags.some((tag) => tag === safeQuery)) fields.push("tags");
    for (const field of SEARCHABLE_DATA_FIELDS[record.record_type]) {
      const value = record.record_data?.[field];
      if (value === undefined || value === null) continue;
      const text = typeof value === "string" ? value : JSON.stringify(value);
      if (text.toLowerCase().includes(query)) fields.push(field);
    }
  }
  if (
    filterTags &&
    filterTags.length > 0 &&
    filterTags.every((tag) => record.tags.includes(tag)) &&
    !fields.includes("tags")
  ) {
    fields.push("tags");
  }
  return fields;
}

export async function handleSearchRecords(
  { recordType, query, limit, tags, updatedAfter, projectRoute, cursor }: SearchInput,
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = await authResult(ctx);
  if (authError) return authError;
  if (recordType && !isCanonicalRecordType(recordType)) return errorResult("INVALID_INPUT");
  if (query !== undefined && (query.trim().length === 0 || query.length > 200)) {
    return errorResult("INVALID_INPUT");
  }

  let rowLimit: number;
  try {
    rowLimit = boundedLimit(limit);
  } catch {
    return errorResult("INVALID_INPUT");
  }

  let filterTags: string[] | undefined;
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > 10 || !tags.every(validExactTag)) {
      return errorResult("INVALID_INPUT");
    }
    filterTags = tags.map((tag) => tag.trim());
  }
  if (updatedAfter !== undefined && !validIsoDatetime(updatedAfter)) {
    return errorResult("INVALID_INPUT");
  }
  const trimmedRoute = projectRoute?.trim();
  if (projectRoute !== undefined && (!trimmedRoute || trimmedRoute.length > 120)) {
    return errorResult("INVALID_INPUT");
  }
  const decodedCursor = cursor === undefined ? null : decodeSearchCursor(cursor);
  if (cursor !== undefined && !decodedCursor) return errorResult("INVALID_INPUT");

  let textFilter: string | null = null;
  if (query !== undefined) {
    const baseFilter = buildSearchFilter(query);
    const dataFilter = buildRecordDataSearchFilter(recordType, query);
    textFilter = [baseFilter, dataFilter].filter((part) => part !== null).join(",");
    if (!textFilter) return errorResult("INVALID_INPUT");
  }

  try {
    const supabase = supabaseForUser(ctx);
    let request = supabase
      .from("records")
      .select(buildSearchSelect(recordType))
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(rowLimit + 1);
    if (recordType) request = request.eq("record_type", recordType);
    const cursorKeyset = decodedCursor
      ? `updated_at.lt.${decodedCursor.updated_at},and(updated_at.eq.${decodedCursor.updated_at},id.lt.${decodedCursor.id})`
      : null;
    if (textFilter && cursorKeyset) {
      request = request.or(`and(or(${textFilter}),or(${cursorKeyset}))`);
    } else if (textFilter) {
      request = request.or(textFilter);
    } else if (cursorKeyset) {
      request = request.or(cursorKeyset);
    }
    if (filterTags && filterTags.length > 0) request = request.contains("tags", filterTags);
    if (updatedAfter !== undefined)
      request = request.gte("updated_at", new Date(updatedAfter).toISOString());
    if (trimmedRoute) request = request.eq("record_data->>projectRoute", trimmedRoute);
    // The select list is built dynamically, so the row type is declared here
    // rather than inferred from a literal select string.
    const { data, error } = (await request) as unknown as {
      data: Array<Record<string, unknown>> | null;
      error: unknown;
    };
    if (error) return errorResult(mapSupabaseError(error));

    const projected = (data ?? []).map((row) => projectSearchRow(row, recordType));
    const hasMore = projected.length > rowLimit;
    const page = hasMore ? projected.slice(0, rowLimit) : projected;
    const safeQuery = query === undefined ? null : sanitizeSearchQuery(query);
    const records = page.map((record) => ({
      ...withoutRecordData(record),
      matchedFields: matchedFieldsFor(record, safeQuery, filterTags),
    }));
    const last = page[page.length - 1];
    return jsonResult({
      count: records.length,
      records,
      nextCursor:
        hasMore && last ? encodeSearchCursor({ updated_at: last.updated_at, id: last.id }) : null,
    });
  } catch {
    return errorResult("DATA_UNAVAILABLE");
  }
}

export async function loadRecord(
  supabase: ReturnType<typeof supabaseForUser>,
  id: string,
): Promise<{ record: SafeRecord } | { code: "DATA_UNAVAILABLE" | "NOT_FOUND" }> {
  const { data, error } = await supabase
    .from("records")
    .select(RECORD_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) return { code: "DATA_UNAVAILABLE" };
  if (!data) return { code: "NOT_FOUND" };
  return { record: projectRecord(data) };
}

export async function loadLinkedRecordIds(
  supabase: ReturnType<typeof supabaseForUser>,
  id: string,
): Promise<{ linkedRecordIds: string[] } | { code: "DATA_UNAVAILABLE" }> {
  const { data, error } = await supabase
    .from("record_links")
    .select("source_record_id,target_record_id")
    .or(`source_record_id.eq.${id},target_record_id.eq.${id}`);
  if (error) return { code: "DATA_UNAVAILABLE" };
  return {
    linkedRecordIds: (data ?? []).map((link) =>
      link.source_record_id === id ? link.target_record_id : link.source_record_id,
    ),
  };
}

export async function handleFetchRecord(
  { id }: { id: string },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = await authResult(ctx);
  if (authError) return authError;
  try {
    const supabase = supabaseForUser(ctx);
    const loaded = await loadRecord(supabase, id);
    if ("code" in loaded) return errorResult(loaded.code);
    const links = await loadLinkedRecordIds(supabase, id);
    if ("code" in links) return errorResult(links.code);
    return jsonResult({ record: loaded.record, linkedRecordIds: links.linkedRecordIds });
  } catch {
    return errorResult("DATA_UNAVAILABLE");
  }
}

export async function handleGetContext(
  { id, limit }: { id: string; limit?: number },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = await authResult(ctx);
  if (authError) return authError;
  let rowLimit: number;
  try {
    rowLimit = boundedLimit(limit, 25, 50);
  } catch {
    return errorResult("INVALID_INPUT");
  }

  try {
    const supabase = supabaseForUser(ctx);
    const loaded = await loadRecord(supabase, id);
    if ("code" in loaded) return errorResult(loaded.code);
    const links = await loadLinkedRecordIds(supabase, id);
    if ("code" in links) return errorResult(links.code);
    const linkedRecordIds = links.linkedRecordIds.slice(0, rowLimit);
    const { data, error } = linkedRecordIds.length
      ? await supabase.from("records").select(RECORD_DETAIL_SELECT).in("id", linkedRecordIds)
      : { data: [], error: null };
    if (error) return errorResult(mapSupabaseError(error));
    const byId = new Map((data ?? []).map((row) => [row.id, projectRecord(row)]));
    const linkedRecords = linkedRecordIds
      .map((linkedId) => byId.get(linkedId))
      .filter((record): record is SafeRecord => Boolean(record));
    return jsonResult({ record: loaded.record, linkedRecordIds, linkedRecords });
  } catch {
    return errorResult("DATA_UNAVAILABLE");
  }
}

export async function handleCompareRecords(
  { ids }: { ids: string[] },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = await authResult(ctx);
  if (authError) return authError;
  if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) {
    return errorResult("INVALID_INPUT");
  }

  try {
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("records")
      .select(RECORD_DETAIL_SELECT)
      .in("id", ids);
    if (error) return errorResult(mapSupabaseError(error));
    const byId = new Map((data ?? []).map((row) => [row.id, projectRecord(row)]));
    const records = ids
      .map((id) => byId.get(id))
      .filter((record): record is SafeRecord => Boolean(record));
    if (records.length !== ids.length) return errorResult("NOT_FOUND");

    return jsonResult({ ...compareProjectedRecords(records), records });
  } catch {
    return errorResult("DATA_UNAVAILABLE");
  }
}

const MAX_TAG_SCAN_ROWS = 1000;

export async function handleListTags(
  { limit }: { limit?: number },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = await authResult(ctx);
  if (authError) return authError;
  let rowLimit: number;
  try {
    rowLimit = boundedLimit(limit, 100, 500);
  } catch {
    return errorResult("INVALID_INPUT");
  }

  try {
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.from("records").select("tags").limit(MAX_TAG_SCAN_ROWS);
    if (error) return errorResult(mapSupabaseError(error));

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const tags = (row as { tags?: unknown }).tags;
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) {
        if (typeof tag !== "string") continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const tags = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
      .slice(0, rowLimit);
    return jsonResult({ count: tags.length, tags });
  } catch {
    return errorResult("DATA_UNAVAILABLE");
  }
}

export async function handleListRecent(
  { since, recordType, limit }: { since: string; recordType?: CanonicalRecordType; limit?: number },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = await authResult(ctx);
  if (authError) return authError;
  if (!validIsoDatetime(since)) return errorResult("INVALID_INPUT");
  if (recordType && !isCanonicalRecordType(recordType)) return errorResult("INVALID_INPUT");
  let rowLimit: number;
  try {
    rowLimit = boundedLimit(limit);
  } catch {
    return errorResult("INVALID_INPUT");
  }

  try {
    const supabase = supabaseForUser(ctx);
    let request = supabase
      .from("records")
      .select(RECORD_LIST_SELECT)
      .gte("updated_at", new Date(since).toISOString())
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(rowLimit);
    if (recordType) request = request.eq("record_type", recordType);
    const { data, error } = await request;
    if (error) return errorResult(mapSupabaseError(error));

    const records = (data ?? []).map((row) => withoutRecordData(projectRecord(row)));
    return jsonResult({ count: records.length, records });
  } catch {
    return errorResult("DATA_UNAVAILABLE");
  }
}

const DEFAULT_DECISION_STATUSES: readonly DecisionStatus[] = ["Current", "Tentative"];
const MAX_SUPERSEDES_DEPTH = 5;

function chainTarget(record: SafeRecord): string | null {
  const target = record.record_data?.["supersedesDecisionId"];
  if (typeof target !== "string" || target.trim().length === 0) return null;
  return target.trim();
}

async function resolveSupersedesChains(
  supabase: ReturnType<typeof supabaseForUser>,
  decisions: SafeRecord[],
): Promise<
  | { chains: Map<string, { record: SafeRecord | null; ids: string[] }> }
  | { code: "DATA_UNAVAILABLE" | "FOUNDATION_UNAVAILABLE" | "RUNTIME_UNAVAILABLE" }
> {
  const result = new Map<string, { record: SafeRecord | null; ids: string[] }>();
  const seenByOwner = new Map<string, Set<string>>();
  for (const decision of decisions) {
    result.set(decision.id, { record: null, ids: [] });
    seenByOwner.set(decision.id, new Set([decision.id]));
  }

  const recordsById = new Map<string, SafeRecord>(
    decisions.map((decision) => [decision.id, decision]),
  );
  let needed = new Map<string, Set<string>>();
  for (const decision of decisions) {
    const target = chainTarget(decision);
    if (target && !seenByOwner.get(decision.id)?.has(target)) {
      seenByOwner.get(decision.id)?.add(target);
      const owners = needed.get(target) ?? new Set<string>();
      owners.add(decision.id);
      needed.set(target, owners);
    }
  }

  for (let depth = 0; depth < MAX_SUPERSEDES_DEPTH && needed.size > 0; depth += 1) {
    const missing = [...needed.keys()].filter((id) => !recordsById.has(id));
    if (missing.length > 0) {
      const { data, error } = await supabase
        .from("records")
        .select(RECORD_DETAIL_SELECT)
        .in("id", missing);
      if (error) {
        const code = mapSupabaseError(error);
        return {
          code:
            code === "FOUNDATION_UNAVAILABLE" || code === "RUNTIME_UNAVAILABLE"
              ? code
              : ("DATA_UNAVAILABLE" as const),
        };
      }
      for (const row of data ?? []) recordsById.set(String(row.id), projectRecord(row));
    }
    const next = new Map<string, Set<string>>();
    for (const [targetId, owners] of needed) {
      const found = recordsById.get(targetId);
      if (!found) continue;
      for (const ownerId of owners) {
        const entry = result.get(ownerId);
        if (!entry) continue;
        if (depth === 0) entry.record = found;
        entry.ids.push(targetId);
        const target = chainTarget(found);
        const seen = seenByOwner.get(ownerId);
        if (target && seen && !seen.has(target)) {
          seen.add(target);
          const nextOwners = next.get(target) ?? new Set<string>();
          nextOwners.add(ownerId);
          next.set(target, nextOwners);
        }
      }
    }
    needed = next;
  }
  return { chains: result };
}

export async function handleGetDecisions(
  { query, status, limit }: { query?: string; status?: DecisionStatus; limit?: number },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = await authResult(ctx);
  if (authError) return authError;
  if (status !== undefined && !DECISION_STATUSES.includes(status)) {
    return errorResult("INVALID_INPUT");
  }
  if (query !== undefined && (query.trim().length === 0 || query.length > 200)) {
    return errorResult("INVALID_INPUT");
  }
  let rowLimit: number;
  try {
    rowLimit = boundedLimit(limit);
  } catch {
    return errorResult("INVALID_INPUT");
  }

  let textFilter: string | null = null;
  if (query !== undefined) {
    const baseFilter = buildSearchFilter(query);
    const dataFilter = buildRecordDataSearchFilter("decision", query);
    textFilter = [baseFilter, dataFilter].filter((part) => part !== null).join(",");
    if (!textFilter) return errorResult("INVALID_INPUT");
  }
  const statuses: readonly DecisionStatus[] = status ? [status] : DEFAULT_DECISION_STATUSES;

  try {
    const supabase = supabaseForUser(ctx);
    let request = supabase
      .from("records")
      .select(RECORD_DETAIL_SELECT)
      .eq("record_type", "decision")
      .in("record_data->>status", [...statuses])
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(rowLimit);
    if (textFilter) request = request.or(textFilter);
    const { data, error } = await request;
    if (error) return errorResult(mapSupabaseError(error));

    const decisions = (data ?? []).map((row) => projectRecord(row));
    const resolved = await resolveSupersedesChains(supabase, decisions);
    if ("code" in resolved) return errorResult(resolved.code);
    const chains = resolved.chains;
    return jsonResult({
      count: decisions.length,
      decisions: decisions.map((decision) => ({
        ...decision,
        supersedes: chains.get(decision.id)?.record ?? null,
        supersedesChain: chains.get(decision.id)?.ids ?? [],
      })),
    });
  } catch {
    return errorResult("DATA_UNAVAILABLE");
  }
}
