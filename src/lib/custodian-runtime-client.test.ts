import { describe, expect, test } from "bun:test";
import {
  CUSTODIAN_RUN_READ_LIMIT,
  CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER,
  custodianRunInvocation,
  custodianRunsKey,
  describeCustodianRunAccounting,
  invokeCustodianRun,
  mapCustodianRunRow,
  mapProviderHoldRow,
} from "./custodian-runtime";

function runRow() {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    case_id: "00000000-0000-4000-8000-000000000002",
    objective: "What does the persisted evidence support?",
    model_tier: "terra",
    status: "blocked",
    budget_tokens: 2_000,
    budget_cost_usd: 0.1,
    budget_latency_ms: 30_000,
    budget_tool_events: 1,
    tokens_used: 0,
    cost_usd: 0,
    latency_ms: 12,
    tool_events_count: 0,
    last_step_number: 1,
    failure_code: "provider_execution_unsupported",
    failure_message: "Provider execution is intentionally unsupported by this runtime.",
    cancel_requested_at: null,
    created_at: "2026-08-17T14:00:00.000Z",
    updated_at: "2026-08-17T14:00:01.000Z",
  };
}

describe("Custodian run read contract", () => {
  test("maps a persisted run without exposing an owner field", () => {
    expect(mapCustodianRunRow(runRow())).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      caseId: "00000000-0000-4000-8000-000000000002",
      objective: "What does the persisted evidence support?",
      modelTier: "terra",
      status: "blocked",
      budgetTokens: 2_000,
      budgetCostUsd: 0.1,
      budgetLatencyMs: 30_000,
      budgetToolEvents: 1,
      tokensUsed: 0,
      costUsd: 0,
      latencyMs: 12,
      toolEventsCount: 0,
      lastStepNumber: 1,
      failureCode: "provider_execution_unsupported",
      failureMessage: "Provider execution is intentionally unsupported by this runtime.",
      cancelRequestedAt: null,
      createdAt: "2026-08-17T14:00:00.000Z",
      updatedAt: "2026-08-17T14:00:01.000Z",
      providerHold: null,
      latestStep: null,
    });
    expect(
      describeCustodianRunAccounting({
        ...mapCustodianRunRow({
          ...runRow(),
          cancel_requested_at: "2026-09-21T19:05:00.000Z",
        }),
      }).cancellation,
    ).toContain("does not prove the provider was never contacted");
  });

  test("separates recorded provider cost from an unknown hold", () => {
    const run = {
      ...mapCustodianRunRow({ ...runRow(), cost_usd: "0", tokens_used: "0" }),
      providerHold: mapProviderHoldRow({
        id: "00000000-0000-4000-8000-000000000010",
        run_id: "00000000-0000-4000-8000-000000000001",
        status: "held",
        usage_knowledge: "unknown",
        hold_tokens: 400,
        hold_cost_usd: "0.0500",
        actual_tokens: null,
        actual_cost_usd: null,
        pricing_version: "2026-09-21",
        failure_code: "openai_timeout",
        in_flight_until: "2026-09-21T19:02:00.000Z",
        updated_at: "2026-09-21T19:00:30.000Z",
      }),
    };
    const accounting = describeCustodianRunAccounting(run);
    expect(accounting.recordedProviderCost).toBe("Not recorded");
    expect(accounting.heldProviderBudget).toBe("$0.0500 encumbered · 400 tokens");
    expect(accounting.usageKnowledge).toContain("Unknown");
    expect(accounting.pricingVersion).toBe("2026-09-21");
    expect(accounting.recordedProviderCost).not.toContain("0.0500");
  });

  test("shows known factual cost and does not label a settled hold as spend in progress", () => {
    const run = {
      ...mapCustodianRunRow(runRow()),
      providerHold: mapProviderHoldRow({
        id: "00000000-0000-4000-8000-000000000010",
        run_id: "00000000-0000-4000-8000-000000000001",
        status: "settled_known",
        usage_knowledge: "known",
        hold_tokens: 400,
        hold_cost_usd: 0.05,
        actual_tokens: 1250,
        actual_cost_usd: 0.0024,
        pricing_version: "2026-09-21",
        failure_code: null,
        in_flight_until: "2026-09-21T19:02:00.000Z",
        updated_at: "2026-09-21T19:00:30.000Z",
      }),
    };
    const accounting = describeCustodianRunAccounting(run);
    expect(accounting.recordedProviderCost).toBe("$0.0024");
    expect(accounting.recordedProviderTokens).toBe("1250");
    expect(accounting.heldProviderBudget).toBe("None");
    expect(accounting.usageKnowledge).toContain("Known");
  });

  test("does not invoke the provider while the browser gate is closed", async () => {
    expect(CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER).toBe(false);
    const invocation = custodianRunInvocation(
      "00000000-0000-4000-8000-000000000001",
      "invocation-1",
    );
    expect(invocation).toEqual({
      runId: "00000000-0000-4000-8000-000000000001",
      invocationKey: "invocation-1",
    });
    expect(Object.keys(invocation)).toEqual(["runId", "invocationKey"]);
    await expect(invokeCustodianRun(invocation)).resolves.toEqual({
      invoked: false,
      reason: "provider_surface_blocked",
    });
  });

  test("rejects malformed persisted status and usage", () => {
    expect(() => mapCustodianRunRow({ ...runRow(), status: "running" })).toThrow("status");
    expect(() => mapCustodianRunRow({ ...runRow(), tokens_used: -1 })).toThrow("tokens_used");
    expect(() => mapCustodianRunRow({ ...runRow(), updated_at: "not-a-date" })).toThrow(
      "updated_at",
    );
  });

  test("keeps the first slice read-only, bounded, and user-keyed", () => {
    expect(CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER).toBe(false);
    expect(CUSTODIAN_RUN_READ_LIMIT).toBe(100);
    expect(custodianRunsKey("owner-1")).toEqual(["custodian", "runs", "owner-1"]);
    expect(custodianRunsKey(null)).toEqual(["custodian", "runs", "__anonymous__"]);
  });
});
