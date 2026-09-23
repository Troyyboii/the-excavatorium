import {
  boundedOutputBudget,
  calculateUsageCost,
  classifyModelPricing,
  CUSTODIAN_MODEL_PRICING_ENV,
  maximumPotentialUsageCost,
  MODEL_ALLOWLIST,
  resolveSystemPrompt,
  type ModelPricing,
  type ModelTier,
} from "./runtime.ts";
import {
  providerDiagnostic,
  type ProviderClassification,
  type ProviderDiagnostic,
} from "./openai-diagnostics.ts";
import {
  buildSynthesisParams,
  interpretSynthesisResponse,
  sendSynthesisRequest,
  serializedRequestBytes,
  type ProviderExchange,
  type ProviderFetch,
  type SynthesisRequestParams,
} from "./openai-provider.ts";

export { classifyOpenAiHttpFailure } from "./openai-diagnostics.ts";
export { OPENAI_RESPONSES_URL } from "./openai-provider.ts";
export const PROVIDER_ATTEMPT_TIMEOUT_MS = 25_000;

export function boundedProviderTimeoutMs(
  remainingLatencyMs: number,
  requestedMs = PROVIDER_ATTEMPT_TIMEOUT_MS,
): number {
  if (!Number.isFinite(remainingLatencyMs) || remainingLatencyMs <= 0) return 0;
  const requested =
    Number.isFinite(requestedMs) && requestedMs > 0 ? requestedMs : PROVIDER_ATTEMPT_TIMEOUT_MS;
  return Math.min(PROVIDER_ATTEMPT_TIMEOUT_MS, requested, Math.floor(remainingLatencyMs));
}

const RESERVATION_UNESTABLISHED_DETAIL =
  "The provider reservation could not be read. Provider contact and usage could not be established. This invocation made no new provider call.";

export type DisallowedToolEventCounter = {
  from(table: "tool_events"): {
    select(
      columns: "id",
      options: { count: "exact"; head: true },
    ): {
      eq(
        column: "run_id",
        value: string,
      ): {
        neq(
          column: "operation_class",
          value: "read_only",
        ): PromiseLike<{ count: number | null; error: { message: string } | null }>;
        eq(
          column: "operation_class",
          value: KnownDisallowedToolClass,
        ): PromiseLike<{ count: number | null; error: { message: string } | null }>;
      };
    };
  };
};

export async function countDisallowedToolEvents(
  client: DisallowedToolEventCounter,
  runId: string,
): Promise<number | null> {
  const result = await client
    .from("tool_events")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .neq("operation_class", "read_only");
  if (result.error || typeof result.count !== "number" || result.count < 0) return null;
  return result.count;
}

export async function countToolEventsForClass(
  client: DisallowedToolEventCounter,
  runId: string,
  operationClass: KnownDisallowedToolClass,
): Promise<number | null> {
  const result = await client
    .from("tool_events")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("operation_class", operationClass);
  if (result.error || typeof result.count !== "number" || result.count < 0) return null;
  return result.count;
}

export async function countKnownDisallowedToolClasses(
  client: DisallowedToolEventCounter,
  runId: string,
): Promise<ToolClassCounts | null> {
  const counts = await Promise.all(
    KNOWN_DISALLOWED_TOOL_CLASSES.map((operationClass) =>
      countToolEventsForClass(client, runId, operationClass),
    ),
  );
  if (counts.some((count) => count === null)) return null;
  return {
    evidence_write: counts[0] ?? 0,
    canonical_write: counts[1] ?? 0,
    archive_change: counts[2] ?? 0,
    external_write: counts[3] ?? 0,
  };
}
const MAX_HOLD_TOKENS = 10_000_000;

export type UsageKnowledge = "known" | "unknown" | "none";
export type ReservationStatus = "held" | "settled_known" | "released_uncontacted";

export type SynthesisRun = {
  id: string;
  case_id: string;
  status: string;
  input_snapshot: Record<string, unknown>;
  agent_config: Record<string, unknown>;
  tool_policy_id: string;
  objective: string;
  prompt_version: string;
  model_tier: ModelTier;
  tokens_used: number;
  cost_usd: number;
  latency_ms: number;
  tool_events_count: number;
  last_step_number: number;
  cancel_requested_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
};

export type PublicAccounting = {
  usageKnowledge: UsageKnowledge;
  recordedTokens: number | null;
  recordedCostUsd: number | null;
  heldTokens: number | null;
  heldCostUsd: number | null;
  pricingVersion: string | null;
  reservationId: string | null;
  reservationStatus: ReservationStatus | null;
};

export type ReservationView = {
  id: string;
  status: ReservationStatus;
  usageKnowledge: UsageKnowledge;
  holdTokens: number;
  holdCostUsd: number;
  actualTokens: number | null;
  actualCostUsd: number | null;
  pricingVersion: string;
  failureCode: string | null;
  inFlightUntil: string;
  idempotencyKey: string;
};

export type StepArtifact = {
  id: string;
  stepKind: string;
  status: string;
  idempotencyKey: string;
  output: Record<string, unknown> | null;
  tokensUsed: number;
  costUsd: number;
  pricingVersion: string | null;
};

export type VerificationArtifacts = {
  steps: StepArtifact[];
  reservation: ReservationView | null;
  findingCount: number;
  approvalId: string | null;
  proposalId: string | null;
  toolOperationClasses: string[] | null;
  toolClassCounts: ToolClassCounts | null;
  disallowedToolEventCount: number;
};

export type BudgetSnapshot = {
  allowed: boolean;
  reason: string;
  run_tokens_remaining: number;
  run_cost_remaining: number;
  run_latency_remaining: number;
};

export type ApprovalIdentity = {
  id: string;
  status: string;
  approvalKind: string;
  exactActionHash: string;
};

