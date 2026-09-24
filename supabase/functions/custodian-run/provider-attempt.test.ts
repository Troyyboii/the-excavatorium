import { PROVIDER_EXECUTION_UNSUPPORTED, validSynthesis } from "./index.ts";
import {
  advanceCustodianRun,
  approvalIdempotencyKey,
  boundedProviderTimeoutMs,
  classifyOpenAiHttpFailure,
  countDisallowedToolEvents,
  evaluateReadonlyVerification,
  OPENAI_RESPONSES_URL,
  projectPublicRun,
  PROVIDER_ATTEMPT_TIMEOUT_MS,
  providerAttemptKey,
  providerFreeAdmissionSummary,
  retrievalStepKey,
  type ApprovalIdentity,
  type CustodianIo,
  type DisallowedToolEventCounter,
  type ReservationView,
  type StepArtifact,
  type SynthesisRun,
  type VerificationArtifacts,
} from "./provider-attempt.ts";
import type { ProviderDiagnostic } from "./openai-diagnostics.ts";
import { classifySynthesisOutput } from "./openai-provider.ts";
import { classifyModelPricing } from "./runtime.ts";

const runId = "123e4567-e89b-12d3-a456-426614174000";
const evidenceId = "123e4567-e89b-12d3-a456-426614174111";
const apiKey = "sk-test-provider-key";
const pricingJson = JSON.stringify({
  "gpt-5.6-terra": {
    version: "2026-09-21",
    inputUsdPerMillion: 1.2,
    cachedInputUsdPerMillion: 0.3,
    outputUsdPerMillion: 4.8,
  },
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function finding(outcome = "finding", supporting = evidenceId) {
  return {
    outcome,
    title: "Bounded conclusion",
    conclusion: "The selected evidence supports the conclusion.",
    analysis_mode: "synthesis",
    confidence: 80,
    supporting_evidence_ids: outcome === "finding" || outcome === "unresolved" ? [supporting] : [],
    contrary_evidence_ids: [] as string[],
    uncertainties: [] as string[],
    assumptions: ["Only selected Case evidence was reviewed."],
    scope_limits: [] as string[],
    evidence_gaps:
      outcome === "unresolved" ? ["The archive does not contain the primary confirmation."] : [],
    what_would_change_mind: "A newer primary record would change the conclusion.",
    revisit_condition: "Revisit when the Case scope changes.",
  };
}

function synthesis(
  findings: Record<string, unknown>[],
  requiresApproval = false,
): Record<string, unknown> {
  return {
    summary: "Fixture synthesis",
    findings,
    requiresApproval,
    approvalKind: "tool_action",
  };
}

function providerResponse(
  output: unknown,
  usage: Record<string, unknown> | null = {
    input_tokens: 1_000,
    output_tokens: 250,
    total_tokens: 1_250,
  },
) {
  return {
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

function baseRun(status = "synthesizing"): SynthesisRun {
  return {
    id: runId,
    case_id: runId,
    status,
    input_snapshot: {
      kind: "readonly_analysis_snapshot",
      admitted_records: [{ record_id: evidenceId }],
      excluded_records: [],
      citable_evidence_ids: [evidenceId],
      truncated: false,
    },
    agent_config: {},
    tool_policy_id: runId,
    objective: "What does the selected evidence support?",
    prompt_version: "custodian-runtime-v1",
    model_tier: "terra",
    tokens_used: 0,
    cost_usd: 0,
    latency_ms: 0,
    tool_events_count: 0,
    last_step_number: status === "synthesizing" ? 1 : 0,
    cancel_requested_at: null,
    failure_code: null,
    failure_message: null,
  };
}

type World = {
  run: SynthesisRun;
  reservation: ReservationView | null;
  steps: StepArtifact[];
  fetches: number;
  reserveCalls: number;
  settlePayloads: Record<string, unknown>[];
  materializeCalls: number;
  evidenceWrites: number;
  approvals: number;
  approvalRecords: Array<{ key: string; approval: ApprovalIdentity }>;
  materializedStepIds: string[];
  holdApprovals: Promise<void> | null;
  releaseApprovals: (() => void) | null;
  approvalAttempts: number;
  failApprovalRunReread: boolean;
  failApprovalRunRead: boolean;
  pricing: string | undefined;
  apiKey: string | undefined;
  modelPreference: string | null;
  ownerKeyStatus: "ok" | "missing" | "unreadable";
  ownerLookups: string[];
  reservePayloads: Record<string, unknown>[];
  allowedTiers: Array<"luna" | "terra" | "sol" | "pro">;
  policyError: boolean;
  trusted: boolean;
  reserveDenial: string | null;
  cancelOnReserve: boolean;
  materializeError: boolean;
  transitionFailures: number;
  now: number;
  budget: {
    allowed: boolean;
    reason: string;
    run_tokens_remaining: number;
    run_cost_remaining: number;
    run_latency_remaining: number;
  };
  reservationReadError: boolean;
  verificationUnavailable: boolean;
  reserveResponse?:
    | unknown
    | ((idempotencyKey: string, payload: Record<string, unknown>) => unknown);
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  fetchBodies: string[];
  diagnostics: Array<{ key: string; diagnostic: ProviderDiagnostic }>;
  diagnosticError: boolean;
};

function world(status = "synthesizing"): World {
  return {
    run: baseRun(status),
    reservation: null,
    steps: [],
    fetches: 0,
    reserveCalls: 0,
    settlePayloads: [],
    materializeCalls: 0,
    evidenceWrites: 0,
    approvals: 0,
    approvalRecords: [],
    materializedStepIds: [],
    holdApprovals: null,
    releaseApprovals: null,
    approvalAttempts: 0,
    failApprovalRunReread: false,
    failApprovalRunRead: false,
    pricing: pricingJson,
    apiKey,
    modelPreference: "gpt-5.6-terra",
    ownerKeyStatus: "ok",
    ownerLookups: [],
    reservePayloads: [],
    allowedTiers: ["luna", "terra"],
    policyError: false,
    trusted: true,
    reserveDenial: null,
    cancelOnReserve: false,
    materializeError: false,
    transitionFailures: 0,
    now: Date.parse("2026-09-21T19:00:00.000Z"),
    budget: {
      allowed: true,
      reason: "allowed",
      run_tokens_remaining: 100_000,
      run_cost_remaining: 10,
      run_latency_remaining: 60_000,
    },
    reservationReadError: false,
    verificationUnavailable: false,
    fetchImpl: () => Promise.resolve(Response.json(providerResponse(synthesis([finding()])))),
    fetchBodies: [],
    diagnostics: [],
    diagnosticError: false,
  };
}

function reservationRow(reservation: ReservationView) {
  return {
    id: reservation.id,
    status: reservation.status,
    usage_knowledge: reservation.usageKnowledge,
    hold_tokens: reservation.holdTokens,
    hold_cost_usd: reservation.holdCostUsd,
    actual_tokens: reservation.actualTokens,
    actual_cost_usd: reservation.actualCostUsd,
    pricing_version: reservation.pricingVersion,
    failure_code: reservation.failureCode,
    in_flight_until: reservation.inFlightUntil,
    idempotency_key: reservation.idempotencyKey,
  };
}

function ioFor(state: World): CustodianIo {
  return {
    getRun: () => {
      if (state.failApprovalRunRead) return Promise.reject(new Error("run_unreadable"));
      return Promise.resolve(state.run);
    },
    getBudget: () => {
      if (state.run.cancel_requested_at) {
        return Promise.resolve({
          allowed: false,
          reason: "cancel_requested",
          run_tokens_remaining: state.budget.run_tokens_remaining,
          run_cost_remaining: state.budget.run_cost_remaining,
          run_latency_remaining: state.budget.run_latency_remaining,
        });
      }
      return Promise.resolve(state.budget);
    },
    transitionRun: (run, _invocationKey, nextStatus, patch) => {
      if (state.transitionFailures > 0) {
        state.transitionFailures -= 1;
        return Promise.reject(new Error("transition_failed"));
      }
      state.run = {
        ...run,
        status: nextStatus,
        failure_code:
          typeof patch?.failure_code === "string" ? patch.failure_code : run.failure_code,
        failure_message:
          typeof patch?.failure_message === "string" ? patch.failure_message : run.failure_message,
      };
      return Promise.resolve(state.run);
    },
    recordStep: (input) => {
      if (input.outputPayload.evidenceCreated === true) state.evidenceWrites += 1;
      const step: StepArtifact = {
        id: `step-${state.steps.length + 1}`,
        stepKind: input.stepKind,
        status: input.status ?? "completed",
        idempotencyKey: input.idempotencyKey,
        output: input.outputPayload,
        tokensUsed: input.usage?.tokens ?? 0,
        costUsd: input.usage?.costUsd ?? 0,
        pricingVersion: input.usage?.pricingVersion ?? null,
      };
      const existing = state.steps.find((item) => item.idempotencyKey === step.idempotencyKey);
      if (!existing) {
        state.steps.push(step);
        state.run = {
          ...state.run,
          last_step_number: state.run.last_step_number + 1,
          tokens_used: state.run.tokens_used + step.tokensUsed,
          cost_usd: state.run.cost_usd + step.costUsd,
        };
      }
      return Promise.resolve({
        run: state.run,
        stepId: (existing ?? step).id,
      });
    },
    resolveAllowedModelTiers: () => {
      if (state.policyError) return Promise.reject(new Error("policy"));
      return Promise.resolve(state.allowedTiers);
    },
    getReservation: () => {
      if (state.reservationReadError) return Promise.reject(new Error("reservation_unreadable"));
      return Promise.resolve(state.reservation);
    },
    reserveProviderCall: (_runId, idempotencyKey, payload) => {
      state.reserveCalls += 1;
      state.reservePayloads.push(payload);
      if (state.reserveResponse !== undefined) {
        const response =
          typeof state.reserveResponse === "function"
            ? state.reserveResponse(idempotencyKey, payload)
            : state.reserveResponse;
        return Promise.resolve(response);
      }
      if (state.reservation) {
        const inFlight = Date.parse(state.reservation.inFlightUntil) > state.now;
        return Promise.resolve({
          reserved: false,
          replay: true,
          reason:
            state.reservation.status === "held"
              ? inFlight
                ? "provider_attempt_in_progress"
                : "provider_hold_unsettled"
              : "replay",
          reservation: reservationRow(state.reservation),
        });
      }
      if (state.reserveDenial) {
        return Promise.resolve({
          reserved: false,
          replay: false,
          reason: state.reserveDenial,
          reservation: null,
        });
      }
      state.reservation = {
        id: "reservation-1",
        status: "held",
        usageKnowledge: "unknown",
        holdTokens: payload.hold_tokens as number,
        holdCostUsd: payload.hold_cost_usd as number,
        actualTokens: null,
        actualCostUsd: null,
        pricingVersion: String(payload.pricing_version),
        failureCode: null,
        inFlightUntil: new Date(state.now + 90_000).toISOString(),
        idempotencyKey,
      };
      if (state.cancelOnReserve) state.run.cancel_requested_at = new Date(state.now).toISOString();
      return Promise.resolve({
        reserved: true,
        replay: false,
        reason: "reserved",
        reservation: reservationRow(state.reservation),
      });
    },
    settleProviderReservation: (_ownerId, _runId, key, settlement) => {
      state.settlePayloads.push(settlement);
      if (!state.reservation) return Promise.reject(new Error("missing_reservation"));
      const knowledge = settlement.usage_knowledge;
      if (knowledge === "none") {
        state.reservation = {
          ...state.reservation,
          status: "released_uncontacted",
          usageKnowledge: "none",
          actualTokens: null,
          actualCostUsd: null,
        };
      } else if (knowledge === "unknown") {
        state.reservation = { ...state.reservation, usageKnowledge: "unknown", status: "held" };
        if (settlement.record_failure_step === true) {
          state.steps.push({
            id: "step-unknown",
            stepKind: "synthesize",
            status: "failed",
            idempotencyKey: key,
            output: { usage_knowledge: "unknown", errorCode: settlement.failure_code },
            tokensUsed: 0,
            costUsd: 0,
            pricingVersion: state.reservation.pricingVersion,
          });
        }
      } else {
        const tokens = settlement.actual_tokens as number;
        const cost = settlement.actual_cost_usd as number;
        state.reservation = {
          ...state.reservation,
          status: "settled_known",
          usageKnowledge: "known",
          actualTokens: tokens,
          actualCostUsd: cost,
        };
        state.run = {
          ...state.run,
          tokens_used: state.run.tokens_used + tokens,
          cost_usd: state.run.cost_usd + cost,
        };
        state.steps.push({
          id: "step-known",
          stepKind: "synthesize",
          status: String(settlement.step_status),
          idempotencyKey: key,
          output: settlement.output_payload as Record<string, unknown>,
          tokensUsed: tokens,
          costUsd: cost,
          pricingVersion: "2026-09-21",
        });
      }
      return Promise.resolve({ run: state.run, reservation: state.reservation });
    },
    getStepByIdempotency: (_runId, key) =>
      Promise.resolve(state.steps.find((step) => step.idempotencyKey === key) ?? null),
    materializeFindings: (_ownerId, stepId) => {
      if (state.materializeError) return Promise.reject(new Error("attribution_failed"));
      if (!state.materializedStepIds.includes(stepId)) {
        state.materializedStepIds.push(stepId);
        state.materializeCalls += 1;
      }
      return Promise.resolve({ materialized: true, idempotent: true });
    },
    createApproval: async (run, output) => {
      const key = approvalIdempotencyKey(run.id);
      state.approvalAttempts += 1;
      if (state.holdApprovals) {
        if (state.approvalAttempts >= 2) state.releaseApprovals?.();
        await state.holdApprovals;
      }
      const existing = state.approvalRecords.find((record) => record.key === key);
      if (existing) {
        if (state.failApprovalRunReread) state.failApprovalRunRead = true;
        return { run: null, approval: existing.approval };
      }
      const approval: ApprovalIdentity = {
        id: `approval-${state.approvalRecords.length + 1}`,
        status: "pending",
        approvalKind: typeof output.approvalKind === "string" ? output.approvalKind : "tool_action",
        exactActionHash: "abc",
      };
      state.approvalRecords.push({ key, approval });
      state.approvals += 1;
      state.run = { ...state.run, status: "awaiting_approval" };
      return { run: state.run, approval };
    },
    readVerificationArtifacts: () => {
      if (state.verificationUnavailable) return Promise.resolve(null);
      return Promise.resolve({
        steps: state.steps,
        reservation: state.reservation,
        findingCount: state.materializeCalls,
        approvalId: state.approvals > 0 ? "approval-1" : null,
        proposalId: null,
        toolOperationClasses: null,
        toolClassCounts: null,
        disallowedToolEventCount: 0,
      });
    },
    recordProviderDiagnostic: (_ownerId, _runId, key, diagnostic) => {
      if (state.diagnosticError) return Promise.reject(new Error("diagnostic_unavailable"));
      if (!state.diagnostics.some((item) => item.key === key)) {
        state.diagnostics.push({ key, diagnostic });
      }
      return Promise.resolve();
    },
    getOwnerModelPreference: (ownerId) => {
      state.ownerLookups.push(`model:${ownerId}`);
      return Promise.resolve(state.modelPreference);
    },
    getOwnerProviderKey: (ownerId) => {
      state.ownerLookups.push(`key:${ownerId}`);
      if (state.ownerKeyStatus === "missing" || state.apiKey === undefined) {
        return Promise.resolve({ status: "missing" });
      }
      if (state.ownerKeyStatus === "unreadable") return Promise.resolve({ status: "unreadable" });
      return Promise.resolve({ status: "ok", apiKey: state.apiKey });
    },
    getEnv: (name) => {
      if (name === "CUSTODIAN_MODEL_PRICING_JSON") return state.pricing;
      return undefined;
    },
    fetchProvider: (input, init = {}) => {
      state.fetches += 1;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== OPENAI_RESPONSES_URL) return Promise.reject(new Error("unexpected_url"));
      if (init.method !== "POST") return Promise.reject(new Error("unexpected_method"));
      if (!new Headers(init.headers).get("authorization")?.startsWith("Bearer ")) {
        return Promise.reject(new Error("missing_authorization"));
      }
      if (typeof init.body === "string") state.fetchBodies.push(init.body);
      return state.fetchImpl(url, init);
    },
    trustedRuntimeAvailable: () => state.trusted,
    now: () => state.now,
  };
}

async function advance(
  state: World,
  invocationKey = "invocation-1",
  gateOpen = true,
  timeoutMs?: number,
) {
  return advanceCustodianRun({
    io: ioFor(state),
    ownerId: "owner-1",
    invocation: { runId, invocationKey },
    providerExecutionUnsupported: gateOpen ? false : true,
    validSynthesis,
    providerAttemptTimeoutMs: timeoutMs,
  });
}

function denyBudget(state: World, reason: string) {
  state.budget = { ...state.budget, allowed: false, reason };
}

function heldReservation(state: World, inFlight = true): ReservationView {
  return {
    id: "reservation-1",
    status: "held",
    usageKnowledge: "unknown",
    holdTokens: 40,
    holdCostUsd: 0.02,
    actualTokens: null,
    actualCostUsd: null,
    pricingVersion: "2026-09-21",
    failureCode: null,
    inFlightUntil: new Date(state.now + (inFlight ? 30_000 : -1_000)).toISOString(),
    idempotencyKey: `provider-attempt:${runId}:synthesize`,
  };
}

function unreadableDetail(): string {
  return "The provider reservation could not be read. Provider contact and usage could not be established. This invocation made no new provider call.";
}

function claimsNoPriorProviderContact(value: unknown): boolean {
  const text = JSON.stringify(value).toLowerCase();
  return (
    text.includes("never contacted") ||
    text.includes("no provider call was made") ||
    text.includes("no provider usage was assumed")
  );
}

function echoedReservation(
  key: string,
  payload: Record<string, unknown>,
  patch: Partial<ReservationView> = {},
) {
  const reservation: ReservationView = {
    id: "reservation-1",
    status: "held",
    usageKnowledge: "unknown",
    holdTokens: payload.hold_tokens as number,
    holdCostUsd: payload.hold_cost_usd as number,
    actualTokens: null,
    actualCostUsd: null,
    pricingVersion: String(payload.pricing_version),
    failureCode: null,
    inFlightUntil: "2026-09-21T19:02:00.000Z",
    idempotencyKey: key,
    ...patch,
  };
  return {
    reserved: true,
    replay: false,
    reason: "reserved",
    reservation: reservationRow(reservation),
  };
}

function passingVerification(patch?: {
  step?: Partial<StepArtifact>;
  reservation?: Partial<ReservationView>;
  toolOperationClasses?: string[] | null;
  toolClassCounts?: VerificationArtifacts["toolClassCounts"];
  disallowedToolEventCount?: number;
}): VerificationArtifacts {
  const attemptKey = `provider-attempt:${runId}:synthesize`;
  return {
    steps: [
      {
        id: "retrieve",
        stepKind: "retrieve",
        status: "completed",
        idempotencyKey: retrievalStepKey(runId),
        output: { providerContact: false, evidenceCreated: false },
        tokensUsed: 0,
        costUsd: 0,
        pricingVersion: null,
      },
      {
        id: "synthesize",
        stepKind: "synthesize",
        status: "completed",
        idempotencyKey: attemptKey,
        output: synthesis([finding()]),
        tokensUsed: 12,
        costUsd: 0.001,
        pricingVersion: "2026-09-21",
        ...patch?.step,
      },
    ],
    reservation: {
      id: "reservation-1",
      status: "settled_known",
      usageKnowledge: "known",
      holdTokens: 20,
      holdCostUsd: 0.01,
      actualTokens: 12,
      actualCostUsd: 0.001,
      pricingVersion: "2026-09-21",
      failureCode: null,
      inFlightUntil: "2026-09-21T19:00:00.000Z",
      idempotencyKey: attemptKey,
      ...patch?.reservation,
    },
    findingCount: 1,
    approvalId: null,
    proposalId: null,
    toolOperationClasses:
      patch?.toolOperationClasses === undefined ? ["read_only"] : patch.toolOperationClasses,
    toolClassCounts: patch?.toolClassCounts === undefined ? null : patch.toolClassCounts,
    disallowedToolEventCount: patch?.disallowedToolEventCount ?? 0,
  };
}

function settledReservation(state: World): ReservationView {
  return {
    id: "reservation-1",
    status: "settled_known",
    usageKnowledge: "known",
    holdTokens: 40,
    holdCostUsd: 0.02,
    actualTokens: 1_250,
    actualCostUsd: 0.0024,
    pricingVersion: "2026-09-21",
    failureCode: null,
    inFlightUntil: new Date(state.now + 30_000).toISOString(),
    idempotencyKey: `provider-attempt:${runId}:synthesize`,
  };
}

function usage(body: { body: Record<string, unknown> }) {
  const run = body.body.run as { usage: Record<string, unknown> };
  return run.usage;
}

Deno.test("provider gate stays closed and performs no provider fetch", async () => {
  assertEquals(PROVIDER_EXECUTION_UNSUPPORTED, false);
  const state = world();
  state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const blocked = await advance(state, "invocation-1", false);
  assertEquals(state.fetches, 0);
  assertEquals(state.reserveCalls, 0);
  assertEquals(blocked.body.state, "blocked");
  assertEquals(blocked.body.reason, "provider_execution_unsupported");
  assertEquals(usage(blocked).costAccounting, "none");
  assertEquals(usage(blocked).costUsd, 0);
  assertEquals(JSON.stringify(blocked).includes(apiKey), false);
});

Deno.test("closed-gate first-run sequence never reserves or fetches", async () => {
  assertEquals(PROVIDER_EXECUTION_UNSUPPORTED, false);
  const state = world("queued");
  state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const queued = await advance(state, "first-run", false);
  assertEquals(queued.body.state, "advanced");
  assertEquals(state.run.status, "retrieving");
  const retrieving = await advance(state, "first-run", false);
  assertEquals(retrieving.body.state, "advanced");
  assertEquals(state.run.status, "synthesizing");
  assertEquals(state.steps[0]?.output?.providerContact, false);
  assertEquals(state.steps[0]?.output?.evidenceCreated, false);
  const synthesizing = await advance(state, "first-run", false);
  assertEquals(synthesizing.body.state, "blocked");
  assertEquals(synthesizing.body.reason, "provider_execution_unsupported");
  assertEquals(state.fetches, 0);
  assertEquals(state.reserveCalls, 0);
  assertEquals(state.reservation, null);
  assertEquals(state.materializeCalls, 0);
  assertEquals(usage(synthesizing).costAccounting, "none");
});

Deno.test("a closed-gate held reservation does not claim the provider was not called", async () => {
  assertEquals(PROVIDER_EXECUTION_UNSUPPORTED, false);
  const state = world("synthesizing");
  state.reservation = heldReservation(state);
  state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const held = await advance(state, "held-reservation", false);
  assertEquals(state.fetches, 0);
  assertEquals(held.body.state, "held");
  assertEquals(held.body.reason, "provider_execution_unsupported");
  assertEquals(claimsNoPriorProviderContact(held), false);
  assertEquals(JSON.stringify(held).includes("no provider call was made"), false);
  assertEquals(
    String(held.body.detail).includes("does not establish whether a provider was contacted"),
    true,
  );

  const released = world("synthesizing");
  released.reservation = {
    ...heldReservation(released),
    status: "released_uncontacted",
    usageKnowledge: "none",
  };
  const stopped = await advance(released, "released-reservation", false);
  assertEquals(stopped.body.state, "stopped");
  assertEquals(String(stopped.body.detail).includes("No provider call was made."), true);

  const settled = world("synthesizing");
  settled.reservation = settledReservation(settled);
  const replay = await advance(settled, "settled-reservation", false);
  assertEquals(replay.body.state, "replay");
  assertEquals(claimsNoPriorProviderContact(replay), false);
});

Deno.test("retrieval is provider-free and does not create evidence", async () => {
  const state = world("retrieving");
  state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const advanced = await advance(state);
  assertEquals(state.fetches, 0);
  assertEquals(state.reserveCalls, 0);
  assertEquals(state.evidenceWrites, 0);
  assertEquals(advanced.body.state, "advanced");
  assertEquals(state.run.status, "synthesizing");
  assertEquals(state.steps[0]?.stepKind, "retrieve");
  assertEquals(state.steps[0]?.output?.providerContact, false);
  assertEquals(state.steps[0]?.output?.evidenceCreated, false);
  assertEquals(
    providerFreeAdmissionSummary(state.run.input_snapshot).snapshotKind,
    "readonly_analysis_snapshot",
  );
});

Deno.test("reserve denial and closed preconditions do not fetch", async () => {
  for (const setup of [
    (state: World) => {
      state.pricing = undefined;
    },
    (state: World) => {
      state.pricing = "{";
    },
    (state: World) => {
      state.allowedTiers = ["luna"];
    },
    (state: World) => {
      state.policyError = true;
    },
    (state: World) => {
      state.reserveDenial = "aggregate_cost_ceiling_required";
    },
    (state: World) => {
      state.reserveDenial = "per_run_cost";
    },
    (state: World) => {
      state.reserveDenial = "daily_cost";
    },
  ]) {
    const state = world();
    setup(state);
    state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
    await advance(state);
    assertEquals(state.fetches, 0);
  }
});

Deno.test("a successful synthetic reservation performs exactly one provider fetch", async () => {
  const state = world();
  const result = await advance(state);
  assertEquals(state.fetches, 1);
  assertEquals(state.reserveCalls, 1);
  assertEquals(state.reservation?.status, "settled_known");
  assertEquals(state.reservation?.usageKnowledge, "known");
  assertEquals(typeof state.reservation?.actualCostUsd, "number");
  assertEquals(result.body.state, "advanced");
  assertEquals(state.run.status, "verifying");
  assertEquals(usage(result).costAccounting, "recorded");
  assertEquals(usage(result).costUsd, state.reservation?.actualCostUsd);
  assertEquals(usage(result).usageKnowledge, "known");
  assertEquals(usage(result).pricingVersion, "2026-09-21");
  assertEquals(usage(result).hold, null);
  assertEquals(JSON.stringify(result).includes(apiKey), false);
  assertEquals(JSON.stringify(result).includes("Bearer"), false);
});

Deno.test("duplicate and later invocation keys do not fetch again", async () => {
  const state = world();
  await advance(state, "invocation-1");
  await advance(state, "invocation-1");
  await advance(state, "invocation-2");
  assertEquals(state.fetches, 1);
  assertEquals(state.reserveCalls, 1);
});

Deno.test("held, expired, and released reservations do not fetch again", async () => {
  const held = world();
  held.reservation = {
    id: "reservation-1",
    status: "held",
    usageKnowledge: "unknown",
    holdTokens: 40,
    holdCostUsd: 0.02,
    actualTokens: null,
    actualCostUsd: null,
    pricingVersion: "2026-09-21",
    failureCode: null,
    inFlightUntil: new Date(held.now + 30_000).toISOString(),
    idempotencyKey: `provider-attempt:${runId}:synthesize`,
  };
  const inFlight = await advance(held);
  assertEquals(held.fetches, 0);
  assertEquals(inFlight.body.reason, "provider_attempt_in_progress");
  assertEquals(usage(inFlight).costAccounting, "unknown");
  assertEquals(usage(inFlight).costUsd, null);
  assertEquals(usage(inFlight).hold, { tokens: 40, costUsd: 0.02, status: "held" });

  const expired = world();
  expired.reservation = {
    ...held.reservation,
    inFlightUntil: new Date(expired.now - 1_000).toISOString(),
  };
  const unsettled = await advance(expired);
  assertEquals(expired.fetches, 0);
  assertEquals(unsettled.body.reason, "provider_hold_unsettled");
  assertEquals(expired.reservation?.status, "held");

  const released = world();
  released.reservation = {
    ...held.reservation,
    status: "released_uncontacted",
    usageKnowledge: "none",
  };
  await advance(released);
  assertEquals(released.fetches, 0);
  assertEquals(released.settlePayloads.length, 0);
});

Deno.test("timeout, upstream ambiguity, and missing usage keep an unknown hold", async () => {
  const timeout = world();
  timeout.fetchImpl = () =>
    Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  const timed = await advance(timeout);
  assertEquals(timeout.fetches, 1);
  assertEquals(timeout.reservation?.status, "held");
  assertEquals(timeout.reservation?.actualTokens, null);
  assertEquals(timeout.reservation?.actualCostUsd, null);
  assertEquals(timeout.settlePayloads[0]?.usage_knowledge, "unknown");
  assertEquals(usage(timed).costAccounting, "unknown");
  assertEquals(JSON.stringify(timed).includes("unpriced"), false);

  const network = world();
  network.fetchImpl = () => Promise.reject(new TypeError("network"));
  await advance(network);
  assertEquals(network.reservation?.usageKnowledge, "unknown");
  assertEquals(network.reservation?.actualCostUsd, null);

  const upstream = world();
  upstream.fetchImpl = () => Promise.resolve(new Response("nope", { status: 502 }));
  await advance(upstream);
  assertEquals(upstream.reservation?.status, "held");
  assertEquals(upstream.reservation?.actualTokens, null);

  const missing = world();
  missing.fetchImpl = () =>
    Promise.resolve(Response.json(providerResponse(synthesis([finding()]), null)));
  await advance(missing);
  assertEquals(missing.reservation?.usageKnowledge, "unknown");
  assertEquals(missing.materializeCalls, 0);
});

Deno.test("definite pre-contact cancellation releases the hold without a fetch", async () => {
  const state = world();
  state.cancelOnReserve = true;
  state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const cancelled = await advance(state);
  assertEquals(state.fetches, 0);
  assertEquals(state.reservation?.status, "released_uncontacted");
  assertEquals(state.reservation?.usageKnowledge, "none");
  assertEquals(state.settlePayloads[0]?.usage_knowledge, "none");
  assertEquals(cancelled.body.state, "stopped");
  assertEquals(state.run.status, "cancelled");
});

Deno.test("known invalid synthesis retains factual usage and does not materialize", async () => {
  const state = world();
  state.fetchImpl = () =>
    Promise.resolve(Response.json(providerResponse({ summary: "not a synthesis contract" })));
  const failed = await advance(state);
  assertEquals(state.fetches, 1);
  assertEquals(state.materializeCalls, 0);
  assertEquals(state.reservation?.status, "settled_known");
  assertEquals(state.reservation?.actualTokens, 1_250);
  assertEquals(usage(failed).costAccounting, "recorded");
  assertEquals(usage(failed).usageKnowledge, "known");
  assertEquals(typeof usage(failed).costUsd, "number");
  await advance(state, "invocation-2");
  assertEquals(state.fetches, 1);
});

Deno.test("provider refusal with usage is billed and does not become a Finding", async () => {
  const state = world();
  state.fetchImpl = () =>
    Promise.resolve(
      Response.json({
        status: "completed",
        output: [{ type: "message", role: "assistant", content: [{ type: "refusal" }] }],
        usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 },
      }),
    );
  await advance(state);
  assertEquals(state.materializeCalls, 0);
  assertEquals(state.reservation?.usageKnowledge, "known");
  assertEquals(state.steps.at(-1)?.output?.errorCode, "openai_refusal");
});

Deno.test("materialization failure keeps usage and retries do not fetch", async () => {
  const state = world();
  state.fetchImpl = () =>
    Promise.resolve(Response.json(providerResponse(synthesis([finding("finding")]))));
  state.materializeError = true;
  const failed = await advance(state);
  assertEquals(state.fetches, 1);
  assertEquals(state.reservation?.status, "settled_known");
  assertEquals(failed.body.reason, "finding_materialization_failed");
  assertEquals(state.evidenceWrites, 0);
  state.materializeError = false;
  state.transitionFailures = 0;
  await advance(state, "retry-after-materialization");
  assertEquals(state.fetches, 1);
});

Deno.test("a failed verifying transition does not cause a second provider fetch", async () => {
  const state = world();
  state.transitionFailures = 1;
  await advance(state).catch(() => undefined);
  assertEquals(state.fetches, 1);
  assertEquals(state.run.status, "synthesizing");
  const retried = await advance(state, "retry-transition");
  assertEquals(state.fetches, 1);
  assertEquals(retried.body.state, "advanced");
  assertEquals(state.run.status, "verifying");
});

Deno.test("valid no-finding, unresolved, attributable, and approval outcomes", async () => {
  const noFinding = world();
  noFinding.fetchImpl = () =>
    Promise.resolve(Response.json(providerResponse(synthesis([finding("no_finding")]))));
  await advance(noFinding);
  assertEquals(noFinding.materializeCalls, 1);
  assertEquals(noFinding.run.status, "verifying");

  const unresolved = world();
  unresolved.fetchImpl = () =>
    Promise.resolve(Response.json(providerResponse(synthesis([finding("unresolved")]))));
  await advance(unresolved);
  assertEquals(unresolved.materializeCalls, 1);
  assertEquals(unresolved.run.status, "verifying");

  const attributable = world();
  await advance(attributable);
  assertEquals(attributable.materializeCalls, 1);
  assertEquals(attributable.evidenceWrites, 0);

  const approval = world();
  approval.fetchImpl = () =>
    Promise.resolve(Response.json(providerResponse(synthesis([finding("no_finding")], true))));
  const paused = await advance(approval);
  assertEquals(paused.body.state, "paused");
  assertEquals(approval.approvals, 1);
  assertEquals(approval.run.status, "awaiting_approval");
});

Deno.test(
  "cancellation during contact keeps known usage and does not release the hold",
  async () => {
    const state = world();
    state.fetchImpl = () => {
      state.run.cancel_requested_at = new Date(state.now).toISOString();
      return Promise.resolve(Response.json(providerResponse(synthesis([finding()]))));
    };
    const cancelled = await advance(state);
    assertEquals(state.fetches, 1);
    assertEquals(state.reservation?.status, "settled_known");
    assertEquals(state.reservation?.usageKnowledge, "known");
    assertEquals(cancelled.body.state, "stopped");
    assertEquals(state.run.status, "cancelled");
    assertEquals(usage(cancelled).costAccounting, "recorded");
  },
);

Deno.test("verification records boundary checks and does not claim semantic correctness", () => {
  const run = baseRun("verifying");
  const checks = evaluateReadonlyVerification({
    run,
    artifacts: {
      steps: [
        {
          id: "retrieve",
          stepKind: "retrieve",
          status: "completed",
          idempotencyKey: retrievalStepKey(runId),
          output: { providerContact: false, evidenceCreated: false },
          tokensUsed: 0,
          costUsd: 0,
          pricingVersion: null,
        },
        {
          id: "synthesize",
          stepKind: "synthesize",
          status: "completed",
          idempotencyKey: `provider-attempt:${runId}:synthesize`,
          output: synthesis([finding()]),
          tokensUsed: 12,
          costUsd: 0.001,
          pricingVersion: "2026-09-21",
        },
      ],
      reservation: {
        id: "reservation-1",
        status: "settled_known",
        usageKnowledge: "known",
        holdTokens: 20,
        holdCostUsd: 0.01,
        actualTokens: 12,
        actualCostUsd: 0.001,
        pricingVersion: "2026-09-21",
        failureCode: null,
        inFlightUntil: "2026-09-21T19:00:00.000Z",
        idempotencyKey: `provider-attempt:${runId}:synthesize`,
      },
      findingCount: 1,
      approvalId: null,
      proposalId: null,
      toolOperationClasses: [],
      toolClassCounts: null,
      disallowedToolEventCount: 0,
    },
  });
  assertEquals(checks.ok, true);
  assertEquals(checks.checks.semantic_correctness, "not_claimed");
  assertEquals(checks.checks.canonical_mutation, false);
  assertEquals(checks.checks.external_execution, false);
  assertEquals(checks.checks.recorded_cost_usd, 0.001);

  const unknown = evaluateReadonlyVerification({
    run,
    artifacts: {
      steps: [
        {
          id: "retrieve",
          stepKind: "retrieve",
          status: "completed",
          idempotencyKey: retrievalStepKey(runId),
          output: { providerContact: false, evidenceCreated: false },
          tokensUsed: 0,
          costUsd: 0,
          pricingVersion: null,
        },
      ],
      reservation: {
        id: "reservation-1",
        status: "held",
        usageKnowledge: "unknown",
        holdTokens: 10,
        holdCostUsd: 0.01,
        actualTokens: null,
        actualCostUsd: null,
        pricingVersion: "2026-09-21",
        failureCode: "openai_timeout",
        inFlightUntil: "2026-09-21T19:00:00.000Z",
        idempotencyKey: "provider-attempt",
      },
      findingCount: 0,
      approvalId: null,
      proposalId: null,
      toolOperationClasses: [],
      toolClassCounts: null,
      disallowedToolEventCount: 0,
    },
  });
  assertEquals(unknown.ok, false);
  assertEquals(unknown.failureCode, "provider_usage_unknown");
});

Deno.test("public projection never labels recorded cost as unpriced", () => {
  const run = baseRun("failed");
  run.tokens_used = 1_250;
  run.cost_usd = 0.0024;
  const recorded = projectPublicRun(run, {
    usageKnowledge: "known",
    recordedTokens: 1_250,
    recordedCostUsd: 0.0024,
    heldTokens: null,
    heldCostUsd: null,
    pricingVersion: "2026-09-21",
    reservationId: "reservation-1",
    reservationStatus: "settled_known",
  });
  const usageRecord = recorded.usage as Record<string, unknown>;
  assertEquals(usageRecord.costUsd, 0.0024);
  assertEquals(usageRecord.costAccounting, "recorded");
  assertEquals(usageRecord.usageKnowledge, "known");
  assertEquals(JSON.stringify(recorded).includes("unpriced"), false);
  assertEquals(classifyModelPricing(undefined, "gpt-5.6-terra").status, "missing");
  assertEquals(classifyModelPricing("{", "gpt-5.6-terra").status, "malformed");
  assertEquals(
    classifySynthesisOutput({
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "refusal" }] }],
    }).kind,
    "refusal",
  );
});

