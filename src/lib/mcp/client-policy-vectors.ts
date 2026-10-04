// Shared MCP client-policy test vectors, run against both enforcement
// points: src/lib/mcp/security.ts (Bun) and
// supabase/functions/document-fetch/authorization.ts (Deno).
// This file is dependency-free so both runtimes can import it directly.
// Keep the two copies of the runner in sync; the vectors below are the
// single source of truth.

export type ClientPolicyAccess =
  | "allowed"
  | "configuration_invalid"
  | "client_missing"
  | "client_malformed"
  | "client_unapproved";

export type ClientPolicyVector = {
  name: string;
  policy?: string;
  allowedClientIds?: string;
  deniedClientIds?: string;
  clientId?: string;
  expected: ClientPolicyAccess;
};

const ALLOWED_A = "11111111-1111-4111-8111-111111111111";
const ALLOWED_B = "22222222-2222-4222-8222-222222222222";
const DENIED = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

export const CLIENT_POLICY_VECTORS: readonly ClientPolicyVector[] = [
  {
    name: "default allowlist allows a listed client",
    allowedClientIds: ALLOWED_A,
    clientId: ALLOWED_A,
    expected: "allowed",
  },
  {
    name: "default allowlist is case-insensitive",
    allowedClientIds: ALLOWED_A.toUpperCase(),
    clientId: ALLOWED_A,
    expected: "allowed",
  },
  {
    name: "default allowlist rejects an unlisted client",
    allowedClientIds: ALLOWED_A,
    clientId: OTHER,
    expected: "client_unapproved",
  },
  {
    name: "default allowlist rejects a missing client",
    allowedClientIds: ALLOWED_A,
    clientId: undefined,
    expected: "client_missing",
  },
  {
    name: "default allowlist rejects a malformed client",
    allowedClientIds: ALLOWED_A,
    clientId: "not-a-uuid",
    expected: "client_malformed",
  },
  {
    name: "default allowlist requires configuration",
    allowedClientIds: undefined,
    clientId: ALLOWED_A,
    expected: "configuration_invalid",
  },
  {
    name: "default allowlist rejects a malformed list",
    allowedClientIds: "not-a-uuid",
    clientId: ALLOWED_A,
    expected: "configuration_invalid",
  },
  {
    name: "default allowlist rejects duplicate entries",
    allowedClientIds: `${ALLOWED_A},${ALLOWED_A}`,
    clientId: ALLOWED_A,
    expected: "configuration_invalid",
  },
  {
    name: "default allowlist rejects empty entries",
    allowedClientIds: `${ALLOWED_A},,${ALLOWED_B}`,
    clientId: ALLOWED_A,
    expected: "configuration_invalid",
  },
  {
    name: "explicit allowlist behaves like the default",
    policy: "allowlist",
    allowedClientIds: ALLOWED_A,
    clientId: ALLOWED_A,
    expected: "allowed",
  },
  {
    name: "explicit allowlist still requires configuration",
    policy: "allowlist",
    allowedClientIds: undefined,
    clientId: ALLOWED_A,
    expected: "configuration_invalid",
  },
  {
    name: "consent allows any well-formed client",
    policy: "consent",
    clientId: OTHER,
    expected: "allowed",
  },
  {
    name: "consent policy name is case-insensitive",
    policy: "Consent",
    clientId: OTHER,
    expected: "allowed",
  },
  {
    name: "consent ignores the allowlist entirely",
    policy: "consent",
    allowedClientIds: "not-a-uuid",
    clientId: OTHER,
    expected: "allowed",
  },
  {
    name: "consent still rejects a missing client",
    policy: "consent",
    clientId: undefined,
    expected: "client_missing",
  },
  {
    name: "consent still rejects a malformed client",
    policy: "consent",
    clientId: "not-a-uuid",
    expected: "client_malformed",
  },
  {
    name: "unknown policy fails closed",
    policy: "open",
    allowedClientIds: ALLOWED_A,
    clientId: ALLOWED_A,
    expected: "configuration_invalid",
  },
  {
    name: "deny list wins over the allowlist",
    allowedClientIds: `${ALLOWED_A},${DENIED}`,
    deniedClientIds: DENIED,
    clientId: DENIED,
    expected: "client_unapproved",
  },
  {
    name: "deny list wins in consent mode",
    policy: "consent",
    deniedClientIds: DENIED,
    clientId: DENIED,
    expected: "client_unapproved",
  },
  {
    name: "deny list does not affect other clients",
    allowedClientIds: `${ALLOWED_A},${DENIED}`,
    deniedClientIds: DENIED,
    clientId: ALLOWED_A,
    expected: "allowed",
  },
  {
    name: "malformed deny list fails closed",
    policy: "consent",
    deniedClientIds: "not-a-uuid",
    clientId: OTHER,
    expected: "configuration_invalid",
  },
  {
    name: "deny list rejects empty entries",
    allowedClientIds: ALLOWED_A,
    deniedClientIds: `${DENIED},`,
    clientId: ALLOWED_A,
    expected: "configuration_invalid",
  },
  {
    name: "deny list rejects duplicates",
    allowedClientIds: ALLOWED_A,
    deniedClientIds: `${DENIED},${DENIED}`,
    clientId: ALLOWED_A,
    expected: "configuration_invalid",
  },
  {
    name: "broken allowlist still fails closed for a denied client",
    allowedClientIds: "not-a-uuid",
    deniedClientIds: DENIED,
    clientId: DENIED,
    expected: "configuration_invalid",
  },
];
