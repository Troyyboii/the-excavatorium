import {
  CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER,
  fetchCustodianRuns,
  type CustodianRun,
  type CustodianRunRead,
} from "./custodian-runtime";
import { isRuntimeRunState, MODEL_ALLOWLIST, type ModelTier } from "./custodian-runtime-types";
import { supabase } from "./supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_TIERS = Object.keys(MODEL_ALLOWLIST) as ModelTier[];
const SERVER_ATTEMPT_PREFIX = "provider-attempt:";
const KNOWN_HOLD_STATUSES = new Set(["held", "settled_known", "released_uncontacted"]);
/** Terminals the server can persist before `reserveProviderCall`. */
const PRE_PROVIDER_TERMINAL_STATES = new Set(["blocked", "budget_stopped", "cancelled"]);
const RESPONDED_STATES = new Set([
  "advanced",
  "held",
  "paused",
  "terminal",
  "blocked",
  "failed",
  "replay",
  "stopped",
  "completed",
  "unavailable",
]);

/**
 * Readonly driver allowlist. `verifying` stays because the Edge function's
 * verification step completes the read-only path (`verifying` → `completed`)
 * and does not enter `executing`. `executing` is the approved write path and
 * is never driven.
 */
export const READONLY_ANALYSIS_ADVANCE_STATES = [
  "queued",
  "retrieving",
  "synthesizing",
  "verifying",
] as const;

const INDETERMINATE_DETAIL =
  "UNKNOWN/INDETERMINATE. The persisted run does not establish the invocation outcome. Provider contact and recorded usage are not claimed. No further call was made.";

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

export type ReadonlyAnalysisStop =
  | (typeof READONLY_ANALYSIS_STOP_STATES)[number]
  | "held"
  | "durable";

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
  usageKnowledge?: "known" | "unknown" | "none" | null;
  /**
   * `available` means the reservation read succeeded, so a null hold is a
   * confirmed absence. `unavailable` or omitted means the absence is not confirmed.
   */
  holdProjection?: CustodianRunRead["providerHoldProjection"];
};

export type PersistedReadonlyRun = {
  id: string;
  caseId: string;
  status: string;
  holdStatus: ReadonlyRunObservation["holdStatus"];
  failureCode: string | null;
  usageKnowledge?: ReadonlyRunObservation["usageKnowledge"];
  holdProjection?: ReadonlyRunObservation["holdProjection"];
};

export type ReadonlyInvocationResult = {
  ok: boolean;
  state: string | null;
  status: string | null;
  /** `ambiguous` means the server may already have run. `rejected` means the call was not sent. */
  disposition?: "responded" | "ambiguous" | "rejected";
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
  invoke: (body: { runId: string; invocationKey: string }) => Promise<ReadonlyInvocationResult>;
  readRun: (runId: string) => Promise<ReadonlyRunObservation | null>;
  refreshRuns: () => Promise<void>;
  /** Already-loaded Run Room rows. Used to refuse a second run while one is uncertain. */
  persistedRuns?: () => readonly PersistedReadonlyRun[];
};

export type ReadonlyAnalysisSession = {
  tryBegin: () => boolean;
  finish: (durableStop: boolean) => void;
  bindRun: (runId: string) => void;
  resumeRunId: () => string | null;
  invocationKey: () => string;
  invocationKeyIfSet: () => string | null;
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
      usageUnclaimed?: boolean;
      /**
       * True when the persisted hold proves known usage or no recorded contact,
       * or when a pre-provider terminal has a confirmed absent reservation.
       */
      holdResolved?: boolean;
    }
  | {
      ok: false;
      reason:
        | "provider_surface_blocked"
        | "invalid_input"
        | "start_already_in_progress"
        | "policy_failed"
        | "run_failed"
        | "outcome_indeterminate"
        | "authority_boundary"
        | "unresolved_run"
        | "run_unreadable"
        | "run_did_not_advance"
        | "drive_bound_exhausted";
      errors?: string[];
      runId?: string;
      status?: string | null;
      detail?: string;
    };

export function emptyReadonlyAnalysisDraft(
  overrides: Partial<ReadonlyAnalysisDraft> = {},
): ReadonlyAnalysisDraft {
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
    ...overrides,
  };
}

