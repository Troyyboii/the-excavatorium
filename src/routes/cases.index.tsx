import { createFileRoute } from "@tanstack/react-router";
import { CaseListSurface } from "@/components/custodian/case-surface";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { useOnlineStatus } from "@/hooks/use-online";
import { useQueryClient } from "@tanstack/react-query";
import {
  createCustodianCase,
  custodianCasesKey,
  isCustodianFoundationMissing,
  useCustodianCases,
} from "@/lib/custodian";
import { useCurrentUserId } from "@/lib/session";

export const Route = createFileRoute("/cases/")({ component: CasesPage, ssr: false });

function CasesPage() {
  const online = useOnlineStatus();
  const userId = useCurrentUserId();
  const queryClient = useQueryClient();
  const cases = useCustodianCases(online);
  const foundationPending = Boolean(cases.error && isCustodianFoundationMissing(cases.error));
  const error = !online
    ? "Network unavailable. Cases cannot be retrieved or changed."
    : cases.error
      ? foundationPending
        ? "Case storage is unavailable in the connected Supabase project."
        : cases.error.message
      : null;
  const items = cases.data;
  return (
    <CustodianPage
      title="Cases"
      description="A persisted judgment surface for claims, sources, evidence, findings, and actions."
      status={<CustodianStatus online={online} fetching={cases.isFetching} error={error} />}
    >
      <CaseListSurface
        cases={items}
        loading={cases.isLoading}
        error={error}
        online={online && !foundationPending}
        onCreate={async (value) => {
          await createCustodianCase(value);
          await queryClient.invalidateQueries({ queryKey: custodianCasesKey(userId) });
        }}
      />
    </CustodianPage>
  );
}
