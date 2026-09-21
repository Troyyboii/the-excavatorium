import {
  boundedOutputBudget,
  buildResponsesRequest,
  calculateUsageCost,
  classifyModelPricing,
  classifyResponsesOutput,
  CUSTODIAN_MODEL_PRICING_ENV,
  maximumPotentialUsageCost,
  MODEL_ALLOWLIST,
  readUsage,
  resolveSystemPrompt,
  SYNTHESIS_SCHEMA,
  type ModelPricing,
  type ModelTier,
} from "./runtime.ts";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const PROVIDER_ATTEMPT_TIMEOUT_MS = 25_000;
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
  toolOperationClasses: string[];
};

export type BudgetSnapshot = {
  allowed: boolean;
  reason: string;
  run_tokens_remaining: number;
  run_cost_remaining: number;
};

export type ApprovalIdentity = {
  id: string;
  status: string;
  approvalKind: string;
  exactActionHash: string;
};

export type ProviderFetchInit = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
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
    invocationKey: string,
    output: Record<string, unknown>,
  ): Promise<{ run: SynthesisRun; approval: ApprovalIdentity }>;
  readVerificationArtifacts(runId: string): Promise<VerificationArtifacts | null>;
  getEnv(name: string): string | undefined;
  fetchProvider(url: string, init: ProviderFetchInit): Promise<Response>;
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

function reservationUnread(run: SynthesisRun): AdvanceResult {
  return {
    status: 503,
    body: {
      state: "unavailable",
      reason: "provider_reservation_unreadable",
      detail:
        "The provider reservation could not be read. No provider usage was assumed, and no provider call was made.",
      run: {
        id: run.id,
        caseId: run.case_id,
        status: run.status,
      },
    },
  };
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
  const synthesize = input.artifacts.steps.find((step) => step.stepKind === "synthesize");
  const retrieve = input.artifacts.steps.find((step) => step.stepKind === "retrieve");
  const reservation = input.artifacts.reservation;
  const mutatingTools = input.artifacts.toolOperationClasses.filter(
    (operation) => operation !== "read_only",
  );
  const checks: Record<string, unknown> = {
    run_id: input.run.id,
    reservation_id: reservation?.id ?? null,
    reservation_status: reservation?.status ?? null,
    usage_knowledge: reservation?.usageKnowledge ?? "none",
    recorded_tokens: reservation?.status === "settled_known" ? reservation.actualTokens : null,
    recorded_cost_usd: reservation?.status === "settled_known" ? reservation.actualCostUsd : null,
    pricing_version: reservation?.pricingVersion ?? null,
    retrieve_step_status: retrieve?.status ?? null,
    retrieve_provider_contact: retrieve?.output?.providerContact === true,
    evidence_created: retrieve?.output?.evidenceCreated === true,
    synthesize_step_status: synthesize?.status ?? null,
    finding_count: input.artifacts.findingCount,
    approval_id: input.artifacts.approvalId,
    proposal_id: input.artifacts.proposalId,
    canonical_mutation: mutatingTools.includes("canonical_write"),
    external_execution:
      mutatingTools.includes("external_write") ||
      input.artifacts.steps.some(
        (step) => step.stepKind === "execute" && step.status === "completed",
      ),
    semantic_correctness: "not_claimed",
  };
  let failureCode = "verification_failed";
  let ok = true;
  if (checks.external_execution === true || checks.canonical_mutation === true) {
    ok = false;
    failureCode = "verification_boundary_violated";
  } else if (
    !retrieve ||
    retrieve.status !== "completed" ||
    retrieve.output?.providerContact !== false
  ) {
    ok = false;
    failureCode = "retrieval_not_recorded";
  } else if (retrieve.output?.evidenceCreated !== false) {
    ok = false;
    failureCode = "evidence_creation_unexpected";
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
  } else if (!synthesize || synthesize.status !== "completed") {
    ok = false;
    failureCode = "synthesis_not_recorded";
  }
  return { ok, failureCode, checks };
}

async function advanceVerification(
  io: CustodianIo,
  run: SynthesisRun,
  invocationKey: string,
): Promise<AdvanceResult> {
  const artifacts = await io.readVerificationArtifacts(run.id);
  if (!artifacts) {
    const failed = await io.transitionRun(
      run,
      invocationKey,
      "failed",
      failurePatch(
        "verification_artifacts_unavailable",
        "Verification could not read the durable run artifacts.",
      ),
    );
    return outcome(200, "failed", failed, emptyAccounting(failed));
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
      const approval = await io.createApproval(run, invocationKey, output);
      return outcome(
        200,
        "paused",
        approval.run,
        accountingFromReservation(approval.run, reservation),
        {
          approval: approval.approval,
        },
      );
    } catch {
      return transitionFailure(
        io,
        run,
        invocationKey,
        "failed",
        "approval_recording_failed",
        "Provider usage was recorded, but the approval request was not recorded. The provider was not called again.",
        accounting,
      );
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
  let requestBody: string;
  try {
    const evidence = {
      objective: run.objective,
      evidence: run.input_snapshot,
    };
    const request = buildResponsesRequest({
      stage: "synthesize",
      model,
      systemPrompt,
      untrustedEvidence: evidence,
      schemaName: "custodian_synthesis",
      schema: SYNTHESIS_SCHEMA,
      maxOutputTokens,
    });
    requestBody = JSON.stringify(request);
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
  const inputBytes = new TextEncoder().encode(requestBody).byteLength;
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
    return outcome(503, "failed", run, emptyAccounting(run), {
      reason: "provider_reservation_unreadable",
    });
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

  const controller = new AbortController();
  const timeoutMs = input.providerAttemptTimeoutMs ?? PROVIDER_ATTEMPT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = io.now();
  let response: Response | undefined;
  let upstream: unknown;
  try {
    response = await io.fetchProvider(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
      signal: controller.signal,
    });
    upstream = await response.json();
  } catch (error) {
    const aborted = isAbortError(error);
    const received = response;
    let code = "openai_unavailable";
    let message = "Custodian model contact is uncertain. Usage is unknown and the hold remains.";
    if (aborted) {
      code = "openai_timeout";
      message = "Custodian model service timed out. Usage is unknown and the hold remains.";
    } else if (received) {
      code = received.ok ? "openai_invalid_response" : "openai_unavailable";
      message =
        "Provider contact occurred, but reliable usage was not available. The hold remains.";
    }
    return settleUnknown(io, ownerId, run, input.invocationKey, attemptKey, code, message);
  } finally {
    clearTimeout(timeout);
  }
  const latencyMs = Math.max(0, Math.round(io.now() - startedAt));
  const usage = readUsage(upstream);
  if (!response.ok || !usage) {
    return settleUnknown(
      io,
      ownerId,
      run,
      input.invocationKey,
      attemptKey,
      response.ok ? "openai_usage_missing" : "openai_unavailable",
      "Provider contact occurred, but reliable usage was not available. The hold remains.",
    );
  }
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
  const classified = classifyResponsesOutput(upstream);
  const structured = classified.kind === "json" ? classified.value : null;
  const accepted = structured !== null && input.validSynthesis(structured);
  const errorCode =
    classified.kind === "refusal" ? "openai_refusal" : accepted ? null : "openai_invalid_output";
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
          detail:
            "Provider execution is unsupported. The existing reservation was left unchanged and no provider call was made.",
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