export type CustodianIo = {
  getRun(runId: string): Promise<SynthesisRun>;
  getBudget(runId: string): Promise<BudgetSnapshot>;
  transitionRun(
    run: SynthesisRun,
    invocationKey: string,
    nextStatus: string,
    patch?: Record<string, unknown>,
  ): Promise<SynthesisRun>;
  recordStep(input: {
    run: SynthesisRun;
    stepKind: string;
    idempotencyKey: string;
    modelTier: ModelTier;
    inputPayload: Record<string, unknown>;
    outputPayload: Record<string, unknown>;
    status?: "completed" | "failed" | "blocked";
    usage?: { tokens: number; costUsd: number; latencyMs: number; pricingVersion?: string };
  }): Promise<{ run: SynthesisRun; stepId: string }>;
  resolveAllowedModelTiers(run: SynthesisRun): Promise<readonly ModelTier[]>;
  getReservation(runId: string, idempotencyKey: string): Promise<ReservationView | null>;
  reserveProviderCall(
    runId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
  settleProviderReservation(
    ownerId: string,
    runId: string,
    idempotencyKey: string,
    settlement: Record<string, unknown>,
  ): Promise<{ run: SynthesisRun; reservation: ReservationView }>;
  getStepByIdempotency(runId: string, idempotencyKey: string): Promise<StepArtifact | null>;
  materializeFindings(ownerId: string, stepId: string): Promise<unknown>;
  createApproval(
    run: SynthesisRun,
    output: Record<string, unknown>,
  ): Promise<{ run: SynthesisRun | null; approval: ApprovalIdentity }>;
  readVerificationArtifacts(runId: string): Promise<VerificationArtifacts | null>;
  /** Server-only safe metadata. A failed write never changes accounting. */
  recordProviderDiagnostic(
    ownerId: string,
    runId: string,
    idempotencyKey: string,
    diagnostic: ProviderDiagnostic,
  ): Promise<void>;
  getEnv(name: string): string | undefined;
  /** The only provider transport. The OpenAI SDK sends its one request through it. */
  fetchProvider: ProviderFetch;
  trustedRuntimeAvailable(): boolean;
  now(): number;
};

export type AdvanceResult = {
  status: number;
  body: Record<string, unknown>;
};

const TERMINAL_STATES = new Set([
  "completed",
  "blocked",
  "failed",
  "expired",
  "budget_stopped",
  "cancelled",
]);

export function providerAttemptKey(runId: string): string {
  return `provider-attempt:${runId}:synthesize`;
}

export function retrievalStepKey(runId: string): string {
  return `provider-free-retrieve:${runId}`;
}

export function approvalIdempotencyKey(runId: string): string {
  return `approval:${providerAttemptKey(runId)}`;
}

export function confirmedPendingApprovalRun<T extends { status: string }>(
  run: T | null,
  approvalStatus: string,
): T {
  if (!run || approvalStatus !== "pending" || run.status !== "awaiting_approval") {
    throw new Error("approval_run_unconfirmed");
  }
  return run;
}

export const KNOWN_DISALLOWED_TOOL_CLASSES = [
  "evidence_write",
  "canonical_write",
  "archive_change",
  "external_write",
] as const;

export type KnownDisallowedToolClass = (typeof KNOWN_DISALLOWED_TOOL_CLASSES)[number];
export type ToolClassCounts = Record<KnownDisallowedToolClass, number>;

export function emptyAccounting(run: SynthesisRun): PublicAccounting {
  return {
    usageKnowledge: "none",
    recordedTokens: run.tokens_used,
    recordedCostUsd: run.cost_usd,
    heldTokens: null,
    heldCostUsd: null,
    pricingVersion: null,
    reservationId: null,
    reservationStatus: null,
  };
}

export function accountingFromReservation(
  run: SynthesisRun,
  reservation: ReservationView | null,
): PublicAccounting {
  if (!reservation) return emptyAccounting(run);
  if (reservation.status === "held" || reservation.usageKnowledge === "unknown") {
    return {
      usageKnowledge: "unknown",
      recordedTokens: null,
      recordedCostUsd: null,
      heldTokens: reservation.holdTokens,
      heldCostUsd: reservation.holdCostUsd,
      pricingVersion: reservation.pricingVersion,
      reservationId: reservation.id,
      reservationStatus: "held",
    };
  }
  if (reservation.status === "settled_known") {
    return {
      usageKnowledge: "known",
      recordedTokens: reservation.actualTokens,
      recordedCostUsd: reservation.actualCostUsd,
      heldTokens: null,
      heldCostUsd: null,
      pricingVersion: reservation.pricingVersion,
      reservationId: reservation.id,
      reservationStatus: "settled_known",
    };
  }
  return {
    usageKnowledge: "none",
    recordedTokens: run.tokens_used,
    recordedCostUsd: run.cost_usd,
    heldTokens: null,
    heldCostUsd: null,
    pricingVersion: reservation.pricingVersion,
    reservationId: reservation.id,
    reservationStatus: "released_uncontacted",
  };
}

function costAccounting(accounting: PublicAccounting): "recorded" | "unknown" | "none" {
  if (accounting.usageKnowledge === "unknown") return "unknown";
  if (accounting.usageKnowledge === "known") return "recorded";
  if (accounting.recordedCostUsd !== null && accounting.recordedCostUsd > 0) return "recorded";
  return "none";
}

export function projectPublicRun(
  run: SynthesisRun,
  accounting: PublicAccounting = emptyAccounting(run),
): Record<string, unknown> {
  const knowledge = accounting.usageKnowledge;
  return {
    id: run.id,
    caseId: run.case_id,
    status: run.status,
    lastStepNumber: run.last_step_number,
    usage: {
      tokens: knowledge === "unknown" ? null : accounting.recordedTokens,
      costUsd: knowledge === "unknown" ? null : accounting.recordedCostUsd,
      costAccounting: costAccounting(accounting),
      usageKnowledge: knowledge,
      pricingVersion: accounting.pricingVersion,
      hold:
        accounting.reservationStatus === "held"
          ? {
              tokens: accounting.heldTokens,
              costUsd: accounting.heldCostUsd,
              status: "held",
            }
          : null,
      latencyMs: run.latency_ms,
      toolEvents: run.tool_events_count,
    },
    reservation: accounting.reservationId
      ? {
          id: accounting.reservationId,
          status: accounting.reservationStatus,
          usageKnowledge: knowledge,
          pricingVersion: accounting.pricingVersion,
        }
      : null,
    failure: run.failure_code
      ? {
          code: run.failure_code,
          message: run.failure_message ?? "The Custodian run did not complete.",
        }
      : null,
  };
}

export function providerFreeAdmissionSummary(snapshot: unknown): Record<string, unknown> {
  const record =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)
      : {};
  const count = (value: unknown): number | null => (Array.isArray(value) ? value.length : null);
  return {
    providerContact: false,
    evidenceCreated: false,
    snapshotKind: typeof record.kind === "string" ? record.kind : "unspecified",
    admittedRecordCount: count(record.admitted_records),
    excludedRecordCount: count(record.excluded_records),
    citableEvidenceCount: count(record.citable_evidence_ids),
    truncated: record.truncated === true,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parseReservationView(value: unknown): ReservationView | null {
  if (!isObject(value)) return null;
  const status = value.status;
  const knowledge = value.usage_knowledge;
  const holdTokens = finiteNumber(value.hold_tokens);
  const holdCost = finiteNumber(value.hold_cost_usd);
  if (
    (status !== "held" && status !== "settled_known" && status !== "released_uncontacted") ||
    (knowledge !== "known" && knowledge !== "unknown" && knowledge !== "none") ||
    typeof value.id !== "string" ||
    typeof value.idempotency_key !== "string" ||
    typeof value.pricing_version !== "string" ||
    typeof value.in_flight_until !== "string" ||
    holdTokens === null ||
    holdCost === null
  ) {
    return null;
  }
  const actualTokens = value.actual_tokens === null ? null : finiteNumber(value.actual_tokens);
  const actualCost = value.actual_cost_usd === null ? null : finiteNumber(value.actual_cost_usd);
  if (value.actual_tokens !== null && actualTokens === null) return null;
  if (value.actual_cost_usd !== null && actualCost === null) return null;
  return {
    id: value.id,
    status,
    usageKnowledge: knowledge,
    holdTokens,
    holdCostUsd: holdCost,
    actualTokens,
    actualCostUsd: actualCost,
    pricingVersion: value.pricing_version,
    failureCode: typeof value.failure_code === "string" ? value.failure_code : null,
    inFlightUntil: value.in_flight_until,
    idempotencyKey: value.idempotency_key,
  };
}

function reservationMatchesAttempt(
  reservation: ReservationView | null,
  attemptKey: string,
  pricingVersion: string,
  holdTokens: number,
  holdCostUsd: number,
): boolean {
  return (
    reservation !== null &&
    reservation.status === "held" &&
    reservation.usageKnowledge === "unknown" &&
    reservation.idempotencyKey === attemptKey &&
    reservation.pricingVersion === pricingVersion &&
    reservation.holdTokens === holdTokens &&
    sameAmount(reservation.holdCostUsd, holdCostUsd)
  );
}

function parseReservePayload(value: unknown): {
  reserved: boolean;
  replay: boolean;
  reason: string;
  reservation: ReservationView | null;
} | null {
  if (!isObject(value) || typeof value.reserved !== "boolean" || typeof value.reason !== "string") {
    return null;
  }
  const reservation =
    value.reservation === null || value.reservation === undefined
      ? null
      : parseReservationView(value.reservation);
  if (value.reservation && !reservation) return null;
  return {
    reserved: value.reserved,
    replay: value.replay === true,
    reason: value.reason,
    reservation,
  };
}

function outcome(
  status: number,
  state: string,
  run: SynthesisRun,
  accounting: PublicAccounting,
  extra: Record<string, unknown> = {},
): AdvanceResult {
  return {
    status,
    body: {
      state,
      run: projectPublicRun(run, accounting),
      ...extra,
    },
  };
}

function failurePatch(code: string, message: string): Record<string, unknown> {
  return { failure_code: code, failure_message: message };
}

const SPEND_BUDGET_REASONS = new Set([
  "per_run_tokens",
  "per_run_cost",
  "per_run_latency",
  "per_run_tool_events",
  "daily_tokens",
  "monthly_tokens",
  "daily_cost",
  "monthly_cost",
]);

function budgetDenial(reason: string): {
  next: "cancelled" | "budget_stopped" | "blocked";
  code: string;
  message: string;
} {
  if (reason === "cancel_requested") {
    return {
      next: "cancelled",
      code: "cancelled",
      message: "The owner requested cancellation before provider contact.",
    };
  }
  if (SPEND_BUDGET_REASONS.has(reason)) {
    return {
      next: "budget_stopped",
      code: reason,
      message: "The persisted run budget stopped execution before provider contact.",
    };
  }
  return {
    next: "blocked",
    code: reason || "budget_denied",
    message: "The persisted budget status stopped execution before provider contact.",
  };
}

function reservationUnestablished(run: SynthesisRun, reason: string): AdvanceResult {
  return {
    status: 503,
    body: {
      state: "unavailable",
      reason,
      detail: RESERVATION_UNESTABLISHED_DETAIL,
      run: {
        id: run.id,
        caseId: run.case_id,
        status: run.status,
      },
    },
  };
}

function reservationUnread(run: SynthesisRun): AdvanceResult {
  return reservationUnestablished(run, "provider_reservation_unreadable");
}

async function readAttemptReservation(
  io: CustodianIo,
  run: SynthesisRun,
): Promise<ReservationView | null | AdvanceResult> {
  try {
    return await io.getReservation(run.id, providerAttemptKey(run.id));
  } catch {
    return reservationUnread(run);
  }
}

function isAdvanceResult(value: ReservationView | null | AdvanceResult): value is AdvanceResult {
  return value !== null && "body" in value && "status" in value;
}

async function stopForBudget(
  io: CustodianIo,
  run: SynthesisRun,
  invocationKey: string,
  budget: BudgetSnapshot,
): Promise<AdvanceResult> {
  const denial = budgetDenial(budget.reason);
  const next = await io.transitionRun(
    run,
    invocationKey,
    denial.next,
    failurePatch(denial.code, denial.message),
  );
  return outcome(200, "stopped", next, emptyAccounting(next));
}

async function advanceRetrieval(
  io: CustodianIo,
  run: SynthesisRun,
  invocationKey: string,
): Promise<AdvanceResult> {
  const summary = providerFreeAdmissionSummary(run.input_snapshot);
  const recorded = await io.recordStep({
    run,
    stepKind: "retrieve",
    idempotencyKey: retrievalStepKey(run.id),
    modelTier: run.model_tier,
    inputPayload: { stage: "retrieve", providerContact: false },
    outputPayload: summary,
    status: "completed",
    usage: { tokens: 0, costUsd: 0, latencyMs: 0 },
  });
  if (TERMINAL_STATES.has(recorded.run.status)) {
    return outcome(200, "stopped", recorded.run, emptyAccounting(recorded.run));
  }
  const next = await io.transitionRun(recorded.run, invocationKey, "synthesizing");
  return outcome(200, "advanced", next, emptyAccounting(next));
}

export function evaluateReadonlyVerification(input: {
  run: SynthesisRun;
  artifacts: VerificationArtifacts;
}): { ok: boolean; failureCode: string; checks: Record<string, unknown> } {
  const synthesizeCandidates = input.artifacts.steps.filter(
    (step) => step.stepKind === "synthesize",
  );
  const retrieveSteps = input.artifacts.steps.filter((step) => step.stepKind === "retrieve");
  const retrieve = retrieveSteps.find(
    (step) => step.idempotencyKey === retrievalStepKey(input.run.id),
  );
  const retrievalProviderContact = retrieveSteps.some(
    (step) => step.output?.providerContact === true,
  );
  const retrievalEvidenceCreated = retrieveSteps.some(
    (step) => step.output?.evidenceCreated === true,
  );
  const reservation = input.artifacts.reservation;
  const disallowedClasses = (input.artifacts.toolOperationClasses ?? []).filter(
    (operation) => operation !== "read_only",
  );
  const completedExecute = input.artifacts.steps.some(
    (step) => step.stepKind === "execute" && step.status === "completed",
  );
  const classCounts = input.artifacts.toolClassCounts;
  const unexplainedDisallowed =
    input.artifacts.disallowedToolEventCount > 0 &&
    classCounts === null &&
    disallowedClasses.length === 0;
  const subtype = (name: KnownDisallowedToolClass): boolean | null => {
    if (disallowedClasses.includes(name)) return true;
    if (classCounts) return classCounts[name] > 0;
    if (unexplainedDisallowed || input.artifacts.toolOperationClasses === null) {
      return input.artifacts.disallowedToolEventCount === 0 ? false : null;
    }
    return false;
  };
  const knownCount = classCounts
    ? KNOWN_DISALLOWED_TOOL_CLASSES.reduce((sum, name) => sum + classCounts[name], 0)
    : 0;
  const otherDisallowed = classCounts
    ? input.artifacts.disallowedToolEventCount > knownCount ||
      disallowedClasses.some(
        (operation) =>
          !KNOWN_DISALLOWED_TOOL_CLASSES.includes(operation as KnownDisallowedToolClass),
      )
    : unexplainedDisallowed
      ? null
      : disallowedClasses.some(
          (operation) =>
            !KNOWN_DISALLOWED_TOOL_CLASSES.includes(operation as KnownDisallowedToolClass),
        );
  const externalWrite = subtype("external_write");
  const mutatingToolEvent =
    disallowedClasses.length > 0 ||
    input.artifacts.disallowedToolEventCount > 0 ||
    otherDisallowed === true ||
    completedExecute;
  const matchedSynthesis =
    reservation === null
      ? undefined
      : synthesizeCandidates.find(
          (step) =>
            step.status === "completed" && step.idempotencyKey === reservation.idempotencyKey,
        );
  const checks: Record<string, unknown> = {
    run_id: input.run.id,
    reservation_id: reservation?.id ?? null,
    reservation_status: reservation?.status ?? null,
    reservation_idempotency_key: reservation?.idempotencyKey ?? null,
    usage_knowledge: reservation?.usageKnowledge ?? "none",
    recorded_tokens: reservation?.status === "settled_known" ? reservation.actualTokens : null,
    recorded_cost_usd: reservation?.status === "settled_known" ? reservation.actualCostUsd : null,
    hold_tokens: reservation?.holdTokens ?? null,
    hold_cost_usd: reservation?.holdCostUsd ?? null,
    pricing_version: reservation?.pricingVersion ?? null,
    retrieve_step_status: retrieve?.status ?? null,
    retrieve_idempotency_key: retrieve?.idempotencyKey ?? null,
    retrieve_provider_contact: retrievalProviderContact,
    evidence_created: retrievalEvidenceCreated,
    synthesize_step_status: matchedSynthesis?.status ?? null,
    synthesize_idempotency_key: matchedSynthesis?.idempotencyKey ?? null,
    finding_count: input.artifacts.findingCount,
    approval_id: input.artifacts.approvalId,
    proposal_id: input.artifacts.proposalId,
    canonical_mutation: subtype("canonical_write"),
    evidence_write: subtype("evidence_write"),
    archive_change: subtype("archive_change"),
    external_execution: completedExecute ? true : externalWrite,
    other_disallowed_operation: otherDisallowed,
    mutating_tool_event: mutatingToolEvent,
    semantic_correctness: "not_claimed",
  };
  let failureCode = "verification_failed";
  let ok = true;
  if (mutatingToolEvent) {
    ok = false;
    failureCode = "verification_boundary_violated";
  } else if (retrievalProviderContact) {
    ok = false;
    failureCode = "retrieval_provider_contact";
  } else if (retrievalEvidenceCreated) {
    ok = false;
    failureCode = "evidence_creation_unexpected";
  } else if (
    !retrieve ||
    retrieve.status !== "completed" ||
    retrieve.idempotencyKey !== retrievalStepKey(input.run.id) ||
    retrieve.output?.providerContact !== false ||
    retrieve.output?.evidenceCreated !== false
  ) {
    ok = false;
    failureCode = "retrieval_not_recorded";
  } else if (!reservation) {
    ok = false;
    failureCode = "provider_reservation_absent";
  } else if (reservation.status === "held" || reservation.usageKnowledge === "unknown") {
    ok = false;
    failureCode = "provider_usage_unknown";
  } else if (reservation.status !== "settled_known") {
    ok = false;
    failureCode = "provider_usage_not_settled";
  } else if (reservation.actualTokens === null || reservation.actualCostUsd === null) {
    ok = false;
    failureCode = "provider_usage_not_settled";
  } else if (!matchedSynthesis) {
    ok = false;
    failureCode = synthesizeCandidates.some((step) => step.status === "completed")
      ? "synthesis_identity_mismatch"
      : "synthesis_not_recorded";
  } else if (matchedSynthesis.pricingVersion !== reservation.pricingVersion) {
    ok = false;
    failureCode = "synthesis_pricing_mismatch";
  } else if (matchedSynthesis.tokensUsed !== reservation.actualTokens) {
    ok = false;
    failureCode = "synthesis_token_mismatch";
  } else if (!sameAmount(matchedSynthesis.costUsd, reservation.actualCostUsd)) {
    ok = false;
    failureCode = "synthesis_cost_mismatch";
  } else if (
    reservation.actualTokens > reservation.holdTokens ||
    exceedsAmount(reservation.actualCostUsd, reservation.holdCostUsd)
  ) {
    ok = false;
    failureCode = "provider_hold_exceeded";
  }
  return { ok, failureCode, checks };
}

function sameAmount(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-8;
}

function exceedsAmount(actual: number, ceiling: number): boolean {
  return actual - ceiling > 1e-8;
}

async function advanceVerification(
  io: CustodianIo,
  run: SynthesisRun,
  invocationKey: string,
): Promise<AdvanceResult> {
  const artifacts = await io.readVerificationArtifacts(run.id);
  if (!artifacts) {
    const reservation = await readAttemptReservation(io, run);
    if (isAdvanceResult(reservation)) return reservation;
    const failed = await io.transitionRun(
      run,
      invocationKey,
      "failed",
      failurePatch(
        "verification_artifacts_unavailable",
        "Verification could not read the durable run artifacts.",
      ),
    );
    return outcome(200, "failed", failed, accountingFromReservation(failed, reservation));
  }
  const evaluation = evaluateReadonlyVerification({ run, artifacts });
  const recorded = await io.recordStep({
    run,
    stepKind: "verify",
    idempotencyKey: `verify:${run.id}`,
    modelTier: run.model_tier,
    inputPayload: { stage: "verify" },
    outputPayload: {
      verification: "m4_readonly_boundary",
      checks: evaluation.checks,
    },
    status: evaluation.ok ? "completed" : "failed",
  });
  if (TERMINAL_STATES.has(recorded.run.status)) {
    return outcome(
      200,
      "stopped",
      recorded.run,
      accountingFromReservation(recorded.run, artifacts.reservation),
    );
  }
  if (!evaluation.ok) {
    const failed = await io.transitionRun(
      recorded.run,
      invocationKey,
      "failed",
      failurePatch(evaluation.failureCode, "Verification did not prove the M4 read-only boundary."),
    );
    return outcome(200, "failed", failed, accountingFromReservation(failed, artifacts.reservation));
  }
  const completed = await io.transitionRun(recorded.run, invocationKey, "completed");
  return outcome(
    200,
    "completed",
    completed,
    accountingFromReservation(completed, artifacts.reservation),
  );
}

function reservationInFlight(reservation: ReservationView, now: number): boolean {
  const until = Date.parse(reservation.inFlightUntil);
  return Number.isFinite(until) && until > now;
}

const PROVIDER_CONTACT_USAGE_UNKNOWN =
  "Provider contact occurred, but reliable usage was not available. The hold remains.";
const PROVIDER_TIMEOUT_USAGE_UNKNOWN =
  "Custodian model service timed out. Usage is unknown and the hold remains.";
const PROVIDER_CONTACT_UNCERTAIN =
  "Custodian model contact is uncertain. Usage is unknown and the hold remains.";

function exchangeFailureMessage(exchange: Extract<ProviderExchange, { kind: "failure" }>): string {
  if (exchange.code === "openai_timeout") return PROVIDER_TIMEOUT_USAGE_UNKNOWN;
  if (exchange.diagnostic.contact_state === "contact_uncertain") return PROVIDER_CONTACT_UNCERTAIN;
  return PROVIDER_CONTACT_USAGE_UNKNOWN;
}

/** Best effort. Diagnostics are evidence about the attempt, never accounting. */
async function recordDiagnostic(
  io: CustodianIo,
  ownerId: string,
  runId: string,
  attemptKey: string,
  diagnostic: ProviderDiagnostic,
): Promise<void> {
  try {
    await io.recordProviderDiagnostic(ownerId, runId, attemptKey, diagnostic);
  } catch {
    // A missing diagnostic surface must not alter the provider outcome.
  }
}

async function transitionFailure(
  io: CustodianIo,
  run: SynthesisRun,
  invocationKey: string,
  nextStatus: string,
  code: string,
  message: string,
  accounting: PublicAccounting,
  httpStatus = 200,
): Promise<AdvanceResult> {
  if (TERMINAL_STATES.has(run.status)) {
    return outcome(httpStatus, "stopped", run, accounting, { reason: code });
  }
  const next = await io.transitionRun(run, invocationKey, nextStatus, failurePatch(code, message));
  const state =
    nextStatus === "cancelled" || nextStatus === "budget_stopped"
      ? "stopped"
      : nextStatus === "blocked"
        ? "blocked"
        : "failed";
  return outcome(httpStatus, state, next, accounting, { reason: code });
}

async function releaseUncontacted(
  io: CustodianIo,
  ownerId: string,
  run: SynthesisRun,
  invocationKey: string,
  attemptKey: string,
  code: string,
  message: string,
  nextStatus: "cancelled" | "failed" | "blocked",
): Promise<AdvanceResult> {
  const settled = await io.settleProviderReservation(ownerId, run.id, attemptKey, {
    usage_knowledge: "none",
  });
  return transitionFailure(
    io,
    settled.run,
    invocationKey,
    nextStatus,
    code,
    message,
    accountingFromReservation(settled.run, settled.reservation),
  );
}

async function settleUnknown(
  io: CustodianIo,
  ownerId: string,
  run: SynthesisRun,
  invocationKey: string,
  attemptKey: string,
  code: string,
  message: string,
): Promise<AdvanceResult> {
  let settled: { run: SynthesisRun; reservation: ReservationView };
  try {
    settled = await io.settleProviderReservation(ownerId, run.id, attemptKey, {
      usage_knowledge: "unknown",
      record_failure_step: true,
      failure_code: code,
      failure_message: message,
    });
  } catch {
    const current = await io.getRun(run.id);
    const reservation = await io.getReservation(run.id, attemptKey);
    return outcome(503, "held", current, accountingFromReservation(current, reservation), {
      reason: "provider_settlement_uncertain",
      detail:
        "Provider contact may already have happened. The runtime did not record reliable usage and will not make another provider call.",
    });
  }
  const accounting = accountingFromReservation(settled.run, settled.reservation);
  if (settled.run.cancel_requested_at) {
    return transitionFailure(
      io,
      settled.run,
      invocationKey,
      "cancelled",
      "cancelled",
      "Cancellation was requested. Provider contact may already have happened, so the unresolved hold remains.",
      accounting,
    );
  }
  return transitionFailure(
    io,
    settled.run,
    invocationKey,
    "failed",
    code,
    message,
    accounting,
    502,
  );
}

async function continueFromRecordedStep(
  io: CustodianIo,
  ownerId: string,
  run: SynthesisRun,
  invocationKey: string,
  attemptKey: string,
  reservation: ReservationView,
): Promise<AdvanceResult> {
  run = await io.getRun(run.id);
  const accounting = accountingFromReservation(run, reservation);
  const step = await io.getStepByIdempotency(run.id, attemptKey);
  if (!step) {
    return transitionFailure(
      io,
      run,
      invocationKey,
      "failed",
      "provider_step_missing",
      "Provider usage was settled, but the synthesis step could not be read. The provider was not called again.",
      accounting,
    );
  }
  if (step.status !== "completed") {
    return transitionFailure(
      io,
      run,
      invocationKey,
      run.status === "budget_stopped" ? "budget_stopped" : "failed",
      step.output?.errorCode && typeof step.output.errorCode === "string"
        ? step.output.errorCode
        : "provider_output_rejected",
      "The recorded provider step did not produce a completed synthesis. The provider was not called again.",
      accounting,
    );
  }
  try {
    await io.materializeFindings(ownerId, step.id);
  } catch {
    return transitionFailure(
      io,
      run,
      invocationKey,
      "failed",
      "finding_materialization_failed",
      "Provider usage was recorded, but Finding materialization failed. The provider was not called again.",
      accounting,
    );
  }
  if (run.cancel_requested_at) {
    return transitionFailure(
      io,
      run,
      invocationKey,
      "cancelled",
      "cancelled",
      "Cancellation was requested after provider contact may have occurred. Recorded provider usage remains.",
      accounting,
    );
  }
  const output = step.output ?? {};
  if (output.requiresApproval === true) {
    try {
      const created = await io.createApproval(run, output);
      const durable = await readConfirmedApprovalRun(io, run.id, created);
      return outcome(200, "paused", durable, accountingFromReservation(durable, reservation), {
        approval: created.approval,
      });
    } catch {
      return approvalUnconfirmed(run, accounting);
    }
  }
  if (TERMINAL_STATES.has(run.status)) return outcome(200, "stopped", run, accounting);
  try {
    const next = await io.transitionRun(run, invocationKey, "verifying");
    return outcome(200, "advanced", next, accountingFromReservation(next, reservation));
  } catch {
    return outcome(503, "failed", run, accounting, {
      reason: "run_transition_failed",
      detail: "Provider usage remains recorded. The provider was not called again.",
    });
  }
}

async function readConfirmedApprovalRun(
  io: CustodianIo,
  runId: string,
  created: { run: SynthesisRun | null; approval: ApprovalIdentity },
): Promise<SynthesisRun> {
  const durable = created.run ?? (await io.getRun(runId));
  return confirmedPendingApprovalRun(durable, created.approval.status);
}

function approvalUnconfirmed(run: SynthesisRun, accounting: PublicAccounting): AdvanceResult {
  return {
    status: 503,
    body: {
      state: "unavailable",
      reason: "approval_run_unconfirmed",
      detail:
        "The approval could not be confirmed against the durable run. This response does not mark the run awaiting approval. Recorded provider usage remains.",
      run: projectPublicRun(run, accounting),
    },
  };
}

async function blockUnsupported(
  io: CustodianIo,
  run: SynthesisRun,
  invocationKey: string,
): Promise<AdvanceResult> {
  const blockedStep = await io.recordStep({
    run,
    stepKind: "synthesize",
    idempotencyKey: `${invocationKey}:synthesize`.slice(0, 300),
    modelTier: run.model_tier,
    inputPayload: { stage: "synthesize", providerExecution: "unsupported" },
    outputPayload: { errorCode: "provider_execution_unsupported" },
    status: "blocked",
  });
  if (TERMINAL_STATES.has(blockedStep.run.status)) {
    return outcome(200, "stopped", blockedStep.run, emptyAccounting(blockedStep.run), {
      reason: "provider_execution_unsupported",
    });
  }
  const blocked = await io.transitionRun(
    blockedStep.run,
    invocationKey,
    "blocked",
    failurePatch(
      "provider_execution_unsupported",
      "Provider execution is intentionally unsupported by this runtime.",
    ),
  );
  return outcome(200, "blocked", blocked, emptyAccounting(blocked), {
    reason: "provider_execution_unsupported",
  });
}

async function executeBoundedSynthesisAttempt(input: {
  io: CustodianIo;
  ownerId: string;
  run: SynthesisRun;
  invocationKey: string;
  budget: BudgetSnapshot;
  validSynthesis: (value: unknown) => boolean;
  providerAttemptTimeoutMs?: number;
}): Promise<AdvanceResult> {
  const { io, ownerId } = input;
  let run = input.run;
  const attemptKey = providerAttemptKey(run.id);
  const existing = await readAttemptReservation(io, run);
  if (isAdvanceResult(existing)) return existing;
  if (existing?.status === "settled_known") {
    return continueFromRecordedStep(io, ownerId, run, input.invocationKey, attemptKey, existing);
  }
  if (existing?.status === "released_uncontacted") {
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      run.cancel_requested_at ? "cancelled" : "failed",
      "provider_not_contacted",
      "The provider hold was released before contact. The provider was not called again.",
      accountingFromReservation(run, existing),
    );
  }
  if (existing?.status === "held") {
    const accounting = accountingFromReservation(run, existing);
    const reason = reservationInFlight(existing, io.now())
      ? "provider_attempt_in_progress"
      : "provider_hold_unsettled";
    return outcome(200, "held", run, accounting, {
      reason,
      detail:
        "An unresolved provider hold remains. The runtime will not make another provider call. Cancellation does not prove the provider was never contacted.",
    });
  }

  if (!input.budget.allowed) {
    return stopForBudget(io, run, input.invocationKey, input.budget);
  }
  const providerTimeoutMs = boundedProviderTimeoutMs(
    input.budget.run_latency_remaining,
    input.providerAttemptTimeoutMs,
  );
  if (providerTimeoutMs < 1) {
    return stopForBudget(io, run, input.invocationKey, {
      ...input.budget,
      allowed: false,
      reason: "per_run_latency",
    });
  }

  if (run.cancel_requested_at) {
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      "cancelled",
      "cancelled",
      "The owner requested cancellation before provider contact.",
      emptyAccounting(run),
    );
  }

  if (!io.trustedRuntimeAvailable()) {
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      "blocked",
      "trusted_runtime_unavailable",
      "Custodian trusted runtime execution is unavailable.",
      emptyAccounting(run),
      503,
    );
  }

  let allowedTiers: readonly ModelTier[];
  try {
    allowedTiers = await io.resolveAllowedModelTiers(run);
  } catch {
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      "blocked",
      "tool_policy_invalid",
      "The persisted Custodian tool policy is unavailable or malformed.",
      emptyAccounting(run),
      502,
    );
  }
  if (!allowedTiers.includes(run.model_tier)) {
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      "blocked",
      "model_tier_not_allowed",
      "The persisted Custodian model tier is not allowed by its owner policy.",
      emptyAccounting(run),
      502,
    );
  }
  const model = MODEL_ALLOWLIST[run.model_tier];
  const pricingClass = classifyModelPricing(io.getEnv(CUSTODIAN_MODEL_PRICING_ENV), model);
  if (pricingClass.status !== "ready") {
    const missing = pricingClass.status === "missing";
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      "blocked",
      missing ? "model_pricing_unavailable" : "model_pricing_invalid",
      missing
        ? "Custodian model pricing is unavailable, so provider execution remains blocked."
        : "Custodian model pricing is malformed, so provider execution remains blocked.",
      emptyAccounting(run),
      503,
    );
  }
  const pricing: ModelPricing = pricingClass.pricing;
  let systemPrompt: string;
  try {
    systemPrompt = resolveSystemPrompt(run.agent_config);
  } catch {
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      "blocked",
      "agent_config_invalid",
      "The persisted Custodian agent configuration is malformed.",
      emptyAccounting(run),
      502,
    );
  }
  const apiKey = io.getEnv("OPENAI_API_KEY");
  if (!apiKey) {
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      "blocked",
      "openai_not_configured",
      "Custodian model service is not configured.",
      emptyAccounting(run),
      503,
    );
  }
  const maxOutputTokens = boundedOutputBudget(input.budget.run_tokens_remaining);
  if (maxOutputTokens < 1) {
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      "budget_stopped",
      "per_run_tokens",
      "The remaining Custodian token budget cannot cover a bounded provider call.",
      emptyAccounting(run),
    );
  }
  let params: SynthesisRequestParams;
  let inputBytes: number;
  try {
    params = buildSynthesisParams({
      model,
      systemPrompt,
      untrustedEvidence: {
        objective: run.objective,
        evidence: run.input_snapshot,
      },
      maxOutputTokens,
    });
    inputBytes = serializedRequestBytes(params);
  } catch {
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      "blocked",
      "provider_request_invalid",
      "The bounded provider request could not be constructed.",
      emptyAccounting(run),
      502,
    );
  }
  const holdTokens = inputBytes + maxOutputTokens;
  const holdCost = maximumPotentialUsageCost(inputBytes, maxOutputTokens, pricing);
  if (
    !Number.isSafeInteger(holdTokens) ||
    holdTokens <= 0 ||
    holdTokens > MAX_HOLD_TOKENS ||
    holdCost === null
  ) {
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      "blocked",
      "provider_hold_invalid",
      "The conservative provider hold could not be calculated.",
      emptyAccounting(run),
      502,
    );
  }

  const reservedRaw = await io.reserveProviderCall(run.id, attemptKey, {
    stage: "synthesize",
    pricing_version: pricing.version,
    model_name: model,
    model_tier: run.model_tier,
    hold_tokens: holdTokens,
    hold_cost_usd: holdCost,
  });
  const reserved = parseReservePayload(reservedRaw);
  if (!reserved) {
    return reservationUnestablished(run, "provider_reservation_unreadable");
  }
  if (!reserved.reserved) {
    if (reserved.reservation?.status === "settled_known") {
      return continueFromRecordedStep(
        io,
        ownerId,
        run,
        input.invocationKey,
        attemptKey,
        reserved.reservation,
      );
    }
    if (reserved.reservation?.status === "released_uncontacted") {
      return transitionFailure(
        io,
        run,
        input.invocationKey,
        "failed",
        "provider_not_contacted",
        "The provider hold was released before contact. The provider was not called again.",
        accountingFromReservation(run, reserved.reservation),
      );
    }
    if (reserved.reservation?.status === "held") {
      return outcome(200, "held", run, accountingFromReservation(run, reserved.reservation), {
        reason: reserved.reason,
        detail:
          "An unresolved provider hold remains. The runtime will not make another provider call. Cancellation does not prove the provider was never contacted.",
      });
    }
    const denial = reserveDenial(reserved.reason);
    if (!denial) {
      return outcome(200, "blocked", run, emptyAccounting(run), { reason: reserved.reason });
    }
    return transitionFailure(
      io,
      run,
      input.invocationKey,
      denial.next,
      denial.code,
      denial.message,
      emptyAccounting(run),
      denial.httpStatus,
    );
  }
  if (
    !reservationMatchesAttempt(
      reserved.reservation,
      attemptKey,
      pricing.version,
      holdTokens,
      holdCost,
    )
  ) {
    return reservationUnestablished(run, "provider_reservation_mismatch");
  }

  const fresh = await io.getRun(run.id);
  run = fresh;
  if (run.cancel_requested_at) {
    return releaseUncontacted(
      io,
      ownerId,
      run,
      input.invocationKey,
      attemptKey,
      "cancelled",
      "The owner requested cancellation before provider contact. The hold was released.",
      "cancelled",
    );
  }

  const startedAt = io.now();
  const exchange = await sendSynthesisRequest({
    apiKey,
    fetch: io.fetchProvider,
    timeoutMs: providerTimeoutMs,
    params,
  });
  const latencyMs = Math.max(0, Math.round(io.now() - startedAt));
  if (exchange.kind === "failure") {
    await recordDiagnostic(io, ownerId, run.id, attemptKey, exchange.diagnostic);
    return settleUnknown(
      io,
      ownerId,
      run,
      input.invocationKey,
      attemptKey,
      exchange.code,
      exchangeFailureMessage(exchange),
    );
  }
  const responded = (classification: ProviderClassification, incompleteReason?: string | null) =>
    providerDiagnostic({
      classification,
      httpStatus: exchange.diagnostic.httpStatus,
      requestId: exchange.diagnostic.requestId,
      incompleteReason,
    });
  const interpreted = interpretSynthesisResponse(exchange.body);
  if (interpreted.kind === "unreadable") {
    await recordDiagnostic(io, ownerId, run.id, attemptKey, responded("openai_invalid_response"));
    return settleUnknown(
      io,
      ownerId,
      run,
      input.invocationKey,
      attemptKey,
      "openai_invalid_response",
      PROVIDER_CONTACT_USAGE_UNKNOWN,
    );
  }
  const synthesisOutput = interpreted.output;
  const incompleteReason = synthesisOutput.kind === "incomplete" ? synthesisOutput.reason : null;
  const usage = interpreted.usage;
  if (!usage) {
    await recordDiagnostic(
      io,
      ownerId,
      run.id,
      attemptKey,
      responded("openai_usage_missing", incompleteReason),
    );
    return settleUnknown(
      io,
      ownerId,
      run,
      input.invocationKey,
      attemptKey,
      "openai_usage_missing",
      PROVIDER_CONTACT_USAGE_UNKNOWN,
    );
  }
  const structured = synthesisOutput.kind === "json" ? synthesisOutput.value : null;
  const accepted = structured !== null && input.validSynthesis(structured);
  const errorCode =
    synthesisOutput.kind === "refusal"
      ? "openai_refusal"
      : synthesisOutput.kind === "incomplete"
        ? "openai_incomplete"
        : accepted
          ? null
          : "openai_invalid_output";
  await recordDiagnostic(
    io,
    ownerId,
    run.id,
    attemptKey,
    responded(errorCode ?? "openai_completed", incompleteReason),
  );
  const costUsd = calculateUsageCost(usage, pricing);
  if (costUsd === null) {
    return settleUnknown(
      io,
      ownerId,
      run,
      input.invocationKey,
      attemptKey,
      "model_pricing_invalid",
      "Provider usage could not be priced from the persisted version. The hold remains.",
    );
  }
  let settled: { run: SynthesisRun; reservation: ReservationView };
  try {
    settled = await io.settleProviderReservation(ownerId, run.id, attemptKey, {
      usage_knowledge: "known",
      actual_tokens: usage.tokens,
      actual_cost_usd: costUsd,
      step_status: accepted ? "completed" : "failed",
      input_payload: { stage: "synthesize", providerContact: true },
      output_payload: accepted ? structured : { errorCode, usage_knowledge: "known" },
      latency_ms: latencyMs,
    });
  } catch {
    const current = await io.getRun(run.id);
    const reservation = await io.getReservation(run.id, attemptKey);
    return outcome(503, "held", current, accountingFromReservation(current, reservation), {
      reason: "provider_settlement_uncertain",
      detail:
        "Provider contact may already have happened. The runtime will not make another provider call.",
    });
  }
  if (!accepted || !structured) {
    return transitionFailure(
      io,
      settled.run,
      input.invocationKey,
      "failed",
      errorCode ?? "openai_invalid_output",
      "Provider usage was recorded, but the synthesis output was not a valid Finding result.",
      accountingFromReservation(settled.run, settled.reservation),
      502,
    );
  }
  return continueFromRecordedStep(
    io,
    ownerId,
    settled.run,
    input.invocationKey,
    attemptKey,
    settled.reservation,
  );
}

