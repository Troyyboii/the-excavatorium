import type { ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase";
import {
  authResult,
  boundedLimit,
  buildSearchFilter,
  compareProjectedRecords,
  errorResult,
  isCanonicalRecordType,
  jsonResult,
  mapSupabaseError,
  projectRecord,
  RECORD_DETAIL_SELECT,
  RECORD_LIST_SELECT,
  withoutRecordData,
  type CanonicalRecordType,
  type JsonToolResult,
  type SafeRecord,
} from "./mcp-utils";

type SearchInput = {
  recordType?: CanonicalRecordType;
  query?: string;
  limit?: number;
};

export async function handleSearchRecords(
  { recordType, query, limit }: SearchInput,
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = authResult(ctx);
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

  const filter = query === undefined ? null : buildSearchFilter(query);
  if (query !== undefined && !filter) return errorResult("INVALID_INPUT");

  try {
    const supabase = supabaseForUser(ctx);
    let request = supabase
      .from("records")
      .select(RECORD_LIST_SELECT)
      .order("updated_at", { ascending: false })
      .limit(rowLimit);
    if (recordType) request = request.eq("record_type", recordType);
    if (filter) request = request.or(filter);
    const { data, error } = await request;
    if (error) return errorResult(mapSupabaseError(error));

    const records = (data ?? []).map((row) => withoutRecordData(projectRecord(row)));
    return jsonResult({ count: records.length, records });
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
  const authError = authResult(ctx);
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
  const authError = authResult(ctx);
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
  const authError = authResult(ctx);
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
