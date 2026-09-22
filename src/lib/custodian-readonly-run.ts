import { CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER, fetchCustodianRuns } from "./custodian-runtime";
import { MODEL_ALLOWLIST, type ModelTier } from "./custodian-runtime-types";
import { supabase } from "./supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_TIERS = Object.keys(MODEL_ALLOWLIST) as ModelTier[];
const SERVER_ATTEMPT_PREFIX = "provider-attempt:";

/** Advanceable lifecycle states. The driver stops on awaiting_approval instead of entering execution. */
export const READONLY_ANALYSIS_ADVANCE_STATES = [
  "queued",
  "retrieving",
  "synthesizing",
  "executing",
  "verifying",
] as const;

export const READONLY_ANALYSIS_DRIVE_BOUND = READONLY_ANALYSIS_ADVANCE_STATES.length;

export const READONLY_ANALYSIS_STOP_STATES = [
  "completed",
  "awaiting_approval",
  "blocked",
  "failed",
  "expired",
  "budget_stopped",
  "cancelled",
] as const;

export type ReadonlyAnalysisStop = (typeof READONLY_ANALYSIS_STOP_STATES)[number] | "held";

export type ReadonlyAnalysisDraft = {
  caseId: string;
  policyName: string;
  allowedModelTiers: readonly string[];
  perRunTokenBudget: string;
  perRunCostUsd: string;
  perRunLatencyMs: string;
  perRunToolEventBudget: string;
  dailyTokenBudget: string;
  monthlyTokenBudget: string;
  dailyCostUsd: string;
  monthlyCostUsd: string;
  modelTier: string;
  promptVersion: string;
  objective: string;
};

export type ReadonlyAnalysisStartInput = {
  caseId: string;
  policyName: string;
  allowedModelTiers: readonly ModelTier[];
  perRunTokenBudget: number;
  perRunCostUsd: number;
  perRunLatencyMs: number;
  perRunToolEventBudget: number;
  dailyTokenBudget: number;
  monthlyTokenBudget: number;
  dailyCostUsd: number;
  monthlyCostUsd: number;
  modelTier: ModelTier;
  promptVersion: string;
  objective: string;
};

export type ReadonlyAnalysisPolicyPayload = {
  policy_name: string;
  allowed_model_tiers: ModelTier[];
  per_run_token_budget: number;
  per_run_cost_usd: number;
  per_run_latency_ms: number;
  per_run_tool_event_budget: number;
  daily_token_budget: number;
  monthly_token_budget: number;
  daily_cost_usd: number;
  monthly_cost_usd: number;
};

export type ReadonlyAnalysisRunPayload = {
  model_tier: ModelTier;
  prompt_version: string;
  objective: string;
  tool_policy_id: string;
};

export type ReadonlyRunObservation = {
  status: string;
  holdStatus: "held" | "settled_known" | "released_uncontacted" | null;
  failureCode: string | null;
};

export type ReadonlyAnalysisPorts = {
  surfaceEnabled: boolean;
  ensurePolicy: (
    caseId: string,
    payload: ReadonlyAnalysisPolicyPayload,
  ) => Promise<{ policyId: string }>;
  createRun: (
    caseId: string,
    idempotencyKey: string,
    payload: ReadonlyAnalysisRunPayload,
  ) => Promise<{ runId: string }>;
  invoke: (body: { runId: string; invocationKey: string }) => Promise<{
    ok: boolean;
    state: string | null;
    status: string | null;
  }>;
  readRun: (runId: string) => Promise<ReadonlyRunObservation | null>;
  refreshRuns: () => Promise<void>;
};

export type ReadonlyAnalysisSession = {
  tryBegin: () => boolean;
  finish: () => void;
  invocationKey: () => string;
  runIdempotencyKey: () => string;
};

