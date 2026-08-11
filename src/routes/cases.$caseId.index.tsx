import { createFileRoute } from "@tanstack/react-router";
import { CaseDetailSurface } from "@/components/custodian/case-surface";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { useOnlineStatus } from "@/hooks/use-online";
import { isCustodianFoundationMissing, useCustodianCases } from "@/lib/custodian";

export const Route = createFileRoute("/cases/$caseId/")({ component: CaseDetailPage, ssr: false });

function CaseDetailPage() {
  const { caseId } = Route.useParams();
  const online = useOnlineStatus();
  const cases = useCustodianCases(online);
  const foundationPending = Boolean(cases.error && isCustodianFoundationMissing(cases.error));
  const error = cases.error && !foundationPending ? cases.error.message : null;
  const persisted = cases.data?.find((item) => item.id === caseId);
  const item = persisted
    ? {
        id: persisted.id,
        title: persisted.title,
        objective: persisted.objective,
        currentQuestion: persisted.currentQuestion,
        workingSetCount: persisted.defaultWorkingSet.length,
        status: persisted.status,
        updatedAt: persisted.updatedAt,
      }
    : undefined;
  return (
    <CustodianPage
      title="Case detail"
      description="Persisted case detail with explicit claims and evidence provenance."
      status={
        <CustodianStatus
          online={online}
          fetching={cases.isFetching}
          foundationPending={foundationPending}
          error={error}
        />
      }
    >
      <CaseDetailSurface
        caseId={caseId}
        item={item}
        foundationPending={foundationPending}
        loading={cases.isLoading}
        error={error}
      />
    </CustodianPage>
  );
}
