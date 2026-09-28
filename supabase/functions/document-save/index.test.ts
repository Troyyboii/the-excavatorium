import { createDocumentSaveHandler } from "./index.ts";
import type { AuthenticatedSupabase } from "../_shared/http.ts";
import {
  DOCUMENT_MAX_FILE_BYTES,
  DOCUMENT_MAX_REQUEST_BYTES,
  normalizeDocumentFile,
  toBinaryData,
} from "../_shared/document.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const userId = "123e4567-e89b-12d3-a456-426614174000";

function requestWithFile(): Request {
  const form = new FormData();
  form.append("file", new File(["A bounded document."], "notes.txt", { type: "text/plain" }));
  form.append(
    "record",
    JSON.stringify({
      recordType: "document",
      title: "Notes",
      summary: "",
      tags: [],
      recordData: {
        originalFileName: null,
        mimeType: null,
        fileSizeBytes: null,
        documentDate: null,
        pageCount: null,
        storagePath: null,
        extractedContentPath: null,
        contentHash: null,
        highSignalFindings: [],
        keyClaims: [],
        contradictions: [],
        uncertainties: [],
        sourceReferences: [],
        projectRoute: null,
      },
    }),
  );
  form.append("selectedTargetIds", "[]");
  return new Request("https://example.test/document-save", { method: "POST", body: form });
}

function fakeAuth(options: { failExtractedUpload?: boolean; failSave?: boolean }) {
  const removals: string[][] = [];
  let uploads = 0;
  const auth = {
    client: {
      storage: {
        from() {
          return {
            async upload() {
              uploads += 1;
              return options.failExtractedUpload && uploads === 2
                ? { data: null, error: { message: "storage unavailable" } }
                : { data: {}, error: null };
            },
            async remove(paths: string[]) {
              removals.push(paths);
              return { data: [], error: null };
            },
          };
        },
      },
      async rpc() {
        return options.failSave
          ? { data: null, error: { message: "record save unavailable" } }
          : { data: { id: crypto.randomUUID(), isNew: true }, error: null };
      },
    },
    user: { id: userId },
    authorization: "Bearer test",
  } as unknown as AuthenticatedSupabase;
  return { auth, removals };
}

Deno.test(
  "document save removes both newly-uploaded objects when record persistence fails",
  async () => {
    const { auth, removals } = fakeAuth({ failSave: true });
    const handler = createDocumentSaveHandler(async () => auth);

    const response = await handler(requestWithFile());

    assert(response.status === 502, "expected a safe record-save failure");
    assert(removals.length === 1, "expected one cleanup request");
    assert(removals[0].length === 2, "expected both original and normalized objects to be removed");
    assert(
      removals[0].every((path) => path.startsWith(`${userId}/documents/`)),
      "expected cleanup to stay in the authenticated owner's document scope",
    );
  },
);

Deno.test("document save removes the original when normalized-object upload fails", async () => {
  const { auth, removals } = fakeAuth({ failExtractedUpload: true });
  const handler = createDocumentSaveHandler(async () => auth);

  const response = await handler(requestWithFile());

  assert(response.status === 502, "expected a safe storage failure");
  assert(removals.length === 1, "expected cleanup after the second upload fails");
  assert(removals[0].length === 1, "only the successfully-uploaded original should be removed");
});

Deno.test(
  "document save returns a safe 503 when authentication infrastructure throws",
  async () => {
    const handler = createDocumentSaveHandler(async () => {
      throw new Error("do not disclose auth backend details");
    });

    const response = await handler(
      new Request("https://example.test/document-save", { method: "POST" }),
    );

    assert(
      response.status === 503,
      "expected authentication infrastructure failures to be sanitized",
    );
    assert(
      (await response.json()).error === "Authentication is temporarily unavailable.",
      "expected a stable public authentication error",
    );
  },
);

// ---------------------------------------------------------------------------
// Save-stage regressions for heading-dense documents. Production document-save
// v13 bundled a stale shared module that still capped documents at 128 source
// units, so a 71,800-byte, 326-section Markdown file excavated successfully and
// then failed here with a bare 413 while re-normalizing the uploaded file.

const encoder = new TextEncoder();

