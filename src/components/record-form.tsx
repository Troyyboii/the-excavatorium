import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Field, TextInput, TextArea, Select, Section } from "./form-parts";
import { TagInput } from "./tag-input";
import { RecordPicker } from "./record-picker";
import { Banner } from "./page-parts";
import { useSaveRecord, useDeleteRecord } from "@/lib/archive";
import type {
  ArchiveLink,
  ArchiveRecord,
  ConversationData,
  DecisionData,
  RecordType,
  RepositoryData,
  ToolData,
} from "@/lib/types";
import {
  CONFIDENCE_LEVELS,
  DECISION_STATUSES,
  PROJECT_ROUTES,
  RATING_LEVELS,
  RECORD_TYPE_LABEL,
  REPOSITORY_ACTIONS,
  TOOL_STATUSES,
  emptyRecordData,
} from "@/lib/types";
import { normalizeTags } from "@/lib/format";
import { plural } from "./record-list";

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Props = {
  recordType: RecordType;
  existing: ArchiveRecord | null;
  allRecords: ArchiveRecord[];
  allLinks: ArchiveLink[];
};

export function RecordForm({ recordType, existing, allRecords, allLinks }: Props) {
  const navigate = useNavigate();
  const save = useSaveRecord();
  const del = useDeleteRecord();

  const [title, setTitle] = useState(existing?.title ?? "");
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [data, setData] = useState<ToolData | RepositoryData | ConversationData | DecisionData>(
    existing?.recordData ?? emptyRecordData(recordType, todayLocal()),
  );
  const [selectedLinks, setSelectedLinks] = useState<string[]>(() => {
    if (!existing) return [];
    return allLinks
      .filter((l) => l.sourceId === existing.id || l.targetId === existing.id)
      .map((l) => (l.sourceId === existing.id ? l.targetId : l.sourceId));
  });
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    function onUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  function patch<K extends keyof typeof data>(k: K, v: (typeof data)[K]) {
    setData((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  }

  function clientValidate(): string | null {
    if (title.trim() === "") return "Title is required.";
    if (recordType === "tool") {
      const d = data as ToolData;
      if (!d.category.trim()) return "Category is required.";
      if (!d.status) return "Status is required.";
      if (d.replacementToolId && d.replacementToolId === existing?.id)
        return "Replacement tool cannot be the current record.";
    } else if (recordType === "repository") {
      const d = data as RepositoryData;
      if (!d.githubUrl.trim()) return "GitHub URL is required.";
    } else if (recordType === "conversation") {
      const d = data as ConversationData;
      if (!d.projectRoute) return "Project route is required.";
    } else {
      const d = data as DecisionData;
      if (!d.reason.trim()) return "Reason is required.";
      if (!d.decisionDate) return "Decision date is required.";
      if (!d.status) return "Status is required.";
      if (!d.confidence) return "Confidence is required.";
      if (d.supersedesDecisionId && d.supersedesDecisionId === existing?.id)
        return "Supersedes cannot reference the current record.";
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const err = clientValidate();
    if (err) {
      setError(err);
      return;
    }
    try {
      const result = await save.mutateAsync({
        id: existing?.id ?? null,
        recordType,
        title: title.trim(),
        summary,
        tags: normalizeTags(tags),
        recordData: data as unknown as Record<string, unknown>,
        selectedTargetIds: selectedLinks,
      });
      setDirty(false);
      navigate({ to: `/${plural(recordType)}/${result.id}` });
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Save failed.");
    }
  }

  async function onDelete() {
    if (!existing) return;
    setError(null);
    try {
      await del.mutateAsync(existing.id);
      setDirty(false);
      navigate({ to: `/${plural(recordType)}` });
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Delete failed.");
    }
  }

  const toolChoices = useMemo(
    () => allRecords.filter((r) => r.recordType === "tool" && r.id !== existing?.id),
    [allRecords, existing?.id],
  );
  const decisionChoices = useMemo(
    () => allRecords.filter((r) => r.recordType === "decision" && r.id !== existing?.id),
    [allRecords, existing?.id],
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5 pb-40 sm:pb-24">
      {error ? (
        <Banner kind="error" title="Could not save this record">
          {error}. Existing data was not changed. You can safely retry.
        </Banner>
      ) : null}

      <Section
        title={
          existing
            ? `Edit ${RECORD_TYPE_LABEL[recordType]}`
            : `New ${RECORD_TYPE_LABEL[recordType]}`
        }
      >
        <Field label="Title" htmlFor="title" required>
          <TextInput
            id="title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            required
          />
        </Field>
        <Field label="Summary" htmlFor="summary">
          <TextArea
            id="summary"
            value={summary}
            onChange={(e) => {
              setSummary(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <Field label="Tags" htmlFor="tags">
          <TagInput
            id="tags"
            value={tags}
            onChange={(v) => {
              setTags(v);
              setDirty(true);
            }}
          />
        </Field>
      </Section>

      {recordType === "tool" ? (
        <ToolFields data={data as ToolData} patch={patch as never} choices={toolChoices} />
      ) : null}
      {recordType === "repository" ? (
        <RepositoryFields data={data as RepositoryData} patch={patch as never} />
      ) : null}
      {recordType === "conversation" ? (
        <ConversationFields data={data as ConversationData} patch={patch as never} />
      ) : null}
      {recordType === "decision" ? (
        <DecisionFields
          data={data as DecisionData}
          patch={patch as never}
          choices={decisionChoices}
        />
      ) : null}

      <Section title="Connected records">
        <RecordPicker
          all={allRecords}
          currentId={existing?.id ?? null}
          value={selectedLinks}
          onChange={(v) => {
            setSelectedLinks(v);
            setDirty(true);
          }}
        />
      </Section>

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-3 border-t border-border bg-background px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:mx-0 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-0">
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-[color:var(--primary)]/90 disabled:opacity-60"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (dirty && !window.confirm("Discard unsaved changes?")) return;
              navigate({
                to: existing ? `/${plural(recordType)}/${existing.id}` : `/${plural(recordType)}`,
              });
            }}
            className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-[color:var(--record-hover)]"
          >
            Cancel
          </button>
        </div>
        {existing ? (
          <div className="flex items-center gap-2">
            {showDeleteConfirm ? (
              <>
                <span className="text-xs text-muted-foreground">Delete this record?</span>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/10 px-3 py-2 text-sm text-[color:var(--destructive-foreground)]"
                  onClick={onDelete}
                  disabled={del.isPending}
                >
                  {del.isPending ? "Deleting…" : "Confirm delete"}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm text-muted-foreground"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-md border border-[color:var(--destructive)]/60 px-3 py-2 text-sm text-[color:var(--destructive-foreground)] hover:bg-[color:var(--destructive)]/10"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete
              </button>
            )}
          </div>
        ) : null}
      </div>
    </form>
  );
}

// ------------- Type-specific field groups -------------

type Patcher<D> = <K extends keyof D>(k: K, v: D[K]) => void;

function ToolFields({
  data,
  patch,
  choices,
}: {
  data: ToolData;
  patch: Patcher<ToolData>;
  choices: ArchiveRecord[];
}) {
  return (
    <Section title="Tool details">
      <Field label="Category" required>
        <TextInput
          value={data.category}
          onChange={(e) => patch("category", e.target.value)}
          required
        />
      </Field>
      <Field label="Status" required>
        <Select
          value={data.status}
          onChange={(e) => patch("status", e.target.value as ToolData["status"])}
        >
          {TOOL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="What caught my eye">
          <TextArea
            value={data.whatCaughtMyEye}
            onChange={(e) => patch("whatCaughtMyEye", e.target.value)}
          />
        </Field>
        <Field label="What it promised">
          <TextArea
            value={data.whatItPromised}
            onChange={(e) => patch("whatItPromised", e.target.value)}
          />
        </Field>
        <Field label="What actually happened">
          <TextArea
            value={data.whatActuallyHappened}
            onChange={(e) => patch("whatActuallyHappened", e.target.value)}
          />
        </Field>
        <Field label="What worked">
          <TextArea value={data.whatWorked} onChange={(e) => patch("whatWorked", e.target.value)} />
        </Field>
        <Field label="What failed">
          <TextArea value={data.whatFailed} onChange={(e) => patch("whatFailed", e.target.value)} />
        </Field>
        <Field label="Why I kept or stopped using it">
          <TextArea
            value={data.whyIKeptOrStoppedUsingIt}
            onChange={(e) => patch("whyIKeptOrStoppedUsingIt", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Replacement tool" hint="Must reference another of your Tools.">
        <Select
          value={data.replacementToolId ?? ""}
          onChange={(e) => patch("replacementToolId", e.target.value || null)}
        >
          <option value="">— None —</option>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Revisit condition">
        <TextArea
          value={data.revisitCondition}
          onChange={(e) => patch("revisitCondition", e.target.value)}
        />
      </Field>
      <Field label="Final verdict">
        <TextArea
          value={data.finalVerdict}
          onChange={(e) => patch("finalVerdict", e.target.value)}
        />
      </Field>
      <Field label="Last reviewed">
        <TextInput
          type="date"
          value={data.lastReviewed ?? ""}
          onChange={(e) => patch("lastReviewed", e.target.value || null)}
        />
      </Field>
    </Section>
  );
}

function RepositoryFields({
  data,
  patch,
}: {
  data: RepositoryData;
  patch: Patcher<RepositoryData>;
}) {
  return (
    <Section title="Repository details">
      <Field
        label="GitHub URL"
        required
        hint="Only the URL is stored. No GitHub API calls are made."
      >
        <TextInput
          type="url"
          value={data.githubUrl}
          onChange={(e) => patch("githubUrl", e.target.value)}
          required
        />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="What caught my eye">
          <TextArea
            value={data.whatCaughtMyEye}
            onChange={(e) => patch("whatCaughtMyEye", e.target.value)}
          />
        </Field>
        <Field label="What it claims">
          <TextArea
            value={data.whatItClaims}
            onChange={(e) => patch("whatItClaims", e.target.value)}
          />
        </Field>
        <Field label="What it actually does">
          <TextArea
            value={data.whatItActuallyDoes}
            onChange={(e) => patch("whatItActuallyDoes", e.target.value)}
          />
        </Field>
        <Field label="Maintenance impression">
          <TextArea
            value={data.maintenanceImpression}
            onChange={(e) => patch("maintenanceImpression", e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        {(
          [
            ["Complexity", "complexity"],
            ["Risk", "risk"],
            ["Integration cost", "integrationCost"],
            ["Immediate usefulness", "immediateUsefulness"],
            ["Long-term value", "longTermValue"],
          ] as const
        ).map(([label, key]) => (
          <Field key={key} label={label}>
            <Select
              value={data[key]}
              onChange={(e) => patch(key, e.target.value as RepositoryData[typeof key])}
            >
              {RATING_LEVELS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <Field label="Recommended action">
        <Select
          value={data.recommendedAction ?? ""}
          onChange={(e) =>
            patch(
              "recommendedAction",
              (e.target.value || null) as RepositoryData["recommendedAction"],
            )
          }
        >
          <option value="">— Awaiting verdict —</option>
          {REPOSITORY_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Final verdict">
        <TextArea
          value={data.finalVerdict}
          onChange={(e) => patch("finalVerdict", e.target.value)}
        />
      </Field>
      <Field label="Last reviewed">
        <TextInput
          type="date"
          value={data.lastReviewed ?? ""}
          onChange={(e) => patch("lastReviewed", e.target.value || null)}
        />
      </Field>
    </Section>
  );
}

function ConversationFields({
  data,
  patch,
}: {
  data: ConversationData;
  patch: Patcher<ConversationData>;
}) {
  const [rawExpanded, setRawExpanded] = useState((data.rawConversationText ?? "").length > 0);
  return (
    <Section title="Conversation details">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Conversation date">
          <TextInput
            type="date"
            value={data.conversationDate ?? ""}
            onChange={(e) => patch("conversationDate", e.target.value || null)}
          />
        </Field>
        <Field label="Project route" required>
          <Select
            value={data.projectRoute}
            onChange={(e) =>
              patch("projectRoute", e.target.value as ConversationData["projectRoute"])
            }
          >
            {PROJECT_ROUTES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="High-signal findings">
        <TextArea
          value={data.highSignalFindings}
          onChange={(e) => patch("highSignalFindings", e.target.value)}
        />
      </Field>
      <Field label="Decisions made">
        <TextArea
          value={data.decisionsMade}
          onChange={(e) => patch("decisionsMade", e.target.value)}
        />
      </Field>
      <Field label="Open loops">
        <TextArea value={data.openLoops} onChange={(e) => patch("openLoops", e.target.value)} />
      </Field>
      <Field label="Reusable prompts">
        <TextArea
          value={data.reusablePrompts}
          onChange={(e) => patch("reusablePrompts", e.target.value)}
        />
      </Field>
      <Field label="Memory candidates">
        <TextArea
          value={data.memoryCandidates}
          onChange={(e) => patch("memoryCandidates", e.target.value)}
        />
      </Field>
      <Field
        label="Raw conversation text"
        hint={`${data.rawConversationText.length.toLocaleString()} characters. Line breaks and long content are preserved.`}
      >
        {rawExpanded ? (
          <TextArea
            value={data.rawConversationText}
            onChange={(e) => patch("rawConversationText", e.target.value)}
            className="min-h-[300px] font-mono text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setRawExpanded(true)}
            className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-[color:var(--record-hover)]"
          >
            Expand raw conversation editor
          </button>
        )}
      </Field>
    </Section>
  );
}

function DecisionFields({
  data,
  patch,
  choices,
}: {
  data: DecisionData;
  patch: Patcher<DecisionData>;
  choices: ArchiveRecord[];
}) {
  return (
    <Section title="Decision details">
      <Field label="Reason" required>
        <TextArea value={data.reason} onChange={(e) => patch("reason", e.target.value)} required />
      </Field>
      <Field label="Trigger">
        <TextArea value={data.trigger} onChange={(e) => patch("trigger", e.target.value)} />
      </Field>
      <Field label="What would change my mind">
        <TextArea
          value={data.whatWouldChangeMyMind}
          onChange={(e) => patch("whatWouldChangeMyMind", e.target.value)}
        />
      </Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Decision date" required>
          <TextInput
            type="date"
            required
            value={data.decisionDate}
            onChange={(e) => patch("decisionDate", e.target.value)}
          />
        </Field>
        <Field label="Status" required>
          <Select
            value={data.status}
            onChange={(e) => patch("status", e.target.value as DecisionData["status"])}
          >
            {DECISION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Confidence" required>
          <Select
            value={data.confidence}
            onChange={(e) => patch("confidence", e.target.value as DecisionData["confidence"])}
          >
            {CONFIDENCE_LEVELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Supersedes decision" hint="Older Decision this one replaces. Not automatic.">
        <Select
          value={data.supersedesDecisionId ?? ""}
          onChange={(e) => patch("supersedesDecisionId", e.target.value || null)}
        >
          <option value="">— None —</option>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
      </Field>
    </Section>
  );
}
