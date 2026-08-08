import { createFileRoute } from "@tanstack/react-router";
import { EditRecordPage } from "@/components/edit-record-page";

export const Route = createFileRoute("/conversations/$id/edit")({ component: Page, ssr: false });
function Page() {
  const { id } = Route.useParams();
  return <EditRecordPage id={id} recordType="conversation" />;
}
