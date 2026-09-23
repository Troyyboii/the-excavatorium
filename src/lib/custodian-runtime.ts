import { useQuery } from "@tanstack/react-query";
import { CustodianFoundationMissingError, isCustodianFoundationMissing } from "./custodian";
import { isRuntimeRunState, type ModelTier, type RuntimeRunState } from "./custodian-runtime-types";
import { useCurrentUserId } from "./session";
import { supabase } from "./supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_TIERS = ["luna", "terra", "sol", "pro"] as const;

export const CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER = true;
export const CUSTODIAN_RUN_READ_LIMIT = 100;

export type ProviderHoldStatus = "held" | "settled_known" | "released_uncontacted";
export type ProviderUsageKnowledge = "known" | "unknown" | "none";

export type CustodianProviderHold = {
  id: string;
  runId: string;
  status: ProviderHoldStatus;
  usageKnowledge: ProviderUsageKnowledge;
  holdTokens: number;
  holdCostUsd: number;
  actualTokens: number | null;
  actualCostUsd: number | null;
  pricingVersion: string;
  failureCode: string | null;
  inFlightUntil: string;
  updatedAt: string;
};

export type ProviderDiagnosticContactState = "contacted" | "contact_uncertain";

/**
 * Safe provider metadata for one provider attempt. The Edge runtime records
 * only validated tokens; prompts, evidence, bodies, and provider messages are
 * never stored, so none can be shown here.
 */
export type CustodianProviderDiagnostic = {
  id: string;
  runId: string;
  reservationId: string;
  attemptKey: string;
  provider: "openai";
  contactState: ProviderDiagnosticContactState;
  classification: string;
  httpStatus: number | null;
  requestId: string | null;
  errorType: string | null;
  errorCode: string | null;
  errorParam: string | null;
  incompleteReason: string | null;
  createdAt: string;
};

export type CustodianRunStep = {
  runId: string;
  stepKind: string;
  status: string;
  sequenceNo: number;
};

export type CustodianRun = {
  id: string;
  caseId: string;
  objective: string;
  modelTier: ModelTier;
  status: RuntimeRunState;
  budgetTokens: number;
  budgetCostUsd: number;
  budgetLatencyMs: number;
  budgetToolEvents: number;
  tokensUsed: number;
  costUsd: number;
  latencyMs: number;
  toolEventsCount: number;
  lastStepNumber: number;
  failureCode: string | null;
  failureMessage: string | null;
  cancelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  providerHold: CustodianProviderHold | null;
  providerDiagnostic: CustodianProviderDiagnostic | null;
  latestStep: CustodianRunStep | null;
};

export type CustodianRunRead = {
  runs: CustodianRun[];
  providerHoldProjection: "available" | "unavailable";
};

export type CustodianRunInvocation = {
  runId: string;
  invocationKey: string;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Custodian run must be a database row object");
  }
  return value as UnknownRecord;
}

function text(row: UnknownRecord, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Custodian run field ${key} must be text`);
  return value;
}

function nullableText(row: UnknownRecord, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new Error(`Custodian run field ${key} must be text or null`);
  }
  return value as string | null;
}

function numberValue(row: UnknownRecord, key: string): number {
  const value = row[key];
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Custodian run field ${key} must be a non-negative number`);
  }
  return parsed;
}

function nullableNumber(row: UnknownRecord, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Custodian run field ${key} must be a non-negative number or null`);
  }
  return parsed;
}

function timestamp(row: UnknownRecord, key: string): string {
  const value = text(row, key);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Custodian run field ${key} is invalid`);
  return parsed.toISOString();
}

