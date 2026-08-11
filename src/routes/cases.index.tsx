import { createFileRoute } from "@tanstack/react-router";
import { CaseListSurface } from "@/components/custodian/case-surface";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { useOnlineStatus } from "@/hooks/use-online";
import { isCustodianFoundationMissing, useCustodianCases } from "@/lib/custodian";

export const Route = createFileRoute("/cases/")({ component: CasesPage, ssr: false });

function CasesPage() {
  const online = useOnlineStatus();
  const cases = useCustodianCases(online);
  const foundationPending = Boolean(cases.error && isCustodianFoundationMissing(cases.error));
  const error = cases.error && !foundationPending ? cases.error.message : null;
  const items = cases.data?.map((item) => ({
    id: item.id,
    title: item.title,
    objective: item.objective,
    currentQuestion: item.currentQuestion,
    workingSetCount: item.defaultWorkingSet.length,
    status: item.status,
    updatedAt: item.updatedAt,
  }));
  return (
    <CustodianPage
      title="Cases"
      description="A persisted judgment surface for claims, sources, evidence, findings, and actions."
      status={
        <CustodianStatus
          online={online}
          fetching={cases.isFetching}
          foundationPending={foundationPending}
          error={error}
        />
      }
    >
      <CaseListSurface
        cases={items}
        foundationPending={foundationPending}
        loading={cases.isLoading}
        error={error}
      />
    </CustodianPage>
  );
}
