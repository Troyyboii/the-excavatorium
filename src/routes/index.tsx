import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useArchive } from "@/lib/archive";
import { PageHeader } from "@/components/page-parts";
import { RecordList, plural, recordHref } from "@/components/record-list";
import type { ArchiveRecord } from "@/lib/types";
import { RECORD_TYPE_LABEL } from "@/lib/types";

export const Route = createFileRoute("/")({
  component: Dashboard,
  ssr: false,
});

function Dashboard() {
  const q = useArchive(true);

  if (q.isPending) return <PageHeader title="Dashboard" description="Loading archive…" />;
  if (q.error)
    return (
      <div>
        <PageHeader title="Dashboard" />
        <div className="rounded-md border border-[color:var(--destructive)]/60 bg-[color:var(--destructive)]/10 p-4 text-sm text-foreground">
          <div className="font-medium">Archive could not load</div>
          <div className="mt-1 text-muted-foreground">
            {q.error.message}. Existing data was not changed. Retry the page or check the
            connection.
          </div>
        </div>
      </div>
    );
  const records = q.data!.records;
  const recentAdditions = [...records]
    .sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 5);
  const recentDecisions = records
    .filter((r): r is ArchiveRecord & { recordType: "decision" } => r.recordType === "decision")
    .sort(
      (a, b) =>
        b.recordData.decisionDate.localeCompare(a.recordData.decisionDate) ||
        b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, 5);
  const activeTools = records
    .filter(
      (r): r is ArchiveRecord & { recordType: "tool" } =>
        r.recordType === "tool" && r.recordData.status === "Active",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title))
    .slice(0, 5);
  const buriedTools = records
    .filter(
      (r): r is ArchiveRecord & { recordType: "tool" } =>
        r.recordType === "tool" &&
        (r.recordData.status === "Buried" || r.recordData.status === "Grok-tier cursed"),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title))
    .slice(0, 5);
  const awaitingRepos = records
    .filter(
      (r): r is ArchiveRecord & { recordType: "repository" } =>
        r.recordType === "repository" && r.recordData.recommendedAction === null,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title))
    .slice(0, 5);
  const openLoopsConvs = records
    .filter(
      (r): r is ArchiveRecord & { recordType: "conversation" } =>
        r.recordType === "conversation" && r.recordData.openLoops.trim() !== "",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title))
    .slice(0, 5);

  return (
    <div>
      <PageHeader title="Dashboard" description="Recent activity across the archive." />
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Recent additions" items={recentAdditions} moreTo={null} />
        <Section title="Recent decisions" items={recentDecisions} moreTo="/decisions" />
        <Section title="Active tools" items={activeTools} moreTo="/tools" />
        <Section title="Buried tools" items={buriedTools} moreTo="/tools" />
        <Section
          title="Repositories awaiting verdict"
          items={awaitingRepos}
          moreTo="/repositories"
        />
        <Section
          title="Conversations with open loops"
          items={openLoopsConvs}
          moreTo="/conversations"
        />
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  moreTo,
}: {
  title: string;
  items: ArchiveRecord[];
  moreTo: string | null;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="min-w-0 flex-1 break-words font-serif text-base text-foreground">{title}</h2>
        {moreTo ? (
          <Link
            to={moreTo}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
        ) : null}
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing here yet.</div>
      ) : (
        <ul>
          {items.map((r) => (
            <li key={r.id}>
              <Link
                to={recordHref(r)}
                className="flex flex-col gap-1 border-b border-border px-4 py-2 text-sm last:border-0 hover:bg-[color:var(--record-hover)] sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <span className="min-w-0 flex-1 break-words text-foreground line-clamp-2 sm:truncate">
                  {r.title}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                  {RECORD_TYPE_LABEL[r.recordType]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// keep unused import friendly to typecheck (plural referenced elsewhere)
void plural;