export type ReadonlyAnalysisStartResult =
  | {
      ok: true;
      runId: string;
      status: string;
      stop: ReadonlyAnalysisStop;
      invocationKey: string;
      advances: number;
      failureCode: string | null;
    }
  | {
      ok: false;
      reason:
        | "provider_surface_blocked"
        | "invalid_input"
        | "start_already_in_progress"
        | "policy_failed"
        | "run_failed"
        | "invocation_failed"
        | "run_unreadable"
        | "run_did_not_advance"
        | "drive_bound_exhausted";
      errors?: string[];
      runId?: string;
      status?: string | null;
      detail?: string;
    };

export function emptyReadonlyAnalysisDraft(): ReadonlyAnalysisDraft {
  return {
    caseId: "",
    policyName: "",
    allowedModelTiers: [],
    perRunTokenBudget: "",
    perRunCostUsd: "",
    perRunLatencyMs: "",
    perRunToolEventBudget: "",
    dailyTokenBudget: "",
    monthlyTokenBudget: "",
    dailyCostUsd: "",
    monthlyCostUsd: "",
    modelTier: "",
    promptVersion: "",
    objective: "",
  };
}

export function createReadonlyAnalysisSession(
  createKey: () => string = () => crypto.randomUUID(),
): ReadonlyAnalysisSession {
  let active = false;
  let invocationKey: string | null = null;
  let runIdempotencyKey: string | null = null;
  return {
    tryBegin() {
      if (active) return false;
      active = true;
      return true;
    },
    finish() {
      active = false;
    },
    invocationKey() {
      if (!invocationKey) invocationKey = requireSessionKey(createKey());
      return invocationKey;
    },
    runIdempotencyKey() {
      if (!runIdempotencyKey) {
        const key = `readonly-run:${requireSessionKey(createKey())}`;
        if (key.length > 300) throw new Error("invocation key is not a browser session key");
        runIdempotencyKey = key;
      }
      return runIdempotencyKey;
    },
  };
}

export function parseReadonlyAnalysisDraft(
  draft: ReadonlyAnalysisDraft,
): { ok: true; value: ReadonlyAnalysisStartInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const caseId = requiredText(draft.caseId, "case_id", 36, errors);
  if (caseId !== null && !UUID_PATTERN.test(caseId)) errors.push("case_id must be a uuid");
  const policyName = requiredText(draft.policyName, "policy_name", 300, errors);
  const allowedModelTiers = parseTiers(draft.allowedModelTiers, errors);
  const perRunTokenBudget = parseInteger(
    draft.perRunTokenBudget,
    "per_run_token_budget",
    1,
    10_000_000,
    errors,
  );
  const perRunCostUsd = parseCost(draft.perRunCostUsd, "per_run_cost_usd", errors);
  const perRunLatencyMs = parseInteger(
    draft.perRunLatencyMs,
    "per_run_latency_ms",
    1000,
    3_600_000,
    errors,
  );
  const perRunToolEventBudget = parseInteger(
    draft.perRunToolEventBudget,
    "per_run_tool_event_budget",
    1,
    10_000,
    errors,
  );
  const dailyTokenBudget = parseInteger(
    draft.dailyTokenBudget,
    "daily_token_budget",
    1,
    100_000_000,
    errors,
  );
  const monthlyTokenBudget = parseInteger(
    draft.monthlyTokenBudget,
    "monthly_token_budget",
    1,
    1_000_000_000,
    errors,
  );
  const dailyCostUsd = parseCost(draft.dailyCostUsd, "daily_cost_usd", errors);
  const monthlyCostUsd = parseCost(draft.monthlyCostUsd, "monthly_cost_usd", errors);
  const promptVersion = requiredText(draft.promptVersion, "prompt_version", 200, errors);
  const objective = requiredText(draft.objective, "objective", 20_000, errors);
  const modelTier = parseModelTier(draft.modelTier, allowedModelTiers, errors);
  if (
    errors.length > 0 ||
    caseId === null ||
    policyName === null ||
    allowedModelTiers === null ||
    perRunTokenBudget === null ||
    perRunCostUsd === null ||
    perRunLatencyMs === null ||
    perRunToolEventBudget === null ||
    dailyTokenBudget === null ||
    monthlyTokenBudget === null ||
    dailyCostUsd === null ||
    monthlyCostUsd === null ||
    promptVersion === null ||
    objective === null ||
    modelTier === null
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      caseId: caseId.toLowerCase(),
      policyName,
      allowedModelTiers,
      perRunTokenBudget,
      perRunCostUsd,
      perRunLatencyMs,
      perRunToolEventBudget,
      dailyTokenBudget,
      monthlyTokenBudget,
      dailyCostUsd,
      monthlyCostUsd,
      modelTier,
      promptVersion,
      objective,
    },
  };
}

