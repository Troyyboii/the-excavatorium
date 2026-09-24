import { useQueryClient } from "@tanstack/react-query";
import { RunRoomSurface } from "@/components/custodian/run-room-surface";
import { useOnlineStatus } from "@/hooks/use-online";
import { isCustodianFoundationMissing } from "@/lib/custodian";
import { productionReadonlyAnalysisPorts } from "@/lib/custodian-readonly-run";
import {
  CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER,
  custodianRunsKey,
  useCustodianRuns,
} from "@/lib/custodian-runtime";
import { openAiModelTier } from "@/lib/openai-models";
import { useModelPreference } from "@/lib/provider-key";
import { useCurrentUserId } from "@/lib/session";

export function RunRoomPage() {
  const online = useOnlineStatus();
  const userId = useCurrentUserId();
  const queryClient = useQueryClient();
  const runs = useCustodianRuns(online);
  const modelPreference = useModelPreference();
  const preferredModelTier = modelPreference.data ? openAiModelTier(modelPreference.data) : null;
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
      ownerPresent={Boolean(userId)}
      surfaceEnabled={CUSTODIAN_RUN_SURFACE_CAN_INVOKE_PROVIDER}
      preferredModelTier={preferredModelTier}
      ports={productionReadonlyAnalysisPorts({
        ownerId: userId,
        refreshRuns: async () => {
          await queryClient.invalidateQueries({ queryKey: custodianRunsKey(userId) });
        },
      })}
    />
  );
}