Deno.test("latency and tool-event budget denials reserve nothing and fetch nothing", async () => {
  for (const reason of [
    "per_run_latency",
    "per_run_tool_events",
    "per_run_tokens",
    "per_run_cost",
    "daily_cost",
    "monthly_tokens",
  ]) {
    const state = world();
    denyBudget(state, reason);
    state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
    const stopped = await advance(state);
    assertEquals(state.reserveCalls, 0);
    assertEquals(state.fetches, 0);
    assertEquals(state.reservation, null);
    assertEquals(state.run.status, "budget_stopped");
    assertEquals(state.run.failure_code, reason);
    assertEquals(stopped.body.state, "stopped");
  }

  const policy = world();
  denyBudget(policy, "policy_unavailable");
  policy.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const blocked = await advance(policy);
  assertEquals(policy.reserveCalls, 0);
  assertEquals(policy.fetches, 0);
  assertEquals(policy.run.status, "blocked");
  assertEquals(policy.run.failure_code, "policy_unavailable");
  assertEquals(blocked.body.state, "stopped");
});

Deno.test(
  "an existing reservation survives a later budget denial without another fetch",
  async () => {
    const held = world();
    denyBudget(held, "per_run_latency");
    held.reservation = heldReservation(held, false);
    const replay = await advance(held);
    assertEquals(held.reserveCalls, 0);
    assertEquals(held.fetches, 0);
    assertEquals(held.reservation?.status, "held");
    assertEquals(usage(replay).usageKnowledge, "unknown");
    assertEquals(usage(replay).hold, { tokens: 40, costUsd: 0.02, status: "held" });
    assertEquals(replay.body.reason, "provider_hold_unsettled");

    const settled = world();
    denyBudget(settled, "per_run_tool_events");
    settled.reservation = settledReservation(settled);
    settled.steps.push({
      id: "step-known",
      stepKind: "synthesize",
      status: "completed",
      idempotencyKey: `provider-attempt:${runId}:synthesize`,
      output: synthesis([finding()]),
      tokensUsed: 1_250,
      costUsd: 0.0024,
      pricingVersion: "2026-09-21",
    });
    const continued = await advance(settled);
    assertEquals(settled.reserveCalls, 0);
    assertEquals(settled.fetches, 0);
    assertEquals(settled.materializeCalls, 1);
    assertEquals(settled.run.status, "verifying");
    assertEquals(usage(continued).usageKnowledge, "known");
    assertEquals(usage(continued).costUsd, 0.0024);
    assertEquals(usage(continued).pricingVersion, "2026-09-21");
    assertEquals(usage(continued).hold, null);
  },
);

