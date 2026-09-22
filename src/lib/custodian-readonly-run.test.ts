import { describe, expect, test } from "bun:test";
import {
  CUSTODIAN_RUN_READ_LIMIT,
  CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER,
} from "./custodian-runtime";
import {
  createReadonlyAnalysisSession,
  describeReadonlyAnalysisResult,
  emptyReadonlyAnalysisDraft,
  parseReadonlyAnalysisDraft,
  productionReadonlyAnalysisPorts,
  READONLY_ANALYSIS_ADVANCE_STATES,
  READONLY_ANALYSIS_DRIVE_BOUND,
  observationForCustodianRun,
  startReadonlyAnalysis,
  type PersistedReadonlyRun,
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
  usageKnowledge: ReadonlyRunObservation["usageKnowledge"] = null,
  holdProjection?: ReadonlyRunObservation["holdProjection"],
): ReadonlyRunObservation {
  return {
    status,
    holdStatus,
    failureCode: status === "failed" ? "openai_timeout" : null,
    usageKnowledge,
    ...(holdProjection ? { holdProjection } : {}),
  };
}

function listedRun(
  status: string,
  holdProjection?: PersistedReadonlyRun["holdProjection"],
  holdStatus: PersistedReadonlyRun["holdStatus"] = null,
  usageKnowledge: PersistedReadonlyRun["usageKnowledge"] = null,
): PersistedReadonlyRun {
  return {
    id: RUN_ID,
    caseId: CASE_ID,
    status,
    holdStatus,
    usageKnowledge,
    failureCode: null,
    ...(holdProjection ? { holdProjection } : {}),
  };
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
  test("production ports expose the activated source gate without making a call", () => {
    expect(CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER).toBe(true);
    expect([...READONLY_ANALYSIS_ADVANCE_STATES]).toEqual([
      "queued",
      "retrieving",
      "synthesizing",
      "verifying",
    ]);
    expect(READONLY_ANALYSIS_ADVANCE_STATES).not.toContain("executing");
    expect(READONLY_ANALYSIS_DRIVE_BOUND).toBe(4);
    const ports = productionReadonlyAnalysisPorts({
      ownerId: CASE_ID,
      refreshRuns: async () => undefined,
    });
    expect(ports.surfaceEnabled).toBe(true);
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
      observation("completed", "settled_known", "known"),
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
      observation("awaiting_approval", "released_uncontacted", "none"),
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
    expect(invocation).toMatchObject({
      ok: false,
      reason: "outcome_indeterminate",
      runId: RUN_ID,
    });
    expect(describeReadonlyAnalysisResult(invocation)).toContain("UNKNOWN/INDETERMINATE");
    expect(deniesContactCertainty(describeReadonlyAnalysisResult(invocation))).toBe(true);
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
      readRun: async () => observation("completed", "settled_known", "known"),
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
        readRun: async () => observation("completed", "settled_known", "known"),
        refreshRuns: async () => undefined,
      },
      createReadonlyAnalysisSession(() => "provider-attempt:invented"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_input");
    expect(policies).toBe(0);
  });
});

