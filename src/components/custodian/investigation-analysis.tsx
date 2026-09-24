import { useRef, useState } from "react";
import { FoundationState } from "@/components/custodian/custodian-ui";
import {
  assessOwnerAnalysisReadiness,
  buildOwnerReadonlyAnalysisInput,
  OWNER_READONLY_CEILINGS,
  ownerAnalysisObjective,
} from "@/lib/custodian-owner-start";
import {
  createReadonlyAnalysisSession,
  describeReadonlyAnalysisResult,
  observationForCustodianRun,
  startReadonlyAnalysis,
  type ReadonlyAnalysisPorts,
  type ReadonlyAnalysisStartResult,
} from "@/lib/custodian-readonly-run";
import type { CustodianRun, CustodianRunRead } from "@/lib/custodian-runtime";
import { CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER } from "@/lib/custodian-runtime";
import type { ProviderKeyStatus } from "@/lib/provider-key";

export function InvestigationAnalysisPanel({
  caseId,
  objective,
  currentQuestion,
  online = true,
  surfaceEnabled = CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER,
  ports = null,
  runs = [],
  providerHoldProjection = "available",
  providerKeyStatus = null,
  modelPreference = null,
  settingsLoading = false,
  settingsUnavailable = false,
  settingsHref = "/settings",
  advancedHref = "/advanced",
}: {
  caseId: string;
  objective: string;
  currentQuestion: string;
  online?: boolean;
  surfaceEnabled?: boolean;
  ports?: ReadonlyAnalysisPorts | null;
  runs?: readonly CustodianRun[];
  providerHoldProjection?: CustodianRunRead["providerHoldProjection"];
  providerKeyStatus?: ProviderKeyStatus | null;
  modelPreference?: string | null;
  settingsLoading?: boolean;
  /** Settings queries failed — distinct from key not configured. */
  settingsUnavailable?: boolean;
  settingsHref?: string;
  advancedHref?: string;
}) {
  const session = useRef(createReadonlyAnalysisSession()).current;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReadonlyAnalysisStartResult | null>(null);

  const analysisObjective = ownerAnalysisObjective(objective, currentQuestion);
  const readiness = settingsLoading
    ? null
    : assessOwnerAnalysisReadiness({
        caseId,
        objective: analysisObjective,
        providerKeyStatus,
        modelPreference,
        settingsUnavailable,
      });
  const gateOpen = surfaceEnabled && ports?.surfaceEnabled === true;
  const caseRuns = runs.filter((run) => run.caseId === caseId);

  let blockMessage: string | null = null;
  if (!online) {
    blockMessage =
      "Analysis is unavailable while offline. No policy, run, or provider call is made.";
  } else if (!gateOpen) {
    blockMessage =
      "Analysis start is unavailable in this build. Persisted Findings stay visible. Advanced may show technical run history.";
  } else if (settingsLoading || readiness === null) {
    blockMessage = "Checking Settings for your OpenAI key and model preference…";
  } else if (!readiness.ok) {
    blockMessage = readiness.message;
  }

  const canStart = blockMessage === null && readiness?.ok === true && ports !== null;

  async function start() {
    if (!canStart || !ports || !readiness || !readiness.ok || busyRef.current) return;
    const input = buildOwnerReadonlyAnalysisInput({
      caseId,
      objective: analysisObjective,
      modelTier: readiness.modelTier,
    });
    busyRef.current = true;
    setBusy(true);
    try {
      setResult(
        await startReadonlyAnalysis(
          input,
          {
            ...ports,
            persistedRuns: () =>
              runs.map((run) => ({
                id: run.id,
                caseId: run.caseId,
                ...observationForCustodianRun(run, providerHoldProjection),
              })),
          },
          session,
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const showSettingsLink =
    readiness !== null &&
    readiness.ok === false &&
    (readiness.reason === "provider_key_missing" ||
      readiness.reason === "provider_settings_unavailable" ||
      readiness.reason === "model_not_selected" ||
      readiness.reason === "model_selection_invalid");

  return (
    <section className="space-y-4 border border-luminous-gold/25 bg-burgundy-muted/20 p-4">
      <FoundationState title="Custodian analysis">
        Starts a bounded read-only examination of this Investigation&apos;s archive scope. You do
        not enter case IDs, policy names, model tiers, prompt versions, pricing, or reservation
        ceilings here. The model comes from Settings; budgets use fixed owner-protecting ceilings
        (per-run {OWNER_READONLY_CEILINGS.perRunCostUsd} USD /{" "}
        {OWNER_READONLY_CEILINGS.perRunTokenBudget} tokens). A Finding is Custodian interpretation —
        not Owner Judgment. Prior Findings stay; new runs append.{" "}
        <a href={advancedHref} className="text-white-gold underline-offset-2 hover:underline">
          Advanced
        </a>{" "}
        keeps the technical Run Room form.
      </FoundationState>

      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Provider key</dt>
          <dd className="mt-1 text-foreground">
            {settingsLoading
              ? "Checking…"
              : settingsUnavailable
                ? "Unavailable"
                : providerKeyStatus?.configured
                  ? `Configured (…${providerKeyStatus.last4})`
                  : "Not configured"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Settings model</dt>
          <dd className="mt-1 text-foreground">
            {settingsLoading
              ? "Checking…"
              : settingsUnavailable
                ? "Unavailable"
                : readiness?.ok
                  ? `${readiness.modelId} · tier ${readiness.modelTier}`
                  : modelPreference || "Not selected"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Analysis brief</dt>
          <dd className="mt-1 break-words text-foreground">
            {analysisObjective || "None recorded yet."}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Runs on this Investigation</dt>
          <dd className="mt-1 text-foreground">{caseRuns.length}</dd>
        </div>
      </dl>

      {blockMessage ? (
        <p
          className={`border px-4 py-3 text-sm ${
            settingsLoading
              ? "border-luminous-gold/30 bg-burgundy-muted/30 text-muted-foreground"
              : "border-risk/40 bg-risk/10 text-risk"
          }`}
          role="status"
        >
          {blockMessage}{" "}
          {showSettingsLink ? (
            <a href={settingsHref} className="underline underline-offset-2">
              Open Settings
            </a>
          ) : null}
        </p>
      ) : null}

      <button
        type="button"
        disabled={!canStart || busy}
        onClick={() => void start()}
        className="inline-flex min-h-11 items-center border border-luminous-gold/55 bg-primary px-4 text-sm text-primary-foreground transition-colors hover:border-white-gold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Starting analysis…" : "Start analysis"}
      </button>

      <p role="status" className="text-sm leading-6 text-muted-foreground">
        {busy
          ? "Waiting for the persisted run."
          : result
            ? describeReadonlyAnalysisResult(result)
            : caseRuns.length
              ? `${caseRuns.length} persisted run${caseRuns.length === 1 ? "" : "s"} on this Investigation. Start analysis creates another; it does not overwrite Findings.`
              : "No analysis has been started from this Investigation yet."}
      </p>
    </section>
  );
}
