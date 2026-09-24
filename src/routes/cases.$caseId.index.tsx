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
  fetchCustodianFindingEvidence,
  fetchCustodianFindings,
  isCustodianFoundationMissing,
  updateCustodianCase,
  useCustodianCases,
} from "@/lib/custodian";
import { productionReadonlyAnalysisPorts } from "@/lib/custodian-readonly-run";
import {
  CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER,
  custodianRunsKey,
  useCustodianRuns,
} from "@/lib/custodian-runtime";
import { useModelPreference, useProviderKeyStatus } from "@/lib/provider-key";
import { useCurrentUserId } from "@/lib/session";

export const Route = createFileRoute("/cases/$caseId/")({ component: CaseDetailPage, ssr: false });

function CaseDetailPage() {
  const { caseId } = Route.useParams();
  const online = useOnlineStatus();
  const userId = useCurrentUserId();
  const queryClient = useQueryClient();
  const cases = useCustodianCases(online);
  const archive = useArchive(online);
  const runs = useCustodianRuns(online);
  const providerKeyStatus = useProviderKeyStatus();
  const modelPreference = useModelPreference();
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
  const findingEvidence = useQuery({
    ...queryOptions,
    queryKey: ["custodian", "finding-evidence", userId],
    queryFn: () => fetchCustodianFindingEvidence(userId as string),
  });
  const detailQueries = [members, claims, evidence, actions, findings, findingEvidence];
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
      title="Investigation"
      description="Question, selected evidence, examination output, and its provenance."
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
        findingEvidence={(findingEvidence.data ?? []).filter((entry) => entry.caseId === caseId)}
        archiveRecords={archive.data?.records ?? []}
        archiveReady={Boolean(archive.data)}
        archiveLoading={archive.isPending}
        archiveError={
          archive.recordsError?.message ??
          (archive.isColdOffline ? "Network unavailable and no cached archive is available." : null)
        }
        archiveStale={Boolean(archive.recordsError && archive.data)}
        loading={cases.isLoading || detailQueries.some((query) => query.isLoading)}
        error={error}
        online={online && !foundationPending}
        analysisPorts={
          CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER
            ? productionReadonlyAnalysisPorts({
                ownerId: userId,
                refreshRuns: async () => {
                  await queryClient.invalidateQueries({ queryKey: custodianRunsKey(userId) });
                  await queryClient.invalidateQueries({
                    queryKey: ["custodian", "findings", userId],
                  });
                  await queryClient.invalidateQueries({
                    queryKey: ["custodian", "finding-evidence", userId],
                  });
                },
              })
            : null
        }
        analysisRuns={runs.data?.runs ?? []}
        providerHoldProjection={runs.data?.providerHoldProjection ?? "available"}
        providerKeyStatus={providerKeyStatus.data ?? null}
        modelPreference={modelPreference.data ?? null}
        settingsLoading={providerKeyStatus.isLoading || modelPreference.isLoading}
        settingsUnavailable={
          !providerKeyStatus.isLoading &&
          !modelPreference.isLoading &&
          (providerKeyStatus.isError || modelPreference.isError)
        }
        onUpdate={async (value) => {
          await updateCustodianCase(caseId, value);
          await queryClient.invalidateQueries({ queryKey: custodianCasesKey(userId) });
          await queryClient.invalidateQueries({
            queryKey: ["custodian", "record-context", userId],
          });
        }}
      />
    </CustodianPage>
  );
}