export function validateReadonlyAnalysisStart(input: ReadonlyAnalysisStartInput): string[] {
  const parsed = parseReadonlyAnalysisDraft({
    caseId: textField(input.caseId),
    policyName: textField(input.policyName),
    allowedModelTiers: Array.isArray(input.allowedModelTiers) ? input.allowedModelTiers : [],
    perRunTokenBudget: textField(input.perRunTokenBudget),
    perRunCostUsd: textField(input.perRunCostUsd),
    perRunLatencyMs: textField(input.perRunLatencyMs),
    perRunToolEventBudget: textField(input.perRunToolEventBudget),
    dailyTokenBudget: textField(input.dailyTokenBudget),
    monthlyTokenBudget: textField(input.monthlyTokenBudget),
    dailyCostUsd: textField(input.dailyCostUsd),
    monthlyCostUsd: textField(input.monthlyCostUsd),
    modelTier: textField(input.modelTier),
    promptVersion: textField(input.promptVersion),
    objective: textField(input.objective),
  });
  return parsed.ok ? [] : parsed.errors;
}

export function describeReadonlyAnalysisResult(result: ReadonlyAnalysisStartResult): string {
  if (!result.ok) {
    if (result.reason === "invalid_input")
      return (result.errors ?? ["Owner input is incomplete."]).join(" ");
    if (result.reason === "provider_surface_blocked") {
      return "Provider invocation is disabled. No policy, run, or Edge call was made.";
    }
    if (result.reason === "start_already_in_progress") {
      return "A readonly analysis start is already in progress.";
    }
    if (result.reason === "invocation_failed") {
      return "The Edge invocation failed. The persisted run was not advanced further.";
    }
    if (result.reason === "run_did_not_advance") {
      return "The persisted run did not advance. No further call was made.";
    }
    if (result.reason === "drive_bound_exhausted") {
      return "The readonly analysis driver reached its lifecycle bound before a persisted stop.";
    }
    return result.detail ?? "The readonly analysis request failed.";
  }
  if (result.stop === "held") {
    return `Persisted run ${result.runId} has an unresolved provider hold. Recorded usage is not claimed.`;
  }
  const failure = result.failureCode ? ` Failure ${result.failureCode}.` : "";
  return `Persisted run ${result.runId} stopped at ${result.status}.${failure}`;
}

