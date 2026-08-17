import { createFileRoute } from "@tanstack/react-router";
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
import { useOnlineStatus } from "@/hooks/use-online";
import { isCustodianFoundationMissing } from "@/lib/custodian";
import { type CustodianRun, useCustodianRuns } from "@/lib/custodian-runtime";

export const Route = createFileRoute("/run-room")({ component: RunRoomPage, ssr: false });

function RunRoomPage() {
  const online = useOnlineStatus();
  const runs = useCustodianRuns(online);
  const foundationPending = Boolean(runs.error && isCustodianFoundationMissing(runs.error));
  const error = !online
    ? "Network unavailable. Persisted runs cannot be retrieved."
    : runs.error
      ? foundationPending
        ? "Custodian runtime storage is unavailable in the connected Supabase project."
        : runs.error.message
      : null;

  return (
    <CustodianPage
      title="Run Room"
      description="Owner-scoped inspection of persisted Custodian runs. This Phase 2B slice cannot create, resume, cancel, or execute a run."
      status={
        <CustodianStatus
          online={online}
          fetching={runs.isFetching}
          error={error}
          detail="Provider execution is disabled while security and cost gates remain open."
        />
      }
    >
      <div className="space-y-6">
        <FoundationState title="Provider execution disabled">
          This surface is read-only. It displays authenticated-owner run records already persisted
          in Supabase, but exposes no provider, model, mutation, approval, or execution control.
          Provider execution remains explicitly disabled.
        </FoundationState>

        {error ? <ArchiveErrorState error={error} /> : null}
        {!error && runs.isLoading ? <LoadingMark label="Retrieving persisted runs…" /> : null}
        {!error && !runs.isLoading && runs.data?.length === 0 ? (
          <EmptyArchiveState
            title="No persisted runs."
            hint="No owner-scoped agent run has been stored yet. This surface does not manufacture a placeholder run."
          />
        ) : null}
        {!error && runs.data?.length ? (
          <Section
            title="Persisted runs"
            description="Newest first. Reading is owner-filtered in the client and enforced again by Supabase row-level security."
            action={`${runs.data.length} shown`}
          >
            <div className="divide-y divide-luminous-gold/15">
              {runs.data.map((run) => (
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
  return (
    <article className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(150px,0.7fr)_minmax(180px,0.8fr)]">
      <div className="min-w-0">
        <p className="font-serif text-base text-white-gold">{run.objective}</p>
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{run.id}</p>
        {run.failureCode ? (
          <p className="mt-3 border-l-2 border-risk/70 pl-3 text-xs leading-5 text-muted-foreground">
            <span className="text-risk">{run.failureCode}</span>
            {run.failureMessage ? `: ${run.failureMessage}` : null}
          </p>
        ) : null}
      </div>
      <dl className="grid content-start gap-2 text-xs">
        <RunValue label="Case" value={run.caseId} />
        <RunValue label="State" value={run.status} />
        <RunValue label="Persisted steps" value={run.lastStepNumber} />
      </dl>
      <dl className="grid content-start gap-2 text-xs">
        <RunValue label="Tokens" value={`${run.tokensUsed} / ${run.budgetTokens}`} />
        <RunValue label="Recorded cost" value={`$${run.costUsd.toFixed(4)}`} />
        <RunValue label="Updated" value={formatRecordDate(run.updatedAt)} />
      </dl>
    </article>
  );
}

function RunValue({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-white-gold">{value}</dd>
    </div>
  );
}