export function mapCustodianRunRow(value: unknown): CustodianRun {
  const row = record(value);
  const status = text(row, "status");
  const modelTier = text(row, "model_tier");
  if (!isRuntimeRunState(status)) throw new Error("Custodian run status is invalid");
  if (!MODEL_TIERS.includes(modelTier as ModelTier))
    throw new Error("Custodian model tier is invalid");
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    objective: text(row, "objective"),
    modelTier: modelTier as ModelTier,
    status,
    budgetTokens: numberValue(row, "budget_tokens"),
    budgetCostUsd: numberValue(row, "budget_cost_usd"),
    budgetLatencyMs: numberValue(row, "budget_latency_ms"),
    budgetToolEvents: numberValue(row, "budget_tool_events"),
    tokensUsed: numberValue(row, "tokens_used"),
    costUsd: numberValue(row, "cost_usd"),
    latencyMs: numberValue(row, "latency_ms"),
    toolEventsCount: numberValue(row, "tool_events_count"),
    lastStepNumber: numberValue(row, "last_step_number"),
    failureCode: nullableText(row, "failure_code"),
    failureMessage: nullableText(row, "failure_message"),
    cancelRequestedAt: nullableTimestamp(row, "cancel_requested_at"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
    providerHold: null,
    providerDiagnostic: null,
    latestStep: null,
  };
}