Deno.test("terminal and paused reads keep the provider reservation accounting", async () => {
  const unknown = world();
  unknown.fetchImpl = () =>
    Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  const failed = await advance(unknown);
  assertEquals(unknown.run.status, "failed");
  assertEquals(unknown.reservation?.status, "held");
  const heldBudget = usage(failed).hold;
  const replay = await advance(unknown, "invocation-2");
  assertEquals(unknown.fetches, 1);
  assertEquals(usage(replay).usageKnowledge, "unknown");
  assertEquals(usage(replay).hold, heldBudget);
  assertEquals(usage(replay).costAccounting, "unknown");

  const known = world("completed");
  known.reservation = settledReservation(known);
  const terminal = await advance(known);
  assertEquals(known.fetches, 0);
  assertEquals(terminal.body.state, "terminal");
  assertEquals(usage(terminal).usageKnowledge, "known");
  assertEquals(usage(terminal).costUsd, 0.0024);
  assertEquals(usage(terminal).pricingVersion, "2026-09-21");

  const paused = world("awaiting_approval");
  paused.reservation = settledReservation(paused);
  const approval = await advance(paused);
  assertEquals(paused.fetches, 0);
  assertEquals(approval.body.state, "paused");
  assertEquals(usage(approval).usageKnowledge, "known");
  assertEquals(usage(approval).pricingVersion, "2026-09-21");

  const legacy = world("cancelled");
  const empty = await advance(legacy);
  assertEquals(legacy.fetches, 0);
  assertEquals(legacy.reservation, null);
  assertEquals(usage(empty).usageKnowledge, "none");
  assertEquals(usage(empty).hold, null);

  const unreadable = world("failed");
  unreadable.reservationReadError = true;
  unreadable.reservation = heldReservation(unreadable);
  const unavailable = await advance(unreadable);
  assertEquals(unavailable.status, 503);
  assertEquals(unavailable.body.reason, "provider_reservation_unreadable");
  assertEquals(unavailable.body.detail, unreadableDetail());
  assertEquals(claimsNoPriorProviderContact(unavailable), false);
  assertEquals(JSON.stringify(unavailable).includes('"usageKnowledge":"none"'), false);
  assertEquals(unreadable.fetches, 0);
});

