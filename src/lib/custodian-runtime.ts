import { useQuery } from "@tanstack/react-query";
import { CustodianFoundationMissingError, isCustodianFoundationMissing } from "./custodian";
import { isRuntimeRunState, type ModelTier, type RuntimeRunState } from "./custodian-runtime-types";
import { useCurrentUserId } from "./session";
import { supabase } from "./supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_TIERS = ["luna", "terra", "sol", "pro"] as const;

export const CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER = false;
export const CUSTODIAN_RUN_READ_LIMIT = 100;

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
  createdAt: string;
  updatedAt: string;
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
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Custodian run field ${key} must be a non-negative number`);
  }
  return value;
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
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

const RUN_SELECT =
  "id,case_id,objective,model_tier,status,budget_tokens,budget_cost_usd,budget_latency_ms,budget_tool_events,tokens_used,cost_usd,latency_ms,tool_events_count,last_step_number,failure_code,failure_message,created_at,updated_at";

export const custodianRunsKey = (userId: string | null) =>
  ["custodian", "runs", userId ?? "__anonymous__"] as const;

export async function fetchCustodianRuns(ownerId: string): Promise<CustodianRun[]> {
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
  return data.map(mapCustodianRunRow);
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
