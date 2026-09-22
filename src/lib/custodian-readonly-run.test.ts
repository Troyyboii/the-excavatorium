import { describe, expect, test } from "bun:test";
import { CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER } from "./custodian-runtime";
import {
  createReadonlyAnalysisSession,
  emptyReadonlyAnalysisDraft,
  parseReadonlyAnalysisDraft,
  productionReadonlyAnalysisPorts,
  READONLY_ANALYSIS_DRIVE_BOUND,
  startReadonlyAnalysis,
  type ReadonlyAnalysisPorts,
  type ReadonlyAnalysisStartInput,
  type ReadonlyRunObservation,
} from "./custodian-readonly-run";

const CASE_ID = "00000000-0000-4000-8000-000000000002";
const POLICY_ID = "00000000-0000-4000-8000-000000000010";
const RUN_ID = "00000000-0000-4000-8000-000000000011";

function ownerInput(): ReadonlyAnalysisStartInput {
  return {
    caseId: CASE_ID,
    policyName: "owner-readonly",
    allowedModelTiers: ["terra"],
    perRunTokenBudget: 1000,
    perRunCostUsd: 1,
    perRunLatencyMs: 5000,
    perRunToolEventBudget: 4,
    dailyTokenBudget: 2000,
    monthlyTokenBudget: 4000,
    dailyCostUsd: 2,
    monthlyCostUsd: 4,
    modelTier: "terra",
    promptVersion: "owner-prompt-1",
    objective: "What does the admitted record support?",
  };
}

function observation(
  status: string,
  holdStatus: ReadonlyRunObservation["holdStatus"] = null,
): ReadonlyRunObservation {
  return { status, holdStatus, failureCode: status === "failed" ? "openai_timeout" : null };
}

function harness(script: ReadonlyRunObservation[], invokeOk = true) {
  const policyPayloads: unknown[] = [];
  const runPayloads: unknown[] = [];
  const runKeys: string[] = [];
  const bodies: unknown[] = [];
  let reads = 0;
  let refreshes = 0;
  const ports: ReadonlyAnalysisPorts = {
    surfaceEnabled: true,
    ensurePolicy: async (_caseId, payload) => {
      policyPayloads.push(payload);
      return { policyId: POLICY_ID };
    },
    createRun: async (_caseId, idempotencyKey, payload) => {
      runKeys.push(idempotencyKey);
      runPayloads.push(payload);
      return { runId: RUN_ID };
    },
    invoke: async (body) => {
      bodies.push(body);
      return { ok: invokeOk, state: invokeOk ? "advanced" : null, status: null };
    },
    readRun: async () => script[Math.min(reads++, Math.max(script.length - 1, 0))] ?? null,
    refreshRuns: async () => {
      refreshes += 1;
    },
  };
  return { ports, policyPayloads, runPayloads, runKeys, bodies, refreshes: () => refreshes };
}

