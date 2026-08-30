const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DocumentFetchClientAccess =
  | "allowed"
  | "configuration_invalid"
  | "client_missing"
  | "client_malformed"
  | "client_unapproved";

export function parseDocumentFetchClientAllowlist(
  value: string | undefined,
): ReadonlySet<string> | null {
  if (!value) return null;
  const ids = value
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !UUID_PATTERN.test(id))) return null;
  return new Set(ids);
}

export function authorizeDocumentFetchClient(
  authorization: string | null,
  authenticatedUserId: string,
  configuredAllowlist: string | undefined,
): DocumentFetchClientAccess {
  const allowed = parseDocumentFetchClientAllowlist(configuredAllowlist);
  if (!allowed) return "configuration_invalid";
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
  return allowed.has(clientId) ? "allowed" : "client_unapproved";
}

export function authorizeDocumentFetchRequest(
  request: Request,
  authenticatedUserId: string,
  configuredAllowlist: string | undefined,
): DocumentFetchClientAccess {
  return authorizeDocumentFetchClient(
    request.headers.get("authorization"),
    authenticatedUserId,
    configuredAllowlist,
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
