// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReadonlyAnalysisPorts } from "@/lib/custodian-readonly-run";
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
    expect(policyArg?.policy_name).toBe("investigation-readonly");
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
});