describe("readonly analysis start", () => {
  test("closed production ports perform no policy, run, or edge call", async () => {
    expect(CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER).toBe(false);
    expect(READONLY_ANALYSIS_DRIVE_BOUND).toBe(5);
    let refreshed = false;
    const ports = productionReadonlyAnalysisPorts({
      ownerId: CASE_ID,
      refreshRuns: async () => {
        refreshed = true;
      },
    });
    expect(ports.surfaceEnabled).toBe(false);
    const result = await startReadonlyAnalysis(
      ownerInput(),
      ports,
      createReadonlyAnalysisSession(() => "session-key"),
    );
    expect(result).toEqual({ ok: false, reason: "provider_surface_blocked" });
    expect(refreshed).toBe(false);
    await expect(ports.ensurePolicy(CASE_ID, {} as never)).rejects.toThrow(
      "provider_surface_blocked",
    );
    await expect(ports.createRun(CASE_ID, "readonly-run:session-key", {} as never)).rejects.toThrow(
      "provider_surface_blocked",
    );
    await expect(ports.invoke({ runId: RUN_ID, invocationKey: "session-key" })).resolves.toEqual({
      ok: false,
      state: "provider_surface_blocked",
      status: null,
    });
    const source = await Bun.file(new URL("./custodian-readonly-run.ts", import.meta.url)).text();
    expect(source).not.toMatch(/\.insert\(/);
    expect(source).not.toMatch(/\.update\(/);
    expect(source).not.toMatch(/\.delete\(/);
    expect(source).not.toMatch(/from\(["']agent_/);
    expect(source).not.toMatch(/import\.meta\.env/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).toContain("custodian_ensure_readonly_analysis_policy");
    expect(source).toContain("custodian_create_readonly_analysis_run");
    expect(source).not.toContain("provider-attempt:${");
  });

  test("rejects omitted owner input before any rpc", async () => {
    const calls = { policy: 0 };
    const parsed = parseReadonlyAnalysisDraft(emptyReadonlyAnalysisDraft());
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join(" ")).toContain("case_id");
      expect(parsed.errors.join(" ")).toContain("objective");
      expect(parsed.errors.join(" ")).toContain("allowed_model_tiers");
    }
    const result = await startReadonlyAnalysis(
      { ...ownerInput(), objective: "  ", allowedModelTiers: [] },
      {
        surfaceEnabled: true,
        ensurePolicy: async () => {
          calls.policy += 1;
          return { policyId: POLICY_ID };
        },
        createRun: async () => ({ runId: RUN_ID }),
        invoke: async () => ({ ok: true, state: "advanced", status: null }),
        readRun: async () => observation("queued"),
        refreshRuns: async () => undefined,
      },
      createReadonlyAnalysisSession(() => "session-key"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_input");
    expect(calls.policy).toBe(0);
  });

  test("drives one persisted run to completed with one policy, one run, and a stable invocation", async () => {
    const session = createReadonlyAnalysisSession(() => "session-key");
    const drive = harness([
      observation("queued"),
      observation("retrieving"),
      observation("synthesizing"),
      observation("verifying"),
      observation("completed"),
    ]);
    const result = await startReadonlyAnalysis(ownerInput(), drive.ports, session);
    expect(result).toMatchObject({
      ok: true,
      runId: RUN_ID,
      status: "completed",
      stop: "completed",
      invocationKey: "session-key",
      advances: 4,
    });
    expect(drive.policyPayloads).toHaveLength(1);
    expect(Object.keys(drive.policyPayloads[0] as object)).toEqual([
      "policy_name",
      "allowed_model_tiers",
      "per_run_token_budget",
      "per_run_cost_usd",
      "per_run_latency_ms",
      "per_run_tool_event_budget",
      "daily_token_budget",
      "monthly_token_budget",
      "daily_cost_usd",
      "monthly_cost_usd",
    ]);
    expect(drive.runKeys).toEqual(["readonly-run:session-key"]);
    expect(Object.keys(drive.runPayloads[0] as object)).toEqual([
      "model_tier",
      "prompt_version",
      "objective",
      "tool_policy_id",
    ]);
    expect(drive.bodies).toEqual([
      { runId: RUN_ID, invocationKey: "session-key" },
      { runId: RUN_ID, invocationKey: "session-key" },
      { runId: RUN_ID, invocationKey: "session-key" },
      { runId: RUN_ID, invocationKey: "session-key" },
    ]);
    expect(drive.refreshes()).toBe(5);
    expect(JSON.stringify(drive.bodies)).not.toContain("provider-attempt:");
  });

  test("stops on awaiting approval, an unresolved hold, and an invocation failure", async () => {
    const approval = harness([
      observation("queued"),
      observation("retrieving"),
      observation("awaiting_approval"),
    ]);
    const approved = await startReadonlyAnalysis(
      ownerInput(),
      approval.ports,
      createReadonlyAnalysisSession(() => "approval-session"),
    );
    expect(approved).toMatchObject({ ok: true, stop: "awaiting_approval", advances: 2 });

    const held = harness([
      observation("queued"),
      observation("retrieving"),
      observation("synthesizing", "held"),
    ]);
    const unresolved = await startReadonlyAnalysis(
      ownerInput(),
      held.ports,
      createReadonlyAnalysisSession(() => "held-session"),
    );
    expect(unresolved).toMatchObject({ ok: true, stop: "held", advances: 2 });
    expect(held.bodies).toHaveLength(2);

    const failed = harness([observation("queued")], false);
    const invocation = await startReadonlyAnalysis(
      ownerInput(),
      failed.ports,
      createReadonlyAnalysisSession(() => "error-session"),
    );
    expect(invocation).toMatchObject({ ok: false, reason: "invocation_failed", runId: RUN_ID });
    expect(failed.bodies).toHaveLength(1);
  });

  test("a second overlapping start does not create another policy or run", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let policies = 0;
    let runs = 0;
    const ports: ReadonlyAnalysisPorts = {
      surfaceEnabled: true,
      ensurePolicy: async () => {
        policies += 1;
        await gate;
        return { policyId: POLICY_ID };
      },
      createRun: async () => {
        runs += 1;
        return { runId: RUN_ID };
      },
      invoke: async () => ({ ok: true, state: "advanced", status: null }),
      readRun: async () => observation("completed"),
      refreshRuns: async () => undefined,
    };
    const session = createReadonlyAnalysisSession(() => "overlap-session");
    const first = startReadonlyAnalysis(ownerInput(), ports, session);
    const second = await startReadonlyAnalysis(ownerInput(), ports, session);
    expect(second).toEqual({ ok: false, reason: "start_already_in_progress" });
    release();
    await expect(first).resolves.toMatchObject({ ok: true, stop: "completed", advances: 0 });
    expect(policies).toBe(1);
    expect(runs).toBe(1);
  });

  test("does not invent a provider attempt key", async () => {
    let policies = 0;
    const result = await startReadonlyAnalysis(
      ownerInput(),
      {
        surfaceEnabled: true,
        ensurePolicy: async () => {
          policies += 1;
          return { policyId: POLICY_ID };
        },
        createRun: async () => ({ runId: RUN_ID }),
        invoke: async () => ({ ok: true, state: "advanced", status: null }),
        readRun: async () => observation("completed"),
        refreshRuns: async () => undefined,
      },
      createReadonlyAnalysisSession(() => "provider-attempt:invented"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_input");
    expect(policies).toBe(0);
  });
});
