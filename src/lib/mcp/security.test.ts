import { describe, expect, it } from "bun:test";
import {
  authorizeMcpClientRequest,
  MAX_MCP_REQUEST_BYTES,
  limitMcpRequestBody,
  evaluateMcpClientAccess,
  mcpErrorResponseForRequest,
  parseMcpAllowedClientIds,
} from "./security";
import { performOAuthDecision, safeOAuthConsentError } from "@/lib/oauth-consent";
import { authResult } from "./mcp-utils";

const ALLOWED_CLIENT = "11111111-1111-4111-8111-111111111111";

function authenticatedContext(clientId: string | undefined) {
  return {
    isAuthenticated: () => true,
    getClientId: () => clientId,
  } as never;
}

describe("MCP client allow-list", () => {
  it("accepts configured UUID client ids and rejects missing, malformed, and unapproved values", () => {
    const allowed = parseMcpAllowedClientIds(ALLOWED_CLIENT);
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) throw new Error("expected configured client ids");

    expect(allowed.ids.has(ALLOWED_CLIENT)).toBe(true);
    expect(evaluateMcpClientAccess(ALLOWED_CLIENT, ALLOWED_CLIENT)).toBe("allowed");
    expect(evaluateMcpClientAccess(undefined, ALLOWED_CLIENT)).toBe("configuration_invalid");
    expect(evaluateMcpClientAccess("not-a-uuid", ALLOWED_CLIENT)).toBe("configuration_invalid");
    expect(evaluateMcpClientAccess(ALLOWED_CLIENT, undefined)).toBe("client_missing");
    expect(evaluateMcpClientAccess(ALLOWED_CLIENT, "not-a-uuid")).toBe("client_malformed");
    expect(evaluateMcpClientAccess(ALLOWED_CLIENT, "22222222-2222-4222-8222-222222222222")).toBe(
      "client_unapproved",
    );
    expect(allowed.ids.has("22222222-2222-4222-8222-222222222222")).toBe(false);
  });
});

describe("MCP handler authorization", () => {
  it("fails closed before a tool can reach Supabase when the client policy is absent or invalid", async () => {
    const previous = process.env.MCP_ALLOWED_CLIENT_IDS;
    try {
      delete process.env.MCP_ALLOWED_CLIENT_IDS;
      expect((await authResult(authenticatedContext(ALLOWED_CLIENT)))?.structuredContent).toEqual({
        error: {
          code: "AUTH_CONFIGURATION_ERROR",
          message: "MCP authorization is temporarily unavailable.",
        },
      });

      process.env.MCP_ALLOWED_CLIENT_IDS = "not-a-uuid";
      expect((await authResult(authenticatedContext(ALLOWED_CLIENT)))?.isError).toBe(true);

      process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
      expect((await authResult(authenticatedContext(undefined)))?.structuredContent).toEqual({
        error: {
          code: "CLIENT_NOT_ALLOWED",
          message: "This OAuth client is not permitted to access this server.",
        },
      });
      expect(await authResult(authenticatedContext(ALLOWED_CLIENT))).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.MCP_ALLOWED_CLIENT_IDS;
      else process.env.MCP_ALLOWED_CLIENT_IDS = previous;
    }
  });

  it("gates protocol and catalog requests using only a verified client identity", async () => {
    const previous = process.env.MCP_ALLOWED_CLIENT_IDS;
    const request = new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: "Bearer opaque-token" },
      body: "{}",
    });
    try {
      delete process.env.MCP_ALLOWED_CLIENT_IDS;
      expect(
        (await authorizeMcpClientRequest(request, "jsonrpc", async () => ALLOWED_CLIENT))?.status,
      ).toBe(500);

      process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
      expect(
        await authorizeMcpClientRequest(
          new Request("https://example.test/mcp", { method: "POST", body: "{}" }),
          "jsonrpc",
          async () => undefined,
        ),
      ).toBeNull();
      expect(await authorizeMcpClientRequest(request, "jsonrpc", async () => ALLOWED_CLIENT)).toBe(
        null,
      );
      expect(
        (
          await authorizeMcpClientRequest(
            request,
            "json",
            async () => "22222222-2222-4222-8222-222222222222",
          )
        )?.status,
      ).toBe(403);
      const missingIdentity = await authorizeMcpClientRequest(
        request,
        "json",
        async () => undefined,
      );
      expect(missingIdentity?.status).toBe(401);
      expect(missingIdentity?.headers.get("www-authenticate")).toContain(
        'resource_metadata="https://example.test/.well-known/oauth-protected-resource"',
      );
      expect(
        (await authorizeMcpClientRequest(request, "json", async () => "malformed"))?.status,
      ).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.MCP_ALLOWED_CLIENT_IDS;
      else process.env.MCP_ALLOWED_CLIENT_IDS = previous;
    }
  });
});

