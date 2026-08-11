import { createFileRoute } from "@tanstack/react-router";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { InboxIntake } from "@/components/custodian/inbox-intake";
import { useOnlineStatus } from "@/hooks/use-online";
import { useQueryClient } from "@tanstack/react-query";
import {
  createCustodianInboxItem,
  isCustodianFoundationMissing,
  useCustodianInboxItems,
} from "@/lib/custodian";

export const Route = createFileRoute("/inbox")({ component: InboxPage, ssr: false });

function InboxPage() {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const inbox = useCustodianInboxItems(online);
  const foundationPending = Boolean(inbox.error && isCustodianFoundationMissing(inbox.error));

  async function create(payload: {
    sourceKind:
      | "thought"
      | "conversation"
      | "document"
      | "url"
      | "github"
      | "context7"
      | "record"
      | "clipboard"
      | "mobile_share";
    title: string;
    content: string;
  }) {
    await createCustodianInboxItem({
      kind: payload.sourceKind,
      title: payload.title,
      rawContent: payload.content,
      sourceLabel: payload.sourceKind,
    });
    await queryClient.invalidateQueries({ queryKey: ["custodian"] });
  }
  return (
    <CustodianPage
      title="Inbox"
      description="One intake surface for material that has not yet earned a place in the archive."
      status={
        <CustodianStatus
          online={online}
          fetching={inbox.isFetching}
          foundationPending={foundationPending}
          error={inbox.error && !foundationPending ? inbox.error.message : null}
        />
      }
    >
      <InboxIntake foundationPending={foundationPending} onCreate={create} />
    </CustodianPage>
  );
}
