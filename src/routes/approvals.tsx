import { createFileRoute } from "@tanstack/react-router";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { CustodianScaffold } from "@/components/custodian/scaffold-surface";
import { useOnlineStatus } from "@/hooks/use-online";

export const Route = createFileRoute("/approvals")({ component: ApprovalsPage, ssr: false });

function ApprovalsPage() {
  const online = useOnlineStatus();
  return (
    <CustodianPage
      title="Approvals"
      description="A reserved review surface for persisted approval requests. No approval workflow is connected in Release 1."
      status={<CustodianStatus online={online} foundationPending />}
    >
      <CustodianScaffold
        kind="approvals"
        title="Approvals"
        description="Approval state is foundation-pending. This route does not imply that a request exists, has been reviewed, or has been granted."
        points={[
          "No pending approval records were read by this route.",
          "No approve, reject, or escalation action is wired here.",
          "A future approval reader must expose request identity, scope, actor, and decision provenance.",
        ]}
      />
    </CustodianPage>
  );
}