function loreMarkdown(targetBytes = 71_800): Uint8Array {
  let text =
    "---\ntitle: Synthetic Kingdom — Expanded Lore\n---\n\n# Synthetic Kingdom\n\n> “Salt remembers what stone forgets.”\n\n";
  for (let index = 1; encoder.encode(text).byteLength < targetBytes - 600; index += 1) {
    text +=
      `## Province ${index}: Žumberak\n\nIn year ${index} of the Crowned Era the Ban ceded the saltworks.\n\n` +
      `| Holding | Tithe |\n| --- | --- |\n| Solana ${index} | ${index * 3} marks |\n\n- Banner: argent\n\n` +
      `### Customs ${index}\n\nThe feast of Sveti Vlaho is kept with bonfires.\n\n`;
  }
  while (encoder.encode(text).byteLength < targetBytes) text += ".";
  return encoder.encode(text);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toBinaryData(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function referenceIds(count: number, start = 1): string[] {
  return Array.from(
    { length: count },
    (_, index) => `ref_${(start + index).toString(16).padStart(8, "0")}`,
  );
}

/** Builds the same multipart fields as excavateAndSaveChatGptDocument. */
async function mcpSaveRequest(
  bytes: Uint8Array,
  name: string,
  type: string,
  cited: string[],
  options: { recordId?: string; fileless?: boolean; recordData?: Record<string, unknown> } = {},
): Promise<Request> {
  const contentHash = await sha256Hex(bytes);
  const form = new FormData();
  form.append(
    "record",
    JSON.stringify({
      ...(options.recordId ? { id: options.recordId } : {}),
      recordType: "document",
      title: "Synthetic Kingdom",
      summary: "An expanded lore book.",
      tags: ["lore"],
      recordData: {
        originalFileName: name,
        mimeType: type,
        fileSizeBytes: bytes.byteLength,
        documentDate: "2026-09-28",
        pageCount: null,
        storagePath: null,
        extractedContentPath: null,
        contentHash,
        highSignalFindings: cited.map((id, index) => ({
          text: `Finding ${index} about the saltworks.`,
          sourceReferenceIds: [id],
        })),
        keyClaims: [],
        contradictions: [],
        uncertainties: [],
        sourceReferences: cited.map((id) => ({
          id,
          locator: "Heading: Province (Lines 1-9)",
          label: "Province",
          note: "",
        })),
        projectRoute: null,
        ...options.recordData,
      },
    }),
  );
  form.append("selectedTargetIds", "[]");
  form.append("removeFile", "false");
  if (!options.fileless) {
    form.append("contentHash", contentHash);
    form.append("file", new File([toBinaryData(bytes)], name, { type }));
  }
  return new Request("https://example.test/document-save", { method: "POST", body: form });
}

type Upload = { path: string; body: unknown; options: Record<string, unknown> };

function recordingAuth(
  options: {
    existing?: Record<string, unknown>;
    storedNormalized?: string;
  } = {},
) {
  const uploads: Upload[] = [];
  const removals: string[][] = [];
  const saves: Array<Record<string, unknown>> = [];
  const auth = {
    client: {
      from() {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.existing
                  ? {
                      id: options.existing.id,
                      record_type: "document",
                      record_data: options.existing.data,
                    }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      },
      storage: {
        from() {
          return {
            async upload(path: string, body: unknown, uploadOptions: Record<string, unknown>) {
              uploads.push({ path, body, options: uploadOptions });
              return { data: {}, error: null };
            },
            async remove(paths: string[]) {
              removals.push(paths);
              return { data: [], error: null };
            },
            async download() {
              return options.storedNormalized === undefined
                ? { data: null, error: { message: "missing" } }
                : { data: new Blob([options.storedNormalized]), error: null };
            },
          };
        },
      },
      async rpc(_name: string, args: Record<string, unknown>) {
        saves.push(args);
        return { data: { id: crypto.randomUUID(), isNew: !options.existing }, error: null };
      },
    },
    user: { id: userId },
    authorization: "Bearer test",
  } as unknown as AuthenticatedSupabase;
  return { auth, uploads, removals, saves };
}

async function captureErrors<T>(run: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logs.push(JSON.stringify(args));
  try {
    return { result: await run(), logs };
  } finally {
    console.error = original;
  }
}

Deno.test(
  "saves a 71,800-byte, 326-section Markdown file through the MCP request shape",
  async () => {
    const bytes = loreMarkdown();
    const normalized = await normalizeDocumentFile(bytes, "lore.md", "text/markdown");
    assert(bytes.byteLength === 71_800, "expected the 71,800-byte fixture");
    assert(normalized.units.length > 128, "fixture must exceed the removed 128-unit cap");

    const cited = [normalized.units[0].id, normalized.units[200].id, normalized.units.at(-1)!.id];
    const request = await mcpSaveRequest(bytes, "lore.md", "text/markdown", cited);
    const requestBytes = (await request.clone().arrayBuffer()).byteLength;
    assert(requestBytes < 100_000, `save request must stay near file size, got ${requestBytes}`);
    assert(requestBytes < DOCUMENT_MAX_REQUEST_BYTES, "save request must be within the hard limit");

    const { auth, uploads, saves } = recordingAuth();
    const response = await createDocumentSaveHandler(async () => auth)(request);
    assert(response.status === 200, `expected the save to succeed, got ${response.status}`);
    assert(saves.length === 1, "expected exactly one archive save");
    assert(uploads.length === 2, "expected original and normalized uploads");
    assert(
      uploads.every((upload) => upload.path.startsWith(`${userId}/documents/`)),
      "uploads must stay in the authenticated owner's scope",
    );
    assert(
      uploads[0].body instanceof Uint8Array && uploads[0].body.byteLength === 71_800,
      "the original file must be stored once, byte for byte",
    );

    const extracted = uploads[1];
    assert(extracted.body instanceof Blob, "normalized JSON must upload as a Blob");
    assert(extracted.body.type === "application/json", "normalized JSON must keep its type");
    const metadata = extracted.options.metadata as Record<string, string>;
    const storedIds = JSON.parse(metadata.document_source_reference_ids) as string[];
    assert(storedIds.length === normalized.units.length, "metadata must list every source unit");
    assert(
      cited.every((id) => storedIds.includes(id)),
      "cited references must be in metadata",
    );
    const recordData = (saves[0].record_payload as { recordData: Record<string, unknown> })
      .recordData;
    assert(recordData.contentHash === normalized.contentHash, "saved hash must match the file");
    assert(recordData.fileSizeBytes === 71_800, "saved size must be the real file size");
  },
);

Deno.test("saves small Markdown and UTF-8 plain text", async () => {
  for (const [name, type, text] of [
    ["small.md", "text/markdown", "# A\n\nOne.\n\n## B\n\nTwo."],
    ["notes.txt", "text/plain", "Čćžšđ — plain UTF-8 text.\nLine two."],
  ]) {
    const bytes = encoder.encode(text);
    const { auth, saves } = recordingAuth();
    const response = await createDocumentSaveHandler(async () => auth)(
      await mcpSaveRequest(bytes, name, type, ["ref_00000001"]),
    );
    assert(response.status === 200, `expected ${name} to save, got ${response.status}`);
    assert(saves.length === 1, `expected one archive save for ${name}`);
  }
});

Deno.test("rejects a declared request over the hard limit before authentication", async () => {
  let authenticated = false;
  const { result: response, logs } = await captureErrors(() =>
    createDocumentSaveHandler(async () => {
      authenticated = true;
      return recordingAuth().auth;
    })(
      new Request("https://example.test/document-save", {
        method: "POST",
        headers: { "content-length": String(DOCUMENT_MAX_REQUEST_BYTES + 1) },
        body: "x",
      }),
    ),
  );
  const body = await response.json();
  assert(response.status === 413, "expected HTTP 413");
  assert(body.diagnostic === "declared_request_too_large", "expected the declared-size cause");
  assert(!authenticated, "declared oversize must be rejected before authentication");
  assert(
    logs.some((line) => line.includes("declared_request_too_large")),
    "the declared-size rejection must be logged",
  );
});

Deno.test("rejects a streamed body over the hard limit with a distinct diagnostic", async () => {
  const chunk = new Uint8Array(1_000_000);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent > DOCUMENT_MAX_REQUEST_BYTES) return controller.close();
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const { auth, uploads, saves } = recordingAuth();
  const { result: response, logs } = await captureErrors(() =>
    createDocumentSaveHandler(async () => auth)(
      new Request("https://example.test/document-save", { method: "POST", body: stream }),
    ),
  );
  const body = await response.json();
  assert(response.status === 413, "expected HTTP 413");
  assert(body.diagnostic === "request_too_large", "expected the streamed-size cause");
  assert(uploads.length === 0 && saves.length === 0, "nothing may be stored or saved");
  assert(
    logs.some((line) => line.includes('"reason":"request_too_large"')),
    "the streamed-size rejection must be logged with its reason",
  );
});

Deno.test("rejects a file over the 10 MB limit with the file-size diagnostic", async () => {
  const bytes = new Uint8Array(DOCUMENT_MAX_FILE_BYTES + 1).fill(97);
  const { auth, uploads, saves } = recordingAuth();
  const { result: response } = await captureErrors(async () =>
    createDocumentSaveHandler(async () => auth)(
      await mcpSaveRequest(bytes, "large.txt", "text/plain", ["ref_00000001"]),
    ),
  );
  const body = await response.json();
  assert(response.status === 413, "expected HTTP 413");
  assert(body.diagnostic === "file_too_large", "expected the actual file-size cause");
  assert(uploads.length === 0 && saves.length === 0, "nothing may be stored or saved");
});

Deno.test(
  "rejects a normalized representation over its bound without storing anything",
  async () => {
    const text = Array.from({ length: 9_000 }, (_, index) => `# h${index}`).join("\n");
    const { auth, uploads, saves } = recordingAuth();
    const { result: response } = await captureErrors(async () =>
      createDocumentSaveHandler(async () => auth)(
        await mcpSaveRequest(encoder.encode(text), "dense.md", "text/markdown", ["ref_00000001"]),
      ),
    );
    const body = await response.json();
    assert(response.status === 413, "expected HTTP 413");
    assert(body.diagnostic === "normalized_structure_limit", "expected the normalized-size cause");
    assert(uploads.length === 0 && saves.length === 0, "nothing may be stored or saved");
  },
);

Deno.test("rejects source references that the uploaded file does not contain", async () => {
  const { auth, uploads, saves } = recordingAuth();
  const response = await createDocumentSaveHandler(async () => auth)(
    await mcpSaveRequest(loreMarkdown(), "lore.md", "text/markdown", ["ref_ffffffff"]),
  );
  assert(response.status === 400, "expected a provenance mismatch to fail");
  assert(uploads.length === 0 && saves.length === 0, "nothing may be stored or saved");
});

Deno.test("re-saves a stored 326-section document without re-uploading it", async () => {
  const bytes = loreMarkdown();
  const normalized = await normalizeDocumentFile(bytes, "lore.md", "text/markdown");
  const recordId = "22222222-2222-4222-8222-222222222222";
  const storagePath = `${userId}/documents/${recordId}/original/33333333-3333-4333-8333-333333333333-lore.md`;
  const extractedContentPath = `${userId}/documents/${recordId}/extracted/33333333-3333-4333-8333-333333333333-normalized.json`;
  const cited = [normalized.units[300].id];
  const existingData = {
    originalFileName: "lore.md",
    mimeType: "text/markdown",
    fileSizeBytes: bytes.byteLength,
    documentDate: null,
    pageCount: null,
    storagePath,
    extractedContentPath,
    contentHash: normalized.contentHash,
    highSignalFindings: [],
    keyClaims: [],
    contradictions: [],
    uncertainties: [],
    sourceReferences: [],
    projectRoute: null,
  };
  const { auth, uploads, saves } = recordingAuth({
    existing: { id: recordId, data: existingData },
    storedNormalized: JSON.stringify(normalized),
  });
  const response = await createDocumentSaveHandler(async () => auth)(
    await mcpSaveRequest(bytes, "lore.md", "text/markdown", cited, {
      recordId,
      fileless: true,
      recordData: { storagePath, extractedContentPath, contentHash: normalized.contentHash },
    }),
  );
  assert(
    response.status === 200,
    `expected the stored document to re-save, got ${response.status}`,
  );
  assert((await response.json()).isNew === false, "a re-save must update, not duplicate");
  assert(uploads.length === 0, "a re-save must not upload the file again");
  assert(saves.length === 1, "expected one archive update");
});
