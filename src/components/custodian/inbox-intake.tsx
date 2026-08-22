import { useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  Check,
  ClipboardText,
  CircleNotch,
  FloppyDisk,
  PaperPlaneTilt,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CustodianPromotionTarget } from "@/lib/custodian";
import type { InboxItem, InboxStatus } from "@/lib/custodian-types";
import {
  countInboxStatuses,
  filterInboxItems,
  INBOX_FILTERS,
  isPromotionReady,
  type InboxFilter,
} from "@/lib/custodian-surfaces";
import { formatRecordDate } from "./custodian-format";
import {
  ArchiveErrorState,
  EmptyArchiveState,
  FoundationState,
  LoadingMark,
  Section,
} from "./custodian-ui";
import type { CustodianCase as PersistedCustodianCase } from "@/lib/custodian-types";

export const INBOX_CAPTURE_OPTIONS = [
  { value: "thought", label: "Thought", sourceKind: "thought" },
  { value: "link", label: "Link", sourceKind: "url" },
  { value: "conversation", label: "Conversation", sourceKind: "conversation" },
  { value: "document", label: "Document", sourceKind: "document" },
] as const;

export type InboxCaptureKind = (typeof INBOX_CAPTURE_OPTIONS)[number]["value"];
export type InboxSourceKind = (typeof INBOX_CAPTURE_OPTIONS)[number]["sourceKind"];

export type InboxCreatePayload = {
  sourceKind: InboxSourceKind;
  title: string;
  content: string;
};

function captureOption(kind: InboxCaptureKind) {
  return INBOX_CAPTURE_OPTIONS.find((option) => option.value === kind) ?? INBOX_CAPTURE_OPTIONS[0];
}

type InboxTriageStatus = Exclude<InboxStatus, "new" | "promoted">;
const STATUS_LABELS: Record<InboxFilter, string> = {
  all: "All",
  new: "New",
  triaged: "Triaged",
  promoted: "Promoted",
  dismissed: "Dismissed",
  archived: "Archived",
};

const PROMOTION_TARGETS: readonly { value: CustodianPromotionTarget; label: string }[] = [
  { value: "claim", label: "Claim" },
  { value: "evidence_item", label: "Evidence item" },
  { value: "action", label: "Action" },
  { value: "custodian_finding", label: "Finding" },
];

