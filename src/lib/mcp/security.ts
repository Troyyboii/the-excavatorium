import type { ToolContext } from "@lovable.dev/mcp-js";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

export const MAX_MCP_REQUEST_BYTES = 64 * 1024;

type McpErrorFormat = "jsonrpc" | "json";

type ClientIdentityVerifier = (request: Request) => Promise<string | undefined>;

type ParsedClientIds = { ok: true; ids: ReadonlySet<string> } | { ok: false };

export type McpClientAccess =
  | "allowed"
  | "configuration_invalid"
  | "client_missing"
  | "client_malformed"
  | "client_unapproved";

export type McpClientPolicy = "allowlist" | "consent";

export type McpClientPolicyConfig = {
  policy?: string;
  allowedClientIds?: string;
  deniedClientIds?: string;
};

type RuntimeGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOUDFLARE_WORKERS_MODULE = "cloudflare:workers";
const SUPABASE_PROJECT_REF =
  (import.meta.env["VITE_SUPABASE_PROJECT_ID"] as string | undefined) ?? "rmlaknguklxwbbdnywcd";
const SUPABASE_AUTH_ISSUER = `https://${SUPABASE_PROJECT_REF}.supabase.co/auth/v1`;
const SUPABASE_JWKS = createRemoteJWKSet(new URL(`${SUPABASE_AUTH_ISSUER}/.well-known/jwks.json`), {
  timeoutDuration: 5_000,
});
const ACCESS_TOKEN_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;

function safeJsonResponse(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function responseFor(format: McpErrorFormat, status: number, message: string): Response {
  return format === "jsonrpc"
    ? safeJsonResponse(
        { jsonrpc: "2.0", id: null, error: { code: status === 413 ? -32600 : -32603, message } },
        status,
      )
    : safeJsonResponse({ error: message }, status);
}

function unauthorizedResponse(request: Request, format: McpErrorFormat, message: string): Response {
  const response = responseFor(format, 401, message);
  const metadataUrl = new URL("/.well-known/oauth-protected-resource", request.url).toString();
  response.headers.set(
    "www-authenticate",
    `Bearer realm="mcp", resource_metadata="${metadataUrl}", error="invalid_token"`,
  );
  return response;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  const match = authorization ? /^Bearer\s+(.+)$/i.exec(authorization) : null;
  const token = match?.[1]?.trim();
  return token && !/\s/.test(token) ? token : null;
}

async function verifiedClientId(request: Request): Promise<string | undefined> {
  const token = bearerToken(request);
  if (!token) return undefined;
  const header = decodeProtectedHeader(token);
  if (header.typ !== "at+jwt" && header.typ !== "JWT") return undefined;
  const { payload } = await jwtVerify(token, SUPABASE_JWKS, {
    issuer: [SUPABASE_AUTH_ISSUER, `${SUPABASE_AUTH_ISSUER}/`],
    audience: "authenticated",
    algorithms: [...ACCESS_TOKEN_ALGORITHMS],
    requiredClaims: ["sub", "exp"],
    clockTolerance: 30,
  });
  const clientId =
    typeof payload.client_id === "string"
      ? payload.client_id
      : typeof payload.azp === "string"
        ? payload.azp
        : undefined;
  return clientId;
}

/**
 * Authorizes the OAuth client before the SDK can serve protocol metadata or a
 * tool catalog. The SDK performs its full bearer verification again before
 * dispatch; this request-level gate exists because catalog requests do not
 * create a ToolContext where per-tool authorization can run.
 */
export async function authorizeMcpClientRequest(
  request: Request,
  format: McpErrorFormat,
  verifyIdentity: ClientIdentityVerifier = verifiedClientId,
): Promise<Response | null> {
  if (request.method === "OPTIONS") return null;
  const config: McpClientPolicyConfig = {
    policy: await serverEnvironment("MCP_CLIENT_POLICY"),
    allowedClientIds: await serverEnvironment("MCP_ALLOWED_CLIENT_IDS"),
    deniedClientIds: await serverEnvironment("MCP_DENIED_CLIENT_IDS"),
  };
  // Fail closed before the SDK challenge, exactly as today: a broken client
  // policy is a 500 even when no bearer is present. In consent mode the
  // allowlist is ignored entirely and may be unset or malformed.
  if (!isMcpPolicyConfigValid(config)) {
    return responseFor(format, 500, "authorization configuration unavailable");
  }
  // Let the SDK emit its canonical OAuth discovery challenge when no usable
  // bearer is present. No archive/Supabase data request occurs on that path.
  if (!bearerToken(request)) return null;
  let clientId: string | undefined;
  try {
    clientId = await verifyIdentity(request);
  } catch {
    return unauthorizedResponse(request, format, "unauthorized");
  }
  if (!clientId || !UUID_PATTERN.test(clientId)) {
    return unauthorizedResponse(request, format, "unauthorized");
  }
  // The config was validated above, so only the membership decision remains.
  return evaluateMcpClientAccess(config, clientId) === "allowed"
    ? null
    : responseFor(format, 403, "client not permitted");
}

export function mcpErrorResponseForRequest(request: Request): Response | null {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/mcp") return responseFor("jsonrpc", 500, "internal error");
  if (pathname.startsWith("/.mcp/")) return responseFor("json", 500, "internal error");
  return null;
}

export async function limitMcpRequestBody(
  request: Request,
  format: McpErrorFormat,
): Promise<{ request: Request } | { response: Response }> {
  if (request.method !== "POST") return { request };

  const declaredSize = request.headers.get("content-length");
  if (declaredSize) {
    if (!/^\d+$/.test(declaredSize)) {
      return { response: responseFor(format, 413, "request body too large") };
    }
    const byteLength = Number(declaredSize);
    if (!Number.isSafeInteger(byteLength) || byteLength > MAX_MCP_REQUEST_BYTES) {
      return { response: responseFor(format, 413, "request body too large") };
    }
  }

  if (!request.body) return { request };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_MCP_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The response is already determined; cancellation is best effort.
        }
        return { response: responseFor(format, 413, "request body too large") };
      }
      chunks.push(next.value);
    }
  } catch {
    return { response: responseFor(format, 400, "invalid request body") };
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return {
    request: new Request(request.url, {
      method: request.method,
      headers,
      body,
    }),
  };
}

