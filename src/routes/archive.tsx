import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { RecordList } from "@/components/record-list";
import { ArchiveViewNav } from "@/components/archive-view-nav";
import { useArchive } from "@/lib/archive";
import { RECORD_TYPES, RECORD_TYPE_LABEL, type ArchiveRecord, type RecordType } from "@/lib/types";

export const Route = createFileRoute("/archive")({ component: ArchivePage, ssr: false });

function ArchivePage() {
  const archive = useArchive(true);
  const [type, setType] = useState<RecordType | "all">("all");
  const records = useMemo(() => {
    const all = [...(archive.data?.records ?? [])].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title),
    );
    return type === "all" ? all : all.filter((record) => record.recordType === type);
  }, [archive.data?.records, type]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 py-4 sm:py-7">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-brass">The Archive</p>
        <h1 className="mt-2 font-serif text-3xl text-foreground sm:text-4xl">Archive</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Browse records and their saved connections, dates, and source material.
        </p>
      </header>

      <ArchiveViewNav active="browse" />

      {archive.state.isColdOffline ? (
        <p className="border border-border bg-card p-5 text-sm text-muted-foreground">
          No cached archive is available on this device. Reconnect to read persisted records.
        </p>
      ) : !archive.data && archive.isPending ? (
        <p className="p-4 text-sm text-muted-foreground" role="status">
          Reading persisted records…
        </p>
      ) : !archive.data ? (
        <div className="border border-border bg-card p-5 text-sm text-muted-foreground">
          <p>
            Archive records could not be retrieved:{" "}
            {archive.recordsError?.message ?? "No data returned."}
          </p>
          <button
            type="button"
            className="mt-3 inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void archive.refetch()}
          >
            Retry
          </button>
        </div>
      ) : (
        <section
          aria-labelledby="browse-heading"
          className="overflow-hidden border border-border bg-card"
        >
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="browse-heading" className="font-serif text-xl text-foreground">
                Browse records
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {records.length} {records.length === 1 ? "record" : "records"}
                {archive.recordsError ? " · showing cached records" : ""}
              </p>
            </div>
            <label className="flex min-h-11 items-center gap-2 border border-input bg-background px-3 text-sm">
              <span className="text-muted-foreground">Type</span>
              <select
                aria-label="Filter records by type"
                className="min-h-10 max-w-full bg-transparent text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={type}
                onChange={(event) => setType(event.target.value as RecordType | "all")}
              >
                <option value="all">All records</option>
                {RECORD_TYPES.map((recordType) => (
                  <option key={recordType} value={recordType}>
                    {recordType === "repository"
                      ? "Code repository"
                      : RECORD_TYPE_LABEL[recordType]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {records.length ? (
            <div className="divide-y divide-border">
              {records.map((record) => (
                <BrowseRecord key={record.id} record={record} />
              ))}
            </div>
          ) : (
            <div className="p-8 text-center">
              <p className="font-serif text-xl text-foreground">Nothing is filed here yet.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {type === "all"
                  ? "Add material when you are ready."
                  : "No records match this type."}
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function BrowseRecord({ record }: { record: ArchiveRecord }) {
  const typeLabel =
    record.recordType === "repository" ? "Code repository" : RECORD_TYPE_LABEL[record.recordType];
  const firstLine = record.summary.trim() || firstUsefulLine(record);
  return (
    <a
      href={`/${record.recordType === "repository" ? "repositories" : record.recordType === "tool" ? "tools" : `${record.recordType}s`}/${record.id}`}
      className="group grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 transition-colors hover:bg-record-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
    >
      <span className="min-w-0">
        <span className="block truncate font-serif text-lg text-foreground group-hover:text-primary">
          {record.title}
        </span>
        {firstLine ? (
          <span className="mt-1 line-clamp-2 block text-sm leading-5 text-muted-foreground">
            {firstLine}
          </span>
        ) : null}
        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{typeLabel}</span>
          <span>{new Date(record.updatedAt).toLocaleDateString()}</span>
          {record.tags.slice(0, 4).map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </span>
      </span>
      <span aria-hidden="true" className="text-brass">
        →
      </span>
    </a>
  );
}

function firstUsefulLine(record: ArchiveRecord): string {
  if (record.recordType === "conversation") return record.recordData.highSignalFindings.trim();
  if (record.recordType === "decision") return record.recordData.reason.trim();
  if (record.recordType === "tool") return record.recordData.finalVerdict.trim();
  if (record.recordType === "repository") return record.recordData.whatItActuallyDoes.trim();
  return record.recordData.highSignalFindings[0]?.text.trim() ?? "";
}
