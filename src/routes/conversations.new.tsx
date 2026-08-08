import { createFileRoute } from "@tanstack/react-router";
import { NewRecordPage } from "@/components/new-record-page";

export const Route = createFileRoute("/conversations/new")({ component: Page, ssr: false });
function Page() {
  return <NewRecordPage recordType="conversation" title="New conversation" />;
}
