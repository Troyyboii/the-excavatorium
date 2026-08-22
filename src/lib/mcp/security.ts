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
  const configured = await serverEnvironment("MCP_ALLOWED_CLIENT_IDS");
  const allowed = parseMcpAllowedClientIds(configured);
  if (!allowed.ok) return responseFor(format, 500, "authorization configuration unavailable");
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
  if (!allowed.ids.has(clientId.toLowerCase())) {
    return responseFor(format, 403, "client not permitted");
  }
  return null;
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

export function evaluateMcpClientAccess(
  configuredClientIds: string | undefined,
  clientId: string | undefined,
): McpClientAccess {
  const allowed = parseMcpAllowedClientIds(configuredClientIds);
  if (!allowed.ok) return "configuration_invalid";
  if (!clientId) return "client_missing";
  if (!UUID_PATTERN.test(clientId)) return "client_malformed";
  return allowed.ids.has(clientId.toLowerCase()) ? "allowed" : "client_unapproved";
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
    await serverEnvironment("MCP_ALLOWED_CLIENT_IDS"),
    ctx.getClientId(),
  );
}
