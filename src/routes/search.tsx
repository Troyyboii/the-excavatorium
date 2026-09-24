import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useArchive } from "@/lib/archive";
import { Banner, PageHeader } from "@/components/page-parts";
import { RecordList } from "@/components/record-list";
import type { ArchiveRecord, RecordType } from "@/lib/types";
import { RECORD_TYPES, RECORD_TYPE_PLURAL } from "@/lib/types";
import { ArchiveViewNav } from "@/components/archive-view-nav";

export const Route = createFileRoute("/search")({ component: Page, ssr: false });

// Fields searched: every user-entered string. Excludes IDs, timestamps,
// booleans, seed keys, and enum machine keys per spec §15.
function toSearchableText(r: ArchiveRecord): string {
  const parts: string[] = [r.title, r.summary, r.tags.join(" ")];
  const d = r.recordData as Record<string, unknown>;
  if (r.recordType === "tool") {
    parts.push(r.recordData.category, r.recordData.status);
    parts.push(
      r.recordData.whatCaughtMyEye,
      r.recordData.whatItPromised,
      r.recordData.whatActuallyHappened,
      r.recordData.whatWorked,
      r.recordData.whatFailed,
      r.recordData.whyIKeptOrStoppedUsingIt,
      r.recordData.revisitCondition,
      r.recordData.finalVerdict,
    );
  } else if (r.recordType === "repository") {
    parts.push(
      r.recordData.githubUrl,
      r.recordData.whatCaughtMyEye,
      r.recordData.whatItClaims,
      r.recordData.whatItActuallyDoes,
      r.recordData.maintenanceImpression,
      r.recordData.finalVerdict,
      r.recordData.recommendedAction ?? "",
    );
  } else if (r.recordType === "conversation") {
    parts.push(
      r.recordData.projectRoute ?? "",
      r.recordData.highSignalFindings,
      r.recordData.decisionsMade,
      r.recordData.openLoops,
      r.recordData.reusablePrompts,
      r.recordData.memoryCandidates,
      r.recordData.rawConversationText,
    );
  } else if (r.recordType === "decision") {
    parts.push(
      r.recordData.reason,
      r.recordData.trigger,
      r.recordData.whatWouldChangeMyMind,
      r.recordData.status,
      r.recordData.confidence,
    );
  } else if (r.recordType === "document") {
    const insights = [
      ...r.recordData.highSignalFindings,
      ...r.recordData.keyClaims,
      ...r.recordData.contradictions,
      ...r.recordData.uncertainties,
    ];
    parts.push(
      r.recordData.originalFileName ?? "",
      r.recordData.documentDate ?? "",
      r.recordData.projectRoute ?? "",
      ...insights.flatMap((item) => [item.text, ...item.sourceReferenceIds]),
      ...r.recordData.sourceReferences.flatMap((ref) => [ref.label, ref.note, ref.locator]),
    );
  }
  void d;
  return parts.join("\n").toLowerCase();
}

function Page() {
  const q = useArchive(true);
  const [text, setText] = useState("");

  const indexed = useMemo(() => {
    const items = q.data?.records ?? [];
    return items.map((r) => ({ r, text: toSearchableText(r) }));
  }, [q.data]);

  const results = useMemo(() => {
    const query = text.trim().toLowerCase();
    if (!query) return [];
    return indexed.filter((x) => x.text.includes(query)).map((x) => x.r);
  }, [indexed, text]);

  const grouped: Record<RecordType, ArchiveRecord[]> = {
    tool: results.filter((r) => r.recordType === "tool"),
    repository: results.filter((r) => r.recordType === "repository"),
    conversation: results.filter((r) => r.recordType === "conversation"),
    decision: results.filter((r) => r.recordType === "decision"),
    document: results.filter((r) => r.recordType === "document"),
  };

  if (!q.data && q.isPending) {
    return <PageHeader title="Search" description="Loading the searchable archive…" />;
  }

  if (!q.data) {
    return (
      <div>
        <PageHeader title="Search" />
        <Banner kind="error" title="Search is unavailable">
          <span>{q.recordsError?.message ?? "Records could not load."}</span>{" "}
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </Banner>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Search Archive"
        description="Case-insensitive partial text across every user-entered field."
      />
      <div className="mb-6">
        <ArchiveViewNav active="search" />
      </div>
      {q.recordsError ? (
        <div className="mb-4">
          <Banner kind="warning" title="Showing cached search data">
            The latest refresh failed. Existing results remain searchable.
          </Banner>
        </div>
      ) : null}
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search the archive…"
        className="mb-6 w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
      />
      {text.trim() === "" ? (
        <p className="text-sm text-muted-foreground">Type to search.</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches for “{text}”.</p>
      ) : (
        <div className="space-y-6">
          {RECORD_TYPES.map((t) => {
            const items = grouped[t];
            if (items.length === 0) return null;
            return (
              <section key={t}>
                <h2 className="mb-2 font-serif text-lg text-foreground">
                  {t === "repository" ? "Code repositories" : RECORD_TYPE_PLURAL[t]}{" "}
                  <span className="text-xs text-muted-foreground">({items.length})</span>
                </h2>
                <RecordList items={items} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
