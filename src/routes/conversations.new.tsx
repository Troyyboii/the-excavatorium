import { createFileRoute } from "@tanstack/react-router";
import { useArchive } from "@/lib/archive";
import { RecordForm } from "@/components/record-form";
import { PageHeader } from "@/components/page-parts";

export const Route = createFileRoute("/conversations/new")({ component: Page, ssr: false });
function Page() {
  const q = useArchive(true);
  return (
    <div>
      <PageHeader title="New conversation" />
      <RecordForm
        recordType="conversation"
        existing={null}
        allRecords={q.data?.records ?? []}
        allLinks={q.data?.links ?? []}
      />
    </div>
  );
}