export function InboxIntake({
  onCreate,
  online = true,
  foundationPending = false,
  items,
  cases,
  casesFoundationPending = false,
  loading = false,
  error = null,
  casesLoading = false,
  casesError = null,
  onRetry,
  onTriage,
  onPromote,
}: {
  onCreate?: (payload: InboxCreatePayload) => Promise<unknown> | unknown;
  online?: boolean;
  foundationPending?: boolean;
  items?: readonly InboxItem[];
  cases?: readonly PersistedCustodianCase[];
  casesFoundationPending?: boolean;
  loading?: boolean;
  error?: string | null;
  casesLoading?: boolean;
  casesError?: string | null;
  onRetry?: () => void;
  onTriage?: (itemId: string, status: InboxTriageStatus) => Promise<unknown>;
  onPromote?: (
    itemId: string,
    target: CustodianPromotionTarget,
    caseId: string,
  ) => Promise<unknown>;
}) {
  const [captureKind, setCaptureKind] = useState<InboxCaptureKind>("thought");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [candidate, setCandidate] = useState<InboxCreatePayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ itemId: string; message: string } | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    itemId: string;
    message: string;
  } | null>(null);
  const [promotion, setPromotion] = useState<{
    itemId: string;
    target: CustodianPromotionTarget;
    caseId: string;
    confirmed: boolean;
  } | null>(null);

  const filteredItems = useMemo(() => filterInboxItems(items ?? [], filter), [filter, items]);

  const statusCounts = useMemo(() => countInboxStatuses(items ?? []), [items]);

  function continueToReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedContent = content.trim();
    if (!normalizedContent) {
      setMessage("Add a thought, link, conversation, or document before continuing.");
      return;
    }
    const payload = {
      sourceKind: captureOption(captureKind).sourceKind,
      title: title.trim(),
      content: normalizedContent,
    };
    setMessage(null);
    setCandidate(payload);
  }

  async function saveCandidate() {
    if (!candidate || submitting) return;
    if (!online) {
      setMessage("Save is unavailable while the network is offline. Your draft is still here.");
      return;
    }
    if (foundationPending) {
      setMessage(
        "Save is unavailable because Inbox storage is not connected. Your draft is still here.",
      );
      return;
    }
    if (!onCreate) {
      setMessage(
        "Save is unavailable because the Inbox writer is not connected. Your draft is still here.",
      );
      return;
    }

    setMessage(null);
    setSubmitting(true);
    try {
      await onCreate(candidate);
      setCandidate(null);
      setCaptureKind("thought");
      setTitle("");
      setContent("");
      setMessage("Saved to Inbox.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The draft could not be saved to Inbox.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {foundationPending ? (
        <FoundationState title="Inbox saving unavailable">
          You can prepare a local review, but saved Inbox storage is currently unavailable.
        </FoundationState>
      ) : null}

      {!candidate ? (
        <Section
          title="New capture"
          description="Prepare a thought, link, conversation, or document for review before saving it."
        >
          <form onSubmit={continueToReview} className="space-y-4 p-4">
            <div className="grid gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
              <label className="space-y-2 text-sm text-muted-foreground">
                <span>Type</span>
                <select
                  value={captureKind}
                  onChange={(event) => setCaptureKind(event.target.value as InboxCaptureKind)}
                  className="min-h-11 w-full border border-luminous-gold/30 bg-background px-3 text-sm text-white-gold outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
                >
                  {INBOX_CAPTURE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm text-muted-foreground">
                <span>
                  Working title <span className="text-muted-foreground">(optional)</span>
                </span>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Short title for review"
                  className="min-h-11 rounded-none border-luminous-gold/30 bg-background text-white-gold placeholder:text-muted-foreground focus-visible:ring-luminous-gold"
                />
              </label>
            </div>
            <label className="block space-y-2 text-sm text-muted-foreground">
              <span>Content</span>
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Write or paste what you want to review before saving."
                rows={8}
                className="resize-y rounded-none border-luminous-gold/30 bg-background text-white-gold placeholder:text-muted-foreground focus-visible:ring-luminous-gold"
              />
            </label>
            {message ? (
              <p className="text-sm text-luminous-gold" role="status">
                {message}
              </p>
            ) : null}
            <button
              type="submit"
              className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/40 bg-burgundy-muted/80 px-4 py-2 text-sm text-white-gold transition-colors hover:bg-risk/80 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
            >
              <PaperPlaneTilt size={16} aria-hidden="true" />
              Continue to review
            </button>
          </form>
        </Section>
      ) : null}

      {candidate ? (
        <Section
          title="Review capture"
          description="Check this local draft before anything is saved to Inbox."
        >
          <div className="space-y-4 p-4">
            <dl className="grid gap-4 border-b border-luminous-gold/20 pb-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Type</dt>
                <dd className="mt-1 text-sm text-white-gold">{captureOption(captureKind).label}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Title</dt>
                <dd className="mt-1 text-sm text-white-gold">{candidate.title || "Untitled"}</dd>
              </div>
            </dl>
            <div className="flex items-start gap-3">
              <ClipboardText
                size={18}
                className="mt-0.5 shrink-0 text-luminous-gold"
                aria-hidden="true"
              />
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                {candidate.content}
              </p>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check size={15} className="text-luminous-gold" aria-hidden="true" />
              Nothing has been saved yet.
            </p>
            {message ? (
              <p className="text-sm text-luminous-gold" role="status">
                {message}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 border-t border-luminous-gold/15 pt-4">
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setCandidate(null);
                  setMessage(null);
                }}
                className="inline-flex min-h-11 items-center border border-luminous-gold/35 px-4 py-2 text-sm text-white-gold transition-colors hover:bg-burgundy-muted/55 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
              >
                Back to edit
              </button>
              <button
                type="button"
                disabled={submitting || foundationPending || !online || !onCreate}
                onClick={() => void saveCandidate()}
                className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/40 bg-burgundy-muted/80 px-4 py-2 text-sm text-white-gold transition-colors hover:bg-risk/80 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
              >
                {submitting ? (
                  <CircleNotch size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <FloppyDisk size={16} aria-hidden="true" />
                )}
                {submitting ? "Saving…" : "Save to Inbox"}
              </button>
            </div>
          </div>
        </Section>
      ) : null}

      <InboxItems
        items={filteredItems}
        allItemsCount={items?.length ?? 0}
        filter={filter}
        filters={INBOX_FILTERS}
        statusCounts={statusCounts}
        foundationPending={foundationPending}
        loading={loading}
        error={error}
        onRetry={onRetry}
        cases={cases}
        casesFoundationPending={casesFoundationPending}
        casesLoading={casesLoading}
        casesError={casesError}
        busyAction={busyAction}
        actionError={actionError}
        actionMessage={actionMessage}
        promotion={promotion}
        onFilterChange={setFilter}
        onTriage={async (itemId, status) => {
          if (!onTriage) return;
          setBusyAction(`${status}:${itemId}`);
          setActionError(null);
          setActionMessage(null);
          try {
            await onTriage(itemId, status);
            setActionMessage({ itemId, message: `Inbox item marked ${status}.` });
          } catch (error) {
            setActionError({
              itemId,
              message:
                error instanceof Error ? error.message : "Inbox status could not be updated.",
            });
          } finally {
            setBusyAction(null);
          }
        }}
        onPromotionChange={setPromotion}
        onPromote={async (itemId, target, caseId) => {
          if (!onPromote) return;
          setBusyAction(`promote:${itemId}`);
          setActionError(null);
          setActionMessage(null);
          try {
            await onPromote(itemId, target, caseId);
            setActionMessage({ itemId, message: "Inbox item promoted to the selected case." });
            setPromotion(null);
          } catch (error) {
            setActionError({
              itemId,
              message: error instanceof Error ? error.message : "Inbox item could not be promoted.",
            });
          } finally {
            setBusyAction(null);
          }
        }}
      />
    </div>
  );
}