describe("MCP request body limits", () => {
  it("accepts exactly 64 KiB", async () => {
    const request = new Request("https://example.test/mcp", {
      method: "POST",
      body: "x".repeat(MAX_MCP_REQUEST_BYTES),
    });
    const limited = await limitMcpRequestBody(request, "jsonrpc");
    expect(limited).toHaveProperty("request");
    if (!("request" in limited)) throw new Error("expected request");
    expect((await limited.request.text()).length).toBe(MAX_MCP_REQUEST_BYTES);
  });

  it("rejects an oversized streamed body even when Content-Length lies", async () => {
    const request = new Request("https://example.test/.mcp/invoke-tool/search", {
      method: "POST",
      headers: { "content-length": "1" },
      body: "x".repeat(MAX_MCP_REQUEST_BYTES + 1),
    });
    const limited = await limitMcpRequestBody(request, "json");
    expect(limited).toHaveProperty("response");
    if (!("response" in limited)) throw new Error("expected rejection response");
    expect(limited.response.status).toBe(413);
    await expect(limited.response.json()).resolves.toEqual({ error: "request body too large" });
  });

  it("rejects an oversized declared Content-Length before passing the request onward", async () => {
    const request = new Request("https://example.test/mcp", {
      method: "POST",
      headers: { "content-length": String(MAX_MCP_REQUEST_BYTES + 1) },
      body: "{}",
    });
    const limited = await limitMcpRequestBody(request, "jsonrpc");
    expect(limited).toHaveProperty("response");
    if (!("response" in limited)) throw new Error("expected rejection response");
    await expect(limited.response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "request body too large" },
    });
  });

  it("rejects a malformed Content-Length without trusting it", async () => {
    const limited = await limitMcpRequestBody(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { "content-length": "not-a-number" },
        body: "{}",
      }),
      "jsonrpc",
    );
    expect(limited).toHaveProperty("response");
    if (!("response" in limited)) throw new Error("expected rejection response");
    expect(limited.response.status).toBe(413);
  });
});

describe("MCP catastrophic error responses", () => {
  it("uses JSON-RPC for /mcp and safe JSON for REST companions", async () => {
    const protocol = mcpErrorResponseForRequest(new Request("https://example.test/mcp"));
    expect(protocol.headers.get("content-type")).toContain("application/json");
    await expect(protocol.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "internal error" },
    });

    const rest = mcpErrorResponseForRequest(
      new Request("https://example.test/.mcp/invoke-tool/search"),
    );
    await expect(rest.json()).resolves.toEqual({ error: "internal error" });
  });
});

describe("OAuth consent errors", () => {
  it("does not surface upstream error text", () => {
    expect(safeOAuthConsentError("database connection failed: secret detail")).toBe(
      "This authorization request could not be completed. Please try again.",
    );
  });

  it("sanitizes rejected approve and deny requests", async () => {
    const rejected = async () => {
      throw new Error("upstream secret detail");
    };
    const api = {
      getAuthorizationDetails: rejected,
      approveAuthorization: rejected,
      denyAuthorization: rejected,
    };
    expect(await performOAuthDecision(api, "request-id", true)).toEqual({
      redirect: null,
      error: "This authorization request could not be completed. Please try again.",
    });
    expect(await performOAuthDecision(api, "request-id", false)).toEqual({
      redirect: null,
      error: "This authorization request could not be completed. Please try again.",
    });
  });
});