describe("readonly analysis adversarial matrix", () => {
  test("ambiguous transport, invoke error, and malformed bodies reconcile once and do not retry", async () => {
    const transport = countingDrive();
    transport.read = scriptedRead([observation("queued"), observation("completed")]);
    transport.invoke = async () => {
      transport.invokes += 1;
      throw new Error("network reset");
    };
    const transported = await startReadonlyAnalysis(
      ownerInput(),
      transport.ports(),
      createReadonlyAnalysisSession(() => "transport"),
    );
    expect(transported).toMatchObject({
      ok: false,
      reason: "outcome_indeterminate",
      status: "completed",
      runId: RUN_ID,
    });
    expect(transport.invokes).toBe(1);
    const transportedText = describeReadonlyAnalysisResult(transported);
    expect(transportedText).toContain("Recorded usage is unclaimed");
    expect(transportedText).toContain("outcome is not established");
    expect(transportedText).not.toContain("stopped at completed");
    expect(deniesContactCertainty(transportedText)).toBe(true);

    const errored = countingDrive();
    errored.read = scriptedRead([observation("queued"), observation("awaiting_approval")]);
    errored.invoke = async () => {
      errored.invokes += 1;
      return { ok: false, state: null, status: null, disposition: "ambiguous" as const };
    };
    const approval = await startReadonlyAnalysis(
      ownerInput(),
      errored.ports(),
      createReadonlyAnalysisSession(() => "invoke-error"),
    );
    expect(approval).toMatchObject({
      ok: false,
      reason: "outcome_indeterminate",
      status: "awaiting_approval",
    });
    expect(errored.invokes).toBe(1);
    expect(describeReadonlyAnalysisResult(approval)).toContain("Recorded usage is unclaimed");
    expect(describeReadonlyAnalysisResult(approval)).not.toContain("stopped at awaiting_approval");

    const held = countingDrive();
    held.read = scriptedRead([
      observation("queued"),
      observation("synthesizing", "held", "unknown"),
    ]);
    held.invoke = async () => {
      held.invokes += 1;
      return { ok: false, state: null, status: null };
    };
    const unresolved = await startReadonlyAnalysis(
      ownerInput(),
      held.ports(),
      createReadonlyAnalysisSession(() => "held-ambiguous"),
    );
    expect(unresolved).toMatchObject({ ok: true, stop: "held" });
    expect(describeReadonlyAnalysisResult(unresolved)).toContain("may already have happened");
    expect(deniesContactCertainty(describeReadonlyAnalysisResult(unresolved))).toBe(true);
    expect(held.invokes).toBe(1);

    const advanced = countingDrive();
    advanced.read = scriptedRead([observation("queued"), observation("retrieving")]);
    advanced.invoke = async () => {
      advanced.invokes += 1;
      return { ok: true, state: null, status: null };
    };
    const durable = await startReadonlyAnalysis(
      ownerInput(),
      advanced.ports(),
      createReadonlyAnalysisSession(() => "malformed"),
    );
    expect(durable).toMatchObject({ ok: true, stop: "durable", status: "retrieving", advances: 1 });
    expect(advanced.invokes).toBe(1);
    expect(describeReadonlyAnalysisResult(durable)).toContain("retrieving");
    expect(deniesContactCertainty(describeReadonlyAnalysisResult(durable))).toBe(true);

    const unreadable = countingDrive();
    unreadable.read = scriptedRead([observation("queued"), null]);
    unreadable.invoke = async () => {
      unreadable.invokes += 1;
      return { ok: false, state: null, status: null, disposition: "ambiguous" as const };
    };
    const unknown = await startReadonlyAnalysis(
      ownerInput(),
      unreadable.ports(),
      createReadonlyAnalysisSession(() => "unreadable"),
    );
    expect(unknown).toMatchObject({ ok: false, reason: "outcome_indeterminate", runId: RUN_ID });
    expect(describeReadonlyAnalysisResult(unknown)).toContain("UNKNOWN/INDETERMINATE");
    expect(deniesContactCertainty(describeReadonlyAnalysisResult(unknown))).toBe(true);
    expect(unreadable.invokes).toBe(1);
  });

  test("an unresolved start keeps its keys and a later stopped start rotates both", async () => {
    let n = 0;
    const session = createReadonlyAnalysisSession(() => `identity-${++n}`);
    let invokes = 0;
    const runKeys: string[] = [];
    const objectives = new Map<string, string>();
    const ports: ReadonlyAnalysisPorts = {
      surfaceEnabled: true,
      ensurePolicy: async () => ({ policyId: POLICY_ID }),
      createRun: async (_caseId, idempotencyKey, payload) => {
        const previous = objectives.get(idempotencyKey);
        if (previous !== undefined && previous !== payload.objective) {
          throw new Error("23505 idempotency_key was already used for a different run request");
        }
        objectives.set(idempotencyKey, payload.objective);
        runKeys.push(idempotencyKey);
        return { runId: runKeys.length === 1 ? RUN_ID : RUN_B };
      },
      invoke: async () => {
        invokes += 1;
        throw new Error("socket hang up");
      },
      readRun: async () => observation("queued"),
      refreshRuns: async () => undefined,
    };
    const first = await startReadonlyAnalysis(ownerInput(), ports, session);
    expect(first).toMatchObject({ ok: false, reason: "outcome_indeterminate" });
    const runKey = session.runIdempotencyKey();
    const invocationKey = session.invocationKey();
    const recovery = await startReadonlyAnalysis(
      { ...ownerInput(), objective: "Changing the draft must not open a second run yet." },
      ports,
      session,
    );
    expect(invokes).toBe(1);
    expect(runKeys).toEqual([runKey]);
    expect(session.runIdempotencyKey()).toBe(runKey);
    expect(session.invocationKey()).toBe(invocationKey);
    expect(recovery.ok).toBe(false);
    expect(deniesContactCertainty(describeReadonlyAnalysisResult(recovery))).toBe(true);

    const freshKeys: string[] = [];
    const freshObjectives = new Map<string, string>();
    const stopped = createReadonlyAnalysisSession(() => `fresh-${++n}`);
    const stoppedPorts: ReadonlyAnalysisPorts = {
      surfaceEnabled: true,
      ensurePolicy: async () => ({ policyId: POLICY_ID }),
      createRun: async (_caseId, idempotencyKey, payload) => {
        const previous = freshObjectives.get(idempotencyKey);
        if (previous !== undefined && previous !== payload.objective) {
          throw new Error("23505 idempotency_key was already used for a different run request");
        }
        freshObjectives.set(idempotencyKey, payload.objective);
        freshKeys.push(idempotencyKey);
        return { runId: freshKeys.length === 1 ? RUN_ID : RUN_B };
      },
      invoke: async () => ({ ok: true, state: "advanced", status: null, disposition: "responded" }),
      readRun: async () => observation("completed", "settled_known", "known"),
      refreshRuns: async () => undefined,
    };
    const runA = await startReadonlyAnalysis(ownerInput(), stoppedPorts, stopped);
    const runB = await startReadonlyAnalysis(
      { ...ownerInput(), objective: "What does the next admitted record support?" },
      stoppedPorts,
      stopped,
    );
    expect(runA).toMatchObject({ ok: true, stop: "completed", runId: RUN_ID });
    expect(runB).toMatchObject({ ok: true, stop: "completed", runId: RUN_B });
    expect(freshKeys).toHaveLength(2);
    expect(freshKeys[0]).not.toBe(freshKeys[1]);
    expect(runA.ok && runB.ok && runA.invocationKey !== runB.invocationKey).toBe(true);
    expect(freshKeys.every((key) => !key.startsWith("provider-attempt:"))).toBe(true);
  });

  test("overlapping submit is one operation", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;
    const keys: string[] = [];
    const ports: ReadonlyAnalysisPorts = {
      surfaceEnabled: true,
      ensurePolicy: async () => {
        await gate;
        return { policyId: POLICY_ID };
      },
      createRun: async (_caseId, idempotencyKey) => {
        runs += 1;
        keys.push(idempotencyKey);
        return { runId: RUN_ID };
      },
      invoke: async () => ({ ok: true, state: "advanced", status: null }),
      readRun: async () => observation("completed", "settled_known", "known"),
      refreshRuns: async () => undefined,
    };
    const session = createReadonlyAnalysisSession(() => "same-operation");
    const first = startReadonlyAnalysis(ownerInput(), ports, session);
    const second = await startReadonlyAnalysis(ownerInput(), ports, session);
    expect(second).toEqual({ ok: false, reason: "start_already_in_progress" });
    release();
    await first;
    expect(runs).toBe(1);
    expect(keys).toEqual(["readonly-run:same-operation"]);
  });

  test("readonly driving stops at executing, terminals, approval, and malformed states", async () => {
    const initial = countingDrive();
    initial.read = async () => observation("executing");
    const blocked = await startReadonlyAnalysis(
      ownerInput(),
      initial.ports(),
      createReadonlyAnalysisSession(() => "exec-initial"),
    );
    expect(blocked).toMatchObject({ ok: false, reason: "authority_boundary", status: "executing" });
    expect(initial.invokes).toBe(0);
    expect(describeReadonlyAnalysisResult(blocked)).toContain("does not invoke");
    expect(describeReadonlyAnalysisResult(blocked)).not.toContain("again");

    const between = countingDrive();
    between.read = scriptedRead([observation("queued"), observation("executing")]);
    const moved = await startReadonlyAnalysis(
      ownerInput(),
      between.ports(),
      createReadonlyAnalysisSession(() => "exec-between"),
    );
    expect(moved).toMatchObject({ ok: false, reason: "authority_boundary" });
    expect(between.invokes).toBe(1);
    expect(describeReadonlyAnalysisResult(moved)).toContain(
      "will not invoke the Edge function again",
    );
    expect(describeReadonlyAnalysisResult(moved)).not.toContain("does not invoke");

    const claimed = countingDrive();
    claimed.read = scriptedRead([observation("retrieving"), observation("executing")]);
    claimed.invoke = async (body) => {
      claimed.invokes += 1;
      claimed.bodies.push(body);
      return { ok: true, state: "advanced", status: "executing", disposition: "responded" };
    };
    const lied = await startReadonlyAnalysis(
      ownerInput(),
      claimed.ports(),
      createReadonlyAnalysisSession(() => "exec-claimed"),
    );
    expect(lied).toMatchObject({ ok: false, reason: "authority_boundary" });
    expect(claimed.invokes).toBe(1);

    const approval = countingDrive();
    approval.read = async () => observation("awaiting_approval");
    await startReadonlyAnalysis(
      ownerInput(),
      approval.ports(),
      createReadonlyAnalysisSession(() => "approval-initial"),
    );
    expect(approval.invokes).toBe(0);

    const terminal = countingDrive();
    terminal.read = async () => observation("failed");
    await startReadonlyAnalysis(
      ownerInput(),
      terminal.ports(),
      createReadonlyAnalysisSession(() => "terminal-initial"),
    );
    expect(terminal.invokes).toBe(0);

    const malformed = countingDrive();
    malformed.read = async () => observation("not-a-state");
    const bad = await startReadonlyAnalysis(
      ownerInput(),
      malformed.ports(),
      createReadonlyAnalysisSession(() => "malformed"),
    );
    expect(bad).toMatchObject({ ok: false, reason: "outcome_indeterminate" });
    expect(malformed.invokes).toBe(0);

    const verifying = countingDrive();
    verifying.read = scriptedRead([
      observation("verifying"),
      observation("completed", "settled_known", "known"),
    ]);
    const verified = await startReadonlyAnalysis(
      ownerInput(),
      verifying.ports(),
      createReadonlyAnalysisSession(() => "verify"),
    );
    expect(verified).toMatchObject({ ok: true, stop: "completed", advances: 1 });
    expect(verifying.invokes).toBe(1);
  });

  test("a reloaded session does not start a second run while persisted work is uncertain", async () => {
    const calls = { policy: 0, run: 0, invoke: 0 };
    const uncertain: ReadonlyAnalysisPorts = {
      surfaceEnabled: true,
      persistedRuns: () => [
        {
          id: RUN_ID,
          caseId: CASE_ID,
          status: "synthesizing",
          holdStatus: "held",
          usageKnowledge: "unknown",
          failureCode: "openai_timeout",
        },
      ],
      ensurePolicy: async () => {
        calls.policy += 1;
        return { policyId: POLICY_ID };
      },
      createRun: async () => {
        calls.run += 1;
        return { runId: RUN_B };
      },
      invoke: async () => {
        calls.invoke += 1;
        return { ok: true, state: "advanced", status: null };
      },
      readRun: async () => observation("synthesizing", "held", "unknown"),
      refreshRuns: async () => undefined,
    };
    const reloaded = await startReadonlyAnalysis(
      { ...ownerInput(), objective: "A reload must not spend against a new idempotency key." },
      uncertain,
      createReadonlyAnalysisSession(() => "reloaded-session"),
    );
    expect(reloaded).toMatchObject({ ok: false, reason: "unresolved_run", runId: RUN_ID });
    expect(describeReadonlyAnalysisResult(reloaded)).not.toContain("failed");
    expect(deniesContactCertainty(describeReadonlyAnalysisResult(reloaded))).toBe(true);
    expect(calls).toEqual({ policy: 0, run: 0, invoke: 0 });

    const settled: ReadonlyAnalysisPorts = {
      ...uncertain,
      persistedRuns: () => [
        {
          id: RUN_ID,
          caseId: CASE_ID,
          status: "completed",
          holdStatus: "settled_known",
          usageKnowledge: "known",
          failureCode: null,
        },
      ],
      readRun: async () => observation("completed", "settled_known", "known"),
    };
    const next = await startReadonlyAnalysis(
      ownerInput(),
      settled,
      createReadonlyAnalysisSession(() => "after-settled"),
    );
    expect(next).toMatchObject({ ok: true, stop: "completed" });
    expect(calls.run).toBe(1);
    expect(next.ok && next.holdResolved).toBe(true);
  });

  test("a terminal or approval row with an unresolved hold does not spend on later clicks", async () => {
    for (const status of ["failed", "cancelled", "awaiting_approval"] as const) {
      let n = 0;
      const session = createReadonlyAnalysisSession(() => `${status}-ambiguous-${++n}`);
      let invokes = 0;
      let creates = 0;
      const ports: ReadonlyAnalysisPorts = {
        surfaceEnabled: true,
        ensurePolicy: async () => ({ policyId: POLICY_ID }),
        createRun: async () => {
          creates += 1;
          return { runId: RUN_ID };
        },
        invoke: async () => {
          invokes += 1;
          return { ok: false, state: null, status: null, disposition: "ambiguous" as const };
        },
        readRun: scriptedRead([observation("queued"), observation(status, "held", "unknown")]),
        refreshRuns: async () => undefined,
      };
      const first = await startReadonlyAnalysis(ownerInput(), ports, session);
      const runKey = session.runIdempotencyKey();
      const invocationKey = session.invocationKey();
      const second = await startReadonlyAnalysis(ownerInput(), ports, session);
      const third = await startReadonlyAnalysis(ownerInput(), ports, session);
      expect(first).toMatchObject({ ok: true, stop: "held", status, holdResolved: false });
      expect(second).toMatchObject({ ok: true, stop: "held", status });
      expect(third).toMatchObject({ ok: true, stop: "held", status });
      expect(invokes).toBe(1);
      expect(creates).toBe(1);
      expect(session.runIdempotencyKey()).toBe(runKey);
      expect(session.invocationKey()).toBe(invocationKey);
      for (const result of [first, second, third]) {
        const text = describeReadonlyAnalysisResult(result);
        expect(deniesContactCertainty(text)).toBe(true);
        expect(text.toLowerCase()).not.toContain("no provider call was made");
      }
    }
  });

  test("a recognized failure with a held reservation stays held across resume clicks", async () => {
    let n = 0;
    const session = createReadonlyAnalysisSession(() => `recognized-${++n}`);
    let invokes = 0;
    let creates = 0;
    const ports: ReadonlyAnalysisPorts = {
      surfaceEnabled: true,
      ensurePolicy: async () => ({ policyId: POLICY_ID }),
      createRun: async () => {
        creates += 1;
        return { runId: RUN_ID };
      },
      invoke: async () => {
        invokes += 1;
        return { ok: true, state: "advanced", status: null, disposition: "responded" as const };
      },
      readRun: scriptedRead([observation("queued"), observation("failed", "held", "unknown")]),
      refreshRuns: async () => undefined,
    };
    const first = await startReadonlyAnalysis(ownerInput(), ports, session);
    const runKey = session.runIdempotencyKey();
    const invocationKey = session.invocationKey();
    const resume = await startReadonlyAnalysis(ownerInput(), ports, session);
    const later = await startReadonlyAnalysis(ownerInput(), ports, session);
    expect(first).toMatchObject({ ok: true, stop: "held", status: "failed" });
    expect(resume).toMatchObject({ ok: true, stop: "held", status: "failed" });
    expect(later).toMatchObject({ ok: true, stop: "held", status: "failed" });
    expect(invokes).toBe(1);
    expect(creates).toBe(1);
    expect(session.runIdempotencyKey()).toBe(runKey);
    expect(session.invocationKey()).toBe(invocationKey);
  });

  test("a visible stop with a missing or held reservation blocks a new start", async () => {
    for (const row of [
      { status: "failed", holdStatus: null, usageKnowledge: null },
      { status: "cancelled", holdStatus: null, usageKnowledge: null },
      { status: "failed", holdStatus: "held" as const, usageKnowledge: "unknown" as const },
      { status: "cancelled", holdStatus: "held" as const, usageKnowledge: "unknown" as const },
    ]) {
      const calls = { policy: 0, run: 0, invoke: 0 };
      const result = await startReadonlyAnalysis(
        ownerInput(),
        {
          surfaceEnabled: true,
          persistedRuns: () => [
            {
              id: RUN_ID,
              caseId: CASE_ID,
              status: row.status,
              holdStatus: row.holdStatus,
              usageKnowledge: row.usageKnowledge,
              failureCode: "openai_timeout",
            },
          ],
          ensurePolicy: async () => {
            calls.policy += 1;
            return { policyId: POLICY_ID };
          },
          createRun: async () => {
            calls.run += 1;
            return { runId: RUN_B };
          },
          invoke: async () => {
            calls.invoke += 1;
            return { ok: true, state: "advanced", status: null };
          },
          readRun: async () => observation(row.status, row.holdStatus, row.usageKnowledge),
          refreshRuns: async () => undefined,
        },
        createReadonlyAnalysisSession(() => `list-${row.status}-${row.holdStatus ?? "missing"}`),
      );
      expect(result).toMatchObject({ ok: false, reason: "unresolved_run", runId: RUN_ID });
      expect(calls).toEqual({ policy: 0, run: 0, invoke: 0 });
      expect(deniesContactCertainty(describeReadonlyAnalysisResult(result))).toBe(true);
    }
  });

  test("a pre-provider blocked row with a confirmed absent reservation does not block a new start", async () => {
    const started = await startAfterListed(listedRun("blocked", "available"));
    expect(started.creates).toBe(1);
    expect(started.invokes).toBe(1);
    expect(started.result).toMatchObject({
      ok: true,
      stop: "completed",
      runId: RUN_B,
      holdResolved: true,
    });
  });

  test("a budget_stopped row with a confirmed absent reservation does not block a new start", async () => {
    const started = await startAfterListed(listedRun("budget_stopped", "available"));
    expect(started.creates).toBe(1);
    expect(started.invokes).toBe(1);
    expect(started.result).toMatchObject({ ok: true, stop: "completed", runId: RUN_B });
  });

  test("cancellation before a provider reservation does not block a new start", async () => {
    const started = await startAfterListed(listedRun("cancelled", "available"));
    expect(started.creates).toBe(1);
    expect(started.invokes).toBe(1);
    expect(started.result).toMatchObject({ ok: true, stop: "completed", runId: RUN_B });
    expect(describeReadonlyAnalysisResult(started.result)).not.toContain("UNKNOWN/INDETERMINATE");
  });

  test("an unavailable hold projection on a pre-provider terminal stays indeterminate", async () => {
    for (const status of ["blocked", "budget_stopped", "cancelled"] as const) {
      const started = await startAfterListed(listedRun(status, "unavailable"));
      expect(started.creates).toBe(0);
      expect(started.invokes).toBe(0);
      expect(started.result).toMatchObject({
        ok: false,
        reason: "unresolved_run",
        runId: RUN_ID,
        status,
      });
      const text = describeReadonlyAnalysisResult(started.result);
      expect(text).toContain("A new analysis was not started");
      expect(deniesContactCertainty(text)).toBe(true);

      let invokes = 0;
      const session = createReadonlyAnalysisSession(() => `unread-${status}`);
      const ports: ReadonlyAnalysisPorts = {
        surfaceEnabled: true,
        ensurePolicy: async () => ({ policyId: POLICY_ID }),
        createRun: async () => ({ runId: RUN_ID }),
        invoke: async () => {
          invokes += 1;
          return { ok: false, state: null, status: null, disposition: "ambiguous" as const };
        },
        readRun: scriptedRead([
          observation("queued"),
          observation(status, null, null, "unavailable"),
        ]),
        refreshRuns: async () => undefined,
      };
      const first = await startReadonlyAnalysis(ownerInput(), ports, session);
      const second = await startReadonlyAnalysis(ownerInput(), ports, session);
      expect(first).toMatchObject({ ok: false, reason: "outcome_indeterminate", status });
      expect(describeReadonlyAnalysisResult(first)).toContain("Recorded usage is unclaimed");
      expect(second).toMatchObject({ ok: false, reason: "outcome_indeterminate", status });
      expect(invokes).toBe(1);
    }
  });

  test("a completed row with an unexpected missing reservation stays conservative", async () => {
    const absent = await startAfterListed(listedRun("completed", "available"));
    expect(absent.creates).toBe(0);
    expect(absent.invokes).toBe(0);
    expect(absent.result).toMatchObject({
      ok: false,
      reason: "unresolved_run",
      status: "completed",
    });

    let invokes = 0;
    const session = createReadonlyAnalysisSession(() => "completed-absent");
    const ports: ReadonlyAnalysisPorts = {
      surfaceEnabled: true,
      ensurePolicy: async () => ({ policyId: POLICY_ID }),
      createRun: async () => ({ runId: RUN_ID }),
      invoke: async () => {
        invokes += 1;
        throw new Error("network reset");
      },
      readRun: scriptedRead([
        observation("queued"),
        observation("completed", null, null, "available"),
      ]),
      refreshRuns: async () => undefined,
    };
    const first = await startReadonlyAnalysis(ownerInput(), ports, session);
    const second = await startReadonlyAnalysis(ownerInput(), ports, session);
    expect(first).toMatchObject({
      ok: false,
      reason: "outcome_indeterminate",
      status: "completed",
    });
    expect(describeReadonlyAnalysisResult(first)).toContain("outcome is not established");
    expect(describeReadonlyAnalysisResult(first)).not.toContain("stopped at completed");
    expect(second).toMatchObject({ ok: false, reason: "outcome_indeterminate" });
    expect(invokes).toBe(1);

    const proved = await startAfterListed({
      ...listedRun("completed", "available"),
      holdStatus: "released_uncontacted",
      usageKnowledge: "none",
    });
    expect(proved.creates).toBe(1);
    expect(proved.result).toMatchObject({ ok: true, stop: "completed", holdResolved: true });
  });

  test("a held or unknown reservation stays unresolved when the projection is available", async () => {
    for (const row of [
      listedRun("failed", "available", "held", "unknown"),
      listedRun("cancelled", "available", "held", "unknown"),
      listedRun("blocked", "available", "held", "unknown"),
    ]) {
      const started = await startAfterListed(row);
      expect(started.creates).toBe(0);
      expect(started.invokes).toBe(0);
      expect(started.result).toMatchObject({ ok: false, reason: "unresolved_run", runId: RUN_ID });
    }

    let invokes = 0;
    const session = createReadonlyAnalysisSession(() => "held-available");
    const ports: ReadonlyAnalysisPorts = {
      surfaceEnabled: true,
      ensurePolicy: async () => ({ policyId: POLICY_ID }),
      createRun: async () => ({ runId: RUN_ID }),
      invoke: async () => {
        invokes += 1;
        return { ok: true, state: "advanced", status: null, disposition: "responded" as const };
      },
      readRun: scriptedRead([
        observation("queued"),
        observation("cancelled", "held", "unknown", "available"),
      ]),
      refreshRuns: async () => undefined,
    };
    const first = await startReadonlyAnalysis(ownerInput(), ports, session);
    const runKey = session.runIdempotencyKey();
    const invocationKey = session.invocationKey();
    const second = await startReadonlyAnalysis(ownerInput(), ports, session);
    expect(first).toMatchObject({
      ok: true,
      stop: "held",
      holdResolved: false,
      status: "cancelled",
    });
    expect(second).toMatchObject({ ok: true, stop: "held", status: "cancelled" });
    expect(invokes).toBe(1);
    expect(session.runIdempotencyKey()).toBe(runKey);
    expect(session.invocationKey()).toBe(invocationKey);
    expect(describeReadonlyAnalysisResult(first)).toContain("may already have happened");
  });

  test("a fresh start succeeds after a confirmed pre-provider terminal run", async () => {
    let creates = 0;
    let invokes = 0;
    let keys = 0;
    const session = createReadonlyAnalysisSession(() => `pre-provider-then-fresh-${++keys}`);
    const prior = listedRun("blocked", "available");
    const ports: ReadonlyAnalysisPorts = {
      surfaceEnabled: true,
      persistedRuns: () => [prior],
      ensurePolicy: async () => ({ policyId: POLICY_ID }),
      createRun: async () => {
        creates += 1;
        return { runId: creates === 1 ? RUN_ID : RUN_B };
      },
      invoke: async () => {
        invokes += 1;
        return { ok: true, state: "advanced", status: null, disposition: "responded" as const };
      },
      readRun: scriptedRead([
        observation("queued"),
        observation("blocked", null, null, "available"),
        observation("queued"),
        observation("completed", "settled_known", "known"),
      ]),
      refreshRuns: async () => undefined,
    };
    const first = await startReadonlyAnalysis(ownerInput(), ports, session);
    const firstKey = session.runIdempotencyKey();
    const second = await startReadonlyAnalysis(
      { ...ownerInput(), objective: "A later objective after the pre-provider stop." },
      ports,
      session,
    );
    expect(first).toMatchObject({
      ok: true,
      stop: "blocked",
      runId: RUN_ID,
      holdResolved: true,
      advances: 1,
    });
    expect(describeReadonlyAnalysisResult(first)).toContain("stopped at blocked");
    expect(describeReadonlyAnalysisResult(first)).not.toContain("UNKNOWN/INDETERMINATE");
    expect(second).toMatchObject({
      ok: true,
      stop: "completed",
      runId: RUN_B,
      holdResolved: true,
    });
    expect(creates).toBe(2);
    expect(invokes).toBe(2);
    expect(session.runIdempotencyKey()).not.toBe(firstKey);
    const mapped = observationForCustodianRun(
      { status: "blocked", failureCode: null, providerHold: null },
      "available",
    );
    expect(mapped.holdProjection).toBe("available");
    expect(mapped.holdStatus).toBeNull();
  });

  test("the second-start guard only sees the loaded run list for this tab and case", async () => {
    expect(CUSTODIAN_RUN_READ_LIMIT).toBe(100);
    const otherCase = "00000000-0000-4000-8000-000000000099";
    for (const persistedRuns of [
      () => [] as const,
      () => [
        {
          id: RUN_B,
          caseId: otherCase,
          status: "failed",
          holdStatus: "held" as const,
          usageKnowledge: "unknown" as const,
          failureCode: "openai_timeout",
        },
      ],
    ]) {
      let creates = 0;
      const result = await startReadonlyAnalysis(
        ownerInput(),
        {
          surfaceEnabled: true,
          persistedRuns,
          ensurePolicy: async () => ({ policyId: POLICY_ID }),
          createRun: async () => {
            creates += 1;
            return { runId: RUN_ID };
          },
          invoke: async () => ({
            ok: true,
            state: "advanced",
            status: null,
            disposition: "responded" as const,
          }),
          readRun: async () => observation("completed", "settled_known", "known"),
          refreshRuns: async () => undefined,
        },
        createReadonlyAnalysisSession(() => `loaded-list-${creates}`),
      );
      expect(creates).toBe(1);
      expect(result).toMatchObject({
        ok: true,
        stop: "completed",
        runId: RUN_ID,
        holdResolved: true,
      });
    }
  });

  test("a response label does not finish a run that is still driving", async () => {
    for (const state of ["blocked", "failed", "paused"] as const) {
      let invokes = 0;
      let creates = 0;
      const session = createReadonlyAnalysisSession(() => `label-${state}`);
      const ports: ReadonlyAnalysisPorts = {
        surfaceEnabled: true,
        ensurePolicy: async () => ({ policyId: POLICY_ID }),
        createRun: async () => {
          creates += 1;
          return { runId: RUN_ID };
        },
        invoke: async () => {
          invokes += 1;
          return { ok: true, state, status: null, disposition: "responded" as const };
        },
        readRun: scriptedRead([observation("synthesizing"), observation("synthesizing")]),
        refreshRuns: async () => undefined,
      };
      const first = await startReadonlyAnalysis(ownerInput(), ports, session);
      const runKey = session.runIdempotencyKey();
      const invocationKey = session.invocationKey();
      const second = await startReadonlyAnalysis(ownerInput(), ports, session);
      expect(first).toMatchObject({
        ok: false,
        reason: "run_did_not_advance",
        status: "synthesizing",
      });
      expect(describeReadonlyAnalysisResult(first)).not.toContain("No further call was made");
      expect(describeReadonlyAnalysisResult(first)).toContain(
        "will not invoke the Edge function again",
      );
      expect(second).toMatchObject({
        ok: false,
        reason: "outcome_indeterminate",
        status: "synthesizing",
      });
      expect(invokes).toBe(1);
      expect(creates).toBe(1);
      expect(session.runIdempotencyKey()).toBe(runKey);
      expect(session.invocationKey()).toBe(invocationKey);
    }
  });

  test("invocation bodies stay limited to runId and invocationKey", async () => {
    const drive = harness([
      observation("queued"),
      observation("retrieving"),
      observation("synthesizing"),
      observation("verifying"),
      observation("completed"),
    ]);
    await startReadonlyAnalysis(
      ownerInput(),
      drive.ports,
      createReadonlyAnalysisSession(() => "browser-session"),
    );
    expect(drive.bodies.length).toBeGreaterThan(0);
    for (const body of drive.bodies) {
      expect(Object.keys(body)).toEqual(["runId", "invocationKey"]);
      expect(body.invocationKey.startsWith("provider-attempt:")).toBe(false);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("owner");
      expect(serialized).not.toContain("model");
      expect(serialized).not.toContain("budget");
      expect(serialized).not.toContain("approval");
      expect(serialized).not.toContain("tool");
      expect(serialized).not.toContain("provider-attempt:");
    }
    const source = await Bun.file(new URL("./custodian-readonly-run.ts", import.meta.url)).text();
    expect(source).not.toContain("provider-attempt:${");
  });
});