function reserveDenial(reason: string): {
  next: string;
  code: string;
  message: string;
  httpStatus: number;
} | null {
  if (
    reason === "per_run_tokens" ||
    reason === "per_run_cost" ||
    reason === "daily_tokens" ||
    reason === "monthly_tokens" ||
    reason === "daily_cost" ||
    reason === "monthly_cost"
  ) {
    return {
      next: "budget_stopped",
      code: reason,
      message: "The provider reservation was denied by the persisted budget.",
      httpStatus: 200,
    };
  }
  if (reason === "cancel_requested") {
    return {
      next: "cancelled",
      code: "cancelled",
      message: "The owner requested cancellation before a provider hold was taken.",
      httpStatus: 200,
    };
  }
  if (reason === "aggregate_cost_ceiling_required") {
    return {
      next: "blocked",
      code: reason,
      message: "Provider reservation requires explicit daily and monthly cost ceilings.",
      httpStatus: 200,
    };
  }
  if (reason === "policy_unavailable" || reason === "model_tier_not_allowed") {
    return {
      next: "blocked",
      code: reason,
      message: "The persisted owner policy refused the provider reservation.",
      httpStatus: 200,
    };
  }
  if (reason === "run_not_synthesizing") return null;
  return {
    next: "blocked",
    code: "provider_reservation_denied",
    message: "The provider reservation was refused. No provider call was made.",
    httpStatus: 200,
  };
}

