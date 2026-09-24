import { supabase } from "./supabase";
import { exportArchiveSnapshot } from "./archive";
import { parseProviderKeyStatus, type FunctionsClient } from "./provider-key";
import {
  ACCOUNT_DELETE_CONFIRMATION,
  buildAccountExport,
  parseAccountSnapshotRpc,
  type AccountExport,
} from "./account-export";
import { FunctionsHttpError } from "@supabase/supabase-js";

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body: unknown = await (error.context as Response).clone().json();
      if (
        body &&
        typeof body === "object" &&
        typeof (body as { error?: unknown }).error === "string"
      ) {
        return (body as { error: string }).error;
      }
    } catch {
      // Fall through.
    }
  }
  return fallback;
}

/** Assembles the expanded account export from owner-scoped RPCs (no Storage bytes). */
export async function exportAccountSnapshot(): Promise<AccountExport> {
  const [archive, accountRpc, keyStatusRpc] = await Promise.all([
    exportArchiveSnapshot(),
    supabase.rpc("export_user_account_snapshot"),
    supabase.rpc("custodian_provider_key_status"),
  ]);
  if (accountRpc.error) throw new Error(accountRpc.error.message);
  if (keyStatusRpc.error) throw new Error(keyStatusRpc.error.message);
  const providerKeyStatus = parseProviderKeyStatus(keyStatusRpc.data);
  const snapshot = parseAccountSnapshotRpc(
    accountRpc.data,
    { records: archive.records, links: archive.links },
    providerKeyStatus,
  );
  return buildAccountExport(snapshot);
}

export async function deleteOwnerAccount(
  confirmation: string,
  client: FunctionsClient = supabase,
): Promise<void> {
  if (confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
    throw new Error(`Type ${ACCOUNT_DELETE_CONFIRMATION} to confirm permanent deletion.`);
  }
  const { data, error } = await client.functions.invoke("account-delete", {
    body: { confirmation: ACCOUNT_DELETE_CONFIRMATION },
  });
  if (error) {
    throw new Error(await functionErrorMessage(error, "Account deletion failed."));
  }
  const row = (data ?? {}) as Record<string, unknown>;
  if (row.deleted !== true) {
    throw new Error("Account deletion did not complete.");
  }
}
