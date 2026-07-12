import { createFileRoute } from "@tanstack/react-router";
import { useArchive } from "@/lib/archive";
import { RecordListPage } from "@/components/record-list-page";

export const Route = createFileRoute("/tools/")({ component: Page, ssr: false });
function Page() {
  const q = useArchive(true);
  return <RecordListPage type="tool" records={q.data?.records ?? []} />;
}