export async function startReadonlyAnalysis(
  input: ReadonlyAnalysisStartInput,
  ports: ReadonlyAnalysisPorts,
  session: ReadonlyAnalysisSession,
): Promise<ReadonlyAnalysisStartResult> {
  if (!ports.surfaceEnabled) return { ok: false, reason: "provider_surface_blocked" };
  const parsed = parseReadonlyAnalysisDraft({
    caseId: textField(input.caseId),
    policyName: textField(input.policyName),
    allowedModelTiers: Array.isArray(input.allowedModelTiers) ? input.allowedModelTiers : [],
    perRunTokenBudget: textField(input.perRunTokenBudget),
    perRunCostUsd: textField(input.perRunCostUsd),
    perRunLatencyMs: textField(input.perRunLatencyMs),
    perRunToolEventBudget: textField(input.perRunToolEventBudget),
    dailyTokenBudget: textField(input.dailyTokenBudget),
    monthlyTokenBudget: textField(input.monthlyTokenBudget),
    dailyCostUsd: textField(input.dailyCostUsd),
    monthlyCostUsd: textField(input.monthlyCostUsd),
    modelTier: textField(input.modelTier),
    promptVersion: textField(input.promptVersion),
    objective: textField(input.objective),
  });
  if (!parsed.ok) return { ok: false, reason: "invalid_input", errors: parsed.errors };
  const ownerInput = parsed.value;
  if (!session.tryBegin()) return { ok: false, reason: "start_already_in_progress" };
  try {
    let invocationKey: string;
    let runKey: string;
    try {
      invocationKey = session.invocationKey();
      runKey = session.runIdempotencyKey();
    } catch (error) {
      return { ok: false, reason: "invalid_input", errors: [publicDetail(error)] };
    }
    const policyPayload = policyPayloadFrom(ownerInput);
    let policyId: string;
    try {
      policyId = (await ports.ensurePolicy(ownerInput.caseId, policyPayload)).policyId;
    } catch (error) {
      return {
        ok: false,
        reason: failureReason(error, "policy_failed"),
        detail: publicDetail(error),
      };
    }
    if (!UUID_PATTERN.test(policyId)) {
      return {
        ok: false,
        reason: "policy_failed",
        detail: "The policy RPC did not return a persisted id.",
      };
    }
    let runId: string;
    try {
      runId = (
        await ports.createRun(ownerInput.caseId, runKey, {
          model_tier: ownerInput.modelTier,
          prompt_version: ownerInput.promptVersion,
          objective: ownerInput.objective,
          tool_policy_id: policyId,
        })
      ).runId;
    } catch (error) {
      return { ok: false, reason: failureReason(error, "run_failed"), detail: publicDetail(error) };
    }
    if (!UUID_PATTERN.test(runId)) {
      return {
        ok: false,
        reason: "run_failed",
        detail: "The run RPC did not return a persisted id.",
      };
    }
    try {
      await ports.refreshRuns();
    } catch (error) {
      return { ok: false, reason: "run_unreadable", runId, detail: publicDetail(error) };
    }
    let observation = await ports.readRun(runId);
    if (!observation) return { ok: false, reason: "run_unreadable", runId };
    const initialStop = classifyStop(observation, null);
    if (initialStop) return stopped(runId, observation, initialStop, invocationKey, 0);

    let advances = 0;
    while (advances < READONLY_ANALYSIS_DRIVE_BOUND) {
      const before = observation;
      const body = exactInvocation(runId, invocationKey);
      let invoked: { ok: boolean; state: string | null; status: string | null };
      try {
        invoked = await ports.invoke(body);
      } catch (error) {
        await safeRefresh(ports);
        return {
          ok: false,
          reason: "invocation_failed",
          runId,
          status: before.status,
          detail: publicDetail(error),
        };
      }
      advances += 1;
      await safeRefresh(ports);
      if (!invoked.ok) {
        return {
          ok: false,
          reason: "invocation_failed",
          runId,
          status: before.status,
          detail: "The Edge invocation failed. The persisted run was not advanced further.",
        };
      }
      observation = (await ports.readRun(runId)) ?? null;
      if (!observation) return { ok: false, reason: "run_unreadable", runId };
      const stop = classifyStop(observation, invoked.state);
      if (stop) return stopped(runId, observation, stop, invocationKey, advances);
      if (observation.status === before.status) {
        return { ok: false, reason: "run_did_not_advance", runId, status: observation.status };
      }
    }
    return { ok: false, reason: "drive_bound_exhausted", runId, status: observation.status };
  } finally {
    session.finish();
  }
}