Deno.test("a stalled response body after headers remains an unknown hold", async () => {
  const state = world();
  state.fetchImpl = (_url, init) => {
    const body = new ReadableStream({
      start(controller) {
        const abort = () =>
          controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort, { once: true });
      },
    });
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    );
  };
  const timed = await Promise.race([
    advance(state, "invocation-1", true, 30),
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error("provider timeout did not cover the response body")),
        1_000,
      );
    }),
  ]);
  assertEquals(state.fetches, 1);
  assertEquals(state.reservation?.status, "held");
  assertEquals(state.reservation?.usageKnowledge, "unknown");
  assertEquals(state.reservation?.actualTokens, null);
  assertEquals(state.reservation?.actualCostUsd, null);
  assertEquals(state.settlePayloads[0]?.usage_knowledge, "unknown");
  assertEquals(
    state.settlePayloads.some((item) => item.usage_knowledge === "none"),
    false,
  );
  assertEquals(usage(timed).usageKnowledge, "unknown");
  assertEquals((usage(timed).hold as { status: string }).status, "held");
  const replay = await advance(state, "invocation-2");
  assertEquals(state.fetches, 1);
  assertEquals(usage(replay).usageKnowledge, "unknown");
  assertEquals(usage(replay).hold, usage(timed).hold);
});

Deno.test("remaining latency blocks contact and caps the provider timeout", async () => {
  assertEquals(boundedProviderTimeoutMs(0), 0);
  assertEquals(boundedProviderTimeoutMs(-5, 30_000), 0);
  assertEquals(boundedProviderTimeoutMs(Number.NaN, 30), 0);
  assertEquals(boundedProviderTimeoutMs(20), 20);
  assertEquals(boundedProviderTimeoutMs(20, 30), 20);
  assertEquals(boundedProviderTimeoutMs(60_000), PROVIDER_ATTEMPT_TIMEOUT_MS);
  assertEquals(boundedProviderTimeoutMs(60_000, 30_000), PROVIDER_ATTEMPT_TIMEOUT_MS);
  assertEquals(boundedProviderTimeoutMs(60_000, 30), 30);

  const exhausted = world();
  exhausted.budget.run_latency_remaining = 0;
  exhausted.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const stopped = await advance(exhausted, "invocation-1", true, 30_000);
  assertEquals(exhausted.reserveCalls, 0);
  assertEquals(exhausted.fetches, 0);
  assertEquals(exhausted.run.status, "budget_stopped");
  assertEquals(exhausted.run.failure_code, "per_run_latency");
  assertEquals(stopped.body.state, "stopped");

  const tight = world();
  tight.budget.run_latency_remaining = 20;
  tight.fetchImpl = (_url, init) => {
    const body = new ReadableStream({
      start(controller) {
        const abort = () =>
          controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort, { once: true });
      },
    });
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    );
  };
  const timed = await Promise.race([
    advance(tight),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("20ms latency budget was not enforced")), 1_000);
    }),
  ]);
  assertEquals(tight.fetches, 1);
  assertEquals(tight.reserveCalls, 1);
  assertEquals(tight.reservation?.usageKnowledge, "unknown");
  assertEquals(usage(timed).usageKnowledge, "unknown");
  assertEquals(boundedProviderTimeoutMs(tight.budget.run_latency_remaining) <= 20, true);
});

Deno.test("a remaining output budget below 16 stops before reserve", async () => {
  for (const remaining of [1, 15]) {
    const state = world();
    state.budget.run_tokens_remaining = remaining;
    state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
    const stopped = await advance(state);
    assertEquals(state.reserveCalls, 0);
    assertEquals(state.fetches, 0);
    assertEquals(state.reservation, null);
    assertEquals(state.run.status, "budget_stopped");
    assertEquals(state.run.failure_code, "per_run_tokens");
    assertEquals(stopped.body.state, "stopped");
  }
});

Deno.test("a legal remaining output budget is sent unchanged", async () => {
  for (const remaining of [16, 4074, 4096]) {
    const state = world();
    state.budget.run_tokens_remaining = remaining;
    let sent: number | undefined;
    state.fetchImpl = (_url, init) => {
      const request = JSON.parse((init as { body?: string }).body ?? "{}") as {
        max_output_tokens?: number;
      };
      sent = request.max_output_tokens;
      return Promise.resolve(Response.json(providerResponse(synthesis([finding()]))));
    };
    await advance(state);
    assertEquals(sent, remaining);
    assertEquals(state.fetches, 1);
  }

  const capped = world();
  capped.budget.run_tokens_remaining = 4097;
  let cappedSent: number | undefined;
  capped.fetchImpl = (_url, init) => {
    const request = JSON.parse((init as { body?: string }).body ?? "{}") as {
      max_output_tokens?: number;
    };
    cappedSent = request.max_output_tokens;
    return Promise.resolve(Response.json(providerResponse(synthesis([finding()]))));
  };
  await advance(capped);
  assertEquals(cappedSent, 4096);
  assertEquals(capped.fetches, 1);
});

Deno.test("a successful reserve must identify the expected hold before fetch", async () => {
  const cases: Array<{
    response: unknown | ((key: string, payload: Record<string, unknown>) => unknown);
    reason: string;
  }> = [
    {
      response: { reserved: true, reason: "reserved", reservation: null },
      reason: "provider_reservation_mismatch",
    },
    {
      response: { reserved: true, reservation: null },
      reason: "provider_reservation_unreadable",
    },
    {
      response: (key: string, payload: Record<string, unknown>) =>
        echoedReservation(key, payload, { idempotencyKey: "other" }),
      reason: "provider_reservation_mismatch",
    },
    {
      response: (key: string, payload: Record<string, unknown>) =>
        echoedReservation(key, payload, { pricingVersion: "other" }),
      reason: "provider_reservation_mismatch",
    },
    {
      response: (key: string, payload: Record<string, unknown>) =>
        echoedReservation(key, payload, { holdTokens: (payload.hold_tokens as number) + 1 }),
      reason: "provider_reservation_mismatch",
    },
    {
      response: (key: string, payload: Record<string, unknown>) =>
        echoedReservation(key, payload, { holdCostUsd: (payload.hold_cost_usd as number) + 1 }),
      reason: "provider_reservation_mismatch",
    },
    {
      response: (key: string, payload: Record<string, unknown>) =>
        echoedReservation(key, payload, { status: "settled_known" }),
      reason: "provider_reservation_mismatch",
    },
    {
      response: (key: string, payload: Record<string, unknown>) =>
        echoedReservation(key, payload, { usageKnowledge: "known" }),
      reason: "provider_reservation_mismatch",
    },
  ];
  for (const item of cases) {
    const state = world();
    state.reserveResponse = item.response;
    state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
    const result = await advance(state);
    assertEquals(state.fetches, 0);
    assertEquals(state.reserveCalls, 1);
    assertEquals(result.status, 503);
    assertEquals(result.body.state, "unavailable");
    assertEquals(result.body.reason, item.reason);
    assertEquals(result.body.detail, unreadableDetail());
    assertEquals(claimsNoPriorProviderContact(result), false);
    assertEquals(JSON.stringify(result).includes("usageKnowledge"), false);
  }
});

