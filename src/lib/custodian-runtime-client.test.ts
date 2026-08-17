import { describe, expect, test } from "bun:test";
import {
  CUSTODIAN_RUN_READ_LIMIT,
  CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER,
  custodianRunsKey,
  mapCustodianRunRow,
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
      createdAt: "2026-08-17T14:00:00.000Z",
      updatedAt: "2026-08-17T14:00:01.000Z",
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
