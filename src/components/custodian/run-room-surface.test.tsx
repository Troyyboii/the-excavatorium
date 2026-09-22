// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mapCustodianRunRow, mapProviderHoldRow, mapRunStepRow } from "@/lib/custodian-runtime";
import {
  type ReadonlyAnalysisPorts,
  type ReadonlyRunObservation,
} from "@/lib/custodian-readonly-run";
import { RunRoomSurface } from "./run-room-surface";

afterEach(() => cleanup());

function run() {
  return {
    ...mapCustodianRunRow({
      id: "00000000-0000-4000-8000-000000000001",
      case_id: "00000000-0000-4000-8000-000000000002",
      objective: "What does the selected evidence support?",
      model_tier: "terra",
      status: "failed",
      budget_tokens: 2_000,
      budget_cost_usd: 0.1,
      budget_latency_ms: 30_000,
      budget_tool_events: 1,
      tokens_used: 0,
      cost_usd: 0,
      latency_ms: 12,
      tool_events_count: 0,
      last_step_number: 2,
      failure_code: "openai_timeout",
      failure_message: "Usage is unknown and the hold remains.",
      cancel_requested_at: "2026-09-21T19:05:00.000Z",
      created_at: "2026-09-21T19:00:00.000Z",
      updated_at: "2026-09-21T19:06:00.000Z",
    }),
    providerHold: mapProviderHoldRow({
      id: "00000000-0000-4000-8000-000000000010",
      run_id: "00000000-0000-4000-8000-000000000001",
      status: "held",
      usage_knowledge: "unknown",
      hold_tokens: 400,
      hold_cost_usd: 0.05,
      actual_tokens: null,
      actual_cost_usd: null,
      pricing_version: "2026-09-21",
      failure_code: "openai_timeout",
      in_flight_until: "2026-09-21T19:02:00.000Z",
      updated_at: "2026-09-21T19:01:00.000Z",
    }),
    latestStep: mapRunStepRow({
      run_id: "00000000-0000-4000-8000-000000000001",
      step_kind: "synthesize",
      status: "failed",
      sequence_no: 2,
    }),
  };
}

