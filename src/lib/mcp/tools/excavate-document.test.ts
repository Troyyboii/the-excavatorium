import { afterEach, describe, expect, test } from "bun:test";
import type { ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { DocumentIngestionError } from "../document-ingestion";
import excavateDocument, { handleExcavateDocument, mapDraftForSave } from "./excavate-document";

const allowedClientId = "11111111-1111-4111-8111-111111111111";
const disallowedClientId = "22222222-2222-4222-8222-222222222222";
const file = {
  download_url: "https://files.oaiusercontent.com/temporary",
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
    expect(signedOut.structuredContent).toBeUndefined();
    expect(signedOut.content[0]?.text).toContain("AUTH_REQUIRED");

    process.env.MCP_ALLOWED_CLIENT_IDS = allowedClientId;
    const disallowed = await handleExcavateDocument(
      { file },
      context(true, disallowedClientId),
      neverRun,
    );
    expect(disallowed.structuredContent).toBeUndefined();
    expect(disallowed.content[0]?.text).toContain("CLIENT_NOT_ALLOWED");
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
        throw new DocumentIngestionError("FILE_UNAVAILABLE", undefined, "network_fetch_failure");
      },
    );
    expect(failure.isError).toBe(true);
    expect(failure.structuredContent).toBeUndefined();
    expect(failure.content[0]?.text).toContain("diagnostic: network_fetch_failure");
    expect(JSON.stringify(failure)).not.toContain(file.download_url);
  });

  test("normalizes tags using the browser save behavior", () => {
    const draft = {
      title: "Excavated notes",
      summary: "Summary",
      tags: [" Notes ", "notes", "", "NODES"],
      documentDate: null,
      pageCount: 1,
      highSignalFindings: [],
      keyClaims: [],
      contradictions: [],
      uncertainties: [],
      sourceReferences: [],
      suggestedRecordIds: [],
      originalFileName: "notes.md",
      mimeType: "text/markdown",
      fileSizeBytes: 12,
      contentHash: "a".repeat(64),
    };
    expect(mapDraftForSave(draft, new Set())).toMatchObject({ tags: ["Notes", "NODES"] });
  });
});
