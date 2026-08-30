import { describe, expect, test } from "bun:test";
import type { DocumentData } from "../types";
import {
  DocumentIngestionError,
  type ChatGptFileReference,
  type DocumentIngestionClient,
  downloadChatGptDocument,
  excavateAndSaveChatGptDocument,
} from "./document-ingestion";

const reference: ChatGptFileReference = {
  download_url: "https://files.openai.example/temporary-file",
  file_id: "file_123",
  file_name: "notes.md",
  mime_type: "text/markdown",
};

const publicResolver = async () => ["203.0.113.10"];

const data: DocumentData = {
  originalFileName: "notes.md",
  mimeType: "text/markdown",
  fileSizeBytes: 12,
  documentDate: null,
  pageCount: 1,
  storagePath: null,
  extractedContentPath: null,
  contentHash: "a".repeat(64),
  highSignalFindings: [],
  keyClaims: [],
  contradictions: [],
  uncertainties: [],
  sourceReferences: [],
  projectRoute: null,
};

function response(body: string | Uint8Array, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

function draft(contentHash = "a".repeat(64)) {
  return {
    title: "Excavated notes",
    summary: "A concise summary.",
    tags: ["notes"],
    documentDate: null,
    pageCount: 1,
    highSignalFindings: [],
    keyClaims: [],
    contradictions: [],
    uncertainties: [],
    sourceReferences: [],
    suggestedRecordIds: ["11111111-1111-4111-8111-111111111111"],
    originalFileName: "notes.md",
    mimeType: "text/markdown",
    fileSizeBytes: 12,
    contentHash,
  };
}

function client(overrides: Partial<DocumentIngestionClient> = {}): DocumentIngestionClient {
  return {
    listRecentCandidates: async () => ({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Existing record",
          record_type: "document",
        },
      ],
      error: null,
    }),
    invoke: async (name) =>
      name === "document-extract"
        ? { data: draft(), error: null }
        : { data: { id: "22222222-2222-4222-8222-222222222222", isNew: true }, error: null },
    ...overrides,
  };
}

async function expectCode(work: Promise<unknown>, code: string) {
  try {
    await work;
    throw new Error("Expected a DocumentIngestionError");
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentIngestionError);
    expect((error as DocumentIngestionError).code).toBe(code);
  }
}

