import { createFileRoute } from "@tanstack/react-router";
import { useArchive } from "@/lib/archive";
import { RecordListPage } from "@/components/record-list-page";

export const Route = createFileRoute("/conversations/")({ component: Page, ssr: false });
function Page() {
  const q = useArchive(true);
  return <RecordListPage type="conversation" records={q.data?.records ?? []} />;
}
