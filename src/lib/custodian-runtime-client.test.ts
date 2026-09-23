import { describe, expect, test } from "bun:test";
import {
  CUSTODIAN_RUN_READ_LIMIT,
  CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER,
  custodianRunInvocation,
  custodianRunsKey,
  describeCustodianRunAccounting,
  describeProviderDiagnostic,
  diagnosticsByRun,
  interpretCustodianFunctionResult,
  mapCustodianRunRow,
  mapProviderDiagnosticRow,
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
      providerDiagnostic: null,
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

  test("does not present a missing hold as recorded zero spend when the projection is unavailable", () => {
    const run = mapCustodianRunRow({
      ...{
        id: "00000000-0000-4000-8000-000000000001",
        case_id: "00000000-0000-4000-8000-000000000002",
        objective: "What does the selected evidence support?",
        model_tier: "terra",
        status: "completed",
        budget_tokens: 2_000,
        budget_cost_usd: 0.1,
        budget_latency_ms: 30_000,
        budget_tool_events: 1,
        tokens_used: 0,
        cost_usd: 0,
        latency_ms: 12,
        tool_events_count: 0,
        last_step_number: 2,
        failure_code: null,
        failure_message: null,
        cancel_requested_at: null,
        created_at: "2026-09-21T19:00:00.000Z",
        updated_at: "2026-09-21T19:06:00.000Z",
      },
    });
    const accounting = describeCustodianRunAccounting(run, "unavailable");
    expect(accounting.recordedProviderCost).toBe("Not recorded");
    expect(accounting.recordedProviderTokens).toBe("Not recorded");
    expect(accounting.usageKnowledge).toContain("unclaimed");
    expect(accounting.usageKnowledge).not.toContain("No provider usage recorded");
    expect(accounting.recordedProviderCost).not.toContain("$");
  });

  test("keeps the activated browser invocation contract narrow and secret-safe", () => {
    expect(CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER).toBe(true);
    const invocation = custodianRunInvocation(
      "00000000-0000-4000-8000-000000000001",
      "invocation-1",
    );
    expect(invocation).toEqual({
      runId: "00000000-0000-4000-8000-000000000001",
      invocationKey: "invocation-1",
    });
    expect(Object.keys(invocation)).toEqual(["runId", "invocationKey"]);
    const failed = interpretCustodianFunctionResult({
      error: { message: "sk-secret Bearer raw-provider-payload" },
    });
    expect(failed).toEqual({ invoked: false, reason: "invocation_failed" });
    expect(JSON.stringify(failed)).not.toContain("sk-secret");
    expect(JSON.stringify(failed)).not.toContain("Bearer");
    expect(interpretCustodianFunctionResult({ error: null })).toEqual({
      invoked: true,
      reason: "invoked",
    });
  });

  test("rejects malformed persisted status and usage", () => {
    expect(() => mapCustodianRunRow({ ...runRow(), status: "running" })).toThrow("status");
    expect(() => mapCustodianRunRow({ ...runRow(), tokens_used: -1 })).toThrow("tokens_used");
    expect(() => mapCustodianRunRow({ ...runRow(), updated_at: "not-a-date" })).toThrow(
      "updated_at",
    );
  });

  test("keeps the read slice bounded and user-keyed after browser activation", () => {
    expect(CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER).toBe(true);
    expect(CUSTODIAN_RUN_READ_LIMIT).toBe(100);
    expect(custodianRunsKey("owner-1")).toEqual(["custodian", "runs", "owner-1"]);
    expect(custodianRunsKey(null)).toEqual(["custodian", "runs", "__anonymous__"]);
  });

  test("Run Room route keeps provider invocation behind the explicit runtime client boundary", async () => {
    const source = await Bun.file(new URL("../routes/run-room.tsx", import.meta.url)).text();
    expect(source).toContain("CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER");
    expect(source).toContain("useCustodianRuns");
    expect(source).not.toContain("invokeCustodianRun");
    expect(source).not.toContain("functions.invoke");
    expect(source).not.toContain(".from(");
    expect(source).not.toContain(".insert(");
    expect(source).not.toContain(".update(");
    expect(source).not.toMatch(/["']custodian-run["']/);
  });
});

function diagnosticRow(patch: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    run_id: "00000000-0000-4000-8000-000000000001",
    reservation_id: "00000000-0000-4000-8000-000000000010",
    attempt_key: "provider-attempt:00000000-0000-4000-8000-000000000001:synthesize",
    provider: "openai",
    contact_state: "contacted",
    classification: "openai_request_rejected",
    http_status: 400,
    request_id: "req_0123456789abcdef",
    error_type: "invalid_request_error",
    error_code: "invalid_json_schema",
    error_param: "text.format.schema.properties.findings",
    incomplete_reason: null,
    created_at: "2026-09-23T12:00:00.000Z",
    ...patch,
  };
}