const RUN_B = "00000000-0000-4000-8000-000000000012";

function deniesContactCertainty(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    "was not advanced",
    "not advanced further",
    "not contacted",
    "never contacted",
    "zero spend",
    "nothing happened",
    "did not advance",
  ].every((phrase) => !lower.includes(phrase));
}

async function startAfterListed(row: PersistedReadonlyRun) {
  let creates = 0;
  let invokes = 0;
  const result = await startReadonlyAnalysis(
    ownerInput(),
    {
      surfaceEnabled: true,
      persistedRuns: () => [row],
      ensurePolicy: async () => ({ policyId: POLICY_ID }),
      createRun: async () => {
        creates += 1;
        return { runId: RUN_B };
      },
      invoke: async () => {
        invokes += 1;
        return { ok: true, state: "advanced", status: null, disposition: "responded" as const };
      },
      readRun: scriptedRead([
        observation("queued"),
        observation("completed", "settled_known", "known"),
      ]),
      refreshRuns: async () => undefined,
    },
    createReadonlyAnalysisSession(
      () => `after-${row.status}-${row.holdProjection ?? "omitted"}-${row.holdStatus ?? "none"}`,
    ),
  );
  return { creates, invokes, result };
}

function scriptedRead(script: Array<ReadonlyRunObservation | null>) {
  let reads = 0;
  return async () => script[Math.min(reads++, Math.max(script.length - 1, 0))] ?? null;
}

