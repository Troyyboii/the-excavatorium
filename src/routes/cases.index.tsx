import { createFileRoute } from "@tanstack/react-router";
import { CaseListSurface } from "@/components/custodian/case-surface";
import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { CaseEditorValue } from "@/components/custodian/case-surface";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { useOnlineStatus } from "@/hooks/use-online";
import { useQueryClient } from "@tanstack/react-query";
import { useArchive } from "@/lib/archive";
import {
  createCustodianCase,
  custodianCasesKey,
  isCustodianFoundationMissing,
  useCustodianCases,
} from "@/lib/custodian";
import { useCurrentUserId } from "@/lib/session";
import { UUID_RE } from "@/lib/types";

type CasesSearch = {
  decision?: string;
};

export const Route = createFileRoute("/cases/")({
  component: CasesPage,
  ssr: false,
  validateSearch: (search: Record<string, unknown>): CasesSearch => ({
    decision:
      typeof search.decision === "string" && UUID_RE.test(search.decision)
        ? search.decision
        : undefined,
  }),
});

function CasesPage() {
  const online = useOnlineStatus();
  const userId = useCurrentUserId();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const cases = useCustodianCases(online);
  const archive = useArchive(online);
  const search = Route.useSearch();
  const foundationPending = Boolean(cases.error && isCustodianFoundationMissing(cases.error));
  const error = !online
    ? "Network unavailable. Cases cannot be retrieved or changed."
    : cases.error
      ? foundationPending
        ? "Case storage is unavailable in the connected Supabase project."
        : cases.error.message
      : null;
  const decisionRecord = search.decision ? archive.data?.byId.get(search.decision) : undefined;
  const initial = useMemo<CaseEditorValue | undefined>(() => {
    if (!decisionRecord || decisionRecord.recordType !== "decision") return undefined;
    return {
      title: ("Review: " + decisionRecord.title).slice(0, 300),
      objective: "Review the existing Decision against a bounded archive scope.",
      currentQuestion: "Does the selected archive evidence still support this Decision?",
      archiveScope: {
        recordIds: [decisionRecord.id],
        freeTextContext: "",
      },
      status: "open",
    };
  }, [decisionRecord]);
  const prefillError =
    search.decision && archive.data && !decisionRecord
      ? "The requested Decision is not available in the current owner-scoped archive."
      : null;
  const items = cases.data;
  return (
    <CustodianPage
      title="Investigations"
      description="Start from a question, choose archive evidence, and examine the material within a clear scope."
      status={
        <CustodianStatus
          online={online}
          fetching={cases.isFetching || archive.isFetching}
          error={error}
        />
      }
    >
      <CaseListSurface
        cases={items}
        loading={cases.isLoading}
        error={error}
        online={online && !foundationPending}
        archiveRecords={archive.data?.records ?? []}
        archiveReady={Boolean(archive.data)}
        archiveLoading={archive.isPending}
        archiveError={
          archive.recordsError?.message ??
          (archive.isColdOffline ? "Network unavailable and no cached archive is available." : null)
        }
        archiveStale={Boolean(archive.recordsError && archive.data)}
        initial={initial}
        prefillError={prefillError}
        onCreate={async (value) => {
          const created = await createCustodianCase(value);
          await queryClient.invalidateQueries({ queryKey: custodianCasesKey(userId) });
          await navigate({ to: "/cases/$caseId", params: { caseId: created.id } });
          return created;
        }}
      />
    </CustodianPage>
  );
}