describe("Custodian provider diagnostic read contract", () => {
  test("maps only allowlisted diagnostic metadata", () => {
    const diagnostic = mapProviderDiagnosticRow({
      ...diagnosticRow(),
      message: "Bearer sk-live-secret prompt text",
      body: '{"raw":true}',
    });
    expect(diagnostic).toEqual({
      id: "00000000-0000-4000-8000-000000000020",
      runId: "00000000-0000-4000-8000-000000000001",
      reservationId: "00000000-0000-4000-8000-000000000010",
      attemptKey: "provider-attempt:00000000-0000-4000-8000-000000000001:synthesize",
      provider: "openai",
      contactState: "contacted",
      classification: "openai_request_rejected",
      httpStatus: 400,
      requestId: "req_0123456789abcdef",
      errorType: "invalid_request_error",
      errorCode: "invalid_json_schema",
      errorParam: "text.format.schema.properties.findings",
      incompleteReason: null,
      createdAt: "2026-09-23T12:00:00.000Z",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("sk-live-secret");
    expect(JSON.stringify(diagnostic)).not.toContain("raw");
  });

  test("shows unsafe provider-derived values as absent instead of sanitizing them", () => {
    const diagnostic = mapProviderDiagnosticRow(
      diagnosticRow({
        error_param: "text.format schema Bearer sk-x",
        error_code: "Invalid Code",
        error_type: "x".repeat(81),
        request_id: `req_${"a".repeat(200)}`,
        http_status: 99,
      }),
    );
    expect(diagnostic?.errorParam).toBeNull();
    expect(diagnostic?.errorCode).toBeNull();
    expect(diagnostic?.errorType).toBeNull();
    expect(diagnostic?.requestId).toBeNull();
    expect(diagnostic?.httpStatus).toBeNull();
    expect(mapProviderDiagnosticRow(diagnosticRow({ provider: "other" }))).toBeNull();
    expect(mapProviderDiagnosticRow(diagnosticRow({ classification: "Bad Class" }))).toBeNull();
    expect(mapProviderDiagnosticRow(diagnosticRow({ contact_state: "maybe" }))).toBeNull();
    expect(mapProviderDiagnosticRow(null)).toBeNull();
  });

  test("describes a rejected request with the safe technical fields", () => {
    const diagnostic = mapProviderDiagnosticRow(diagnosticRow());
    if (!diagnostic) throw new Error("diagnostic fixture must map");
    expect(describeProviderDiagnostic(diagnostic)).toEqual([
      { label: "Provider", value: "OpenAI" },
      { label: "Status", value: "400" },
      { label: "Classification", value: "Request rejected" },
      { label: "Error type", value: "invalid_request_error" },
      { label: "Error code", value: "invalid_json_schema" },
      { label: "Parameter", value: "text.format.schema.properties.findings" },
      { label: "Request ID", value: "req_0123456789abcdef" },
      {
        label: "Attempt",
        value: "provider-attempt:00000000-0000-4000-8000-000000000001:synthesize",
      },
      { label: "Time", value: "2026-09-23T12:00:00.000Z" },
    ]);
    const uncertain = mapProviderDiagnosticRow(
      diagnosticRow({
        contact_state: "contact_uncertain",
        classification: "openai_timeout",
        http_status: null,
        request_id: null,
        error_type: null,
        error_code: null,
        error_param: null,
      }),
    );
    if (!uncertain) throw new Error("uncertain fixture must map");
    expect(describeProviderDiagnostic(uncertain).map((entry) => entry.label)).toEqual([
      "Provider",
      "Status",
      "Classification",
      "Attempt",
      "Time",
    ]);
    expect(describeProviderDiagnostic(uncertain)[1]?.value).toContain("uncertain");
  });

  test("keeps the newest valid diagnostic per run and skips malformed rows", () => {
    const byRun = diagnosticsByRun([
      diagnosticRow({ created_at: "2026-09-23T11:00:00.000Z", classification: "openai_timeout" }),
      diagnosticRow(),
      diagnosticRow({ id: "bad", provider: "other", created_at: "2026-09-23T13:00:00.000Z" }),
      "not a row",
    ]);
    expect(byRun.size).toBe(1);
    expect(byRun.get("00000000-0000-4000-8000-000000000001")?.classification).toBe(
      "openai_request_rejected",
    );
  });
});