function countingDrive() {
  const state: {
    invokes: number;
    policies: number;
    runs: number;
    bodies: Array<{ runId: string; invocationKey: string }>;
    read: () => Promise<ReadonlyRunObservation | null>;
    invoke: ReadonlyAnalysisPorts["invoke"];
  } = {
    invokes: 0,
    policies: 0,
    runs: 0,
    bodies: [],
    read: async () => observation("queued"),
    invoke: async (body) => {
      state.invokes += 1;
      state.bodies.push(body);
      return { ok: true, state: "advanced", status: null, disposition: "responded" as const };
    },
  };
  return {
    get invokes() {
      return state.invokes;
    },
    set invokes(value: number) {
      state.invokes = value;
    },
    get bodies() {
      return state.bodies;
    },
    set read(value: () => Promise<ReadonlyRunObservation | null>) {
      state.read = value;
    },
    set invoke(value: ReadonlyAnalysisPorts["invoke"]) {
      state.invoke = value;
    },
    ports(): ReadonlyAnalysisPorts {
      return {
        surfaceEnabled: true,
        ensurePolicy: async () => {
          state.policies += 1;
          return { policyId: POLICY_ID };
        },
        createRun: async () => {
          state.runs += 1;
          return { runId: RUN_ID };
        },
        invoke: (body) => state.invoke(body),
        readRun: () => state.read(),
        refreshRuns: async () => undefined,
      };
    },
  };
}
