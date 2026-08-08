import { useArchive } from "@/lib/archive";
import type { RecordType } from "@/lib/types";
import { Banner, EmptyState, PageHeader } from "./page-parts";
import { RecordForm } from "./record-form";

export function EditRecordPage({ id, recordType }: { id: string; recordType: RecordType }) {
  const query = useArchive(true);

  if (query.isPending && !query.data) return <PageHeader title="Loading…" />;

  if (!query.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Record unavailable" />
        <Banner kind="error" title="The archive could not load">
          <span>{query.recordsError?.message ?? "The records request failed."}</span>{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </Banner>
      </div>
    );
  }

  const record = query.data.byId.get(id);
  if (!record || record.recordType !== recordType) {
    return (
      <div>
        <PageHeader title="Record not found" />
        <EmptyState title={`No ${recordType} matches this ID.`} />
      </div>
    );
  }

  if (query.recordsError || query.state.linksPending || query.linksError) {
    const recordsStale = Boolean(query.recordsError);
    return (
      <div className="space-y-4">
        <PageHeader title={`Edit ${record.title}`} />
        <Banner
          kind={recordsStale || query.linksError ? "error" : "info"}
          title={
            recordsStale
              ? "Record data may be stale"
              : query.linksError
                ? "Connections unavailable"
                : "Loading connections…"
          }
        >
          <span>
            Editing is paused so stale record data or an incomplete connection list cannot overwrite
            this record.
          </span>{" "}
          {recordsStale || query.linksError ? (
            <button type="button" className="underline" onClick={() => void query.refetch()}>
              Retry
            </button>
          ) : null}
        </Banner>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={`Edit ${record.title}`} />
      <RecordForm
        recordType={recordType}
        existing={record}
        allRecords={query.data.records}
        allLinks={query.data.links}
      />
    </div>
  );
}
