import { createFileRoute } from "@tanstack/react-router";
import { CaseDetailSurface } from "@/components/custodian/case-surface";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { useOnlineStatus } from "@/hooks/use-online";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useArchive } from "@/lib/archive";
import {
  custodianCasesKey,
  fetchCustodianActions,
  fetchCustodianCaseMembers,
  fetchCustodianClaims,
  fetchCustodianEvidence,
  fetchCustodianFindings,
  isCustodianFoundationMissing,
  updateCustodianCase,
  useCustodianCases,
} from "@/lib/custodian";
import { useCurrentUserId } from "@/lib/session";

export const Route = createFileRoute("/cases/$caseId/")({ component: CaseDetailPage, ssr: false });

function CaseDetailPage() {
  const { caseId } = Route.useParams();
  const online = useOnlineStatus();
  const userId = useCurrentUserId();
  const queryClient = useQueryClient();
  const cases = useCustodianCases(online);
  const archive = useArchive(online);
  const queryOptions = { enabled: online && userId !== null, staleTime: 30_000, retry: 1 };
  const members = useQuery({
    ...queryOptions,
    queryKey: ["custodian", "members", userId],
    queryFn: () => fetchCustodianCaseMembers(userId as string),
  });
  const claims = useQuery({
    ...queryOptions,
    queryKey: ["custodian", "claims", userId],
    queryFn: () => fetchCustodianClaims(userId as string),
  });
  const evidence = useQuery({
    ...queryOptions,
    queryKey: ["custodian", "evidence", userId],
    queryFn: () => fetchCustodianEvidence(userId as string),
  });
  const actions = useQuery({
    ...queryOptions,
    queryKey: ["custodian", "actions", userId],
    queryFn: () => fetchCustodianActions(userId as string),
  });
  const findings = useQuery({
    ...queryOptions,
    queryKey: ["custodian", "findings", userId],
    queryFn: () => fetchCustodianFindings(userId as string),
  });
  const detailQueries = [members, claims, evidence, actions, findings];
  const foundationPending = Boolean(cases.error && isCustodianFoundationMissing(cases.error));
  const detailError = detailQueries.find((query) => query.error)?.error;
  const error = !online
    ? "Network unavailable. Case detail cannot be retrieved or changed."
    : cases.error
      ? foundationPending
        ? "Case storage is unavailable in the connected Supabase project."
        : cases.error.message
      : detailError instanceof Error
        ? detailError.message
        : null;
  const persisted = cases.data?.find((item) => item.id === caseId);
  return (
    <CustodianPage
      title="Case detail"
      description="Persisted case detail with explicit claims and evidence provenance."
      status={<CustodianStatus online={online} fetching={cases.isFetching} error={error} />}
    >
      <CaseDetailSurface
        caseId={caseId}
        item={persisted}
        members={(members.data ?? []).filter((entry) => entry.caseId === caseId)}
        claims={(claims.data ?? []).filter((entry) => entry.caseId === caseId)}
        evidence={(evidence.data ?? []).filter((entry) => entry.caseId === caseId)}
        actions={(actions.data ?? []).filter((entry) => entry.caseId === caseId)}
        findings={(findings.data ?? []).filter((entry) => entry.caseId === caseId)}
        archiveRecords={archive.data?.records ?? []}
        loading={cases.isLoading || detailQueries.some((query) => query.isLoading)}
        error={error}
        online={online && !foundationPending}
        onUpdate={async (value) => {
          await updateCustodianCase(caseId, value);
          await queryClient.invalidateQueries({ queryKey: custodianCasesKey(userId) });
        }}
      />
    </CustodianPage>
  );
}
