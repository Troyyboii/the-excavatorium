import { createFileRoute } from "@tanstack/react-router";
import { useArchive } from "@/lib/archive";
import { RecordDetail } from "@/components/record-detail";
import { EmptyState, PageHeader } from "@/components/page-parts";

export const Route = createFileRoute("/conversations/$id/")({ component: Page, ssr: false });
function Page() {
  const q = useArchive(true);
  const { id } = Route.useParams();
  if (q.isPending) return <PageHeader title="Loading…" />;
  const rec = q.data?.byId.get(id);
  if (!rec || rec.recordType !== "conversation") {
    return (<div><PageHeader title="Record not found" /><EmptyState title="No conversation matches this ID." /></div>);
  }
  return <RecordDetail record={rec} allRecords={q.data!.records} allLinks={q.data!.links} byId={q.data!.byId} />;
}
