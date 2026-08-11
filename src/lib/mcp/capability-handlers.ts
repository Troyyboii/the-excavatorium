import type { ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase";
import {
  authResult,
  boundedLimit,
  buildTextSearchFilter,
  errorResult,
  jsonResult,
  mapSupabaseError,
  type JsonToolResult,
} from "./mcp-utils";

const CASE_SELECT =
  "id,title,objective,current_question,default_working_set,status,created_at,updated_at";
const FINDING_SELECT =
  "id,case_id,analysis_mode,title,finding,confidence,what_would_change_mind,revisit_condition,source_record_id,status,created_at,updated_at";
const RUN_SELECT =
  "id,case_id,objective,model_tier,status,started_at,completed_at,failure_code,failure_message,created_at,updated_at";
const APPROVAL_SELECT =
  "id,case_id,run_id,approval_kind,status,title,rationale,requested_at,responded_at,expires_at,created_at,updated_at";

export async function handleListCases(
  { query, status, limit }: { query?: string; status?: string; limit?: number },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = authResult(ctx);
  if (authError) return authError;
  if (query !== undefined && (query.trim().length === 0 || query.length > 200)) {
    return errorResult("INVALID_INPUT");
  }
  let rowLimit: number;
  try {
    rowLimit = boundedLimit(limit);
  } catch {
    return errorResult("INVALID_INPUT");
  }

  try {
    const supabase = supabaseForUser(ctx);
    let request = supabase
      .from("cases")
      .select(CASE_SELECT)
      .order("updated_at", { ascending: false })
      .limit(rowLimit);
    if (status) request = request.eq("status", status);
    if (query) {
      const filter = buildTextSearchFilter(query);
      if (!filter) return errorResult("INVALID_INPUT");
      request = request.or(filter);
    }
    const { data, error } = await request;
    if (error) return errorResult(mapSupabaseError(error, "FOUNDATION_UNAVAILABLE"));
    return jsonResult({ count: data?.length ?? 0, cases: data ?? [] });
  } catch {
    return errorResult("FOUNDATION_UNAVAILABLE");
  }
}

export async function handleGetCase(
  { id }: { id: string },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = authResult(ctx);
  if (authError) return authError;
  try {
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("cases")
      .select(CASE_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) return errorResult(mapSupabaseError(error, "FOUNDATION_UNAVAILABLE"));
    if (!data) return errorResult("NOT_FOUND");
    return jsonResult({ case: data });
  } catch {
    return errorResult("FOUNDATION_UNAVAILABLE");
  }
}

export async function handleGetFindings(
  { caseId, limit }: { caseId?: string; limit?: number },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = authResult(ctx);
  if (authError) return authError;
  let rowLimit: number;
  try {
    rowLimit = boundedLimit(limit);
  } catch {
    return errorResult("INVALID_INPUT");
  }

  try {
    const supabase = supabaseForUser(ctx);
    let request = supabase
      .from("custodian_findings")
      .select(FINDING_SELECT)
      .order("created_at", { ascending: false })
      .limit(rowLimit);
    if (caseId) request = request.eq("case_id", caseId);
    const { data, error } = await request;
    if (error) return errorResult(mapSupabaseError(error, "FOUNDATION_UNAVAILABLE"));
    return jsonResult({ count: data?.length ?? 0, findings: data ?? [] });
  } catch {
    return errorResult("FOUNDATION_UNAVAILABLE");
  }
}

export async function handleGetPendingApprovals(
  { caseId, limit }: { caseId?: string; limit?: number },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  return readRuntimeTable(ctx, "approval_requests", APPROVAL_SELECT, caseId, limit, "approvals");
}

export async function handleGetRun(
  { id }: { id: string },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = authResult(ctx);
  if (authError) return authError;
  try {
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("agent_runs")
      .select(RUN_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) return errorResult(mapSupabaseError(error, "RUNTIME_UNAVAILABLE"));
    if (!data) return errorResult("NOT_FOUND");
    return jsonResult({ run: data });
  } catch {
    return errorResult("RUNTIME_UNAVAILABLE");
  }
}

export async function handleStartAnalysis(
  _input: { caseId: string; recordIds?: string[] },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = authResult(ctx);
  if (authError) return authError;
  return errorResult("RUNTIME_UNAVAILABLE");
}

export async function handleCancelRun(
  _input: { id: string },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = authResult(ctx);
  if (authError) return authError;
  return errorResult("RUNTIME_UNAVAILABLE");
}

async function readRuntimeTable(
  ctx: ToolContext,
  table: "approval_requests",
  select: string,
  caseId: string | undefined,
  limit: number | undefined,
  resultKey: "approvals",
): Promise<JsonToolResult> {
  const authError = authResult(ctx);
  if (authError) return authError;
  let rowLimit: number;
  try {
    rowLimit = boundedLimit(limit);
  } catch {
    return errorResult("INVALID_INPUT");
  }
  try {
    const supabase = supabaseForUser(ctx);
    let request = supabase
      .from(table)
      .select(select)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(rowLimit);
    if (caseId) request = request.eq("case_id", caseId);
    const { data, error } = await request;
    if (error) return errorResult(mapSupabaseError(error, "RUNTIME_UNAVAILABLE"));
    return jsonResult({ count: data?.length ?? 0, [resultKey]: data ?? [] });
  } catch {
    return errorResult("RUNTIME_UNAVAILABLE");
  }
}
