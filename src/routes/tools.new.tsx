import { createFileRoute } from "@tanstack/react-router";
import { NewRecordPage } from "@/components/new-record-page";

export const Route = createFileRoute("/tools/new")({ component: Page, ssr: false });
function Page() {
  return <NewRecordPage recordType="tool" title="New tool" />;
}
