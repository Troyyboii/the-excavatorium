import { createFileRoute } from "@tanstack/react-router";
import { useArchive } from "@/lib/archive";
import { RecordListPage } from "@/components/record-list-page";

export const Route = createFileRoute("/decisions/")({ component: Page, ssr: false });
function Page() {
  const q = useArchive(true);
  return <RecordListPage type="decision" records={q.data?.records ?? []} />;
}