export function parseMcpClientPolicy(
  value: string | undefined,
): { ok: true; policy: McpClientPolicy } | { ok: false } {
  if (value === undefined) return { ok: true, policy: "allowlist" };
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "allowlist") return { ok: true, policy: "allowlist" };
  if (normalized === "consent") return { ok: true, policy: "consent" };
  return { ok: false };
}

export function parseMcpAllowedClientIds(value: string | undefined): ParsedClientIds {
  if (!value) return { ok: false };
  const ids = value.split(",").map((item) => item.trim().toLowerCase());
  if (
    ids.length === 0 ||
    ids.some((id) => !UUID_PATTERN.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return { ok: false };
  }
  return { ok: true, ids: new Set(ids) };
}

export function parseMcpDeniedClientIds(value: string | undefined): ParsedClientIds {
  if (!value) return { ok: true, ids: new Set() };
  const ids = value.split(",").map((item) => item.trim().toLowerCase());
  if (ids.some((id) => !UUID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
    return { ok: false };
  }
  return { ok: true, ids: new Set(ids) };
}

// Whether the client policy configuration is usable at all. Checked before
// any bearer inspection so a broken policy fails closed with a 500 even when
// no bearer is present. In consent mode the allowlist is not consulted.
export function isMcpPolicyConfigValid(config: McpClientPolicyConfig): boolean {
  const policy = parseMcpClientPolicy(config.policy);
  if (!policy.ok) return false;
  if (!parseMcpDeniedClientIds(config.deniedClientIds).ok) return false;
  return policy.policy === "consent" || parseMcpAllowedClientIds(config.allowedClientIds).ok;
}

export function evaluateMcpClientAccess(
  config: McpClientPolicyConfig,
  clientId: string | undefined,
): McpClientAccess {
  const policy = parseMcpClientPolicy(config.policy);
  if (!policy.ok) return "configuration_invalid";
  const denied = parseMcpDeniedClientIds(config.deniedClientIds);
  if (!denied.ok) return "configuration_invalid";
  // In allowlist mode the allowlist is parsed before any client inspection,
  // exactly as before: a broken allowlist is configuration_invalid even when
  // no usable client identity is present.
  const allowed =
    policy.policy === "consent" ? null : parseMcpAllowedClientIds(config.allowedClientIds);
  if (allowed !== null && !allowed.ok) return "configuration_invalid";
  if (!clientId) return "client_missing";
  if (!UUID_PATTERN.test(clientId)) return "client_malformed";
  const normalized = clientId.toLowerCase();
  // The deny list wins over every approval path in both modes.
  if (denied.ids.has(normalized)) return "client_unapproved";
  if (allowed === null || allowed.ids.has(normalized)) return "allowed";
  return "client_unapproved";
}

async function serverEnvironment(name: string): Promise<string | undefined> {
  const processValue = (globalThis as RuntimeGlobals).process?.env?.[name]?.trim();
  if (processValue) return processValue;

  try {
    const workers = (await import(/* @vite-ignore */ CLOUDFLARE_WORKERS_MODULE)) as {
      env?: Record<string, string | undefined>;
    };
    const workerValue = workers.env?.[name]?.trim();
    return workerValue || undefined;
  } catch {
    return undefined;
  }
}

export async function mcpClientAccess(ctx: ToolContext): Promise<McpClientAccess> {
  return evaluateMcpClientAccess(
    {
      policy: await serverEnvironment("MCP_CLIENT_POLICY"),
      allowedClientIds: await serverEnvironment("MCP_ALLOWED_CLIENT_IDS"),
      deniedClientIds: await serverEnvironment("MCP_DENIED_CLIENT_IDS"),
    },
    ctx.getClientId(),
  );
}
