// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { mapCustodianRunRow, mapProviderHoldRow, mapRunStepRow } from "@/lib/custodian-runtime";
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
});
