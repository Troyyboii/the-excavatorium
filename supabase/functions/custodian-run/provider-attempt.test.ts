import { PROVIDER_EXECUTION_UNSUPPORTED, validSynthesis } from "./index.ts";
import {
  advanceCustodianRun,
  evaluateReadonlyVerification,
  OPENAI_RESPONSES_URL,
  projectPublicRun,
  providerFreeAdmissionSummary,
  type CustodianIo,
  type ReservationView,
  type StepArtifact,
  type SynthesisRun,
} from "./provider-attempt.ts";
import { classifyModelPricing, classifyResponsesOutput } from "./runtime.ts";

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
    proposedDiff: {},
    toolAction: {},
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
  pricing: string | undefined;
  apiKey: string | undefined;
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
  };
  reservationReadError: boolean;
  fetchImpl: (
    url: string,
    init: { headers: Record<string, string>; signal?: AbortSignal },
  ) => Promise<Response>;
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
    pricing: pricingJson,
    apiKey,
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
    },
    reservationReadError: false,
    fetchImpl: () => Promise.resolve(Response.json(providerResponse(synthesis([finding()])))),
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
    getRun: () => Promise.resolve(state.run),
    getBudget: () => {
      if (state.run.cancel_requested_at) {
        return Promise.resolve({
          allowed: false,
          reason: "cancel_requested",
          run_tokens_remaining: state.budget.run_tokens_remaining,
          run_cost_remaining: state.budget.run_cost_remaining,
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
    reserveProviderCall: () => {
      state.reserveCalls += 1;
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
        holdTokens: 100,
        holdCostUsd: 0.05,
        actualTokens: null,
        actualCostUsd: null,
        pricingVersion: "2026-09-21",
        failureCode: null,
        inFlightUntil: new Date(state.now + 90_000).toISOString(),
        idempotencyKey: `provider-attempt:${runId}:synthesize`,
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
    materializeFindings: () => {
      state.materializeCalls += 1;
      if (state.materializeError) return Promise.reject(new Error("attribution_failed"));
      return Promise.resolve({ materialized: true });
    },
    createApproval: (run) => {
      state.approvals += 1;
      state.run = { ...run, status: "awaiting_approval" };
      return Promise.resolve({
        run: state.run,
        approval: {
          id: "approval-1",
          status: "pending",
          approvalKind: "tool_action",
          exactActionHash: "abc",
        },
      });
    },
    readVerificationArtifacts: () =>
      Promise.resolve({
        steps: state.steps,
        reservation: state.reservation,
        findingCount: state.materializeCalls,
        approvalId: state.approvals > 0 ? "approval-1" : null,
        proposalId: null,
        toolOperationClasses: [],
      }),
    getEnv: (name) => {
      if (name === "OPENAI_API_KEY") return state.apiKey;
      if (name === "CUSTODIAN_MODEL_PRICING_JSON") return state.pricing;
      return undefined;
    },
    fetchProvider: (url, init) => {
      state.fetches += 1;
      if (url !== OPENAI_RESPONSES_URL) return Promise.reject(new Error("unexpected_url"));
      if (!init.headers.Authorization?.startsWith("Bearer ")) {
        return Promise.reject(new Error("missing_authorization"));
      }
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
    providerExecutionUnsupported: gateOpen ? false : PROVIDER_EXECUTION_UNSUPPORTED,
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
  assertEquals(PROVIDER_EXECUTION_UNSUPPORTED, true);
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
    Promise.resolve(Response.json(providerResponse(synthesis([finding("finding", "not-a-uuid")]))));
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
          idempotencyKey: "retrieve",
          output: { providerContact: false, evidenceCreated: false },
          tokensUsed: 0,
          costUsd: 0,
          pricingVersion: null,
        },
        {
          id: "synthesize",
          stepKind: "synthesize",
          status: "completed",
          idempotencyKey: "synthesize",
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
        holdTokens: 10,
        holdCostUsd: 0.01,
        actualTokens: 12,
        actualCostUsd: 0.001,
        pricingVersion: "2026-09-21",
        failureCode: null,
        inFlightUntil: "2026-09-21T19:00:00.000Z",
        idempotencyKey: "provider-attempt",
      },
      findingCount: 1,
      approvalId: null,
      proposalId: null,
      toolOperationClasses: [],
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
          idempotencyKey: "retrieve",
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
    classifyResponsesOutput({
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
