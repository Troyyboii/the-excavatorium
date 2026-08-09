import { createFileRoute } from "@tanstack/react-router";
import { ArchiveRecordListPage } from "@/components/record-list-page";

export const Route = createFileRoute("/documents/")({ component: Page, ssr: false });
function Page() {
  return <ArchiveRecordListPage type="document" />;
}
