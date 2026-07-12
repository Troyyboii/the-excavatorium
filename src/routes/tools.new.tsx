import { createFileRoute } from "@tanstack/react-router";
import { useArchive } from "@/lib/archive";
import { RecordForm } from "@/components/record-form";
import { PageHeader } from "@/components/page-parts";

export const Route = createFileRoute("/tools/new")({ component: Page, ssr: false });
function Page() {
  const q = useArchive(true);
  return (
    <div>
      <PageHeader title="New tool" />
      <RecordForm recordType="tool" existing={null} allRecords={q.data?.records ?? []} allLinks={q.data?.links ?? []} />
    </div>
  );
}