export function createReadonlyAnalysisSession(
  createKey: () => string = () => crypto.randomUUID(),
): ReadonlyAnalysisSession {
  let phase: "idle" | "active" | "unresolved" | "stopped" = "idle";
  let invocationKey: string | null = null;
  let runIdempotencyKey: string | null = null;
  let boundRunId: string | null = null;
  let pendingResumeId: string | null = null;
  return {
    tryBegin() {
      if (phase === "active") return false;
      if (phase === "stopped") {
        invocationKey = null;
        runIdempotencyKey = null;
        boundRunId = null;
        pendingResumeId = null;
      } else if (phase === "unresolved") {
        pendingResumeId = boundRunId;
      } else {
        pendingResumeId = null;
      }
      phase = "active";
      return true;
    },
    finish(durableStop: boolean) {
      phase = durableStop ? "stopped" : "unresolved";
    },
    bindRun(runId: string) {
      if (UUID_PATTERN.test(runId)) boundRunId = runId.toLowerCase();
    },
    resumeRunId() {
      return pendingResumeId;
    },
    invocationKey() {
      if (!invocationKey) invocationKey = requireSessionKey(createKey());
      return invocationKey;
    },
    invocationKeyIfSet() {
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
    if (result.reason === "outcome_indeterminate" || result.reason === "run_unreadable") {
      return result.detail ?? INDETERMINATE_DETAIL;
    }
    if (result.reason === "authority_boundary") {
      return result.detail ?? authorityDetail(false);
    }
    if (result.reason === "unresolved_run") {
      return (
        result.detail ??
        `Persisted run ${result.runId ?? ""} is ${result.status ?? "unresolved"}. A new analysis was not started. Provider contact and recorded usage are not claimed from this attempt.`
      );
    }
    if (result.reason === "run_did_not_advance") {
      return `The persisted run is still at ${result.status ?? "its previous state"}. This start will not invoke the Edge function again.`;
    }
    if (result.reason === "drive_bound_exhausted") {
      return "The readonly analysis driver reached its lifecycle bound before a persisted stop.";
    }
    return result.detail ?? "The readonly analysis request failed.";
  }
  if (result.stop === "held") {
    return `Persisted run ${result.runId} has an unresolved provider hold. Recorded usage is not claimed. Provider contact may already have happened.`;
  }
  if (result.stop === "durable") {
    return `Persisted run ${result.runId} is at ${result.status}. The driver stopped on that durable state. No further call was made.`;
  }
  if (result.holdResolved !== true) {
    return `UNKNOWN/INDETERMINATE. Persisted run ${result.runId} is at ${result.status}. Recorded usage is unclaimed. The invocation outcome is not established.`;
  }
  const failure = result.failureCode ? ` Failure ${result.failureCode}.` : "";
  const usage = result.usageUnclaimed ? " Recorded usage is not claimed." : "";
  return `Persisted run ${result.runId} stopped at ${result.status}.${failure}${usage}`;
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
  let durableStop = false;
  try {
    const result = await performReadonlyAnalysis(ownerInput, ports, session);
    durableStop = isDurableStop(result);
    if (result.runId) session.bindRun(result.runId);
    return result;
  } finally {
    session.finish(durableStop);
  }
}

async function performReadonlyAnalysis(
  ownerInput: ReadonlyAnalysisStartInput,
  ports: ReadonlyAnalysisPorts,
  session: ReadonlyAnalysisSession,
): Promise<ReadonlyAnalysisStartResult> {
  const resumeId = session.resumeRunId();
  if (resumeId) {
    await safeRefresh(ports);
    return reportPersisted(resumeId, await readObservation(ports, resumeId), session, 0);
  }

  const blocking = blockingPersistedRun(ports, ownerInput.caseId);
  if (blocking === "unreadable") {
    return { ok: false, reason: "outcome_indeterminate", detail: INDETERMINATE_DETAIL };
  }
  if (blocking) {
    if (blocking.status === "executing") return authorityResult(blocking.id);
    if (!isRuntimeRunState(blocking.status)) {
      return indeterminateResult(blocking.id, blocking.status);
    }
    return {
      ok: false,
      reason: "unresolved_run",
      runId: blocking.id,
      status: blocking.status,
      detail: `Persisted run ${blocking.id} is ${blocking.status}. A new analysis was not started. Provider contact and recorded usage are not claimed from this attempt.`,
    };
  }

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
    return { ok: false, reason: "outcome_indeterminate", runId, detail: INDETERMINATE_DETAIL };
  }
  let observation = await readObservation(ports, runId);
  if (!observation) return indeterminateResult(runId, null);
  const initial = stopBeforeInvoke(observation);
  if (initial) return initialResult(runId, observation, initial, invocationKey, 0);

  let advances = 0;
  while (advances < READONLY_ANALYSIS_DRIVE_BOUND) {
    if (!isDriveState(observation.status)) {
      const blocked = stopBeforeInvoke(observation);
      if (blocked) return initialResult(runId, observation, blocked, invocationKey, advances);
      return indeterminateResult(runId, observation.status);
    }
    const before = observation;
    let invoked: ReadonlyInvocationResult;
    try {
      invoked = await ports.invoke(exactInvocation(runId, invocationKey));
    } catch {
      invoked = { ok: false, state: null, status: null, disposition: "ambiguous" };
    }
    advances += 1;
    if (isAmbiguousInvocation(invoked)) {
      await safeRefresh(ports);
      return reconcileAmbiguous(
        runId,
        before,
        await readObservation(ports, runId),
        invocationKey,
        advances,
      );
    }
    if (invoked.disposition === "rejected" || invoked.state === "provider_surface_blocked") {
      return { ok: false, reason: "provider_surface_blocked", runId, status: before.status };
    }
    await safeRefresh(ports);
    observation = await readObservation(ports, runId);
    if (!observation) return indeterminateResult(runId, null);
    if (observation.status === "executing") return authorityResult(runId, true);
    const stop = classifyStop(observation, invoked.state);
    if (stop) return initialResult(runId, observation, stop, invocationKey, advances);
    if (isStopStatus(observation.status) && !holdIsResolved(observation)) {
      return unsettledStopResult(runId, observation);
    }
    if (!isDriveState(observation.status)) {
      return indeterminateResult(runId, observation.status);
    }
    if (observation.status === before.status) {
      return { ok: false, reason: "run_did_not_advance", runId, status: observation.status };
    }
  }
  return { ok: false, reason: "drive_bound_exhausted", runId, status: observation.status };
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
      if (!surfaceEnabled) {
        return {
          ok: false,
          state: "provider_surface_blocked",
          status: null,
          disposition: "rejected",
        };
      }
      if (!input.ownerId || !UUID_PATTERN.test(input.ownerId)) {
        return { ok: false, state: "owner_missing", status: null, disposition: "rejected" };
      }
      assertExactInvocation(body);
      try {
        const result = await supabase.functions.invoke("custodian-run", { body });
        if (result.error) return { ok: false, state: null, status: null, disposition: "ambiguous" };
        const view = advanceView(result.data);
        if (!view.state) return { ok: false, state: null, status: null, disposition: "ambiguous" };
        return { ok: true, ...view, disposition: "responded" };
      } catch {
        return { ok: false, state: null, status: null, disposition: "ambiguous" };
      }
    },
    async readRun(runId) {
      if (!surfaceEnabled || !input.ownerId || !UUID_PATTERN.test(input.ownerId)) return null;
      try {
        const read = await fetchCustodianRuns(input.ownerId);
        const run = read.runs.find((item) => item.id === runId);
        if (!run) return null;
        return observationForCustodianRun(run, read.providerHoldProjection);
      } catch {
        return null;
      }
    },
    refreshRuns: input.refreshRuns,
  };
}

