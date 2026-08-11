import { createFileRoute } from "@tanstack/react-router";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { InboxIntake } from "@/components/custodian/inbox-intake";
import { useOnlineStatus } from "@/hooks/use-online";
import { useQueryClient } from "@tanstack/react-query";
import {
  createCustodianInboxItem,
  isCustodianFoundationMissing,
  promoteCustodianInboxItem,
  triageCustodianInboxItem,
  useCustodianCases,
  useCustodianInboxItems,
} from "@/lib/custodian";
import type { CustodianPromotionTarget } from "@/lib/custodian";
import type { InboxStatus } from "@/lib/custodian-types";

export const Route = createFileRoute("/inbox")({ component: InboxPage, ssr: false });

function InboxPage() {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const inbox = useCustodianInboxItems(online);
  const cases = useCustodianCases(online);
  const inboxFoundationPending = Boolean(inbox.error && isCustodianFoundationMissing(inbox.error));
  const casesFoundationPending = Boolean(cases.error && isCustodianFoundationMissing(cases.error));
  const error = !online
    ? "Network unavailable. Inbox items cannot be retrieved or changed."
    : inbox.error
      ? inboxFoundationPending
        ? "Inbox storage is unavailable in the connected Supabase project."
        : inbox.error.message
      : null;

  async function invalidateCustodianQueries() {
    await queryClient.invalidateQueries({ queryKey: ["custodian"] });
  }

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
    await invalidateCustodianQueries();
  }

  async function triage(itemId: string, status: Exclude<InboxStatus, "new" | "promoted">) {
    await triageCustodianInboxItem(itemId, status);
    await invalidateCustodianQueries();
  }

  async function promote(itemId: string, target: CustodianPromotionTarget, caseId: string) {
    await promoteCustodianInboxItem(itemId, target, caseId);
    await invalidateCustodianQueries();
  }

  return (
    <CustodianPage
      title="Inbox"
      description="One intake surface for material that has not yet earned a place in the archive."
      status={<CustodianStatus online={online} fetching={inbox.isFetching} error={error} />}
    >
      <InboxIntake
        online={online}
        foundationPending={inboxFoundationPending}
        onCreate={create}
        items={inbox.data}
        cases={cases.data}
        casesFoundationPending={casesFoundationPending}
        loading={inbox.isLoading}
        error={error}
        casesLoading={cases.isLoading}
        casesError={cases.error && !casesFoundationPending ? cases.error.message : null}
        onRetry={() => void inbox.refetch()}
        onTriage={triage}
        onPromote={promote}
      />
    </CustodianPage>
  );
}
