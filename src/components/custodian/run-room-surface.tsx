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
  describeCustodianRunAccounting,
  type CustodianRun,
  type CustodianRunRead,
} from "@/lib/custodian-runtime";

export function RunRoomSurface({
  runs,
  providerHoldProjection,
  online,
  loading,
  error,
}: {
  runs: CustodianRun[];
  providerHoldProjection: CustodianRunRead["providerHoldProjection"];
  online: boolean;
  loading: boolean;
  error: string | null;
}) {
  return (
    <CustodianPage
      title="Run Room"
      description="Owner-scoped inspection of persisted Custodian runs. Recorded provider cost and budget holds are separate. This surface cannot start a provider call."
      status={
        <CustodianStatus
          online={online}
          fetching={loading}
          error={error}
          detail="Provider invocation is disabled in the browser."
        />
      }
    >
      <div className="space-y-6">
        <FoundationState title="Provider invocation disabled">
          Start analysis is unavailable. The browser gate is closed, so this control does not call
          the Edge Function, reserve budget, or contact a provider. There is no live progress to
          show.
        </FoundationState>
        <button
          type="button"
          disabled
          aria-describedby="custodian-start-analysis-reason"
          className="inline-flex min-h-11 cursor-not-allowed items-center border border-luminous-gold/40 px-4 text-sm text-white-gold opacity-60"
        >
          Start analysis
        </button>
        <p id="custodian-start-analysis-reason" className="text-sm leading-6 text-muted-foreground">
          Provider invocation stays off until a later activation milestone. No analysis is being
          started.
        </p>
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