export function observationForCustodianRun(
  run: Pick<CustodianRun, "status" | "failureCode" | "providerHold">,
  holdProjection: CustodianRunRead["providerHoldProjection"],
): ReadonlyRunObservation {
  return {
    status: run.status,
    holdStatus: run.providerHold?.status ?? null,
    failureCode: run.failureCode,
    usageKnowledge: run.providerHold?.usageKnowledge ?? null,
    holdProjection,
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
    usageUnclaimed: usageUnclaimed(observation),
    holdResolved: holdIsResolved(observation),
  };
}

function isDurableStop(result: ReadonlyAnalysisStartResult): boolean {
  return (
    result.ok &&
    result.stop !== "held" &&
    result.stop !== "durable" &&
    result.holdResolved === true &&
    isStopStatus(result.status) &&
    !result.usageUnclaimed
  );
}

function isDriveState(status: string): status is (typeof READONLY_ANALYSIS_ADVANCE_STATES)[number] {
  return (READONLY_ANALYSIS_ADVANCE_STATES as readonly string[]).includes(status);
}

function usageUnclaimed(observation: ReadonlyRunObservation): boolean {
  return observation.holdStatus === "held" || observation.usageKnowledge === "unknown";
}

function holdIsUnresolved(observation: ReadonlyRunObservation): boolean {
  if (usageUnclaimed(observation)) return true;
  return Boolean(observation.holdStatus && !KNOWN_HOLD_STATUSES.has(observation.holdStatus));
}