function nullableTimestamp(row: UnknownRecord, key: string): string | null {
  const value = nullableText(row, key);
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Custodian run field ${key} is invalid`);
  return parsed.toISOString();
}

const HOLD_STATUSES = ["held", "settled_known", "released_uncontacted"] as const;
const USAGE_KNOWLEDGE = ["known", "unknown", "none"] as const;

export function mapProviderHoldRow(value: unknown): CustodianProviderHold {
  const row = record(value);
  const status = text(row, "status");
  const usageKnowledge = text(row, "usage_knowledge");
  if (!HOLD_STATUSES.includes(status as (typeof HOLD_STATUSES)[number])) {
    throw new Error("Custodian provider hold status is invalid");
  }
  if (!USAGE_KNOWLEDGE.includes(usageKnowledge as (typeof USAGE_KNOWLEDGE)[number])) {
    throw new Error("Custodian provider usage knowledge is invalid");
  }
  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    status: status as ProviderHoldStatus,
    usageKnowledge: usageKnowledge as ProviderUsageKnowledge,
    holdTokens: numberValue(row, "hold_tokens"),
    holdCostUsd: numberValue(row, "hold_cost_usd"),
    actualTokens: nullableNumber(row, "actual_tokens"),
    actualCostUsd: nullableNumber(row, "actual_cost_usd"),
    pricingVersion: text(row, "pricing_version"),
    failureCode: nullableText(row, "failure_code"),
    inFlightUntil: timestamp(row, "in_flight_until"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

const DIAGNOSTIC_TOKEN = /^[a-z0-9_]{1,80}$/;
const DIAGNOSTIC_PARAM = /^[A-Za-z0-9_.[\]-]{1,200}$/;
const DIAGNOSTIC_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DIAGNOSTIC_CONTACT_STATES = ["contacted", "contact_uncertain"] as const;

function safeDiagnosticValue(row: UnknownRecord, key: string, pattern: RegExp): string | null {
  const value = row[key];
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/**
 * Re-validates every provider-derived value before display. A value outside
 * the allowlisted shape is shown as absent, never sanitized into a new string.
 */
export function mapProviderDiagnosticRow(value: unknown): CustodianProviderDiagnostic | null {
  let row: UnknownRecord;
  try {
    row = record(value);
  } catch {
    return null;
  }
  const contactState = row.contact_state;
  const classification = safeDiagnosticValue(row, "classification", DIAGNOSTIC_TOKEN);
  const status = row.http_status;
  const createdAt = typeof row.created_at === "string" ? new Date(row.created_at) : null;
  if (
    typeof row.id !== "string" ||
    typeof row.run_id !== "string" ||
    typeof row.reservation_id !== "string" ||
    typeof row.attempt_key !== "string" ||
    row.provider !== "openai" ||
    !DIAGNOSTIC_CONTACT_STATES.includes(contactState as ProviderDiagnosticContactState) ||
    classification === null ||
    !createdAt ||
    Number.isNaN(createdAt.getTime())
  ) {
    return null;
  }
  const httpStatus =
    typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : null;
  return {
    id: row.id,
    runId: row.run_id,
    reservationId: row.reservation_id,
    attemptKey: row.attempt_key,
    provider: "openai",
    contactState: contactState as ProviderDiagnosticContactState,
    classification,
    httpStatus,
    requestId: safeDiagnosticValue(row, "request_id", DIAGNOSTIC_REQUEST_ID),
    errorType: safeDiagnosticValue(row, "error_type", DIAGNOSTIC_TOKEN),
    errorCode: safeDiagnosticValue(row, "error_code", DIAGNOSTIC_TOKEN),
    errorParam: safeDiagnosticValue(row, "error_param", DIAGNOSTIC_PARAM),
    incompleteReason: safeDiagnosticValue(row, "incomplete_reason", DIAGNOSTIC_TOKEN),
    createdAt: createdAt.toISOString(),
  };
}

const DIAGNOSTIC_CLASSIFICATION_LABELS: Record<string, string> = {
  openai_completed: "Completed",
  openai_refusal: "Model refused",
  openai_incomplete: "Incomplete response",
  openai_invalid_output: "Output did not match the result contract",
  openai_invalid_response: "Unreadable response",
  openai_usage_missing: "Usage missing",
  openai_authentication_failed: "Authentication failed",
  openai_permission_denied: "Permission denied",
  openai_quota_exceeded: "Quota or spend limit reached",
  openai_rate_limited: "Rate limited",
  openai_model_unavailable: "Model unavailable",
  openai_request_rejected: "Request rejected",
  openai_server_error: "Provider server error",
  openai_timeout: "Timed out",
  openai_unavailable: "Provider unavailable",
};

export function describeProviderDiagnostic(
  diagnostic: CustodianProviderDiagnostic,
): Array<{ label: string; value: string }> {
  const entries: Array<{ label: string; value: string }> = [
    { label: "Provider", value: "OpenAI" },
    {
      label: "Status",
      value:
        diagnostic.httpStatus !== null
          ? String(diagnostic.httpStatus)
          : "No HTTP response. Contact is uncertain.",
    },
    {
      label: "Classification",
      value: DIAGNOSTIC_CLASSIFICATION_LABELS[diagnostic.classification] ?? "Unrecognized",
    },
  ];
  const optional: Array<[string, string | null]> = [
    ["Error type", diagnostic.errorType],
    ["Error code", diagnostic.errorCode],
    ["Parameter", diagnostic.errorParam],
    ["Incomplete reason", diagnostic.incompleteReason],
    ["Request ID", diagnostic.requestId],
  ];
  for (const [label, value] of optional) {
    if (value !== null) entries.push({ label, value });
  }
  entries.push({ label: "Attempt", value: diagnostic.attemptKey });
  entries.push({ label: "Time", value: diagnostic.createdAt });
  return entries;
}

export function diagnosticsByRun(
  rows: readonly unknown[],
): Map<string, CustodianProviderDiagnostic> {
  const byRun = new Map<string, CustodianProviderDiagnostic>();
  for (const row of rows) {
    const diagnostic = mapProviderDiagnosticRow(row);
    if (!diagnostic) continue;
    const current = byRun.get(diagnostic.runId);
    if (!current || diagnostic.createdAt > current.createdAt) {
      byRun.set(diagnostic.runId, diagnostic);
    }
  }
  return byRun;
}

export function mapRunStepRow(value: unknown): CustodianRunStep {
  const row = record(value);
  const sequenceNo = numberValue(row, "sequence_no");
  if (!Number.isInteger(sequenceNo))
    throw new Error("Custodian step sequence_no must be an integer");
  return {
    runId: text(row, "run_id"),
    stepKind: text(row, "step_kind"),
    status: text(row, "status"),
    sequenceNo,
  };
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function describeCustodianRunAccounting(
  run: CustodianRun,
  providerHoldProjection: CustodianRunRead["providerHoldProjection"] = "available",
): {
  recordedProviderCost: string;
  recordedProviderTokens: string;
  heldProviderBudget: string;
  usageKnowledge: string;
  pricingVersion: string;
  cancellation: string;
} {
  const hold = run.providerHold;
  if (providerHoldProjection === "unavailable" && !hold) {
    return {
      recordedProviderCost: "Not recorded",
      recordedProviderTokens: "Not recorded",
      heldProviderBudget: "Not recorded",
      usageKnowledge: "Recorded usage is unclaimed. The invocation outcome is not established.",
      pricingVersion: "Not recorded",
      cancellation: run.cancelRequestedAt
        ? `Requested ${run.cancelRequestedAt}. Cancellation does not prove the provider was never contacted.`
        : "Not requested",
    };
  }
  const unknown = hold?.status === "held" || hold?.usageKnowledge === "unknown";
  const known = hold?.status === "settled_known" && hold.usageKnowledge === "known";
  return {
    recordedProviderCost: unknown
      ? "Not recorded"
      : known && hold.actualCostUsd !== null
        ? formatUsd(hold.actualCostUsd)
        : hold
          ? "No provider usage recorded"
          : formatUsd(run.costUsd),
    recordedProviderTokens: unknown
      ? "Not recorded"
      : known && hold.actualTokens !== null
        ? String(hold.actualTokens)
        : hold
          ? "No provider usage recorded"
          : String(run.tokensUsed),
    heldProviderBudget:
      hold?.status === "held"
        ? `${formatUsd(hold.holdCostUsd)} encumbered · ${hold.holdTokens} tokens`
        : "None",
    usageKnowledge: unknown
      ? "Unknown. Provider contact may already have happened."
      : known
        ? "Known recorded usage."
        : "No provider usage recorded.",
    pricingVersion: hold?.pricingVersion ?? "Not recorded",
    cancellation: run.cancelRequestedAt
      ? `Requested ${run.cancelRequestedAt}. Cancellation does not prove the provider was never contacted.`
      : "Not requested",
  };
}

export function custodianRunInvocation(
  runId: string,
  invocationKey: string,
): CustodianRunInvocation {
  return { runId, invocationKey };
}

export function interpretCustodianFunctionResult(result: { error: unknown }): {
  invoked: boolean;
  reason: "invoked" | "invocation_failed";
} {
  if (result.error) return { invoked: false, reason: "invocation_failed" };
  return { invoked: true, reason: "invoked" };
}

export async function invokeCustodianRun(input: CustodianRunInvocation): Promise<{
  invoked: boolean;
  reason: "provider_surface_blocked" | "invoked" | "invocation_failed";
}> {
  const providerSurfaceEnabled = CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER as boolean;
  if (!providerSurfaceEnabled) {
    return { invoked: false, reason: "provider_surface_blocked" };
  }
  const body = custodianRunInvocation(input.runId, input.invocationKey);
  try {
    const result = await supabase.functions.invoke("custodian-run", { body });
    return interpretCustodianFunctionResult(result);
  } catch {
    return { invoked: false, reason: "invocation_failed" };
  }
}

const RUN_SELECT =
  "id,case_id,objective,model_tier,status,budget_tokens,budget_cost_usd,budget_latency_ms,budget_tool_events,tokens_used,cost_usd,latency_ms,tool_events_count,last_step_number,failure_code,failure_message,cancel_requested_at,created_at,updated_at";
const HOLD_SELECT =
  "id,run_id,status,usage_knowledge,hold_tokens,hold_cost_usd,actual_tokens,actual_cost_usd,pricing_version,failure_code,in_flight_until,updated_at";
const STEP_SELECT = "run_id,step_kind,status,sequence_no";
const DIAGNOSTIC_SELECT =
  "id,run_id,reservation_id,attempt_key,provider,contact_state,classification,http_status,request_id,error_type,error_code,error_param,incomplete_reason,created_at";

function relationUnavailable(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

export const custodianRunsKey = (userId: string | null) =>
  ["custodian", "runs", userId ?? "__anonymous__"] as const;

export async function fetchCustodianRuns(ownerId: string): Promise<CustodianRunRead> {
  if (!UUID_PATTERN.test(ownerId)) throw new Error("A valid owner is required for the run read");
  const { data, error } = await supabase
    .from("agent_runs")
    .select(RUN_SELECT)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CUSTODIAN_RUN_READ_LIMIT);
  if (error) {
    if (isCustodianFoundationMissing(error)) throw new CustodianFoundationMissingError();
    throw error;
  }
  if (!data) throw new Error("Custodian run read returned no data");
  const runs = data.map(mapCustodianRunRow);
  const runIds = runs.map((run) => run.id);
  if (runIds.length === 0) return { runs, providerHoldProjection: "available" };

  const [holds, steps, diagnostics] = await Promise.all([
    supabase
      .from("agent_provider_reservations")
      .select(HOLD_SELECT)
      .eq("owner_id", ownerId)
      .in("run_id", runIds)
      .order("updated_at", { ascending: false })
      .limit(CUSTODIAN_RUN_READ_LIMIT),
    supabase
      .from("agent_steps")
      .select(STEP_SELECT)
      .eq("owner_id", ownerId)
      .in("run_id", runIds)
      .order("sequence_no", { ascending: false })
      .limit(1_000),
    supabase
      .from("agent_provider_diagnostics")
      .select(DIAGNOSTIC_SELECT)
      .eq("owner_id", ownerId)
      .in("run_id", runIds)
      .order("created_at", { ascending: false })
      .limit(CUSTODIAN_RUN_READ_LIMIT),
  ]);
  if (steps.error) {
    if (isCustodianFoundationMissing(steps.error)) throw new CustodianFoundationMissingError();
    throw steps.error;
  }
  let providerHoldProjection: CustodianRunRead["providerHoldProjection"] = "available";
  const holdRows: CustodianProviderHold[] = [];
  if (holds.error) {
    if (relationUnavailable(holds.error)) providerHoldProjection = "unavailable";
    else throw holds.error;
  } else {
    for (const row of holds.data ?? []) holdRows.push(mapProviderHoldRow(row));
  }
  const latestStepByRun = new Map<string, CustodianRunStep>();
  for (const row of steps.data ?? []) {
    const step = mapRunStepRow(row);
    if (!latestStepByRun.has(step.runId)) latestStepByRun.set(step.runId, step);
  }
  const holdByRun = new Map<string, CustodianProviderHold>();
  for (const hold of holdRows) {
    const current = holdByRun.get(hold.runId);
    if (!current || (hold.status === "held" && current.status !== "held")) {
      holdByRun.set(hold.runId, hold);
    }
  }
  // Diagnostics are supplementary technical detail. A missing relation or a
  // failed read never blocks the run or accounting projection.
  const diagnosticByRun = diagnostics.error
    ? new Map<string, CustodianProviderDiagnostic>()
    : diagnosticsByRun(diagnostics.data ?? []);
  return {
    providerHoldProjection,
    runs: runs.map((run) => ({
      ...run,
      providerHold: holdByRun.get(run.id) ?? null,
      providerDiagnostic: diagnosticByRun.get(run.id) ?? null,
      latestStep: latestStepByRun.get(run.id) ?? null,
    })),
  };
}

export function useCustodianRuns(enabled = true) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: custodianRunsKey(userId),
    enabled: enabled && userId !== null,
    staleTime: 5_000,
    retry: (failureCount, error) => !isCustodianFoundationMissing(error) && failureCount < 2,
    queryFn: () => fetchCustodianRuns(userId as string),
  });
}