Deno.test("verification fails for every non-read-only tool class", () => {
  const run = baseRun("verifying");
  for (const operation of [
    "evidence_write",
    "archive_change",
    "canonical_write",
    "external_write",
  ]) {
    const violated = evaluateReadonlyVerification({
      run,
      artifacts: passingVerification({ toolOperationClasses: [operation] }),
    });
    assertEquals(violated.ok, false);
    assertEquals(violated.failureCode, "verification_boundary_violated");
  }
  const readOnly = evaluateReadonlyVerification({ run, artifacts: passingVerification() });
  assertEquals(readOnly.ok, true);
  assertEquals(readOnly.checks.mutating_tool_event, false);

  const sampledAway = evaluateReadonlyVerification({
    run,
    artifacts: passingVerification({
      toolOperationClasses: Array.from({ length: 50 }, () => "read_only"),
      disallowedToolEventCount: 51,
    }),
  });
  assertEquals(sampledAway.ok, false);
  assertEquals(sampledAway.failureCode, "verification_boundary_violated");

  const tail = evaluateReadonlyVerification({
    run,
    artifacts: passingVerification({
      toolOperationClasses: [...Array.from({ length: 50 }, () => "read_only"), "evidence_write"],
    }),
  });
  assertEquals(tail.ok, false);
  assertEquals(tail.failureCode, "verification_boundary_violated");
});