function reservationConfirmedAbsent(observation: {
  holdStatus: ReadonlyRunObservation["holdStatus"];
  usageKnowledge?: ReadonlyRunObservation["usageKnowledge"];
  holdProjection?: ReadonlyRunObservation["holdProjection"];
}): boolean {
  return (
    observation.holdProjection === "available" &&
    observation.holdStatus === null &&
    (observation.usageKnowledge === null || observation.usageKnowledge === undefined)
  );
}

function holdIsResolved(observation: {
  status?: string;
  holdStatus: ReadonlyRunObservation["holdStatus"];
  usageKnowledge?: ReadonlyRunObservation["usageKnowledge"];
  holdProjection?: ReadonlyRunObservation["holdProjection"];
}): boolean {
  if (observation.holdStatus === "settled_known" && observation.usageKnowledge === "known") {
    return true;
  }
  if (observation.holdStatus === "released_uncontacted" && observation.usageKnowledge === "none") {
    return true;
  }
  return (
    observation.status !== undefined &&
    PRE_PROVIDER_TERMINAL_STATES.has(observation.status) &&
    reservationConfirmedAbsent(observation)
  );
}

function authorityDetail(alreadyInvoked: boolean): string {
  const next = alreadyInvoked
    ? "will not invoke the Edge function again"
    : "does not invoke the Edge function";
  return `Persisted run is executing. Readonly analysis stops at the authority boundary and ${next}.`;
}

function authorityResult(runId: string, alreadyInvoked = false): ReadonlyAnalysisStartResult {
  return {
    ok: false,
    reason: "authority_boundary",
    runId,
    status: "executing",
    detail: authorityDetail(alreadyInvoked),
  };
}

function unsettledStopResult(
  runId: string,
  observation: ReadonlyRunObservation,
): ReadonlyAnalysisStartResult {
  return {
    ok: false,
    reason: "outcome_indeterminate",
    runId,
    status: observation.status,
    detail: `UNKNOWN/INDETERMINATE. Persisted run ${runId} is at ${observation.status}. Recorded usage is unclaimed. The invocation outcome is not established.`,
  };
}

function indeterminateResult(
  runId: string | undefined,
  status: string | null,
): ReadonlyAnalysisStartResult {
  return {
    ok: false,
    reason: "outcome_indeterminate",
    runId,
    status,
    detail: INDETERMINATE_DETAIL,
  };
}

function knownInvocationKey(session: ReadonlyAnalysisSession): string {
  return session.invocationKeyIfSet() ?? "";
}

async function readObservation(
  ports: ReadonlyAnalysisPorts,
  runId: string,
): Promise<ReadonlyRunObservation | null> {
  try {
    return await ports.readRun(runId);
  } catch {
    return null;
  }
}

function blockingPersistedRun(
  ports: ReadonlyAnalysisPorts,
  caseId: string,
): PersistedReadonlyRun | "unreadable" | null {
  if (!ports.persistedRuns) return null;
  let runs: readonly PersistedReadonlyRun[];
  try {
    runs = ports.persistedRuns();
  } catch {
    return "unreadable";
  }
  for (const run of runs) {
    if (run.caseId.toLowerCase() !== caseId) continue;
    if (!isCertainPersistedStop(run)) return run;
  }
  return null;
}