export function productionReadonlyAnalysisPorts(input: {
  ownerId: string | null;
  refreshRuns: () => Promise<void>;
}): ReadonlyAnalysisPorts {
  const surfaceEnabled = providerSurfaceOpen();
  return {
    surfaceEnabled,
    async ensurePolicy(caseId, payload) {
      assertSurfaceOpen();
      const { data, error } = await supabase.rpc("custodian_ensure_readonly_analysis_policy", {
        case_id_value: caseId,
        policy_payload: payload,
      });
      if (error) throw new Error(publicDetail(error.message));
      const policyId = nestedId(data, "policy");
      if (!policyId) throw new Error("The policy RPC did not return a persisted id.");
      return { policyId };
    },
    async createRun(caseId, idempotencyKey, payload) {
      assertSurfaceOpen();
      const { data, error } = await supabase.rpc("custodian_create_readonly_analysis_run", {
        case_id_value: caseId,
        idempotency_key: idempotencyKey,
        run_payload: payload,
      });
      if (error) throw new Error(publicDetail(error.message));
      const runId = nestedId(data, "run");
      if (!runId) throw new Error("The run RPC did not return a persisted id.");
      return { runId };
    },
    async invoke(body) {
      if (!surfaceEnabled) return { ok: false, state: "provider_surface_blocked", status: null };
      assertExactInvocation(body);
      try {
        const result = await supabase.functions.invoke("custodian-run", { body });
        if (result.error) return { ok: false, state: null, status: null };
        return { ok: true, ...advanceView(result.data) };
      } catch {
        return { ok: false, state: null, status: null };
      }
    },
    async readRun(runId) {
      if (!surfaceEnabled || !input.ownerId || !UUID_PATTERN.test(input.ownerId)) return null;
      try {
        const read = await fetchCustodianRuns(input.ownerId);
        const run = read.runs.find((item) => item.id === runId);
        if (!run) return null;
        return {
          status: run.status,
          holdStatus: run.providerHold?.status ?? null,
          failureCode: run.failureCode,
        };
      } catch {
        return null;
      }
    },
    refreshRuns: input.refreshRuns,
  };
}

function providerSurfaceOpen(): boolean {
  return (CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER as boolean) === true;
}

function assertSurfaceOpen(): void {
  if (!providerSurfaceOpen()) throw new Error("provider_surface_blocked");
}

function stopped(
  runId: string,
  observation: ReadonlyRunObservation,
  stop: ReadonlyAnalysisStop,
  invocationKey: string,
  advances: number,
): ReadonlyAnalysisStartResult {
  return {
    ok: true,
    runId,
    status: observation.status,
    stop,
    invocationKey,
    advances,
    failureCode: observation.failureCode,
  };
}

function classifyStop(
  observation: ReadonlyRunObservation,
  advanceState: string | null,
): ReadonlyAnalysisStop | null {
  if (observation.holdStatus === "held" || advanceState === "held") return "held";
  if (observation.status === "awaiting_approval" || advanceState === "paused") {
    return "awaiting_approval";
  }
  if (isStopStatus(observation.status)) return observation.status;
  if (advanceState === "blocked") return "blocked";
  if (advanceState === "failed") return "failed";
  return null;
}

function isStopStatus(status: string): status is (typeof READONLY_ANALYSIS_STOP_STATES)[number] {
  return (READONLY_ANALYSIS_STOP_STATES as readonly string[]).includes(status);
}

function policyPayloadFrom(input: ReadonlyAnalysisStartInput): ReadonlyAnalysisPolicyPayload {
  return {
    policy_name: input.policyName,
    allowed_model_tiers: [...input.allowedModelTiers],
    per_run_token_budget: input.perRunTokenBudget,
    per_run_cost_usd: input.perRunCostUsd,
    per_run_latency_ms: input.perRunLatencyMs,
    per_run_tool_event_budget: input.perRunToolEventBudget,
    daily_token_budget: input.dailyTokenBudget,
    monthly_token_budget: input.monthlyTokenBudget,
    daily_cost_usd: input.dailyCostUsd,
    monthly_cost_usd: input.monthlyCostUsd,
  };
}

function exactInvocation(
  runId: string,
  invocationKey: string,
): { runId: string; invocationKey: string } {
  const body = { runId, invocationKey };
  assertExactInvocation(body);
  return body;
}