Deno.test("disallowed tool count is exact and does not use a row limit", async () => {
  let sawLimit = false;
  const client = {
    from(table: string) {
      assertEquals(table, "tool_events");
      return {
        select(columns: string, options: { count: string; head: boolean }) {
          assertEquals(columns, "id");
          assertEquals(options.count, "exact");
          assertEquals(options.head, true);
          return {
            eq(column: string, value: string) {
              assertEquals(column, "run_id");
              assertEquals(value, runId);
              return {
                neq(columnName: string, operationClass: string) {
                  assertEquals(columnName, "operation_class");
                  assertEquals(operationClass, "read_only");
                  return Promise.resolve({ count: 51, error: null });
                },
                limit() {
                  sawLimit = true;
                  return Promise.resolve({ count: 0, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  const count = await countDisallowedToolEvents(
    client as unknown as DisallowedToolEventCounter,
    runId,
  );
  assertEquals(count, 51);
  assertEquals(sawLimit, false);

  const unreadable = await countDisallowedToolEvents(
    {
      from: () => ({
        select: () => ({
          eq: () => ({
            neq: () => Promise.resolve({ count: null, error: { message: "unavailable" } }),
          }),
        }),
      }),
    } as unknown as DisallowedToolEventCounter,
    runId,
  );
  assertEquals(unreadable, null);
});

Deno.test("verification rejects synthesis and reservation identity mismatches", () => {
  const run = baseRun("verifying");
  const cases: Array<{ patch: Parameters<typeof passingVerification>[0]; code: string }> = [
    {
      patch: { step: { idempotencyKey: "synthesize" } },
      code: "synthesis_identity_mismatch",
    },
    {
      patch: { step: { pricingVersion: "other" } },
      code: "synthesis_pricing_mismatch",
    },
    {
      patch: { step: { tokensUsed: 11 } },
      code: "synthesis_token_mismatch",
    },
    {
      patch: { step: { costUsd: 0.002 } },
      code: "synthesis_cost_mismatch",
    },
    {
      patch: { reservation: { holdTokens: 10, holdCostUsd: 0.0001 } },
      code: "provider_hold_exceeded",
    },
  ];
  for (const item of cases) {
    const result = evaluateReadonlyVerification({
      run,
      artifacts: passingVerification(item.patch),
    });
    assertEquals(result.ok, false);
    assertEquals(result.failureCode, item.code);
  }
  const exceeded = evaluateReadonlyVerification({
    run,
    artifacts: passingVerification({ reservation: { holdTokens: 10 } }),
  });
  assertEquals(exceeded.ok, false);
  assertEquals(exceeded.failureCode, "provider_hold_exceeded");
  assertEquals(exceeded.checks.recorded_tokens, 12);
  assertEquals(exceeded.checks.recorded_cost_usd, 0.001);
});

Deno.test("verification artifact failure preserves settled provider accounting", async () => {
  const state = world("verifying");
  state.verificationUnavailable = true;
  state.reservation = settledReservation(state);
  state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const failed = await advance(state);
  assertEquals(state.fetches, 0);
  assertEquals(state.reserveCalls, 0);
  assertEquals(failed.body.state, "failed");
  assertEquals(state.run.failure_code, "verification_artifacts_unavailable");
  assertEquals(usage(failed).usageKnowledge, "known");
  assertEquals(usage(failed).costUsd, 0.0024);
  assertEquals(usage(failed).pricingVersion, "2026-09-21");

  const unreadable = world("verifying");
  unreadable.verificationUnavailable = true;
  unreadable.reservationReadError = true;
  unreadable.reservation = settledReservation(unreadable);
  const unavailable = await advance(unreadable);
  assertEquals(unavailable.status, 503);
  assertEquals(unavailable.body.reason, "provider_reservation_unreadable");
  assertEquals(unavailable.body.detail, unreadableDetail());
  assertEquals(claimsNoPriorProviderContact(unavailable), false);
  assertEquals(JSON.stringify(unavailable).includes("usageKnowledge"), false);
  assertEquals(unreadable.fetches, 0);
  assertEquals(unreadable.run.status, "verifying");
});

function seedSettledApproval(state: World) {
  state.reservation = settledReservation(state);
  state.steps.push({
    id: "step-known",
    stepKind: "synthesize",
    status: "completed",
    idempotencyKey: `provider-attempt:${runId}:synthesize`,
    output: synthesis([finding("no_finding")], true),
    tokensUsed: 1_250,
    costUsd: 0.0024,
    pricingVersion: "2026-09-21",
  });
  state.run.last_step_number = 2;
}

Deno.test("concurrent approval replays share one stable gate", async () => {
  const state = world();
  seedSettledApproval(state);
  let release: (() => void) | undefined;
  state.holdApprovals = new Promise((resolve) => {
    release = resolve;
  });
  state.releaseApprovals = () => release?.();
  const [first, second] = await Promise.race([
    Promise.all([advance(state, "invocation-a"), advance(state, "invocation-b")]),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("approval replays did not meet")), 1_000);
    }),
  ]);
  assertEquals(state.fetches, 0);
  assertEquals(state.reserveCalls, 0);
  assertEquals(state.approvals, 1);
  assertEquals(state.approvalAttempts, 2);
  assertEquals(state.materializeCalls, 1);
  assertEquals(state.run.status, "awaiting_approval");
  assertEquals(first.body.state, "paused");
  assertEquals(second.body.state, "paused");
  assertEquals((first.body.run as { status: string }).status, "awaiting_approval");
  assertEquals((second.body.run as { status: string }).status, "awaiting_approval");
  assertEquals(JSON.stringify(first).includes("synthesizing"), false);
  assertEquals(JSON.stringify(second).includes("synthesizing"), false);
  assertEquals(first.body.approval, second.body.approval);
  assertEquals(
    state.approvalRecords.map((record) => record.key),
    [approvalIdempotencyKey(runId)],
  );
  assertEquals(approvalIdempotencyKey(runId).includes("invocation"), false);

  const replay = await advance(state, "invocation-c");
  assertEquals(state.approvals, 1);
  assertEquals(state.approvalAttempts, 2);
  assertEquals(state.fetches, 0);
  assertEquals(replay.body.state, "paused");

  const otherRunId = "223e4567-e89b-12d3-a456-426614174999";
  state.holdApprovals = null;
  const other = await ioFor(state).createApproval(
    { ...state.run, id: otherRunId },
    synthesis([finding("no_finding")], true),
  );
  assertEquals(state.approvals, 2);
  assertEquals(other.approval.id === (first.body.approval as { id: string }).id, false);
  assertEquals(approvalIdempotencyKey(otherRunId) === approvalIdempotencyKey(runId), false);
  assertEquals(
    state.approvalRecords.map((record) => record.key),
    [approvalIdempotencyKey(runId), approvalIdempotencyKey(otherRunId)],
  );
});

Deno.test("an unconfirmed approval replay does not invent awaiting_approval", async () => {
  const inconsistent = world();
  seedSettledApproval(inconsistent);
  inconsistent.approvalRecords.push({
    key: approvalIdempotencyKey(runId),
    approval: {
      id: "approval-1",
      status: "pending",
      approvalKind: "tool_action",
      exactActionHash: "abc",
    },
  });
  inconsistent.approvals = 1;
  const stale = await advance(inconsistent, "invocation-replay");
  assertEquals(inconsistent.fetches, 0);
  assertEquals(inconsistent.approvals, 1);
  assertEquals(inconsistent.run.status, "synthesizing");
  assertSettledApprovalUnconfirmed(stale);

  const unreadable = world();
  seedSettledApproval(unreadable);
  unreadable.approvalRecords.push({
    key: approvalIdempotencyKey(runId),
    approval: {
      id: "approval-1",
      status: "pending",
      approvalKind: "tool_action",
      exactActionHash: "abc",
    },
  });
  unreadable.approvals = 1;
  unreadable.failApprovalRunReread = true;
  const hidden = await advance(unreadable, "invocation-unreadable");
  assertEquals(unreadable.fetches, 0);
  assertEquals(unreadable.approvals, 1);
  assertEquals(unreadable.run.status, "synthesizing");
  assertSettledApprovalUnconfirmed(hidden);
});

function assertSettledApprovalUnconfirmed(result: {
  status: number;
  body: Record<string, unknown>;
}) {
  assertEquals(result.status, 503);
  assertEquals(result.body.state, "unavailable");
  assertEquals(result.body.reason, "approval_run_unconfirmed");
  assertEquals(JSON.stringify(result).includes("awaiting_approval"), false);
  assertEquals((result.body.run as { status: string }).status, "synthesizing");
  const recorded = usage(result);
  assertEquals(recorded.usageKnowledge, "known");
  assertEquals(recorded.tokens, 1_250);
  assertEquals(recorded.costUsd, 0.0024);
  assertEquals(recorded.pricingVersion, "2026-09-21");
  assertEquals(recorded.hold, null);
  assertEquals(recorded.costAccounting, "recorded");
}

Deno.test("verification binds the stable provider-free retrieval step", () => {
  const run = baseRun("verifying");
  const benign: StepArtifact = {
    id: "retrieve-stable",
    stepKind: "retrieve",
    status: "completed",
    idempotencyKey: retrievalStepKey(runId),
    output: { providerContact: false, evidenceCreated: false },
    tokensUsed: 0,
    costUsd: 0,
    pricingVersion: null,
  };
  const synthesize = passingVerification().steps[1];
  const evaluate = (steps: StepArtifact[]) =>
    evaluateReadonlyVerification({
      run,
      artifacts: { ...passingVerification(), steps: [...steps, synthesize] },
    });
  const recorded = evaluate([benign]);
  assertEquals(recorded.ok, true);
  assertEquals(recorded.checks.retrieve_idempotency_key, retrievalStepKey(runId));

  const wrong = evaluate([{ ...benign, idempotencyKey: "retrieve" }]);
  assertEquals(wrong.ok, false);
  assertEquals(wrong.failureCode, "retrieval_not_recorded");

  const contacted = evaluate([
    benign,
    {
      ...benign,
      id: "retrieve-other",
      idempotencyKey: "other-retrieve",
      output: { providerContact: true, evidenceCreated: false },
    },
  ]);
  assertEquals(contacted.ok, false);
  assertEquals(contacted.failureCode, "retrieval_provider_contact");
  assertEquals(contacted.checks.retrieve_provider_contact, true);

  const created = evaluate([
    benign,
    {
      ...benign,
      id: "retrieve-evidence",
      idempotencyKey: "evidence-retrieve",
      output: { providerContact: false, evidenceCreated: true },
    },
  ]);
  assertEquals(created.ok, false);
  assertEquals(created.failureCode, "evidence_creation_unexpected");
  assertEquals(created.checks.evidence_created, true);
});

Deno.test("unexplained mutation does not record every subtype as false", () => {
  const run = baseRun("verifying");
  for (const toolOperationClasses of [null, [] as string[]]) {
    const result = evaluateReadonlyVerification({
      run,
      artifacts: passingVerification({
        toolOperationClasses,
        disallowedToolEventCount: 3,
      }),
    });
    assertEquals(result.ok, false);
    assertEquals(result.failureCode, "verification_boundary_violated");
    assertEquals(result.checks.mutating_tool_event, true);
    const subtypes = [
      result.checks.canonical_mutation,
      result.checks.evidence_write,
      result.checks.archive_change,
      result.checks.external_execution,
      result.checks.other_disallowed_operation,
    ];
    assertEquals(
      subtypes.every((value) => value === false),
      false,
    );
  }

  const counted = evaluateReadonlyVerification({
    run,
    artifacts: passingVerification({
      toolOperationClasses: null,
      toolClassCounts: {
        evidence_write: 2,
        canonical_write: 0,
        archive_change: 0,
        external_write: 0,
      },
      disallowedToolEventCount: 2,
    }),
  });
  assertEquals(counted.ok, false);
  assertEquals(counted.checks.evidence_write, true);
  assertEquals(counted.checks.canonical_mutation, false);
  assertEquals(counted.checks.other_disallowed_operation, false);
});

Deno.test("mocked readonly races keep one attempt, one fetch, and one outcome", async () => {
  // The source gate is open; all provider effects below remain mocked.
  assertEquals(PROVIDER_EXECUTION_UNSUPPORTED, false);
  const attemptKey = providerAttemptKey(runId);

  const findingRace = world();
  const findingIo = racingIo(findingRace);
  const findingResults = await Promise.all([
    advanceOpen(findingRace, "invocation-a", findingIo.io),
    advanceOpen(findingRace, "invocation-b", findingIo.io),
  ]);
  const loser = findingResults.find((result) => result.body.state === "held");
  check("two attempts share one reservation", findingRace.reserveCalls, 2);
  check("one fetch", findingRace.fetches <= 1 && findingRace.fetches === 1, true);
  check("loser is a replay", findingIo.replays, 1);
  check("loser does not win a second hold", loser?.body.state, "held");
  check("one known settlement", findingRace.settlePayloads.length, 1);
  check(
    "one synthesis step",
    findingRace.steps.filter((step) => step.stepKind === "synthesize").length,
    1,
  );
  check("one finding materialization", findingRace.materializeCalls, 1);
  check("attempt key stays server owned", findingRace.reservation?.idempotencyKey, attemptKey);
  check("no second approval on the finding path", findingRace.approvals, 0);

  const approvalRace = world();
  approvalRace.fetchImpl = () =>
    Promise.resolve(Response.json(providerResponse(synthesis([finding()], true))));
  const approvalIo = racingIo(approvalRace);
  await Promise.all([
    advanceOpen(approvalRace, "approval-a", approvalIo.io),
    advanceOpen(approvalRace, "approval-b", approvalIo.io),
  ]);
  check("approval race fetches once", approvalRace.fetches, 1);
  check("one approval identity", approvalRace.approvals, 1);
  check("approval records share the server key", approvalRace.approvalRecords.length, 1);
  check(
    "approval key is the server attempt",
    approvalRace.approvalRecords[0]?.key,
    approvalIdempotencyKey(runId),
  );
  check("approval race materializes once", approvalRace.materializeCalls, 1);
  check("approval race settles once", approvalRace.settlePayloads.length, 1);

  const settled = world();
  settled.reservation = settledReservation(settled);
  settled.steps.push({
    id: "step-known",
    stepKind: "synthesize",
    status: "completed",
    idempotencyKey: attemptKey,
    output: synthesis([finding()]),
    tokensUsed: 1_250,
    costUsd: 0.0024,
    pricingVersion: "2026-09-21",
  });
  settled.materializedStepIds.push("step-known");
  settled.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  await advance(settled, "settled-replay");
  check("settled known does not fetch", settled.fetches, 0);
  check("settled known does not charge again", settled.settlePayloads.length, 0);

  const inFlight = world();
  inFlight.reservation = heldReservation(inFlight, true);
  inFlight.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const inFlightResult = await advance(inFlight, "held-inflight");
  check("in-flight unknown hold does not fetch", inFlight.fetches, 0);
  check("in-flight hold stays held", inFlight.reservation?.status, "held");
  check("in-flight reason", inFlightResult.body.reason, "provider_attempt_in_progress");

  const expired = world();
  expired.reservation = heldReservation(expired, false);
  expired.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const expiredResult = await advance(expired, "held-expired");
  check("expired unknown hold does not fetch", expired.fetches, 0);
  check("expired hold stays held", expired.reservation?.status, "held");
  check("expired hold reason", expiredResult.body.reason, "provider_hold_unsettled");

  const released = world();
  released.reservation = {
    ...heldReservation(released, false),
    status: "released_uncontacted",
    usageKnowledge: "none",
  };
  released.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  await advance(released, "released");
  check("released uncontacted does not fetch", released.fetches, 0);
  check("released uncontacted does not bill", released.settlePayloads.length, 0);
  check("released uncontacted keeps null actuals", released.reservation?.actualCostUsd, null);

  const beforeContact = world();
  beforeContact.run.cancel_requested_at = new Date(beforeContact.now).toISOString();
  beforeContact.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const before = await advance(beforeContact, "cancel-before");
  check("cancel before contact does not reserve", beforeContact.reserveCalls, 0);
  check("cancel before contact does not fetch", beforeContact.fetches, 0);
  check("cancel before contact stops", before.body.state, "stopped");
  check("cancel before contact is cancelled", beforeContact.run.status, "cancelled");

  const aroundReserve = world();
  aroundReserve.cancelOnReserve = true;
  aroundReserve.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const around = await advance(aroundReserve, "cancel-around-reserve");
  check("cancel after reserve does not fetch", aroundReserve.fetches, 0);
  check(
    "cancel after reserve releases uncontacted",
    aroundReserve.reservation?.status,
    "released_uncontacted",
  );
  check("cancel after reserve stops", around.body.state, "stopped");

  const duringContact = world();
  duringContact.reservation = heldReservation(duringContact, true);
  duringContact.run.cancel_requested_at = new Date(duringContact.now).toISOString();
  duringContact.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const during = await advance(duringContact, "cancel-during-hold");
  check("cancel around possible contact does not fetch", duringContact.fetches, 0);
  check("cancel around possible contact keeps the hold", duringContact.reservation?.status, "held");
  check("cancel around possible contact does not settle", duringContact.settlePayloads.length, 0);
  check("cancel around possible contact stays unresolved", during.body.state, "held");
  check(
    "cancel around possible contact does not claim a clean pre-contact release",
    JSON.stringify(during).includes("The hold was released"),
    false,
  );
});

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function advanceOpen(state: World, invocationKey: string, io: CustodianIo) {
  return advanceCustodianRun({
    io,
    ownerId: "owner-1",
    invocation: { runId: state.run.id, invocationKey },
    providerExecutionUnsupported: false,
    validSynthesis,
  });
}

const CONTACT_HOLD_MESSAGE =
  "Provider contact occurred, but reliable usage was not available. The hold remains.";
const LEAKED_PROVIDER_MESSAGE = `Authorization: Bearer ${apiKey} prompt ${baseRun().objective} evidence admitted_records`;

function providerErrorResponse(status: number, body: unknown, json = true): Response {
  return new Response(json ? JSON.stringify(body) : String(body), {
    status,
    headers: { "content-type": json ? "application/json" : "text/plain" },
  });
}

function assertNoProviderLeak(value: unknown): void {
  const text = JSON.stringify(value);
  if (text.includes(apiKey)) throw new Error("provider metadata leaked the API key");
  if (text.includes("Authorization")) throw new Error("provider metadata leaked Authorization");
  if (text.includes("Bearer")) throw new Error("provider metadata leaked Bearer");
  if (text.includes(baseRun().objective)) throw new Error("provider metadata leaked the prompt");
  if (text.includes("admitted_records")) throw new Error("provider metadata leaked evidence");
  if (text.includes(LEAKED_PROVIDER_MESSAGE)) throw new Error("provider metadata leaked the body");
}

function assertUnknownContactHold(state: World, code: string): void {
  const attemptKey = providerAttemptKey(runId);
  assertEquals(state.fetches, 1);
  assertEquals(state.reservation?.status, "held");
  assertEquals(state.reservation?.usageKnowledge, "unknown");
  assertEquals(state.reservation?.actualTokens, null);
  assertEquals(state.reservation?.actualCostUsd, null);
  assertEquals(state.reservation?.idempotencyKey, attemptKey);
  assertEquals(state.settlePayloads.length, 1);
  const settlement = state.settlePayloads[0] ?? {};
  assertEquals(settlement.usage_knowledge, "unknown");
  assertEquals(settlement.failure_code, code);
  assertEquals(Object.hasOwn(settlement, "actual_tokens"), false);
  assertEquals(Object.hasOwn(settlement, "actual_cost_usd"), false);
  assertEquals(
    state.settlePayloads.some((item) => item.usage_knowledge === "none"),
    false,
  );
  assertEquals(state.run.failure_code, code);
  assertEquals(state.run.status, "failed");
  assertEquals(state.steps.at(-1)?.idempotencyKey, attemptKey);
  assertEquals(state.steps.at(-1)?.output?.errorCode, code);
  assertNoProviderLeak(settlement);
  assertNoProviderLeak(state.steps.at(-1)?.output);
  assertNoProviderLeak(state.run.failure_message);
}

Deno.test("provider HTTP failures keep distinct codes and an unknown hold", async () => {
  const poisoned = {
    error: {
      message: LEAKED_PROVIDER_MESSAGE,
      type: "invalid_request_error",
      code: "invalid_api_key",
      param: "text.format.schema",
    },
  };
  const cases: Array<{
    name: string;
    code: string;
    response?: Response;
    reject?: () => Promise<Response>;
    message?: string;
  }> = [
    {
      name: "401 JSON",
      code: "openai_authentication_failed",
      response: providerErrorResponse(401, poisoned),
    },
    {
      name: "401 non-JSON",
      code: "openai_authentication_failed",
      response: providerErrorResponse(401, LEAKED_PROVIDER_MESSAGE, false),
    },
    {
      name: "403 ordinary permission denial",
      code: "openai_permission_denied",
      response: providerErrorResponse(403, poisoned),
    },
    {
      name: "403 insufficient_quota",
      code: "openai_quota_exceeded",
      response: providerErrorResponse(403, {
        error: { ...poisoned.error, type: "insufficient_quota", code: "insufficient_quota" },
      }),
    },
    {
      name: "403 project spend limit",
      code: "openai_quota_exceeded",
      response: providerErrorResponse(403, {
        error: {
          ...poisoned.error,
          type: "invalid_request_error",
          code: "project_spend_limit_exceeded",
        },
      }),
    },
    {
      name: "403 other allowlisted spend code",
      code: "openai_quota_exceeded",
      response: providerErrorResponse(403, {
        error: {
          ...poisoned.error,
          type: "invalid_request_error",
          code: "organization_spend_limit_exceeded",
        },
      }),
    },
    {
      name: "400 structured invalid request",
      code: "openai_request_rejected",
      response: providerErrorResponse(400, {
        error: { ...poisoned.error, type: "invalid_request_error", code: "invalid_json_schema" },
      }),
    },
    {
      name: "404 model not found",
      code: "openai_model_unavailable",
      response: providerErrorResponse(404, {
        error: { ...poisoned.error, code: "model_not_found" },
      }),
    },
    {
      name: "400 model not found",
      code: "openai_model_unavailable",
      response: providerErrorResponse(400, {
        error: { ...poisoned.error, code: "model_not_found" },
      }),
    },
    {
      name: "429 rate limit",
      code: "openai_rate_limited",
      response: providerErrorResponse(429, {
        error: { ...poisoned.error, type: "rate_limit_error", code: "rate_limit_exceeded" },
      }),
    },
    {
      name: "429 slow down",
      code: "openai_rate_limited",
      response: providerErrorResponse(429, {
        error: { ...poisoned.error, type: "rate_limit_error", code: "slow_down" },
      }),
    },
    {
      name: "429 quota type",
      code: "openai_quota_exceeded",
      response: providerErrorResponse(429, {
        error: { ...poisoned.error, type: "insufficient_quota", code: "insufficient_quota" },
      }),
    },
    {
      name: "429 billing code",
      code: "openai_quota_exceeded",
      response: providerErrorResponse(429, {
        error: {
          ...poisoned.error,
          type: "insufficient_quota",
          code: "credit_balance_exhausted",
        },
      }),
    },
    {
      name: "429 non-JSON",
      code: "openai_rate_limited",
      response: providerErrorResponse(429, LEAKED_PROVIDER_MESSAGE, false),
    },
    {
      name: "500",
      code: "openai_server_error",
      response: providerErrorResponse(500, {
        error: { ...poisoned.error, type: "server_error", code: "server_error" },
      }),
    },
    {
      name: "503",
      code: "openai_unavailable",
      response: providerErrorResponse(503, {
        error: {
          ...poisoned.error,
          type: "service_unavailable_error",
          code: "server_is_overloaded",
        },
      }),
    },
    {
      name: "fetch throws before a response",
      code: "openai_unavailable",
      reject: () => Promise.reject(new TypeError(LEAKED_PROVIDER_MESSAGE)),
      message: "Custodian model contact is uncertain. Usage is unknown and the hold remains.",
    },
    {
      name: "timeout",
      code: "openai_timeout",
      reject: () =>
        Promise.reject(Object.assign(new Error(LEAKED_PROVIDER_MESSAGE), { name: "AbortError" })),
      message: "Custodian model service timed out. Usage is unknown and the hold remains.",
    },
    {
      name: "2xx malformed JSON",
      code: "openai_invalid_response",
      response: providerErrorResponse(200, LEAKED_PROVIDER_MESSAGE, false),
    },
    {
      name: "2xx missing usage",
      code: "openai_usage_missing",
      response: Response.json(providerResponse(synthesis([finding()]), null)),
    },
  ];

  const seen = new Set<string>();
  for (const item of cases) {
    const state = world();
    state.fetchImpl = () => {
      if (item.reject) return item.reject();
      return Promise.resolve(item.response ?? providerErrorResponse(500, poisoned));
    };
    const result = await advance(state);
    assertUnknownContactHold(state, item.code);
    assertEquals(state.run.failure_message, item.message ?? CONTACT_HOLD_MESSAGE);
    assertEquals(usage(result).usageKnowledge, "unknown");
    assertEquals(usage(result).costAccounting, "unknown");
    assertEquals(usage(result).costUsd, null);
    assertEquals((usage(result).hold as { status: string }).status, "held");
    assertNoProviderLeak(result);
    await advance(state, "invocation-2");
    assertEquals(state.fetches, 1);
    assertEquals(state.settlePayloads.length, 1);
    assertEquals(state.reservation?.status, "held");
    assertEquals(state.reservation?.usageKnowledge, "unknown");
    assertEquals(state.reservation?.actualCostUsd, null);
    seen.add(item.code);
  }
  for (const code of [
    "openai_authentication_failed",
    "openai_permission_denied",
    "openai_model_unavailable",
    "openai_rate_limited",
    "openai_quota_exceeded",
    "openai_request_rejected",
    "openai_server_error",
    "openai_timeout",
    "openai_invalid_response",
    "openai_usage_missing",
    "openai_unavailable",
  ]) {
    if (!seen.has(code)) throw new Error(`missing provider error class ${code}`);
  }

  const malformed = world();
  malformed.fetchImpl = () => Promise.resolve(providerErrorResponse(200, "{", false));
  await advance(malformed);
  assertUnknownContactHold(malformed, "openai_invalid_response");

  const invalidOutput = world();
  invalidOutput.fetchImpl = () =>
    Promise.resolve(
      Response.json(
        providerResponse({
          summary: LEAKED_PROVIDER_MESSAGE,
        }),
      ),
    );
  const invalid = await advance(invalidOutput);
  assertEquals(invalidOutput.fetches, 1);
  assertEquals(invalidOutput.reservation?.status, "settled_known");
  assertEquals(invalidOutput.reservation?.usageKnowledge, "known");
  assertEquals(invalidOutput.reservation?.actualTokens, 1_250);
  assertEquals(typeof invalidOutput.reservation?.actualCostUsd, "number");
  assertEquals(invalidOutput.steps.at(-1)?.output?.errorCode, "openai_invalid_output");
  assertEquals(invalid.body.reason, "openai_invalid_output");
  assertNoProviderLeak(invalidOutput.settlePayloads[0]);
  assertNoProviderLeak(invalidOutput.steps.at(-1)?.output);
  assertNoProviderLeak(invalid);
  await advance(invalidOutput, "invocation-2");
  assertEquals(invalidOutput.fetches, 1);

  const success = world();
  const advanced = await advance(success);
  assertEquals(success.fetches, 1);
  assertEquals(success.reservation?.status, "settled_known");
  assertEquals(success.reservation?.usageKnowledge, "known");
  assertEquals(typeof success.reservation?.actualCostUsd, "number");
  assertEquals(success.run.status, "verifying");
  assertEquals(success.run.failure_code, null);
  assertEquals(advanced.body.state, "advanced");
  assertEquals(usage(advanced).costAccounting, "recorded");
  assertNoProviderLeak(advanced);
  await advance(success, "invocation-2");
  assertEquals(success.fetches, 1);
});

Deno.test("classifier ignores provider messages and keeps status when JSON is absent", () => {
  const body = {
    error: {
      message: LEAKED_PROVIDER_MESSAGE,
      type: "invalid_request_error",
      code: "invalid_json_schema",
    },
  };
  assertEquals(classifyOpenAiHttpFailure(401, body), "openai_authentication_failed");
  assertEquals(classifyOpenAiHttpFailure(401, undefined), "openai_authentication_failed");
  assertEquals(classifyOpenAiHttpFailure(403, body), "openai_permission_denied");
  assertEquals(classifyOpenAiHttpFailure(403, undefined), "openai_permission_denied");
  assertEquals(
    classifyOpenAiHttpFailure(403, {
      error: {
        message: "insufficient_quota project_spend_limit_exceeded",
        type: "permission_error",
        code: "country_not_supported",
      },
    }),
    "openai_permission_denied",
  );
  assertEquals(
    classifyOpenAiHttpFailure(403, {
      error: { type: "Insufficient_Quota", code: "PROJECT_SPEND_LIMIT_EXCEEDED" },
    }),
    "openai_permission_denied",
  );
  assertEquals(classifyOpenAiHttpFailure(400, body), "openai_request_rejected");
  assertEquals(
    classifyOpenAiHttpFailure(400, {
      error: { code: "model_not_found", message: LEAKED_PROVIDER_MESSAGE },
    }),
    "openai_model_unavailable",
  );
  assertEquals(classifyOpenAiHttpFailure(404, undefined), "openai_model_unavailable");
  assertEquals(
    classifyOpenAiHttpFailure(429, { error: { type: "rate_limit_error", code: "slow_down" } }),
    "openai_rate_limited",
  );
  assertEquals(
    classifyOpenAiHttpFailure(429, {
      error: { type: "insufficient_quota", code: "project_spend_limit_exceeded" },
    }),
    "openai_quota_exceeded",
  );
  assertEquals(classifyOpenAiHttpFailure(429, undefined), "openai_rate_limited");
  assertEquals(classifyOpenAiHttpFailure(500, body), "openai_server_error");
  assertEquals(classifyOpenAiHttpFailure(503, undefined), "openai_unavailable");
  assertEquals(JSON.stringify(classifyOpenAiHttpFailure(400, body)).includes(apiKey), false);
});

Deno.test("403 allowlisted quota and spend codes classify as quota", () => {
  const leaked = {
    message: LEAKED_PROVIDER_MESSAGE,
    param: "authorization",
  };
  assertEquals(
    classifyOpenAiHttpFailure(403, {
      error: { ...leaked, type: "insufficient_quota", code: "insufficient_quota" },
    }),
    "openai_quota_exceeded",
  );
  assertEquals(
    classifyOpenAiHttpFailure(403, {
      error: { ...leaked, type: "insufficient_quota" },
    }),
    "openai_quota_exceeded",
  );
  for (const code of [
    "insufficient_quota",
    "project_spend_limit_exceeded",
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
  ]) {
    assertEquals(
      classifyOpenAiHttpFailure(403, {
        error: { ...leaked, type: "invalid_request_error", code },
      }),
      "openai_quota_exceeded",
    );
  }
  assertEquals(
    classifyOpenAiHttpFailure(403, {
      error: { ...leaked, type: "invalid_request_error", code: "invalid_api_key" },
    }),
    "openai_permission_denied",
  );
  assertEquals(classifyOpenAiHttpFailure(403, undefined), "openai_permission_denied");
  assertEquals(
    classifyOpenAiHttpFailure(403, "insufficient_quota project_spend_limit_exceeded"),
    "openai_permission_denied",
  );
});

function racingIo(state: World): { io: CustodianIo; replays: number } {
  const base = ioFor(state);
  const seen = { reads: 0, reserves: 0, replays: 0 };
  let releaseSecond: () => void = () => undefined;
  const secondEntered = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const io: CustodianIo = {
    ...base,
    getReservation: () => {
      seen.reads += 1;
      if (seen.reads <= 2) return Promise.resolve(null);
      return base.getReservation(state.run.id, providerAttemptKey(state.run.id));
    },
    reserveProviderCall: async (id, key, payload) => {
      seen.reserves += 1;
      if (seen.reserves === 1) {
        const result = await base.reserveProviderCall(id, key, payload);
        await secondEntered;
        return result;
      }
      releaseSecond();
      const result = await base.reserveProviderCall(id, key, payload);
      const replay = result as { replay?: boolean };
      if (replay.replay === true) seen.replays += 1;
      return result;
    },
  };
  return {
    io,
    get replays() {
      return seen.replays;
    },
  };
}

function diagnosticFor(state: World): ProviderDiagnostic | undefined {
  check("at most one diagnostic per attempt", state.diagnostics.length <= 1, true);
  const recorded = state.diagnostics[0];
  if (recorded) check("diagnostic attempt key", recorded.key, providerAttemptKey(runId));
  return recorded?.diagnostic;
}

function requestIdResponse(body: unknown, status = 200, requestId = "req_attempt0001"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": requestId },
  });
}

Deno.test(
  "each provider outcome records one safe diagnostic without changing accounting",
  async () => {
    const rejected = world();
    rejected.fetchImpl = () =>
      Promise.resolve(
        requestIdResponse(
          {
            error: {
              message: LEAKED_PROVIDER_MESSAGE,
              type: "invalid_request_error",
              code: "invalid_json_schema",
              param: "text.format.schema.properties.findings",
            },
          },
          400,
        ),
      );
    await advance(rejected);
    assertUnknownContactHold(rejected, "openai_request_rejected");
    check("rejected diagnostic", diagnosticFor(rejected), {
      provider: "openai",
      contact_state: "contacted",
      classification: "openai_request_rejected",
      http_status: 400,
      request_id: "req_attempt0001",
      error_type: "invalid_request_error",
      error_code: "invalid_json_schema",
      error_param: "text.format.schema.properties.findings",
      incomplete_reason: null,
    });
    assertNoProviderLeak(rejected.diagnostics);
    await advance(rejected, "invocation-2");
    check("replay does not fetch", rejected.fetches, 1);
    check("replay records no second diagnostic", rejected.diagnostics.length, 1);

    const success = world();
    success.fetchImpl = () =>
      Promise.resolve(requestIdResponse(providerResponse(synthesis([finding()]))));
    await advance(success);
    check("success settles known", success.reservation?.status, "settled_known");
    check("success diagnostic", diagnosticFor(success), {
      provider: "openai",
      contact_state: "contacted",
      classification: "openai_completed",
      http_status: 200,
      request_id: "req_attempt0001",
      error_type: null,
      error_code: null,
      error_param: null,
      incomplete_reason: null,
    });
    assertNoProviderLeak(success.diagnostics);

    const incomplete = world();
    incomplete.fetchImpl = () =>
      Promise.resolve(
        requestIdResponse({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: '{"summary":"trunc' }],
            },
          ],
          usage: { input_tokens: 900, output_tokens: 512, total_tokens: 1_412 },
        }),
      );
    const truncated = await advance(incomplete);
    check("incomplete fetches once", incomplete.fetches, 1);
    check("incomplete usage is known", incomplete.reservation?.status, "settled_known");
    check("incomplete usage tokens", incomplete.reservation?.actualTokens, 1_412);
    check("incomplete step", incomplete.steps.at(-1)?.output?.errorCode, "openai_incomplete");
    check("incomplete run code", incomplete.run.failure_code, "openai_incomplete");
    check("incomplete materializes nothing", incomplete.materializeCalls, 0);
    check("incomplete reason", diagnosticFor(incomplete)?.incomplete_reason, "max_output_tokens");
    check(
      "incomplete classification",
      diagnosticFor(incomplete)?.classification,
      "openai_incomplete",
    );
    check("incomplete response", truncated.body.reason, "openai_incomplete");

    const cases: Array<
      [string, () => Promise<Response>, string, "contacted" | "contact_uncertain"]
    > = [
      [
        "refusal",
        () =>
          Promise.resolve(
            Response.json({
              status: "completed",
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "refusal", refusal: LEAKED_PROVIDER_MESSAGE }],
                },
              ],
              usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
            }),
          ),
        "openai_refusal",
        "contacted",
      ],
      [
        "invalid output",
        () =>
          Promise.resolve(Response.json(providerResponse({ summary: LEAKED_PROVIDER_MESSAGE }))),
        "openai_invalid_output",
        "contacted",
      ],
      [
        "usage missing",
        () => Promise.resolve(Response.json(providerResponse(synthesis([finding()]), null))),
        "openai_usage_missing",
        "contacted",
      ],
      [
        "malformed body",
        () => Promise.resolve(providerErrorResponse(200, LEAKED_PROVIDER_MESSAGE, false)),
        "openai_invalid_response",
        "contacted",
      ],
      [
        "network",
        () => Promise.reject(new TypeError(LEAKED_PROVIDER_MESSAGE)),
        "openai_unavailable",
        "contact_uncertain",
      ],
      [
        "timeout",
        () =>
          Promise.reject(Object.assign(new Error(LEAKED_PROVIDER_MESSAGE), { name: "AbortError" })),
        "openai_timeout",
        "contact_uncertain",
      ],
    ];
    for (const [name, respond, classification, contact] of cases) {
      const state = world();
      state.fetchImpl = respond;
      await advance(state);
      check(`${name} fetches once`, state.fetches, 1);
      check(`${name} classification`, diagnosticFor(state)?.classification, classification);
      check(`${name} contact`, diagnosticFor(state)?.contact_state, contact);
      assertNoProviderLeak(state.diagnostics);
    }
  },
);

