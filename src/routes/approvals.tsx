import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CustodianPage, CustodianStatus } from "@/components/custodian/custodian-ui";
import { ApprovalsSurface } from "@/components/custodian/approvals-surface";
import { useOnlineStatus } from "@/hooks/use-online";
import { isCustodianFoundationMissing } from "@/lib/custodian";
import {
  custodianApprovalsKey,
  respondCustodianOwnerGate,
  useCustodianOwnerGates,
} from "@/lib/custodian-approvals";
import { useCurrentUserId } from "@/lib/session";

export const Route = createFileRoute("/approvals")({ component: ApprovalsPage, ssr: false });

function ApprovalsPage() {
  const online = useOnlineStatus();
  const gates = useCustodianOwnerGates(online);
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const foundationPending = Boolean(gates.error && isCustodianFoundationMissing(gates.error));
  const error = !online
    ? "Network unavailable. Persisted approval requests cannot be retrieved."
    : gates.error
      ? foundationPending
        ? "Custodian runtime storage is unavailable in the connected Supabase project."
        : gates.error.message
      : null;

  return (
    <CustodianPage
      title="Review"
      description="Owner Judgment on persisted approval requests. This is not Findings history — Findings stay on Investigations. Recording a decision does not execute unsupported work."
      status={
        <CustodianStatus
          online={online}
          fetching={gates.isFetching}
          foundationPending={foundationPending}
          error={error}
          detail="Provider and external execution remain disabled. No internal V1 execution class is selected."
        />
      }
    >
      <ApprovalsSurface
        items={gates.data}
        loading={gates.isLoading}
        error={error}
        online={online}
        foundationPending={foundationPending}
        busyId={busyId}
        decisionError={decisionError}
        onDecide={async ({ item, decision, responseNote, inspectedHash }) => {
          setDecisionError(null);
          setBusyId(item.approval.id);
          try {
            await respondCustodianOwnerGate({
              approvalId: item.approval.id,
              decision,
              responseNote,
              inspectedHash,
              currentHash: item.approval.exactActionHash,
            });
            await queryClient.invalidateQueries({ queryKey: custodianApprovalsKey(userId) });
          } catch (caught) {
            setDecisionError(
              caught instanceof Error
                ? caught.message
                : "The owner decision could not be recorded.",
            );
          } finally {
            setBusyId(null);
          }
        }}
      />
    </CustodianPage>
  );
}