function assertExactInvocation(body: { runId: string; invocationKey: string }): void {
  const keys = Object.keys(body);
  if (keys.length !== 2 || keys[0] !== "runId" || keys[1] !== "invocationKey") {
    throw new Error("Invocation body must be exactly runId and invocationKey.");
  }
  if (body.invocationKey.startsWith(SERVER_ATTEMPT_PREFIX)) {
    throw new Error("browser must not invent the provider attempt key");
  }
}

function requireSessionKey(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 300 ||
    value.startsWith(SERVER_ATTEMPT_PREFIX) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error("invocation key is not a browser session key");
  }
  return value;
}

async function safeRefresh(ports: ReadonlyAnalysisPorts): Promise<void> {
  try {
    await ports.refreshRuns();
  } catch {
    // The persisted read remains the authority when refresh fails.
  }
}

function failureReason(
  error: unknown,
  fallback: "policy_failed" | "run_failed",
): "policy_failed" | "run_failed" | "provider_surface_blocked" {
  return error instanceof Error && error.message === "provider_surface_blocked"
    ? "provider_surface_blocked"
    : fallback;
}

function publicDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : "The readonly analysis request failed.";
  if (/bearer|\bsk-|api[_-]?key|service_role|authorization/i.test(message)) {
    return "The readonly analysis request failed.";
  }
  return message.slice(0, 300);
}

function nestedId(data: unknown, key: "policy" | "run"): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const nested = (data as Record<string, unknown>)[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null;
  const id = (nested as Record<string, unknown>).id;
  return typeof id === "string" && UUID_PATTERN.test(id) ? id.toLowerCase() : null;
}

function advanceView(data: unknown): { state: string | null; status: string | null } {
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { state: null, status: null };
  const record = data as Record<string, unknown>;
  const state = typeof record.state === "string" ? record.state : null;
  const run = record.run;
  const status =
    run &&
    typeof run === "object" &&
    !Array.isArray(run) &&
    typeof (run as Record<string, unknown>).status === "string"
      ? ((run as Record<string, unknown>).status as string)
      : null;
  return { state, status };
}

function textField(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value : "";
}

function requiredText(
  value: string,
  field: string,
  maxLength: number,
  errors: string[],
): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} is required`);
    return null;
  }
  if (value.length > maxLength) {
    errors.push(`${field} exceeds its maximum length`);
    return null;
  }
  return value;
}

function parseTiers(values: readonly string[], errors: string[]): ModelTier[] | null {
  if (!Array.isArray(values) || values.length < 1 || values.length > 4) {
    errors.push("allowed_model_tiers must name one to four tiers");
    return null;
  }
  if (new Set(values).size !== values.length) {
    errors.push("allowed_model_tiers must be distinct");
    return null;
  }
  if (values.some((value) => !MODEL_TIERS.includes(value as ModelTier))) {
    errors.push("allowed_model_tiers must stay inside the source model list");
    return null;
  }
  const selected = new Set(values);
  return MODEL_TIERS.filter((tier) => selected.has(tier));
}

function parseModelTier(
  value: string,
  allowed: readonly ModelTier[] | null,
  errors: string[],
): ModelTier | null {
  if (!MODEL_TIERS.includes(value as ModelTier)) {
    errors.push("model_tier is required");
    return null;
  }
  if (allowed && !allowed.includes(value as ModelTier)) {
    errors.push("model_tier is not permitted by the selected owner policy");
    return null;
  }
  return value as ModelTier;
}

function parseInteger(
  raw: string,
  field: string,
  minimum: number,
  maximum: number,
  errors: string[],
): number | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!/^(?:0|[1-9]\d*)$/.test(text)) {
    errors.push(`${field} must be an integer in range`);
    return null;
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    errors.push(`${field} must be an integer in range`);
    return null;
  }
  return value;
}

function parseCost(raw: string, field: string, errors: string[]): number | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    errors.push(`${field} must be a positive cost`);
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 100_000_000) {
    errors.push(`${field} must be a positive cost`);
    return null;
  }
  return value;
}