function InboxItems({
  items,
  allItemsCount,
  filter,
  filters,
  statusCounts,
  foundationPending,
  loading,
  error,
  onRetry,
  cases,
  casesFoundationPending,
  casesLoading,
  casesError,
  busyAction,
  actionError,
  actionMessage,
  promotion,
  onFilterChange,
  onTriage,
  onPromotionChange,
  onPromote,
}: {
  items: readonly InboxItem[];
  allItemsCount: number;
  filter: InboxFilter;
  filters: readonly InboxFilter[];
  statusCounts: Record<InboxStatus, number>;
  foundationPending: boolean;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  cases?: readonly PersistedCustodianCase[];
  casesFoundationPending: boolean;
  casesLoading: boolean;
  casesError: string | null;
  busyAction: string | null;
  actionError: { itemId: string; message: string } | null;
  actionMessage: { itemId: string; message: string } | null;
  promotion: {
    itemId: string;
    target: CustodianPromotionTarget;
    caseId: string;
    confirmed: boolean;
  } | null;
  onFilterChange: (filter: InboxFilter) => void;
  onTriage: (itemId: string, status: InboxTriageStatus) => Promise<void>;
  onPromotionChange: (
    promotion: {
      itemId: string;
      target: CustodianPromotionTarget;
      caseId: string;
      confirmed: boolean;
    } | null,
  ) => void;
  onPromote: (itemId: string, target: CustodianPromotionTarget, caseId: string) => Promise<void>;
}) {
  return (
    <Section
      title="Saved Inbox"
      description="Saved source material, its current lifecycle status, and the available review actions."
      action={allItemsCount === 1 ? "1 saved item" : `${allItemsCount} saved items`}
    >
      <div className="border-b border-luminous-gold/20 p-4">
        <fieldset>
          <legend className="text-xs text-muted-foreground">Filter by status</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Inbox status filters">
            {filters.map((option) => {
              const count = option === "all" ? allItemsCount : statusCounts[option];
              const active = filter === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFilterChange(option)}
                  className={`min-h-11 border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold ${
                    active
                      ? "border-luminous-gold bg-burgundy-muted/80 text-white-gold"
                      : "border-luminous-gold/25 text-muted-foreground hover:bg-burgundy-muted/40 hover:text-white-gold"
                  }`}
                >
                  {STATUS_LABELS[option]} <span className="font-mono">({count})</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      {foundationPending ? (
        <FoundationState title="Persisted inbox unavailable">
          The connected Supabase project did not provide the owner-scoped inbox reader. No saved
          items can be shown from this state.
        </FoundationState>
      ) : error ? (
        <ArchiveErrorState error={error} onRetry={onRetry} />
      ) : loading ? (
        <div className="p-5">
          <LoadingMark label="Retrieving persisted inbox items…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyArchiveState
          title={allItemsCount === 0 ? "No persisted inbox items." : "No items match this status."}
          hint={
            allItemsCount === 0
              ? "The persisted inbox returned no saved items."
              : `The persisted inbox returned no ${STATUS_LABELS[filter].toLowerCase()} items.`
          }
        />
      ) : (
        <div className="divide-y divide-luminous-gold/15">
          {items.map((item) => (
            <InboxItemCard
              key={item.id}
              item={item}
              cases={cases}
              casesFoundationPending={casesFoundationPending}
              casesLoading={casesLoading}
              casesError={casesError}
              busyAction={busyAction}
              actionError={actionError?.itemId === item.id ? actionError.message : null}
              actionMessage={actionMessage?.itemId === item.id ? actionMessage.message : null}
              promotion={promotion?.itemId === item.id ? promotion : null}
              onTriage={onTriage}
              onPromotionChange={onPromotionChange}
              onPromote={onPromote}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function InboxItemCard({
  item,
  cases,
  casesFoundationPending,
  casesLoading,
  casesError,
  busyAction,
  actionError,
  actionMessage,
  promotion,
  onTriage,
  onPromotionChange,
  onPromote,
}: {
  item: InboxItem;
  cases?: readonly PersistedCustodianCase[];
  casesFoundationPending: boolean;
  casesLoading: boolean;
  casesError: string | null;
  busyAction: string | null;
  actionError: string | null;
  actionMessage: string | null;
  promotion: {
    itemId: string;
    target: CustodianPromotionTarget;
    caseId: string;
    confirmed: boolean;
  } | null;
  onTriage: (itemId: string, status: InboxTriageStatus) => Promise<void>;
  onPromotionChange: (
    promotion: {
      itemId: string;
      target: CustodianPromotionTarget;
      caseId: string;
      confirmed: boolean;
    } | null,
  ) => void;
  onPromote: (itemId: string, target: CustodianPromotionTarget, caseId: string) => Promise<void>;
}) {
  const canAct = item.status === "new" || item.status === "triaged";
  const promotionBusy = busyAction === `promote:${item.id}`;
  const selectedPromotion = promotion?.itemId === item.id ? promotion : null;
  const promotionReady = isPromotionReady({
    caseId: selectedPromotion?.caseId ?? "",
    confirmed: selectedPromotion?.confirmed ?? false,
    busy: promotionBusy,
  });

  return (
    <article className="space-y-4 p-4 sm:p-5" aria-labelledby={`inbox-item-${item.id}`}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3
            id={`inbox-item-${item.id}`}
            className="break-words font-serif text-lg text-white-gold"
          >
            {item.title.trim() || "Untitled inbox item"}
          </h3>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {item.sourceLabel || item.kind} · {item.kind}
          </p>
        </div>
        <span className="shrink-0 border border-luminous-gold/30 px-2 py-1 text-xs text-luminous-gold">
          {item.status}
        </span>
      </header>

      <dl className="grid gap-3 border-y border-luminous-gold/15 py-3 text-xs sm:grid-cols-3">
        <InboxMeta label="Captured" value={item.capturedAt} />
        <InboxMeta label="Updated" value={item.updatedAt} />
        <InboxMeta label="Triaged" value={item.triagedAt} />
      </dl>

      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
        {item.rawContent}
      </p>

      {item.promotedId ? (
        <p className="break-all text-xs text-muted-foreground">
          Promoted as {item.promotedKind ?? "record"}: {item.promotedId}
        </p>
      ) : null}

      {actionError ? (
        <p
          className="flex items-start gap-2 border border-risk/50 bg-risk/10 p-3 text-sm text-white-gold"
          role="alert"
        >
          <WarningCircle size={17} className="mt-0.5 shrink-0 text-risk" aria-hidden="true" />
          <span>{actionError}</span>
        </p>
      ) : null}
      {actionMessage ? (
        <p className="flex items-center gap-2 text-sm text-luminous-gold" role="status">
          <Check size={16} aria-hidden="true" />
          {actionMessage}
        </p>
      ) : null}

      {canAct ? (
        <div className="flex flex-wrap gap-2 border-t border-luminous-gold/15 pt-4">
          <ActionButton
            label="Triage"
            busy={busyAction === `triaged:${item.id}`}
            disabled={busyAction !== null}
            onClick={() => void onTriage(item.id, "triaged")}
          />
          <ActionButton
            label="Dismiss"
            busy={busyAction === `dismissed:${item.id}`}
            disabled={busyAction !== null}
            onClick={() => void onTriage(item.id, "dismissed")}
            icon={<X size={15} aria-hidden="true" />}
          />
          <ActionButton
            label="Archive"
            busy={busyAction === `archived:${item.id}`}
            disabled={busyAction !== null}
            onClick={() => void onTriage(item.id, "archived")}
            icon={<Archive size={15} aria-hidden="true" />}
          />
          <ActionButton
            label={selectedPromotion ? "Close promotion" : "Promote"}
            busy={promotionBusy}
            disabled={busyAction !== null && !promotionBusy}
            onClick={() =>
              onPromotionChange(
                selectedPromotion
                  ? null
                  : { itemId: item.id, target: "claim", caseId: "", confirmed: false },
              )
            }
            icon={<FloppyDisk size={15} aria-hidden="true" />}
          />
        </div>
      ) : null}

      {selectedPromotion ? (
        <div className="space-y-4 border border-luminous-gold/30 bg-burgundy-muted/20 p-4">
          <div>
            <h4 className="font-serif text-base text-white-gold">Confirm promotion</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              This uses the existing promotion RPC to create the selected canonical item in a case
              and marks this inbox item promoted.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm text-muted-foreground">
              <span>Promotion target</span>
              <select
                value={selectedPromotion.target}
                onChange={(event) =>
                  onPromotionChange({
                    ...selectedPromotion,
                    target: event.target.value as CustodianPromotionTarget,
                  })
                }
                disabled={promotionBusy}
                className="min-h-11 w-full border border-luminous-gold/30 bg-background px-3 text-sm text-white-gold outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold disabled:opacity-60"
              >
                {PROMOTION_TARGETS.map((target) => (
                  <option key={target.value} value={target.value}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm text-muted-foreground">
              <span>
                Case <span className="text-risk">(required)</span>
              </span>
              <select
                value={selectedPromotion.caseId}
                onChange={(event) =>
                  onPromotionChange({ ...selectedPromotion, caseId: event.target.value })
                }
                disabled={promotionBusy || casesLoading || casesError !== null}
                className="min-h-11 w-full border border-luminous-gold/30 bg-background px-3 text-sm text-white-gold outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold disabled:opacity-60"
              >
                <option value="">Select a case…</option>
                {(cases ?? []).map((currentCase) => (
                  <option key={currentCase.id} value={currentCase.id}>
                    {currentCase.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {casesLoading ? <p className="text-xs text-muted-foreground">Loading cases…</p> : null}
          {casesFoundationPending ? (
            <p className="text-xs text-muted-foreground">
              Case selection is unavailable while the case foundation is pending.
            </p>
          ) : null}
          {casesError ? <p className="text-xs text-risk">Cases unavailable: {casesError}</p> : null}
          {!casesLoading && !casesFoundationPending && !casesError && cases?.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No persisted cases are available for promotion.
            </p>
          ) : null}
          <label className="flex items-start gap-3 text-sm text-white-gold">
            <input
              type="checkbox"
              checked={selectedPromotion.confirmed}
              onChange={(event) =>
                onPromotionChange({ ...selectedPromotion, confirmed: event.target.checked })
              }
              disabled={promotionBusy}
              className="mt-1 h-4 w-4 accent-luminous-gold"
            />
            <span>I confirm this inbox item should be promoted to the selected case.</span>
          </label>
          <button
            type="button"
            disabled={!promotionReady}
            onClick={() => {
              if (!selectedPromotion.caseId) {
                return;
              }
              void onPromote(item.id, selectedPromotion.target, selectedPromotion.caseId);
            }}
            className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/40 bg-burgundy-muted/80 px-4 py-2 text-sm text-white-gold transition-colors hover:bg-risk/80 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
          >
            {promotionBusy ? (
              <CircleNotch size={16} className="animate-spin" aria-hidden="true" />
            ) : null}
            {promotionBusy ? "Promoting…" : "Confirm promotion"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function InboxMeta({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-luminous-gold">{label}</dt>
      <dd className="mt-1 text-foreground">{value ? formatRecordDate(value) : "Not recorded"}</dd>
    </div>
  );
}

function ActionButton({
  label,
  busy,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/35 px-3 py-2 text-xs text-white-gold transition-colors hover:bg-burgundy-muted/55 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
    >
      {busy ? <CircleNotch size={15} className="animate-spin" aria-hidden="true" /> : icon}
      {busy ? `${label}…` : label}
    </button>
  );
}
