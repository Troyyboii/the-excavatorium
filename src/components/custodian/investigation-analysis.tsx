import { useRef, useState } from "react";
import { CryptIcon } from "@/components/crypt-icon";
import { CUSTODIAN_LANTERN_SRC, CustodianLine } from "@/components/custodian/custodian-presence";
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

  const keyLine = settingsLoading
    ? "Checking your OpenAI key…"
    : settingsUnavailable
      ? "Your OpenAI key could not be checked"
      : providerKeyStatus?.configured
        ? `Runs on your own OpenAI key (…${providerKeyStatus.last4})`
        : "No OpenAI key is set yet";
  const modelLine = settingsLoading
    ? "Model: checking…"
    : settingsUnavailable
      ? "Model: unavailable"
      : readiness?.ok
        ? `Model: ${readiness.modelId} (tier ${readiness.modelTier})`
        : `Model: ${modelPreference || "not selected"}`;

  return (
    <section
      aria-labelledby={`examine-${caseId}`}
      className="overflow-hidden border border-[color:var(--mortar-strong)] bg-card"
    >
      <div className="relative h-40 overflow-hidden bg-[#0c0e14]">
        <img
          src={CUSTODIAN_LANTERN_SRC}
          alt=""
          aria-hidden="true"
          width={212}
          height={350}
          decoding="async"
          className="pointer-events-none mx-auto h-full w-auto select-none object-cover"
        />
      </div>
      <div className="space-y-4 p-5">
        <div>
          <h2 id={`examine-${caseId}`} className="font-serif text-[1.625rem] text-foreground">
            {caseRuns.length ? "Examine again" : "Examine the evidence"}
          </h2>
          <CustodianLine size="sm" className="mt-1">
            {caseRuns.length
              ? "Bring me more, and I shall read it all anew."
              : "Set the evidence before me, and I shall read it."}
          </CustodianLine>
        </div>

        <ul className="space-y-1.5 text-base text-foreground">
          <li>{keyLine}</li>
          <li>{modelLine}</li>
          <li>
            Never more than ${OWNER_READONLY_CEILINGS.perRunCostUsd.toFixed(2)} a run (
            {OWNER_READONLY_CEILINGS.perRunTokenBudget.toLocaleString()} tokens)
          </li>
          <li className="text-muted-foreground">
            {caseRuns.length} {caseRuns.length === 1 ? "run" : "runs"} on this Investigation
          </li>
        </ul>

        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-[color:var(--mist)]">Analysis brief</p>
          <p className="mt-0.5 break-words">{analysisObjective || "None recorded yet."}</p>
        </div>

        {blockMessage ? (
          <p
            className={`border px-4 py-3 text-base ${
              settingsLoading
                ? "border-border bg-[color:var(--vault-deep)] text-muted-foreground"
                : "border-[color:var(--ember)]/50 bg-[color:var(--ember)]/10 text-foreground"
            }`}
            role="status"
          >
            {blockMessage}{" "}
            {showSettingsLink ? (
              <a
                href={settingsHref}
                className="text-[color:var(--candlelight)] underline underline-offset-2"
              >
                Open Settings
              </a>
            ) : null}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!canStart || busy}
          onClick={() => void start()}
          className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-sm border border-[color:var(--candlelight)] px-4 text-base text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--candlelight)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CryptIcon glyph="lantern" size={20} className="text-[color:var(--candlelight)]" />
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

        <details className="border-t border-border pt-3 text-sm leading-6 text-muted-foreground">
          <summary className="min-h-11 cursor-pointer py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--candlelight)]">
            About this examination
          </summary>
          <p>
            Starts a bounded read-only examination of this Investigation&apos;s archive scope. You
            do not enter case IDs, policy names, model tiers, prompt versions, pricing, or
            reservation ceilings here. The model comes from Settings; budgets use fixed
            owner-protecting ceilings (per-run {OWNER_READONLY_CEILINGS.perRunCostUsd} USD /{" "}
            {OWNER_READONLY_CEILINGS.perRunTokenBudget} tokens). A Finding is Custodian
            interpretation — not Owner Judgment. Prior Findings stay; new runs append.{" "}
            <a
              href={advancedHref}
              className="text-[color:var(--candlelight)] underline-offset-2 hover:underline"
            >
              Advanced
            </a>{" "}
            keeps the technical Run Room form.
          </p>
        </details>
      </div>
    </section>
  );
}