Deno.test("a failing diagnostic write never changes provider accounting", async () => {
  const unknown = world();
  unknown.diagnosticError = true;
  unknown.fetchImpl = () =>
    Promise.resolve(
      providerErrorResponse(400, { error: { type: "invalid_request_error", code: "bad" } }),
    );
  const held = await advance(unknown);
  assertUnknownContactHold(unknown, "openai_request_rejected");
  check("held usage stays unknown", usage(held).usageKnowledge, "unknown");

  const known = world();
  known.diagnosticError = true;
  const advanced = await advance(known);
  check("known usage still settles", known.reservation?.status, "settled_known");
  check("known run still advances", known.run.status, "verifying");
  check("known result", advanced.body.state, "advanced");
  check("known fetches once", known.fetches, 1);
  check("known settles once", known.settlePayloads.length, 1);
});

Deno.test("the reserved hold covers the exact request bytes the SDK sends", async () => {
  for (const remaining of [16, 512, 4096]) {
    const state = world();
    state.budget.run_tokens_remaining = remaining;
    await advance(state);
    check("one request body", state.fetchBodies.length, 1);
    const sentBytes = new TextEncoder().encode(state.fetchBodies[0]).byteLength;
    const sent = JSON.parse(state.fetchBodies[0]) as {
      max_output_tokens: number;
      store: boolean;
    };
    check("store stays off", sent.store, false);
    check("max output tokens", sent.max_output_tokens, remaining);
    check("hold covers bytes plus output", state.reservation?.holdTokens, sentBytes + remaining);
  }
});

