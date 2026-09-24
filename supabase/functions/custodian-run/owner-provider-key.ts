/**
 * Re-export shared owner-key resolution so Custodian and excavation paths
 * share one decrypt path. Prefer importing from `_shared/owner-provider-key.ts`
 * in new Edge code.
 */
export {
  parseStoredCredential,
  resolveOwnerProviderKey,
  type OwnerProviderKey,
  type StoredCredential,
} from "../_shared/owner-provider-key.ts";
