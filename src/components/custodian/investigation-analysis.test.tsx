// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReadonlyAnalysisPorts } from "@/lib/custodian-readonly-run";
import type { CustodianRun } from "@/lib/custodian-runtime";
import { InvestigationAnalysisPanel } from "./investigation-analysis";

afterEach(() => cleanup());

const CASE_ID = "00000000-0000-4000-8000-000000000002";

function ports(): ReadonlyAnalysisPorts {
  return {
    surfaceEnabled: true,
    ensurePolicy: mock(async () => ({ policyId: "00000000-0000-4000-8000-000000000010" })),
    createRun: mock(async () => ({ runId: "00000000-0000-4000-8000-000000000011" })),
    invoke: mock(async () => ({ ok: true, state: "advanced", status: null })),
    readRun: mock(async () => ({
      status: "completed",
      holdStatus: "settled_known" as const,
      failureCode: null,
      usageKnowledge: "known" as const,
      holdProjection: "available" as const,
    })),
    refreshRuns: mock(async () => undefined),
    acknowledgeUnknownHold: mock(async () => undefined),
  };
}

function failedHeldRun(acknowledged = false): CustodianRun {
  return {
    id: "00000000-0000-4000-8000-000000000011",
    caseId: CASE_ID,
    objective: "Objective",
    modelTier: "luna",
    status: "failed",
    budgetTokens: 40_000,
    budgetCostUsd: 1,
    budgetLatencyMs: 55_000,
    budgetToolEvents: 0,
    tokensUsed: 0,
    costUsd: 0,
    latencyMs: 0,
    toolEventsCount: 0,
    lastStepNumber: 1,
    failureCode: "openai_timeout",
    failureMessage: null,
    cancelRequestedAt: null,
    createdAt: "2026-10-14T19:14:00.000Z",
    updatedAt: "2026-10-14T19:14:55.000Z",
    providerHold: {
      id: "00000000-0000-4000-8000-000000000012",
      runId: "00000000-0000-4000-8000-000000000011",
      status: "held",
      usageKnowledge: "unknown",
      holdTokens: 40_000,
      holdCostUsd: 1,
      actualTokens: null,
      actualCostUsd: null,
      pricingVersion: "test-price-v1",
      failureCode: "openai_timeout",
      ownerAcknowledgedUnknownAt: acknowledged ? "2026-10-15T10:00:00.000Z" : null,
      inFlightUntil: "2026-10-14T19:15:00.000Z",
      updatedAt: "2026-10-14T19:14:55.000Z",
    },
    providerDiagnostic: null,
    latestStep: null,
  };
}

describe("InvestigationAnalysisPanel", () => {
  test("blocks start without typing technical fields when key or model is missing", () => {
    render(
      <InvestigationAnalysisPanel
        caseId={CASE_ID}
        objective="What does the archive support?"
        currentQuestion=""
        ports={ports()}
        providerKeyStatus={{ configured: false }}
        modelPreference="gpt-5.6-terra"
      />,
    );
    expect(screen.getByText(/Add your OpenAI API key in Settings/)).not.toBeNull();
    expect(screen.queryByLabelText("case_id")).toBeNull();
    expect(screen.queryByLabelText("policy_name")).toBeNull();
    expect(screen.queryByLabelText("prompt_version")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Start analysis" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("starts analysis from Investigation context without technical field entry", async () => {
    const analysisPorts = ports();
    const user = userEvent.setup();
    render(
      <InvestigationAnalysisPanel
        caseId={CASE_ID}
        objective="What does the archive support?"
        currentQuestion=""
        ports={analysisPorts}
        providerKeyStatus={{
          configured: true,
          last4: "abcd",
          keyVersion: 1,
          updatedAt: null,
        }}
        modelPreference="gpt-5.6-luna"
      />,
    );

    expect(screen.getByText(/gpt-5\.6-luna/)).not.toBeNull();
    expect(screen.getByText(/tier luna/)).not.toBeNull();
    expect(screen.queryByLabelText("case_id")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(analysisPorts.ensurePolicy).toHaveBeenCalled();
    const ensureMock = analysisPorts.ensurePolicy as ReturnType<typeof mock>;
    const policyArg = ensureMock.mock.calls[0]?.[1] as { policy_name?: string };
    expect(policyArg?.policy_name).toBe("investigation-readonly-v2");
    expect(analysisPorts.createRun).toHaveBeenCalled();
    const createMock = analysisPorts.createRun as ReturnType<typeof mock>;
    const runArg = createMock.mock.calls[0]?.[2] as {
      model_tier?: string;
      prompt_version?: string;
    };
    expect(runArg?.model_tier).toBe("luna");
    expect(runArg?.prompt_version).toBe("investigation-readonly-v1");
  });

  test("does not treat Settings fetch failure as a missing key", () => {
    render(
      <InvestigationAnalysisPanel
        caseId={CASE_ID}
        objective="What does the archive support?"
        currentQuestion=""
        ports={ports()}
        providerKeyStatus={null}
        modelPreference={null}
        settingsUnavailable
      />,
    );
    expect(screen.getByText(/Settings could not be read/i)).not.toBeNull();
    expect(screen.queryByText(/Add your OpenAI API key/i)).toBeNull();
  });

  test("states that Findings are not overwritten and are not Owner Judgment", () => {
    render(
      <InvestigationAnalysisPanel
        caseId={CASE_ID}
        objective="Objective"
        currentQuestion=""
        ports={ports()}
        providerKeyStatus={{
          configured: true,
          last4: "abcd",
          keyVersion: 1,
          updatedAt: null,
        }}
        modelPreference="gpt-5.6-terra"
      />,
    );
    expect(screen.getByText(/not Owner Judgment/)).not.toBeNull();
    expect(screen.getByText(/Prior Findings stay/)).not.toBeNull();
  });

  test("requires explicit acknowledgement, preserves the unknown warning, and refreshes runs", async () => {
    const analysisPorts = ports();
    const user = userEvent.setup();
    const props = {
      caseId: CASE_ID,
      objective: "Objective",
      currentQuestion: "",
      ports: analysisPorts,
      runs: [failedHeldRun()],
      providerHoldProjection: "available" as const,
      providerKeyStatus: {
        configured: true,
        last4: "abcd",
        keyVersion: 1,
        updatedAt: null,
      },
      modelPreference: "gpt-5.6-luna",
    };
    const view = render(<InvestigationAnalysisPanel {...props} />);

    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(analysisPorts.ensurePolicy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Acknowledge unknown usage" }));
    expect(screen.getByText(/Actual usage will remain unknown/)).not.toBeNull();
    expect(analysisPorts.acknowledgeUnknownHold).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm acknowledgement" }));
    expect(analysisPorts.acknowledgeUnknownHold).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000012",
    );
    expect(analysisPorts.refreshRuns).toHaveBeenCalled();

    view.rerender(<InvestigationAnalysisPanel {...props} runs={[failedHeldRun(true)]} />);
    await user.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(analysisPorts.ensurePolicy).toHaveBeenCalled();
  });
});
