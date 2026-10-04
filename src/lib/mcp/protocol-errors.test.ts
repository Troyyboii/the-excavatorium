import { afterEach, describe, expect, test } from "bun:test";
import { auth, defineMcp } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { mcpTools } from "./index";

const ISSUER = "https://protocol-errors.test/auth/v1";
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const MISSING_RECORD_ID = "00000000-0000-4000-8000-000000000001";

const previousAllowedClientIds = process.env.MCP_ALLOWED_CLIENT_IDS;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (previousAllowedClientIds === undefined) delete process.env.MCP_ALLOWED_CLIENT_IDS;
  else process.env.MCP_ALLOWED_CLIENT_IDS = previousAllowedClientIds;
});

function protocolRequest(body: unknown, token?: string): Request {
  return new Request("https://example.test/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readCallResult(response: Response): Promise<{
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string }>;
}> {
  expect(response.status).toBe(200);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("text/event-stream")
    ? JSON.parse((await response.text()).split("data: ")[1]!.trim())
    : await response.json();
  return payload.result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };
}

describe("MCP protocol error results", () => {
  test("an unauthenticated search call returns AUTH_REQUIRED with no structuredContent", async () => {
    const definition = defineMcp({
      name: "protocol-errors-unauth",
      title: "Protocol errors (unauthenticated)",
      version: "1.0.0",
      instructions: "",
      tools: mcpTools,
      metrics: false,
    });
    const handler = createTanStackMcpHandler(definition);
    const response = await handler({
      request: protocolRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search", arguments: { query: "lantern", limit: 5 } },
      }),
    });
    const result = await readCallResult(response);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content?.[0]?.type).toBe("text");
    expect(result.content?.[0]?.text).toContain("AUTH_REQUIRED");
  });

  test("an authenticated fetch for a missing record returns NOT_FOUND with no structuredContent", async () => {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA");
    const jwk = await exportJWK(publicKey);
    const jwks = { keys: [{ ...jwk, kid: "protocol-errors-key", alg: "EdDSA", use: "sig" }] };
    // The SDK only accepts https:// jwksUri values (localhost http is the
    // development exception), so serve the test key set over loopback.
    const server = Bun.serve({
      port: 0,
      fetch: (req) =>
        new URL(req.url).pathname === "/jwks.json"
          ? Response.json(jwks)
          : new Response("not found", { status: 404 }),
    });
    try {
      const jwksUri = `http://localhost:${server.port}/jwks.json`;
      const definition = defineMcp({
        name: "protocol-errors-auth",
        title: "Protocol errors (authenticated)",
        version: "1.0.0",
        instructions: "",
        auth: auth.oauth.issuer({
          issuer: ISSUER,
          acceptedAudiences: "authenticated",
          jwksUri,
        }),
        tools: mcpTools,
        metrics: false,
      });
      const token = await new SignJWT({ aud: "authenticated", client_id: CLIENT_ID })
        .setProtectedHeader({ alg: "EdDSA", kid: "protocol-errors-key", typ: "at+jwt" })
        .setIssuer(ISSUER)
        .setSubject(USER_ID)
        .setExpirationTime("5m")
        .sign(privateKey);

      process.env.MCP_ALLOWED_CLIENT_IDS = CLIENT_ID;
      globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url;
        if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
          return originalFetch(input as never, init);
        }
        const parsed = new URL(url);
        if (parsed.hostname.endsWith(".supabase.co") && parsed.pathname.startsWith("/rest/v1/")) {
          // The requested record does not exist: PostgREST returns no rows,
          // which postgrest-js surfaces as { data: null, error: null }.
          return new Response("[]", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`unexpected network request in protocol-errors test: ${url}`);
      }) as typeof fetch;

      const handler = createTanStackMcpHandler(definition);
      const response = await handler({
        request: protocolRequest(
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "fetch", arguments: { id: MISSING_RECORD_ID } },
          },
          token,
        ),
      });
      const result = await readCallResult(response);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content?.[0]?.type).toBe("text");
      expect(result.content?.[0]?.text).toContain("NOT_FOUND");
    } finally {
      server.stop(true);
    }
  });
});