describe("ChatGPT temporary document downloads", () => {
  test("rejects unsafe URL shapes before requesting bytes", async () => {
    const fetch = (() => {
      throw new Error("fetch must not run");
    }) as typeof globalThis.fetch;
    for (const download_url of [
      "http://files.openai.example/file",
      "https://user:password@files.openai.example/file",
      "https://127.0.0.1/file",
      "https://10.0.0.1/file",
      "https://169.254.1.1/file",
      "https://[::1]/file",
      "https://[::ffff:127.0.0.1]/file",
      "https://[::ffff:10.0.0.1]/file",
      "https://[::ffff:169.254.1.1]/file",
      "https://[::ffff:192.168.1.1]/file",
      "https://localhost/file",
    ]) {
      await expectCode(
        downloadChatGptDocument(
          { ...reference, download_url },
          { fetch, resolveHostname: publicResolver },
        ),
        "FILE_UNAVAILABLE",
      );
    }
  });

  test("uses credential-free manual redirects and revalidates each target", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = (async (url, init) => {
      requests.push({ url: String(url), init });
      if (requests.length === 1) {
        return response("", {
          status: 302,
          headers: { location: "https://files.openai.example/final" },
        });
      }
      return response("hello world", { headers: { "content-type": "text/markdown" } });
    }) as typeof globalThis.fetch;

    const file = await downloadChatGptDocument(reference, {
      fetch,
      resolveHostname: publicResolver,
    });
    expect(await file.text()).toBe("hello world");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.init?.credentials).toBe("omit");
    expect(requests[0]?.init?.redirect).toBe("manual");
    expect(requests[0]?.init?.headers).not.toHaveProperty("Authorization");
  });

  test("accepts valid file references when optional name or MIME metadata is omitted", async () => {
    const fetch = (async () =>
      response("hello world", {
        headers: { "content-type": "text/markdown" },
      })) as typeof globalThis.fetch;

    const withoutName = await downloadChatGptDocument(
      {
        download_url: reference.download_url,
        file_id: reference.file_id,
        mime_type: "text/markdown",
      },
      { fetch, resolveHostname: publicResolver },
    );
    expect(withoutName.name).toBe("uploaded-document.md");

    const withoutMime = await downloadChatGptDocument(
      { download_url: reference.download_url, file_id: reference.file_id, file_name: "notes.md" },
      { fetch, resolveHostname: publicResolver },
    );
    expect(withoutMime.name).toBe("notes.md");
    expect(withoutMime.type).toBe("text/markdown");

    const withoutEither = await downloadChatGptDocument(
      { download_url: reference.download_url, file_id: reference.file_id },
      { fetch, resolveHostname: publicResolver },
    );
    expect(withoutEither.name).toBe("uploaded-document.md");
  });

  test("rejects hostnames resolving to unsafe addresses before fetch and after redirects", async () => {
    let fetches = 0;
    const fetch = (async () => {
      fetches += 1;
      return response("", {
        status: 302,
        headers: { location: "https://redirected.example/file" },
      });
    }) as typeof globalThis.fetch;

    await expectCode(
      downloadChatGptDocument(reference, {
        fetch,
        resolveHostname: async () => ["203.0.113.10", "127.0.0.1"],
      }),
      "FILE_UNAVAILABLE",
    );
    expect(fetches).toBe(0);

    await expectCode(
      downloadChatGptDocument(reference, {
        fetch,
        resolveHostname: async (hostname) =>
          hostname === "files.openai.example" ? ["203.0.113.10"] : ["169.254.169.254"],
      }),
      "FILE_UNAVAILABLE",
    );
    expect(fetches).toBe(1);
  });

  test("rejects unsafe redirects and declared or streamed oversize files", async () => {
    const unsafeRedirect = (async () =>
      response("", {
        status: 302,
        headers: { location: "https://127.0.0.1/private" },
      })) as typeof globalThis.fetch;
    await expectCode(
      downloadChatGptDocument(reference, {
        fetch: unsafeRedirect,
        resolveHostname: publicResolver,
      }),
      "FILE_UNAVAILABLE",
    );

    const malformedRedirect = (async () =>
      response("", {
        status: 302,
        headers: { location: "https://[::1" },
      })) as typeof globalThis.fetch;
    await expectCode(
      downloadChatGptDocument(reference, {
        fetch: malformedRedirect,
        resolveHostname: publicResolver,
      }),
      "FILE_UNAVAILABLE",
    );

    const declaredOversize = (async () =>
      response("", {
        headers: { "content-length": "10000001", "content-type": "text/markdown" },
      })) as typeof globalThis.fetch;
    await expectCode(
      downloadChatGptDocument(reference, {
        fetch: declaredOversize,
        resolveHostname: publicResolver,
      }),
      "FILE_TOO_LARGE",
    );

    const streamedOversize = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(10_000_001));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/markdown" } },
      )) as typeof globalThis.fetch;
    await expectCode(
      downloadChatGptDocument(reference, {
        fetch: streamedOversize,
        resolveHostname: publicResolver,
      }),
      "FILE_TOO_LARGE",
    );
  });

  test("rejects unsupported or MIME-conflicting downloaded files", async () => {
    const unsupported = (async () =>
      response("notes", {
        headers: { "content-type": "application/vnd.ms-excel" },
      })) as typeof globalThis.fetch;
    await expectCode(
      downloadChatGptDocument(reference, {
        fetch: unsupported,
        resolveHostname: publicResolver,
      }),
      "UNSUPPORTED_FILE",
    );

    const conflict = (async () =>
      response("%PDF", {
        headers: { "content-type": "application/pdf" },
      })) as typeof globalThis.fetch;
    await expectCode(
      downloadChatGptDocument(reference, { fetch: conflict, resolveHostname: publicResolver }),
      "UNSUPPORTED_FILE",
    );
  });
});