function isCertainPersistedStop(run: PersistedReadonlyRun): boolean {
  if (!isRuntimeRunState(run.status) || !isStopStatus(run.status)) return false;
  return holdIsResolved(run);
}

function stopBeforeInvoke(
  observation: ReadonlyRunObservation,
): "authority" | "indeterminate" | ReadonlyAnalysisStop | null {
  if (observation.status === "executing") return "authority";
  if (!isRuntimeRunState(observation.status)) return "indeterminate";
  const stop = classifyStop(observation, null);
  if (stop) return stop;
  if (isStopStatus(observation.status)) return "indeterminate";
  return null;
}

function initialResult(
  runId: string,
  observation: ReadonlyRunObservation,
  stop: "authority" | "indeterminate" | ReadonlyAnalysisStop,
  invocationKey: string,
  advances: number,
): ReadonlyAnalysisStartResult {
  if (stop === "authority") return authorityResult(runId);
  if (stop === "indeterminate") {
    if (isStopStatus(observation.status) && !holdIsResolved(observation)) {
      return unsettledStopResult(runId, observation);
    }
    return indeterminateResult(runId, observation.status);
  }
  return stopped(runId, observation, stop, invocationKey, advances);
}

function reportPersisted(
  runId: string,
  observation: ReadonlyRunObservation | null,
  session: ReadonlyAnalysisSession,
  advances: number,
): ReadonlyAnalysisStartResult {
  if (!observation || !isRuntimeRunState(observation.status)) {
    return indeterminateResult(runId, observation?.status ?? null);
  }
  if (observation.status === "executing") return authorityResult(runId);
  if (holdIsUnresolved(observation)) {
    return stopped(runId, observation, "held", knownInvocationKey(session), advances);
  }
  if (isStopStatus(observation.status)) {
    if (!holdIsResolved(observation)) return unsettledStopResult(runId, observation);
    const stop =
      observation.status === "awaiting_approval" ? "awaiting_approval" : observation.status;
    return stopped(runId, observation, stop, knownInvocationKey(session), advances);
  }
  if (isDriveState(observation.status)) {
    return {
      ok: false,
      reason: "outcome_indeterminate",
      runId,
      status: observation.status,
      detail: `UNKNOWN/INDETERMINATE. Persisted run ${runId} is at ${observation.status}. Provider contact and recorded usage are not claimed. No further call was made.`,
    };
  }
  return indeterminateResult(runId, observation.status);
}

function reconcileAmbiguous(
  runId: string,
  before: ReadonlyRunObservation,
  after: ReadonlyRunObservation | null,
  invocationKey: string,
  advances: number,
): ReadonlyAnalysisStartResult {
  if (!after || !isRuntimeRunState(after.status)) {
    return indeterminateResult(runId, after?.status ?? null);
  }
  if (after.status === "executing") return authorityResult(runId, true);
  if (holdIsUnresolved(after)) {
    return stopped(runId, after, "held", invocationKey, advances);
  }
  if (isStopStatus(after.status)) {
    if (!holdIsResolved(after)) return unsettledStopResult(runId, after);
    const stop = after.status === "awaiting_approval" ? "awaiting_approval" : after.status;
    return stopped(runId, after, stop, invocationKey, advances);
  }
  if (after.status !== before.status && isDriveState(after.status)) {
    return stopped(runId, after, "durable", invocationKey, advances);
  }
  return indeterminateResult(runId, after.status);
}

function isAmbiguousInvocation(result: ReadonlyInvocationResult): boolean {
  if (result.disposition === "rejected") return false;
  if (result.disposition === "ambiguous") return true;
  if (!result.ok) return true;
  if (!result.state || !RESPONDED_STATES.has(result.state)) return true;
  return false;
}

function classifyStop(
  observation: ReadonlyRunObservation,
  advanceState: string | null,
): ReadonlyAnalysisStop | null {
  if (holdIsUnresolved(observation) || advanceState === "held") return "held";
  if (!isStopStatus(observation.status) || !holdIsResolved(observation)) return null;
  return observation.status === "awaiting_approval" ? "awaiting_approval" : observation.status;
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
