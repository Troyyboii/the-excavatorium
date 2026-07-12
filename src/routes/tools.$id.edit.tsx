import { createFileRoute } from "@tanstack/react-router";
import { useArchive } from "@/lib/archive";
import { RecordForm } from "@/components/record-form";
import { EmptyState, PageHeader } from "@/components/page-parts";

export const Route = createFileRoute("/tools/$id/edit")({ component: Page, ssr: false });
function Page() {
  const q = useArchive(true);
  const { id } = Route.useParams();
  if (q.isPending) return <PageHeader title="Loading…" />;
  const rec = q.data?.byId.get(id);
  if (!rec || rec.recordType !== "tool") {
    return (<div><PageHeader title="Record not found" /><EmptyState title="No tool matches this ID." /></div>);
  }
  return (
    <div>
      <PageHeader title={`Edit ${rec.title}`} />
      <RecordForm recordType="tool" existing={rec} allRecords={q.data!.records} allLinks={q.data!.links} />
    </div>
  );
}