describe("document ingestion orchestration", () => {
  test("downloads once, forwards the canonical draft and returns only safe result fields", async () => {
    let downloads = 0;
    const requests: Array<{ name: string; body: FormData }> = [];
    const fetch = (async () => {
      downloads += 1;
      return response("hello world!", { headers: { "content-type": "text/markdown" } });
    }) as typeof globalThis.fetch;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hello world!"));
    const expectedHash = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const result = await excavateAndSaveChatGptDocument(reference, {
      fetch,
      resolveHostname: publicResolver,
      client: client({
        invoke: async (name, body) => {
          requests.push({ name, body });
          return name === "document-extract"
            ? { data: draft(expectedHash), error: null }
            : { data: { id: "22222222-2222-4222-8222-222222222222", isNew: true }, error: null };
        },
      }),
      mapDraft: (extraction, allowed) => ({
        title: extraction.title,
        summary: extraction.summary,
        tags: extraction.tags,
        recordData: { ...data, contentHash: extraction.contentHash },
        selectedTargetIds: extraction.suggestedRecordIds.filter((id) => allowed.has(id)),
      }),
    });

    expect(downloads).toBe(1);
    expect(requests.map((request) => request.name)).toEqual(["document-extract", "document-save"]);
    expect(JSON.parse(String(requests[0]?.body.get("candidateRecords")))).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Existing record",
        recordType: "document",
      },
    ]);
    expect(JSON.parse(String(requests[1]?.body.get("selectedTargetIds")))).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(result).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      isNew: true,
      title: "Excavated notes",
      recordType: "document",
      originalFileName: "notes.md",
      contentHash: expectedHash,
    });
    expect(JSON.stringify(result)).not.toContain("storagePath");
  });

  test("maps quota, hash, invalid-owner-link, and save failures without surfacing upstream detail", async () => {
    const fetch = (async () =>
      response("hello world!", {
        headers: { "content-type": "text/markdown" },
      })) as typeof globalThis.fetch;
    const quota = client({
      invoke: async () => ({
        error: { context: new Response("private upstream", { status: 429 }) },
        data: null,
      }),
    });
    await expectCode(
      excavateAndSaveChatGptDocument(reference, {
        client: quota,
        fetch,
        resolveHostname: publicResolver,
        mapDraft: () => ({
          title: "",
          summary: "",
          tags: [],
          recordData: data,
          selectedTargetIds: [],
        }),
      }),
      "QUOTA_EXCEEDED",
    );

    const mismatch = client();
    await expectCode(
      excavateAndSaveChatGptDocument(reference, {
        client: mismatch,
        fetch,
        resolveHostname: publicResolver,
        mapDraft: () => ({
          title: "",
          summary: "",
          tags: [],
          recordData: data,
          selectedTargetIds: [],
        }),
      }),
      "EXTRACTION_FAILED",
    );

    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hello world!"));
    const expectedHash = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    await expectCode(
      excavateAndSaveChatGptDocument(reference, {
        fetch,
        resolveHostname: publicResolver,
        client: client({
          invoke: async (name) =>
            name === "document-extract"
              ? { data: draft(expectedHash), error: null }
              : { data: null, error: null },
        }),
        mapDraft: (extraction) => ({
          title: extraction.title,
          summary: extraction.summary,
          tags: extraction.tags,
          recordData: data,
          selectedTargetIds: ["not-owner"],
        }),
      }),
      "EXTRACTION_FAILED",
    );

    await expectCode(
      excavateAndSaveChatGptDocument(reference, {
        fetch,
        resolveHostname: publicResolver,
        client: client({
          invoke: async (name) =>
            name === "document-extract"
              ? { data: draft(expectedHash), error: null }
              : { data: null, error: new Error("private save") },
        }),
        mapDraft: (extraction, allowed) => ({
          title: extraction.title,
          summary: extraction.summary,
          tags: extraction.tags,
          recordData: data,
          selectedTargetIds: extraction.suggestedRecordIds.filter((id) => allowed.has(id)),
        }),
      }),
      "SAVE_FAILED",
    );
  });

  test("keeps text-normalization and textless-PDF rejections inside the safe extraction boundary", async () => {
    const fetch = (async () =>
      response("hello world!", {
        headers: { "content-type": "text/markdown" },
      })) as typeof globalThis.fetch;
    for (const upstreamMessage of [
      "The text file is not valid UTF-8.",
      "No usable text was found. Scanned or image-only PDFs are not supported.",
    ]) {
      try {
        await excavateAndSaveChatGptDocument(reference, {
          fetch,
          resolveHostname: publicResolver,
          client: client({
            invoke: async () => ({
              data: null,
              error: { context: new Response(upstreamMessage, { status: 422 }) },
            }),
          }),
          mapDraft: () => ({
            title: "",
            summary: "",
            tags: [],
            recordData: data,
            selectedTargetIds: [],
          }),
        });
        throw new Error("Expected an extraction failure");
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentIngestionError);
        expect((error as DocumentIngestionError).code).toBe("EXTRACTION_FAILED");
        expect(String(error)).not.toContain(upstreamMessage);
      }
    }
  });
});
