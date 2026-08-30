import { afterEach, describe, expect, test } from "bun:test";
import type { ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { DocumentIngestionError } from "../document-ingestion";
import excavateDocument, { handleExcavateDocument } from "./excavate-document";

const allowedClientId = "11111111-1111-4111-8111-111111111111";
const disallowedClientId = "22222222-2222-4222-8222-222222222222";
const file = {
  download_url: "https://files.openai.example/temporary",
  file_id: "file_123",
  mime_type: "text/markdown",
  file_name: "notes.md",
};

function context(authenticated: boolean, clientId?: string): ToolContext {
  return {
    isAuthenticated: () => authenticated,
    getClientId: () => clientId,
    getToken: () => (authenticated ? "verified-token" : undefined),
    getUserId: () => (authenticated ? "33333333-3333-4333-8333-333333333333" : undefined),
    getUserEmail: () => undefined,
    getScopes: () => undefined,
    getIssuer: () => undefined,
    getClaims: () => undefined,
  } as unknown as ToolContext;
}

afterEach(() => {
  delete process.env.MCP_ALLOWED_CLIENT_IDS;
});

describe("excavate_document tool", () => {
  test("has the exact mutation annotations and OpenAI-compatible file schema", () => {
    expect(excavateDocument.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    });
    const schema = z.object(excavateDocument.inputSchema!);
    expect(schema.parse({ file })).toEqual({ file });
    expect(
      schema.parse({ file: { download_url: file.download_url, file_id: file.file_id } }),
    ).toEqual({ file: { download_url: file.download_url, file_id: file.file_id } });
    expect(schema.parse({ file: { ...file, file_name: undefined } })).toEqual({
      file: { ...file, file_name: undefined },
    });
    expect(schema.parse({ file: { ...file, mime_type: undefined } })).toEqual({
      file: { ...file, mime_type: undefined },
    });
    expect(() => schema.parse({ file: { download_url: file.download_url } })).toThrow();
    expect(() => schema.parse({ file: { ...file, unexpected: true } })).toThrow();
  });

  test("rejects signed-out and disallowed clients before ingestion", async () => {
    const neverRun = async () => {
      throw new Error("ingestion must not run");
    };
    const signedOut = await handleExcavateDocument({ file }, context(false), neverRun);
    expect(signedOut.structuredContent).toEqual({
      error: { code: "AUTH_REQUIRED", message: "An authenticated OAuth session is required." },
    });

    process.env.MCP_ALLOWED_CLIENT_IDS = allowedClientId;
    const disallowed = await handleExcavateDocument(
      { file },
      context(true, disallowedClientId),
      neverRun,
    );
    expect(disallowed.structuredContent).toEqual({
      error: {
        code: "CLIENT_NOT_ALLOWED",
        message: "This OAuth client is not permitted to access this server.",
      },
    });
  });

  test("returns the safe success shape and never echoes the temporary URL", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = allowedClientId;
    const result = await handleExcavateDocument(
      { file },
      context(true, allowedClientId),
      async () => ({
        id: "44444444-4444-4444-8444-444444444444",
        isNew: true,
        title: "Excavated notes",
        recordType: "document",
        originalFileName: "notes.md",
        contentHash: "a".repeat(64),
      }),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: "44444444-4444-4444-8444-444444444444",
      isNew: true,
      title: "Excavated notes",
      recordType: "document",
      originalFileName: "notes.md",
      contentHash: "a".repeat(64),
    });
    expect(JSON.stringify(result)).not.toContain(file.download_url);

    const failure = await handleExcavateDocument(
      { file },
      context(true, allowedClientId),
      async () => {
        throw new DocumentIngestionError("FILE_UNAVAILABLE");
      },
    );
    expect(failure.isError).toBe(true);
    expect(JSON.stringify(failure)).not.toContain(file.download_url);
  });
});
