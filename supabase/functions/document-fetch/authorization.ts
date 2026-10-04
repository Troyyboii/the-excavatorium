const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DocumentFetchClientAccess =
  | "allowed"
  | "configuration_invalid"
  | "client_missing"
  | "client_malformed"
  | "client_unapproved";

export type DocumentFetchClientPolicy = "allowlist" | "consent";

export type DocumentFetchPolicyConfig = {
  policy?: string;
  allowedClientIds?: string;
  deniedClientIds?: string;
};

type ParsedClientIds = { ok: true; ids: ReadonlySet<string> } | { ok: false };

type ParsedClientPolicy = { ok: true; policy: DocumentFetchClientPolicy } | { ok: false };

export function parseDocumentFetchClientPolicy(value: string | undefined): ParsedClientPolicy {
  if (value === undefined) return { ok: true, policy: "allowlist" };
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "allowlist") return { ok: true, policy: "allowlist" };
  if (normalized === "consent") return { ok: true, policy: "consent" };
  return { ok: false };
}

export function parseDocumentFetchClientAllowlist(value: string | undefined): ParsedClientIds {
  if (!value) return { ok: false };
  const ids = value.split(",").map((id) => id.trim().toLowerCase());
  if (ids.some((id) => !UUID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
    return { ok: false };
  }
  return { ok: true, ids: new Set(ids) };
}

export function parseDocumentFetchDeniedClientIds(value: string | undefined): ParsedClientIds {
  if (!value) return { ok: true, ids: new Set() };
  const ids = value.split(",").map((id) => id.trim().toLowerCase());
  if (ids.some((id) => !UUID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
    return { ok: false };
  }
  return { ok: true, ids: new Set(ids) };
}

// Pure client-policy decision shared with the request authorizer below. The
// deny list wins over every approval path in both modes; in consent mode the
// allowlist is ignored entirely and may be unset or malformed.
export function evaluateDocumentFetchClientAccess(
  config: DocumentFetchPolicyConfig,
  clientId: string | undefined,
): DocumentFetchClientAccess {
  const policy = parseDocumentFetchClientPolicy(config.policy);
  if (!policy.ok) return "configuration_invalid";
  const denied = parseDocumentFetchDeniedClientIds(config.deniedClientIds);
  if (!denied.ok) return "configuration_invalid";
  const allowed =
    policy.policy === "consent" ? null : parseDocumentFetchClientAllowlist(config.allowedClientIds);
  if (allowed !== null && !allowed.ok) return "configuration_invalid";
  if (!clientId) return "client_missing";
  if (!UUID_PATTERN.test(clientId)) return "client_malformed";
  const normalized = clientId.toLowerCase();
  if (denied.ids.has(normalized)) return "client_unapproved";
  if (allowed === null || allowed.ids.has(normalized)) return "allowed";
  return "client_unapproved";
}

export function authorizeDocumentFetchClient(
  authorization: string | null,
  authenticatedUserId: string,
  config: DocumentFetchPolicyConfig,
): DocumentFetchClientAccess {
  if (!authorization) return "client_missing";

  const token = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim())?.[1];
  if (!token) return "client_malformed";
  const claims = decodePayload(token);
  if (!claims || claims.sub !== authenticatedUserId) return "client_malformed";

  const clientId =
    typeof claims.client_id === "string"
      ? claims.client_id.trim().toLowerCase()
      : typeof claims.azp === "string"
        ? claims.azp.trim().toLowerCase()
        : undefined;
  if (!clientId || !UUID_PATTERN.test(clientId)) return "client_malformed";
  return evaluateDocumentFetchClientAccess(config, clientId);
}

export function authorizeDocumentFetchRequest(
  request: Request,
  authenticatedUserId: string,
  config: DocumentFetchPolicyConfig,
): DocumentFetchClientAccess {
  return authorizeDocumentFetchClient(
    request.headers.get("authorization"),
    authenticatedUserId,
    config,
  );
}

function decodePayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const encoded = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === "object" && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
