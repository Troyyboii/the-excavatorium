import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArchiveErrorState,
  CustodianPage,
  CustodianStatus,
  EmptyArchiveState,
  FoundationState,
  LoadingMark,
  Section,
} from "@/components/custodian/custodian-ui";
import { formatRecordDate } from "@/components/custodian/custodian-format";
import {
  CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER,
  describeCustodianRunAccounting,
  type CustodianRun,
  type CustodianRunRead,
} from "@/lib/custodian-runtime";
import {
  createReadonlyAnalysisSession,
  describeReadonlyAnalysisResult,
  emptyReadonlyAnalysisDraft,
  parseReadonlyAnalysisDraft,
  startReadonlyAnalysis,
  type ReadonlyAnalysisDraft,
  type ReadonlyAnalysisPorts,
  type ReadonlyAnalysisStartResult,
} from "@/lib/custodian-readonly-run";
import { MODEL_ALLOWLIST, type ModelTier } from "@/lib/custodian-runtime-types";

const MODEL_TIERS = Object.keys(MODEL_ALLOWLIST) as ModelTier[];

export function RunRoomSurface({
  runs,
  providerHoldProjection,
  online,
  loading,
  error,
  surfaceEnabled = CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER,
  ports = null,
}: {
  runs: CustodianRun[];
  providerHoldProjection: CustodianRunRead["providerHoldProjection"];
  online: boolean;
  loading: boolean;
  error: string | null;
  surfaceEnabled?: boolean;
  ports?: ReadonlyAnalysisPorts | null;
}) {
  const canStart = surfaceEnabled && ports?.surfaceEnabled === true;
  return (
    <CustodianPage
      title="Run Room"
      description={
        canStart
          ? "Owner-scoped readonly analysis. Start analysis sends explicit owner inputs through the readonly policy and run RPCs, then advances one persisted run. It does not stream model output."
          : "Owner-scoped inspection of persisted Custodian runs. Recorded provider cost and budget holds are separate. This surface cannot start a provider call."
      }
      status={
        <CustodianStatus
          online={online}
          fetching={loading}
          error={error}
          detail={
            canStart
              ? "Provider invocation is available only for this explicit readonly start."
              : "Provider invocation is disabled in the browser."
          }
        />
      }
    >
      <div className="space-y-6">
        {canStart && ports ? (
          <ReadonlyAnalysisStart ports={ports} />
        ) : (
          <>
            <FoundationState title="Provider invocation disabled">
              Start analysis is unavailable. The browser gate is closed, so this control does not
              call the Edge Function, reserve budget, or contact a provider. There is no live
              progress to show.
            </FoundationState>
            <button
              type="button"
              disabled
              aria-describedby="custodian-start-analysis-reason"
              className="inline-flex min-h-11 cursor-not-allowed items-center border border-luminous-gold/40 px-4 text-sm text-white-gold opacity-60"
            >
              Start analysis
            </button>
            <p
              id="custodian-start-analysis-reason"
              className="text-sm leading-6 text-muted-foreground"
            >
              Provider invocation stays off until a later activation milestone. No analysis is being
              started.
            </p>
          </>
        )}
        {providerHoldProjection === "unavailable" ? (
          <FoundationState title="Provider hold records unavailable">
            Persisted runs can still be read. Budget holds cannot be shown until the provider-hold
            foundation is available. A missing hold is not recorded spend.
          </FoundationState>
        ) : null}

        {error ? <ArchiveErrorState error={error} /> : null}
        {!error && loading ? <LoadingMark label="Retrieving persisted runs…" /> : null}
        {!error && !loading && runs.length === 0 ? (
          <EmptyArchiveState
            title="No persisted runs."
            hint="No owner-scoped agent run has been stored yet. This surface does not manufacture a placeholder run."
          />
        ) : null}
        {!error && runs.length > 0 ? (
          <Section
            title="Persisted runs"
            description="Newest first. Recorded provider cost is factual usage. A budget hold is an encumbrance, not money recorded as spent."
            action={`${runs.length} shown`}
          >
            <div className="divide-y divide-luminous-gold/15">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    </CustodianPage>
  );
}

function ReadonlyAnalysisStart({ ports }: { ports: ReadonlyAnalysisPorts }) {
  const session = useRef(createReadonlyAnalysisSession()).current;
  const busyRef = useRef(false);
  const [draft, setDraft] = useState<ReadonlyAnalysisDraft>(emptyReadonlyAnalysisDraft);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReadonlyAnalysisStartResult | null>(null);

  function update(patch: Partial<ReadonlyAnalysisDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggleTier(tier: ModelTier) {
    setDraft((current) => {
      const selected = new Set(current.allowedModelTiers);
      if (selected.has(tier)) selected.delete(tier);
      else selected.add(tier);
      return {
        ...current,
        allowedModelTiers: MODEL_TIERS.filter((item) => selected.has(item)),
      };
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseReadonlyAnalysisDraft(draft);
    if (!parsed.ok) {
      setResult({ ok: false, reason: "invalid_input", errors: parsed.errors });
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setResult(await startReadonlyAnalysis(parsed.value, ports, session));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <FoundationState title="Readonly analysis">
        Every field is an explicit owner input. This form does not choose a model, ceiling, or
        objective. It is not a chat.
      </FoundationState>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="case_id">
          <input
            value={draft.caseId}
            autoComplete="off"
            onChange={(event) => update({ caseId: event.target.value })}
          />
        </Field>
        <Field label="policy_name">
          <input
            value={draft.policyName}
            autoComplete="off"
            onChange={(event) => update({ policyName: event.target.value })}
          />
        </Field>
        <fieldset className="grid gap-2 text-sm text-foreground md:col-span-2">
          <legend>allowed_model_tiers</legend>
          <div className="flex flex-wrap gap-3">
            {MODEL_TIERS.map((tier) => (
              <label key={tier} className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.allowedModelTiers.includes(tier)}
                  onChange={() => toggleTier(tier)}
                />
                {tier}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="per_run_token_budget">
          <input
            inputMode="numeric"
            autoComplete="off"
            value={draft.perRunTokenBudget}
            onChange={(event) => update({ perRunTokenBudget: event.target.value })}
          />
        </Field>
        <Field label="per_run_cost_usd">
          <input
            inputMode="decimal"
            autoComplete="off"
            value={draft.perRunCostUsd}
            onChange={(event) => update({ perRunCostUsd: event.target.value })}
          />
        </Field>
        <Field label="per_run_latency_ms">
          <input
            inputMode="numeric"
            autoComplete="off"
            value={draft.perRunLatencyMs}
            onChange={(event) => update({ perRunLatencyMs: event.target.value })}
          />
        </Field>
        <Field label="per_run_tool_event_budget">
          <input
            inputMode="numeric"
            autoComplete="off"
            value={draft.perRunToolEventBudget}
            onChange={(event) => update({ perRunToolEventBudget: event.target.value })}
          />
        </Field>
        <Field label="daily_token_budget">
          <input
            inputMode="numeric"
            autoComplete="off"
            value={draft.dailyTokenBudget}
            onChange={(event) => update({ dailyTokenBudget: event.target.value })}
          />
        </Field>
        <Field label="monthly_token_budget">
          <input
            inputMode="numeric"
            autoComplete="off"
            value={draft.monthlyTokenBudget}
            onChange={(event) => update({ monthlyTokenBudget: event.target.value })}
          />
        </Field>
        <Field label="daily_cost_usd">
          <input
            inputMode="decimal"
            autoComplete="off"
            value={draft.dailyCostUsd}
            onChange={(event) => update({ dailyCostUsd: event.target.value })}
          />
        </Field>
        <Field label="monthly_cost_usd">
          <input
            inputMode="decimal"
            autoComplete="off"
            value={draft.monthlyCostUsd}
            onChange={(event) => update({ monthlyCostUsd: event.target.value })}
          />
        </Field>
        <Field label="model_tier">
          <select
            value={draft.modelTier}
            onChange={(event) => update({ modelTier: event.target.value })}
          >
            <option value="">Choose a model tier</option>
            {MODEL_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </Field>
        <Field label="prompt_version">
          <input
            value={draft.promptVersion}
            autoComplete="off"
            onChange={(event) => update({ promptVersion: event.target.value })}
          />
        </Field>
        <Field label="objective">
          <textarea
            rows={4}
            value={draft.objective}
            onChange={(event) => update({ objective: event.target.value })}
          />
        </Field>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 items-center border border-luminous-gold/40 px-4 text-sm text-white-gold disabled:cursor-not-allowed disabled:opacity-60"
      >
        Start analysis
      </button>
      <p role="status" className="text-sm leading-6 text-muted-foreground">
        {busy
          ? "Waiting for the persisted run."
          : result
            ? describeReadonlyAnalysisResult(result)
            : "No readonly analysis has been started."}
      </p>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm text-foreground [&_input]:min-h-11 [&_input]:border [&_input]:border-luminous-gold/30 [&_input]:bg-background [&_input]:px-3 [&_select]:min-h-11 [&_select]:border [&_select]:border-luminous-gold/30 [&_select]:bg-background [&_select]:px-3 [&_textarea]:border [&_textarea]:border-luminous-gold/30 [&_textarea]:bg-background [&_textarea]:px-3 [&_textarea]:py-2">
      <span>{label}</span>
      {children}
    </label>
  );
}

function RunRow({ run }: { run: CustodianRun }) {
  const accounting = describeCustodianRunAccounting(run);
  return (
    <article className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,1fr)]">
      <div className="min-w-0">
        <p className="font-serif text-base text-white-gold">{run.objective}</p>
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{run.id}</p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <RunValue label="State" value={run.status} />
          <RunValue label="Model tier" value={run.modelTier} />
          <RunValue label="Created" value={formatRecordDate(run.createdAt)} />
          <RunValue label="Updated" value={formatRecordDate(run.updatedAt)} />
          <RunValue
            label="Latest step"
            value={
              run.latestStep
                ? `${run.latestStep.stepKind} · ${run.latestStep.status}`
                : "Not recorded"
            }
          />
          <RunValue label="Pricing version" value={accounting.pricingVersion} />
        </dl>
        {run.failureCode ? (
          <p className="mt-3 border-l-2 border-risk/70 pl-3 text-xs leading-5 text-muted-foreground">
            <span className="text-risk">{run.failureCode}</span>
            {run.failureMessage ? `: ${run.failureMessage}` : null}
          </p>
        ) : null}
      </div>
      <dl className="grid content-start gap-2 text-xs">
        <RunValue label="Recorded provider cost" value={accounting.recordedProviderCost} />
        <RunValue label="Recorded provider tokens" value={accounting.recordedProviderTokens} />
        <RunValue label="Budget currently held" value={accounting.heldProviderBudget} />
        <RunValue label="Provider usage" value={accounting.usageKnowledge} />
        <RunValue label="Cancellation" value={accounting.cancellation} />
        <p className="text-muted-foreground">
          Budget currently held is encumbered allowance. It is not money recorded as spent.
          {run.providerHold?.status === "held"
            ? " An unresolved hold means provider contact may already have happened."
            : ""}
        </p>
      </dl>
    </article>
  );
}

function RunValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] sm:gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-white-gold">{value}</dd>
    </div>
  );
}
