import { createFileRoute } from "@tanstack/react-router";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { CustodianScaffold } from "@/components/custodian/scaffold-surface";
import { useOnlineStatus } from "@/hooks/use-online";

export const Route = createFileRoute("/run-room")({ component: RunRoomPage, ssr: false });

function RunRoomPage() {
  const online = useOnlineStatus();
  return (
    <CustodianPage
      title="Run Room"
      description="A reserved surface for explicitly supported runs. No runtime is connected in Release 1."
      status={<CustodianStatus online={online} foundationPending />}
    >
      <CustodianScaffold
        kind="run"
        title="Run Room"
        description="Run Room is a foundation-pending scaffold. The current route does not start jobs, select models, estimate costs, or imply execution."
        points={[
          "Run definitions are not persisted or executable from this surface yet.",
          "No model or provider selection is available in the current contract.",
          "Results will require a persisted run record before they can appear here.",
        ]}
      />
    </CustodianPage>
  );
}