describe("Run Room surface", () => {
  test("shows recorded cost separately from a held budget and keeps start disabled", () => {
    render(
      <RunRoomSurface
        runs={[run()]}
        providerHoldProjection="available"
        online
        loading={false}
        error={null}
      />,
    );
    const start = screen.getByRole("button", { name: "Start analysis" });
    expect(start.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(
        "Provider invocation stays off until a later activation milestone. No analysis is being started.",
      ),
    ).not.toBeNull();
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(screen.getByText("$0.0500 encumbered · 400 tokens")).not.toBeNull();
    expect(screen.getByText("openai_timeout")).not.toBeNull();
    expect(screen.getByText(/does not prove the provider was never contacted/)).not.toBeNull();
    expect(screen.getByText("synthesize · failed")).not.toBeNull();
    expect(
      screen.getByText(
        "Budget currently held is encumbered allowance. It is not money recorded as spent. An unresolved hold means provider contact may already have happened.",
      ),
    ).not.toBeNull();
  });

  test("explains an unavailable hold projection without inventing spend", () => {
    render(
      <RunRoomSurface
        runs={[]}
        providerHoldProjection="unavailable"
        online
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Provider hold records unavailable")).not.toBeNull();
    expect(screen.getByText("No persisted runs.")).not.toBeNull();
    expect(screen.queryByText("No provider usage recorded.")).toBeNull();
    expect(screen.queryByText("$0.0000")).toBeNull();
  });

  test("an unavailable hold projection does not label a listed run as zero spend", () => {
    const persisted = {
      ...mapCustodianRunRow({
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
      }),
      providerHold: null,
    };
    render(
      <RunRoomSurface
        runs={[persisted]}
        providerHoldProjection="unavailable"
        online
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Provider hold records unavailable")).not.toBeNull();
    expect(screen.getByText(persisted.objective)).not.toBeNull();
    expect(
      screen.getByText("Recorded usage is unclaimed. The invocation outcome is not established."),
    ).not.toBeNull();
    expect(screen.queryByText("No provider usage recorded.")).toBeNull();
    expect(screen.queryByText("$0.0000")).toBeNull();
  });

  test("shows an empty failure state without a placeholder run", () => {
    render(
      <RunRoomSurface
        runs={[]}
        providerHoldProjection="available"
        online={false}
        loading={false}
        error="Network unavailable. Persisted runs cannot be retrieved."
      />,
    );
    expect(
      screen.getByText("Network unavailable. Persisted runs cannot be retrieved."),
    ).not.toBeNull();
    expect(screen.queryByText("No persisted runs.")).toBeNull();
  });

  test("a closed gate ignores owner input and makes no policy or edge call", async () => {
    const user = userEvent.setup();
    let calls = 0;
    render(
      <RunRoomSurface
        runs={[]}
        providerHoldProjection="available"
        online
        loading={false}
        error={null}
        surfaceEnabled={false}
        ports={countingPorts(() => {
          calls += 1;
        })}
      />,
    );
    const start = screen.getByRole("button", { name: "Start analysis" });
    expect(start.hasAttribute("disabled")).toBe(true);
    await user.click(start);
    expect(calls).toBe(0);
    expect(screen.queryByLabelText("objective")).toBeNull();
    expect(screen.queryByText(/Waiting for the persisted run/)).toBeNull();
  });

  test("enabled start validates, then shows a completed persisted run", async () => {
    const user = userEvent.setup();
    const drive = scriptedPorts([
      observed("queued"),
      observed("retrieving"),
      observed("synthesizing"),
      observed("verifying"),
      observed("completed", "settled_known", "known"),
    ]);
    render(enabledRoom(drive.ports));
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(screen.getByText(/case_id is required/)).not.toBeNull();
    expect(drive.policies).toBe(0);

    await fillOwnerInput(user);
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(screen.getByText(/stopped at completed/)).not.toBeNull();
    expect(screen.queryByText(/streaming|thinking|typing/i)).toBeNull();
    expect(drive.policies).toBe(1);
    expect(drive.runs).toBe(1);
    const invocationKey = drive.bodies[0]?.invocationKey;
    expect(drive.bodies).toHaveLength(4);
    expect(
      drive.bodies.every((body) => Object.keys(body).join(",") === "runId,invocationKey"),
    ).toBe(true);
    expect(
      drive.bodies.every((body) => body.runId === RUN_ID && body.invocationKey === invocationKey),
    ).toBe(true);
    expect(invocationKey?.startsWith("provider-attempt:")).toBe(false);
    expect(drive.refreshes).toBeGreaterThan(0);
  });

  test("enabled start reports approval, hold, and invocation failure without another call", async () => {
    const user = userEvent.setup();
    const approval = scriptedPorts([
      observed("queued"),
      observed("retrieving"),
      observed("awaiting_approval", "released_uncontacted", "none"),
    ]);
    const { rerender } = render(enabledRoom(approval.ports));
    await fillOwnerInput(user);
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(screen.getByText(/stopped at awaiting_approval/)).not.toBeNull();

    const held = scriptedPorts([
      observed("queued"),
      observed("retrieving"),
      observed("synthesizing", "held"),
    ]);
    rerender(enabledRoom(held.ports));
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(screen.getByText(/unresolved provider hold/)).not.toBeNull();
    expect(screen.getByText(/Recorded usage is not claimed/)).not.toBeNull();

    const failed = scriptedPorts([observed("queued")], false);
    rerender(enabledRoom(failed.ports));
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(screen.getByText(/UNKNOWN\/INDETERMINATE/)).not.toBeNull();
    expect(screen.queryByText(/was not advanced|not contacted|zero spend/i)).toBeNull();
    expect(failed.bodies).toHaveLength(0);
  });

  test("an ambiguous edge result is reconciled and not retried", async () => {
    const user = userEvent.setup();
    const failed = scriptedPorts([observed("queued"), observed("completed")], false);
    render(enabledRoom(failed.ports));
    await fillOwnerInput(user);
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(screen.getByText(/Recorded usage is unclaimed/)).not.toBeNull();
    expect(screen.getByText(/outcome is not established/)).not.toBeNull();
    expect(screen.queryByText(/stopped at completed/)).toBeNull();
    expect(screen.queryByText(/was not advanced|not contacted|zero spend/i)).toBeNull();
    expect(failed.bodies).toHaveLength(1);
  });

  test("start stays closed for an unhealthy surface and still shows persisted runs", async () => {
    const user = userEvent.setup();
    const calls = { count: 0 };
    const ports = countingPorts(() => {
      calls.count += 1;
    }, true);
    const persisted = run();
    const { rerender } = render(
      <RunRoomSurface
        runs={[persisted]}
        providerHoldProjection="available"
        online={false}
        loading={false}
        error="Network unavailable. Persisted runs cannot be retrieved."
        ownerPresent
        surfaceEnabled
        ports={ports}
      />,
    );
    expect(screen.getByText(persisted.objective)).not.toBeNull();
    expect(screen.getByText(/unavailable while the network is offline/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(calls.count).toBe(0);

    rerender(
      <RunRoomSurface
        runs={[persisted]}
        providerHoldProjection="available"
        online
        loading
        error={null}
        ownerPresent
        surfaceEnabled
        ports={ports}
      />,
    );
    expect(screen.getByText(persisted.objective)).not.toBeNull();
    expect(screen.getByText(/unavailable while persisted runs are loading/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(calls.count).toBe(0);

    rerender(
      <RunRoomSurface
        runs={[persisted]}
        providerHoldProjection="available"
        online
        loading={false}
        error="Custodian runtime storage is unavailable in the connected Supabase project."
        ownerPresent
        surfaceEnabled
        ports={ports}
      />,
    );
    expect(screen.getByText(persisted.objective)).not.toBeNull();
    expect(screen.getByText(/runtime read failed/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(calls.count).toBe(0);

    rerender(
      <RunRoomSurface
        runs={[persisted]}
        providerHoldProjection="available"
        online
        loading={false}
        error={null}
        ownerPresent={false}
        surfaceEnabled
        ports={ports}
      />,
    );
    expect(screen.getByText(persisted.objective)).not.toBeNull();
    expect(screen.getByText(/owner is not signed in/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(calls.count).toBe(0);

    rerender(
      <RunRoomSurface
        runs={[persisted]}
        providerHoldProjection="available"
        online
        loading={false}
        error={null}
        ownerPresent
        surfaceEnabled
        ports={null}
      />,
    );
    expect(screen.getByText(persisted.objective)).not.toBeNull();
    expect(screen.getByText(/runtime ports are not available/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(calls.count).toBe(0);

    rerender(
      <RunRoomSurface
        runs={[persisted]}
        providerHoldProjection="available"
        online
        loading={false}
        error={null}
        ownerPresent
        surfaceEnabled={false}
        ports={ports}
      />,
    );
    expect(screen.getByText(persisted.objective)).not.toBeNull();
    expect(
      screen.getByText(
        "Provider invocation stays off until a later activation milestone. No analysis is being started.",
      ),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(calls.count).toBe(0);
  });

  test("an uncertain persisted run blocks a blind retry and stays visible", async () => {
    const user = userEvent.setup();
    const drive = scriptedPorts([observed("completed")]);
    const persisted = {
      ...run(),
      caseId: "00000000-0000-4000-8000-000000000002",
      status: "synthesizing" as const,
    };
    render(enabledRoom(drive.ports, [persisted]));
    await fillOwnerInput(user);
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(screen.getByText(/A new analysis was not started/)).not.toBeNull();
    expect(screen.getByText(persisted.objective)).not.toBeNull();
    expect(screen.queryByText(/was not advanced|zero spend|not contacted/i)).toBeNull();
    expect(drive.policies).toBe(0);
    expect(drive.runs).toBe(0);
    expect(drive.bodies).toHaveLength(0);
  });

  test("a second click during a start does not repeat policy or run creation", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let policies = 0;
    const ports: ReadonlyAnalysisPorts = {
      ...scriptedPorts([observed("completed", "settled_known", "known")]).ports,
      ensurePolicy: async () => {
        policies += 1;
        await gate;
        return { policyId: POLICY_ID };
      },
    };
    render(enabledRoom(ports));
    await fillOwnerInput(user);
    const button = screen.getByRole("button", { name: "Start analysis" });
    await act(async () => {
      button.click();
      button.click();
    });
    expect(policies).toBe(1);
    await act(async () => {
      release();
    });
    expect(await screen.findByText(/stopped at completed/)).not.toBeNull();
    expect(policies).toBe(1);
  });
});

const POLICY_ID = "00000000-0000-4000-8000-000000000010";
const RUN_ID = "00000000-0000-4000-8000-000000000011";

function observed(
  status: string,
  holdStatus: ReadonlyRunObservation["holdStatus"] = null,
  usageKnowledge: ReadonlyRunObservation["usageKnowledge"] = null,
): ReadonlyRunObservation {
  return { status, holdStatus, failureCode: null, usageKnowledge };
}

function countingPorts(onCall: () => void, surfaceEnabled = false): ReadonlyAnalysisPorts {
  return {
    surfaceEnabled,
    ensurePolicy: async () => {
      onCall();
      return { policyId: POLICY_ID };
    },
    createRun: async () => {
      onCall();
      return { runId: RUN_ID };
    },
    invoke: async () => {
      onCall();
      return { ok: false, state: null, status: null };
    },
    readRun: async () => {
      onCall();
      return null;
    },
    refreshRuns: async () => {
      onCall();
    },
  };
}

function scriptedPorts(script: ReadonlyRunObservation[], invokeOk = true) {
  const bodies: Array<{ runId: string; invocationKey: string }> = [];
  const state = { policies: 0, runs: 0, refreshes: 0, bodies };
  let reads = 0;
  const ports: ReadonlyAnalysisPorts = {
    surfaceEnabled: true,
    ensurePolicy: async () => {
      state.policies += 1;
      return { policyId: POLICY_ID };
    },
    createRun: async () => {
      state.runs += 1;
      return { runId: RUN_ID };
    },
    invoke: async (body) => {
      state.bodies.push(body);
      return { ok: invokeOk, state: invokeOk ? "advanced" : null, status: null };
    },
    readRun: async () => script[Math.min(reads++, Math.max(script.length - 1, 0))] ?? null,
    refreshRuns: async () => {
      state.refreshes += 1;
    },
  };
  return {
    ports,
    get policies() {
      return state.policies;
    },
    get runs() {
      return state.runs;
    },
    get refreshes() {
      return state.refreshes;
    },
    get bodies() {
      return state.bodies;
    },
  };
}

function enabledRoom(ports: ReadonlyAnalysisPorts, runs: ReturnType<typeof run>[] = []) {
  return (
    <RunRoomSurface
      runs={runs}
      providerHoldProjection="available"
      online
      loading={false}
      error={null}
      ownerPresent
      surfaceEnabled
      ports={ports}
    />
  );
}

async function fillOwnerInput(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("case_id"), "00000000-0000-4000-8000-000000000002");
  await user.type(screen.getByLabelText("policy_name"), "owner-readonly");
  await user.click(screen.getByRole("checkbox", { name: "terra" }));
  await user.type(screen.getByLabelText("per_run_token_budget"), "1000");
  await user.type(screen.getByLabelText("per_run_cost_usd"), "1");
  await user.type(screen.getByLabelText("per_run_latency_ms"), "5000");
  await user.type(screen.getByLabelText("per_run_tool_event_budget"), "4");
  await user.type(screen.getByLabelText("daily_token_budget"), "2000");
  await user.type(screen.getByLabelText("monthly_token_budget"), "4000");
  await user.type(screen.getByLabelText("daily_cost_usd"), "2");
  await user.type(screen.getByLabelText("monthly_cost_usd"), "4");
  await user.selectOptions(screen.getByLabelText("model_tier"), "terra");
  await user.type(screen.getByLabelText("prompt_version"), "owner-prompt-1");
  await user.type(screen.getByLabelText("objective"), "What does the admitted record support?");
}
