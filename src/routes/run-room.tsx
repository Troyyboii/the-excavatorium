import { createFileRoute } from "@tanstack/react-router";
import { RunRoomSurface } from "@/components/custodian/run-room-surface";
import { useOnlineStatus } from "@/hooks/use-online";
import { isCustodianFoundationMissing } from "@/lib/custodian";
import { useCustodianRuns } from "@/lib/custodian-runtime";

export const Route = createFileRoute("/run-room")({ component: RunRoomPage, ssr: false });

function RunRoomPage() {
  const online = useOnlineStatus();
  const runs = useCustodianRuns(online);
  const foundationPending = Boolean(runs.error && isCustodianFoundationMissing(runs.error));
  const error = !online
    ? "Network unavailable. Persisted runs cannot be retrieved."
    : runs.error
      ? foundationPending
        ? "Custodian runtime storage is unavailable in the connected Supabase project."
        : runs.error.message
      : null;

  return (
    <RunRoomSurface
      runs={runs.data?.runs ?? []}
      providerHoldProjection={runs.data?.providerHoldProjection ?? "available"}
      online={online}
      loading={Boolean(!error && runs.isLoading)}
      error={error}
    />
  );
}
