import { useMemo, useRef, useState } from "react";
import { Check, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { formatEvidenceContent } from "@/lib/evidence-display";
import {
  CUSTODIAN_OWNER_GATE_CAN_EXECUTE,
  filterOwnerGateItems,
  ownerGateAllowsDecision,
  ownerGateExecutionUnavailableReason,
  presentOwnerGate,
  toolActionClass,
  type OwnerGateFilter,
  type OwnerGateItem,
  OWNER_GATE_FILTERS,
} from "@/lib/custodian-approvals";
import type { JsonValue } from "@/lib/custodian-types";
import type { OwnerGateDecision, OwnerGatePresentation } from "@/lib/custodian-runtime-types";
import { formatRecordDate, valueOrNotRecorded } from "./custodian-format";
import {
  ArchiveErrorState,
  EmptyArchiveState,
  FoundationState,
  LoadingMark,
  Section,
} from "./custodian-ui";

const FILTER_LABELS: Record<OwnerGateFilter, string> = {
  all: "All",
  awaiting: "Awaiting",
  deferred: "Deferred",
  decided: "Decided",
  expired: "Expired",
};

const PRESENTATION_LABELS: Record<OwnerGatePresentation, string> = {
  awaiting_decision: "Awaiting owner decision",
  deferred: "Deferred",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired",
  approved_execution_unavailable: "Approved — execution unavailable",
  action_changed: "Action changed after inspection",
  invalid: "Invalid gate",
};

const DECISION_LABELS: Record<OwnerGateDecision, string> = {
  approved: "Approve",
  rejected: "Reject",
  deferred: "Defer",
  expired: "Mark expired",
  cancelled: "Cancel",
};

export type OwnerGateDecisionRequest = {
  item: OwnerGateItem;
  decision: OwnerGateDecision;
  responseNote: string;
  inspectedHash: string;
};

export function ApprovalsSurface({
  items,
  loading = false,
  error = null,
  online = true,
  foundationPending = false,
  now,
  busyId = null,
  decisionError = null,
  onDecide,
}: {
  items?: readonly OwnerGateItem[];
  loading?: boolean;
  error?: string | null;
  online?: boolean;
  foundationPending?: boolean;
  now?: Date;
  busyId?: string | null;
  decisionError?: string | null;
  onDecide: (request: OwnerGateDecisionRequest) => Promise<void> | void;
}) {
  const [filter, setFilter] = useState<OwnerGateFilter>("all");
  const clock = useMemo(() => now ?? new Date(), [now]);
  const visible = useMemo(
    () => (items ? filterOwnerGateItems(items, filter, clock) : []),
    [items, filter, clock],
  );

  return (
    <div className="space-y-6">
      <FoundationState title="Execution remains unavailable">
        This is an owner decision surface for persisted proposals and approval requests. It does not
        execute provider, external, or canonical archive work.{" "}
        {CUSTODIAN_OWNER_GATE_CAN_EXECUTE
          ? "Execution was unexpectedly enabled."
          : "No internal V1 execution class has been selected."}
      </FoundationState>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Approval filters">
        {OWNER_GATE_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={`inline-flex min-h-11 items-center border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold ${
              filter === value
                ? "border-luminous-gold/70 bg-burgundy-muted/55 text-white-gold"
                : "border-luminous-gold/30 text-muted-foreground hover:border-luminous-gold/55 hover:text-white-gold"
            }`}
          >
            {FILTER_LABELS[value]}
          </button>
        ))}
      </div>

      {error ? <ArchiveErrorState error={error} /> : null}
      {!error && loading ? <LoadingMark label="Retrieving persisted approval requests…" /> : null}
      {!error && !loading && items?.length === 0 ? (
        <EmptyArchiveState
          title="No approval requests."
          hint="No owner-scoped proposal or approval request is persisted. This surface does not invent a pending decision."
        />
      ) : null}
      {!error && items && items.length > 0 && visible.length === 0 ? (
        <EmptyArchiveState
          title="No requests in this view."
          hint="Persisted approval requests exist, but none match the selected filter."
        />
      ) : null}
      {decisionError ? (
        <p
          className="flex items-start gap-2 border border-risk/50 bg-risk/10 p-3 text-sm text-white-gold"
          role="alert"
        >
          <WarningCircle size={17} className="mt-0.5 shrink-0 text-risk" aria-hidden="true" />
          <span>{decisionError}</span>
        </p>
      ) : null}
      {!error && visible.length ? (
        <Section
          title="Owner gates"
          description="Exact proposed actions bound to case, run, policy, and action hash. Approval is not execution."
          action={`${visible.length} shown`}
        >
          <div className="divide-y divide-luminous-gold/15">
            {visible.map((item) => (
              <ApprovalGateCard
                key={item.approval.id}
                item={item}
                now={clock}
                busy={busyId === item.approval.id}
                disabled={!online || foundationPending || busyId !== null}
                onDecide={onDecide}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function ApprovalGateCard({
  item,
  now,
  busy,
  disabled,
  onDecide,
}: {
  item: OwnerGateItem;
  now: Date;
  busy: boolean;
  disabled: boolean;
  onDecide: (request: OwnerGateDecisionRequest) => Promise<void> | void;
}) {
  const { approval, proposal, run, policy } = item;
  const inspectedHash = useRef(approval.exactActionHash).current;
  const presentation = presentOwnerGate(approval, {
    now,
    inspectedHash,
  });
  const [decision, setDecision] = useState<OwnerGateDecision | "">("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const availableDecisions = (
    ["approved", "rejected", "deferred", "expired", "cancelled"] as const
  ).filter((value) => ownerGateAllowsDecision(presentation, value, approval.status));
  const canSubmit =
    decision !== "" &&
    confirmed &&
    !busy &&
    !disabled &&
    ownerGateAllowsDecision(presentation, decision, approval.status);
  const actionClass = toolActionClass(approval.toolAction);
  const before = proposal?.beforeSnapshot ?? null;
  const after = proposal?.afterSnapshot ?? null;
  const diff = proposal?.proposedDiff ?? approval.proposedDiff;

  return (
    <article className="space-y-4 px-4 py-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-serif text-lg text-white-gold">{approval.title}</p>
          <p className="mt-1 font-mono text-[10px] break-all text-muted-foreground">
            {approval.id}
          </p>
        </div>
        <span className="inline-flex min-h-11 items-center border border-luminous-gold/40 px-3 text-xs text-luminous-gold">
          {PRESENTATION_LABELS[presentation]}
        </span>
      </header>

      <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <GateValue label="Proposal" value={proposal?.id ?? "No linked change proposal"} />
        <GateValue label="Case" value={approval.caseId} />
        <GateValue label="Run" value={valueOrNotRecorded(approval.runId)} />
        <GateValue label="Approval kind" value={approval.approvalKind} />
        <GateValue label="Action class" value={actionClass ?? "Not recorded on the tool action"} />
        <GateValue
          label="Policy"
          value={policy ? `${policy.name} (${policy.id})` : "Not recorded"}
        />
        <GateValue label="Approval status" value={approval.status} />
        <GateValue label="Proposal status" value={proposal?.status ?? "Not recorded"} />
        <GateValue label="Run state" value={run?.status ?? "No bound run"} />
        <GateValue label="Requested" value={formatRecordDate(approval.requestedAt)} />
        <GateValue label="Expires" value={formatRecordDate(approval.expiresAt)} />
        <GateValue label="Responded" value={formatRecordDate(approval.respondedAt)} />
      </dl>

      <p className="text-sm leading-6 text-foreground">
        {approval.rationale || "No rationale was stored."}
      </p>
      {proposal?.rationale && proposal.rationale !== approval.rationale ? (
        <p className="text-sm leading-6 text-muted-foreground">{proposal.rationale}</p>
      ) : null}

      <EvidenceBlock label="Exact action hash" mono value={approval.exactActionHash} />
      <EvidenceBlock label="Exact proposed action" value={approval.toolAction} />
      <EvidenceBlock label="Proposed diff" value={diff} />
      <EvidenceBlock label="Before state" value={before} empty="No before snapshot is stored." />
      <EvidenceBlock
        label="Proposed after state"
        value={after}
        empty="No after snapshot is stored."
      />
      <EvidenceBlock label="Provenance" value={approval.provenance} />
      {approval.responseNote ? (
        <EvidenceBlock label="Owner note" value={approval.responseNote} />
      ) : null}

      <div className="border border-sidebar-border bg-sidebar px-4 py-4 text-sidebar-foreground">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-ring">
          <ShieldCheck size={15} aria-hidden="true" />
          Execution boundary
        </p>
        <p className="mt-2 text-sm leading-6">
          {ownerGateExecutionUnavailableReason(approval.approvalKind)}
        </p>
        {run?.failureCode ? (
          <p className="mt-2 text-xs text-sidebar-foreground/70">
            {run.failureCode}
            {run.failureMessage ? `: ${run.failureMessage}` : null}
          </p>
        ) : null}
      </div>

      {availableDecisions.length ? (
        <form
          className="space-y-3 border-t border-luminous-gold/20 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            void onDecide({
              item,
              decision,
              responseNote: note,
              inspectedHash,
            });
          }}
        >
          <p className="text-xs text-muted-foreground">
            Confirm the exact action hash before recording a decision. The decision does not execute
            the proposed action.
          </p>
          <div className="flex flex-wrap gap-2">
            {availableDecisions.map((value) => (
              <button
                key={value}
                type="button"
                disabled={disabled || busy}
                onClick={() => {
                  setDecision(value);
                  setConfirmed(false);
                }}
                className={`inline-flex min-h-11 items-center border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold disabled:cursor-not-allowed disabled:opacity-50 ${
                  decision === value
                    ? "border-luminous-gold/70 bg-primary text-primary-foreground"
                    : "border-luminous-gold/35 text-white-gold hover:border-luminous-gold/60"
                }`}
              >
                {DECISION_LABELS[value]}
              </button>
            ))}
          </div>
          <label className="grid gap-2 text-sm">
            <span>Owner note</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={10000}
              disabled={disabled || busy}
              className="min-h-24 border border-luminous-gold/30 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold disabled:opacity-50"
            />
          </label>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={disabled || busy || decision === ""}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1 h-4 w-4 accent-[color:var(--burgundy)]"
            />
            <span>
              I inspected exact action hash {inspectedHash} and want to record{" "}
              {decision ? DECISION_LABELS[decision].toLowerCase() : "a decision"} without executing
              this action.
            </span>
          </label>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/55 bg-primary px-4 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Recording decision…" : "Confirm decision"}
            {!busy ? <Check size={16} aria-hidden="true" /> : null}
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          {presentation === "approved_execution_unavailable"
            ? "The owner approved this exact action. Execution remains unavailable."
            : presentation === "action_changed"
              ? "The inspected action no longer matches the persisted hash. A new proposal and gate are required."
              : "No further owner decision is available for this gate."}
        </p>
      )}
    </article>
  );
}

function GateValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-white-gold">{value}</dd>
    </div>
  );
}

function EvidenceBlock({
  label,
  value,
  empty,
  mono = false,
}: {
  label: string;
  value: unknown;
  empty?: string;
  mono?: boolean;
}) {
  if (value === null || value === undefined) {
    return (
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-luminous-gold">
          {label}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{empty ?? "Not recorded."}</p>
      </div>
    );
  }
  const preview =
    typeof value === "string"
      ? { text: value, truncated: false }
      : formatEvidenceContent(value as JsonValue);
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-luminous-gold">
        {label}
      </p>
      <pre
        className={`mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all border border-luminous-gold/15 bg-background/80 px-3 py-2 text-xs leading-5 ${
          mono ? "font-mono text-white-gold" : "text-foreground"
        }`}
      >
        {preview.text}
      </pre>
      {preview.truncated ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Display truncated for inspection bounds.
        </p>
      ) : null}
    </div>
  );
}
