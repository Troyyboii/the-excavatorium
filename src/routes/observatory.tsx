import { createFileRoute } from "@tanstack/react-router";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { CustodianScaffold, ObservatorySignals } from "@/components/custodian/scaffold-surface";
import { useOnlineStatus } from "@/hooks/use-online";

export const Route = createFileRoute("/observatory")({ component: ObservatoryPage, ssr: false });

function ObservatoryPage() {
  const online = useOnlineStatus();
  return (
    <CustodianPage
      title="Observatory"
      description="A truthful view of available runtime signals. Release 1 has no connected observability source."
      status={<CustodianStatus online={online} foundationPending />}
    >
      <div className="space-y-6">
        <CustodianScaffold
          kind="observatory"
          title="Observatory"
          description="Observatory is a foundation-pending scaffold. Nothing here should be read as a live health, model, cost, or verification dashboard."
          points={[
            "Runtime events are not being collected by this route.",
            "Model identity and usage are not recorded here.",
            "Verification evidence must arrive from a persisted source before display.",
          ]}
        />
        <ObservatorySignals />
      </div>
    </CustodianPage>
  );
}
