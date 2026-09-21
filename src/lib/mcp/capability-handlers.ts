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
  "id,title,objective,current_question,default_working_set,archive_scope,status,created_at,updated_at";
const FINDING_SELECT =
  "id,case_id,analysis_mode,title,finding,confidence,what_would_change_mind,revisit_condition,source_record_id,status,lifecycle_status,origin_kind,analysis_outcome,origin_run_id,origin_step_id,candidate_index,analysis_result_hash,uncertainties,assumptions,scope_limits,evidence_gaps,created_at,updated_at";
const FINDING_EVIDENCE_SELECT = "id,finding_id,evidence_id,relationship_kind,relationship_note";
const EVIDENCE_DESCRIPTOR_SELECT =
  "id,title,source_classification,source_uri,source_record_id,captured_at";
const RUN_SELECT =
  "id,case_id,objective,model_tier,status,started_at,completed_at,failure_code,failure_message,created_at,updated_at";
export const APPROVAL_SELECT =
  "id,case_id,run_id,approval_kind,status,title,rationale,proposed_diff,tool_action,exact_action_hash,requested_at,responded_at,expires_at,provenance,created_at,updated_at";

type FindingProjectionRow = Record<string, unknown> & { id: string };
type FindingEvidenceProjectionRow = Record<string, unknown> & {
  finding_id: string;
  evidence_id: string;
};
type EvidenceDescriptorProjectionRow = Record<string, unknown> & { id: string };

export function projectFindings(
  findingRows: readonly FindingProjectionRow[],
  links: readonly FindingEvidenceProjectionRow[],
  evidence: readonly EvidenceDescriptorProjectionRow[],
) {
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  const linksByFinding = new Map<string, FindingEvidenceProjectionRow[]>();
  for (const link of links) {
    const current = linksByFinding.get(link.finding_id) ?? [];
    current.push(link);
    linksByFinding.set(link.finding_id, current);
  }
  return findingRows.map((finding) => ({
    ...finding,
    evidence: (linksByFinding.get(finding.id) ?? []).map((link) => ({
      ...link,
      evidence: evidenceById.get(link.evidence_id) ?? { id: link.evidence_id },
    })),
  }));
}

export async function handleListCases(
  { query, status, limit }: { query?: string; status?: string; limit?: number },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = await authResult(ctx);
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
  const authError = await authResult(ctx);
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
  const authError = await authResult(ctx);
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
    const findingRows = data ?? [];
    const findingIds = findingRows.map((finding) => finding.id);
    if (findingIds.length === 0) return jsonResult({ count: 0, findings: [] });

    const { data: links, error: linksError } = await supabase
      .from("custodian_finding_evidence")
      .select(FINDING_EVIDENCE_SELECT)
      .in("finding_id", findingIds);
    if (linksError) return errorResult(mapSupabaseError(linksError, "FOUNDATION_UNAVAILABLE"));

    const evidenceIds = [...new Set((links ?? []).map((link) => link.evidence_id))];
    const { data: evidence, error: evidenceError } = evidenceIds.length
      ? await supabase
          .from("evidence_items")
          .select(EVIDENCE_DESCRIPTOR_SELECT)
          .in("id", evidenceIds)
      : { data: [], error: null };
    if (evidenceError)
      return errorResult(mapSupabaseError(evidenceError, "FOUNDATION_UNAVAILABLE"));

    return jsonResult({
      count: findingRows.length,
      findings: projectFindings(findingRows, links ?? [], evidence ?? []),
    });
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
  const authError = await authResult(ctx);
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
  const authError = await authResult(ctx);
  if (authError) return authError;
  return errorResult("RUNTIME_UNAVAILABLE");
}

export async function handleCancelRun(
  _input: { id: string },
  ctx: ToolContext,
): Promise<JsonToolResult> {
  const authError = await authResult(ctx);
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
  const authError = await authResult(ctx);
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