Deno.test("racing invocations record one diagnostic for the single attempt", async () => {
  const state = world();
  state.fetchImpl = () =>
    Promise.resolve(
      providerErrorResponse(503, { error: { type: "server_error", code: "server_is_overloaded" } }),
    );
  const racing = racingIo(state);
  await Promise.all([
    advanceOpen(state, "race-a", racing.io),
    advanceOpen(state, "race-b", racing.io),
  ]);
  check("race fetches once", state.fetches, 1);
  check("race settles once", state.settlePayloads.length, 1);
  check("race diagnostics", state.diagnostics.length, 1);
  check("race hold stays held", state.reservation?.status, "held");
  check("race usage unknown", state.reservation?.usageKnowledge, "unknown");
  await advanceOpen(state, "race-c", ioFor(state));
  check("later replay does not fetch", state.fetches, 1);
});

Deno.test("a hung diagnostic write cannot delay or change settlement", async () => {
  const known = world();
  const order: string[] = [];
  const base = ioFor(known);
  const io: CustodianIo = {
    ...base,
    settleProviderReservation: (...args) => {
      order.push("settle");
      return base.settleProviderReservation(...args);
    },
    recordProviderDiagnostic: () => {
      order.push("diagnostic");
      return new Promise<void>(() => undefined);
    },
  };
  const started = Date.now();
  const result = await advanceOpen(known, "hung-diagnostic", io);
  check("settles before the diagnostic", order, ["settle", "diagnostic"]);
  check("known usage settled", known.reservation?.status, "settled_known");
  check("run advanced", result.body.state, "advanced");
  check("diagnostic wait is bounded", Date.now() - started < 10_000, true);

  const unknown = world();
  unknown.fetchImpl = () =>
    Promise.resolve(providerErrorResponse(500, { error: { type: "server_error", code: null } }));
  const unknownOrder: string[] = [];
  const unknownBase = ioFor(unknown);
  await advanceOpen(unknown, "hung-diagnostic-unknown", {
    ...unknownBase,
    settleProviderReservation: (...args) => {
      unknownOrder.push("settle");
      return unknownBase.settleProviderReservation(...args);
    },
    recordProviderDiagnostic: () => {
      unknownOrder.push("diagnostic");
      return new Promise<void>(() => undefined);
    },
  });
  check("unknown settles first", unknownOrder, ["settle", "diagnostic"]);
  assertUnknownContactHold(unknown, "openai_server_error");
});

Deno.test("malformed output with known usage settles the usage as known", async () => {
  const state = world();
  state.fetchImpl = () =>
    Promise.resolve(
      Response.json({
        object: "response",
        status: "completed",
        output: null,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    );
  await advance(state);
  check("fetches once", state.fetches, 1);
  check("usage known", state.reservation?.status, "settled_known");
  check("actual tokens", state.reservation?.actualTokens, 15);
  check("step code", state.steps.at(-1)?.output?.errorCode, "openai_invalid_output");
  check("no materialization", state.materializeCalls, 0);
});

// ---------------------------------------------------------------------------
// Bring-your-own OpenAI key: the provider path uses the calling owner's key
// and the owner's model choice, and stops (without reserving or fetching) when
// either is unavailable. Nothing is substituted.
// ---------------------------------------------------------------------------

function pricingFor(...models: string[]): string {
  return JSON.stringify(
    Object.fromEntries(
      models.map((model) => [
        model,
        {
          version: "2026-09-24",
          inputUsdPerMillion: 1.2,
          cachedInputUsdPerMillion: 0.3,
          outputUsdPerMillion: 4.8,
        },
      ]),
    ),
  );
}

function assertNoProviderContact(state: World, result: { body: Record<string, unknown> }) {
  assertEquals(state.fetches, 0);
  assertEquals(state.reserveCalls, 0);
  assertEquals(state.reservation, null);
  assertEquals(state.materializeCalls, 0);
  assertEquals(result.body.state, "blocked");
  assertEquals(usage(result as { body: Record<string, unknown> }).costAccounting, "none");
  assertEquals(JSON.stringify(result).includes(apiKey), false);
}

Deno.test("BYOK: the request carries the owner's key and the owner's chosen model", async () => {
  const state = world();
  const seen: { authorization: string | null; model: unknown }[] = [];
  state.fetchImpl = (_url, init) => {
    seen.push({
      authorization: new Headers(init?.headers).get("authorization"),
      model: JSON.parse(String(init?.body)).model,
    });
    return Promise.resolve(Response.json(providerResponse(synthesis([finding("finding")]))));
  };
  await advance(state);
  assertEquals(seen.length, 1);
  assertEquals(seen[0]?.authorization, `Bearer ${apiKey}`);
  assertEquals(seen[0]?.model, "gpt-5.6-terra");
  assertEquals(state.ownerLookups, ["model:owner-1", "key:owner-1"]);
});

Deno.test(
  "BYOK: a newer-generation model keeps exact attribution and its own pricing",
  async () => {
    const state = world();
    state.run = { ...state.run, model_tier: "pro" };
    state.allowedTiers = ["luna", "terra", "sol", "pro"];
    state.modelPreference = "gpt-6-astra";
    state.pricing = pricingFor("gpt-6-astra");
    let sentModel: unknown = null;
    state.fetchImpl = (_url, init) => {
      sentModel = JSON.parse(String(init?.body)).model;
      return Promise.resolve(Response.json(providerResponse(synthesis([finding("finding")]))));
    };
    await advance(state);
    assertEquals(sentModel, "gpt-6-astra");
    assertEquals(state.reservePayloads[0]?.model_name, "gpt-6-astra");
    assertEquals(state.reservePayloads[0]?.model_tier, "pro");
    assertEquals(state.fetches, 1);
  },
);

Deno.test(
  "BYOK: no stored key blocks before reservation and never falls back to a server key",
  async () => {
    const state = world();
    state.ownerKeyStatus = "missing";
    state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
    const result = await advance(state);
    assertNoProviderContact(state, result);
    assertEquals(result.body.reason, "provider_key_not_configured");
    assertEquals(state.run.failure_code, "provider_key_not_configured");
  },
);

Deno.test("BYOK: an unreadable stored key blocks before reservation", async () => {
  const state = world();
  state.ownerKeyStatus = "unreadable";
  state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const result = await advance(state);
  assertNoProviderContact(state, result);
  assertEquals(result.body.reason, "provider_key_unreadable");
});

Deno.test("BYOK: no model choice blocks; no default model is substituted", async () => {
  const state = world();
  state.modelPreference = null;
  state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
  const result = await advance(state);
  assertNoProviderContact(state, result);
  assertEquals(result.body.reason, "model_not_selected");
  // The key is not even resolved once the model choice is missing.
  assertEquals(state.ownerLookups, ["model:owner-1"]);
});

Deno.test(
  "BYOK: a model outside the list or in another tier blocks with no substitution",
  async () => {
    for (const [choice, reason] of [
      ["gpt-5.6-pro", "model_selection_invalid"],
      ["gpt-4o", "model_selection_invalid"],
      ["gpt-5.6-sol", "model_tier_mismatch"],
      ["gpt-6-astra", "model_tier_mismatch"],
    ] as const) {
      const state = world();
      state.modelPreference = choice;
      state.fetchImpl = () => Promise.reject(new Error("fetch_must_not_run"));
      const result = await advance(state);
      assertNoProviderContact(state, result);
      assertEquals(result.body.reason, reason);
    }
  },
);

Deno.test("BYOK: the owner lookups are keyed only by the authenticated owner", async () => {
  const state = world();
  state.fetchImpl = () =>
    Promise.resolve(Response.json(providerResponse(synthesis([finding("finding")]))));
  await advance(state);
  assertEquals(
    state.ownerLookups.every((lookup) => lookup.endsWith(":owner-1")),
    true,
  );
});
