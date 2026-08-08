import { useArchive } from "@/lib/archive";
import type { RecordType } from "@/lib/types";
import { Banner, PageHeader } from "./page-parts";
import { RecordForm } from "./record-form";

export function NewRecordPage({ recordType, title }: { recordType: RecordType; title: string }) {
  const query = useArchive(true);
  if (!query.data && query.isPending) {
    return <PageHeader title={title} description="Loading archive context…" />;
  }
  if (!query.data) {
    return (
      <div>
        <PageHeader title={title} />
        <Banner kind="error" title="The form cannot load safely">
          <span>{query.error?.message ?? "Archive records are unavailable."}</span>{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </Banner>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title={title} />
      {query.linksError ? (
        <div className="mb-4">
          <Banner kind="warning" title="Connections unavailable">
            You can create the record, but connected-record choices will remain empty until links
            reload.
          </Banner>
        </div>
      ) : null}
      <RecordForm
        recordType={recordType}
        existing={null}
        allRecords={query.data.records}
        allLinks={query.data.links}
      />
    </div>
  );
}