function unsupportedReservationDetail(reservation: ReservationView): string {
  const base = "Provider execution is unsupported. The existing reservation was left unchanged.";
  if (reservation.status === "released_uncontacted" && reservation.usageKnowledge === "none") {
    return `${base} No provider call was made.`;
  }
  if (reservation.status === "held" || reservation.usageKnowledge === "unknown") {
    return `${base} This response does not establish whether a provider was contacted.`;
  }
  return base;
}

export async function advanceCustodianRun(input: {
  io: CustodianIo;
  ownerId: string;
  invocation: { runId: string; invocationKey: string };
  providerExecutionUnsupported: boolean;
  validSynthesis: (value: unknown) => boolean;
  providerAttemptTimeoutMs?: number;
}): Promise<AdvanceResult> {
  const { io, ownerId, invocation } = input;
  let run = await io.getRun(invocation.runId);
  if (TERMINAL_STATES.has(run.status) || run.status === "awaiting_approval") {
    const reservation = await readAttemptReservation(io, run);
    if (isAdvanceResult(reservation)) return reservation;
    return outcome(
      200,
      run.status === "awaiting_approval" ? "paused" : "terminal",
      run,
      accountingFromReservation(run, reservation),
    );
  }

  if (run.status === "executing") {
    const blockedStep = await io.recordStep({
      run,
      stepKind: "execute",
      idempotencyKey: `${invocation.invocationKey}:execute`.slice(0, 300),
      modelTier: run.model_tier,
      inputPayload: { stage: "execute" },
      outputPayload: { errorCode: "external_write_unsupported" },
      status: "blocked",
    });
    const blocked = await io.transitionRun(
      blockedStep.run,
      invocation.invocationKey,
      "blocked",
      failurePatch(
        "external_write_unsupported",
        "Approved external execution is not supported by this runtime.",
      ),
    );
    return outcome(200, "blocked", blocked, emptyAccounting(blocked), {
      reason: "external_write_unsupported",
    });
  }

  const budget = await io.getBudget(invocation.runId);

  if (run.status === "queued") {
    if (!budget.allowed) return stopForBudget(io, run, invocation.invocationKey, budget);
    run = await io.transitionRun(run, invocation.invocationKey, "retrieving");
    return outcome(200, "advanced", run, emptyAccounting(run));
  }

  if (run.status === "retrieving") {
    if (!budget.allowed) return stopForBudget(io, run, invocation.invocationKey, budget);
    return advanceRetrieval(io, run, invocation.invocationKey);
  }

  if (run.status === "synthesizing") {
    if (input.providerExecutionUnsupported) {
      const reservation = await readAttemptReservation(io, run);
      if (isAdvanceResult(reservation)) return reservation;
      if (reservation) {
        const state =
          reservation.status === "held"
            ? "held"
            : reservation.status === "settled_known"
              ? "replay"
              : "stopped";
        return outcome(200, state, run, accountingFromReservation(run, reservation), {
          reason: "provider_execution_unsupported",
          detail: unsupportedReservationDetail(reservation),
        });
      }
      if (!budget.allowed) return stopForBudget(io, run, invocation.invocationKey, budget);
      return blockUnsupported(io, run, invocation.invocationKey);
    }
    return executeBoundedSynthesisAttempt({
      io,
      ownerId,
      run,
      invocationKey: invocation.invocationKey,
      budget,
      validSynthesis: input.validSynthesis,
      providerAttemptTimeoutMs: input.providerAttemptTimeoutMs,
    });
  }

  if (run.status === "verifying") {
    return advanceVerification(io, run, invocation.invocationKey);
  }

  throw new Error("unsupported_run_state");
}
