import {
  chunkUnits,
  DOCUMENT_MAX_CHUNKS,
  DOCUMENT_MAX_FILE_BYTES,
  DOCUMENT_MAX_NORMALIZED_BYTES,
  mapInBatches,
  normalizeDocumentFile,
  toBinaryData,
  type NormalizedDocument,
  validateNormalizedDocument,
} from "../_shared/document.ts";
import {
  compactInsightList,
  DOCUMENT_SYNTHESIS_LIMITS,
  orderSourceReferenceIds,
} from "../_shared/document-draft.ts";
import { type AuthenticatedSupabase } from "../_shared/http.ts";
import {
  boundedText,
  classifyOpenAiFailure,
  extractAssistantOutputText,
  handleDocumentExtract,
} from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function extractionAuth(onQuota: () => Promise<unknown>) {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { model_name: "test-model" }, error: null }),
          }),
        }),
      }),
    }),
    rpc: async () => await onQuota(),
  };
  return {
    client,
    user: { id: "11111111-1111-4111-8111-111111111111" },
    authorization: "Bearer test",
  } as unknown as AuthenticatedSupabase;
}

async function documentExtractRequest(
  bytes: Uint8Array,
  name = "notes.md",
  type = "text/markdown",
) {
  const digest = await crypto.subtle.digest("SHA-256", toBinaryData(bytes));
  const contentHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const form = new FormData();
  form.set("file", new File([toBinaryData(bytes)], name, { type }));
  form.set("contentHash", contentHash);
  form.set("candidateRecords", "[]");
  return new Request("https://example.test", { method: "POST", body: form });
}

function providerResponse(value: unknown): Response {
  return new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function syntheticResearchDocument(): NormalizedDocument {
  const pageCount = 55;
  const charactersPerPage = 3_500;
  const units = Array.from({ length: pageCount }, (_, index) => {
    const pageNumber = index + 1;
    const pageText =
      `Page ${pageNumber}: This deterministic research passage records a bounded source claim, its supporting observation, and the uncertainty that remains for later synthesis. `
        .repeat(30)
        .slice(0, charactersPerPage);
    return {
      id: `ref_${pageNumber.toString(16).padStart(8, "0")}`,
      order: index,
      locator: `p. ${pageNumber}`,
      label: `Page ${pageNumber}`,
      text: pageText,
    };
  });
  return {
    version: 1,
    kind: "pdf",
    contentHash: "0".repeat(64),
    pageCount,
    extractedCharacterCount: units.reduce((sum, unit) => sum + unit.text.length, 0),
    units,
  };
}

Deno.test("normalizes Markdown with heading and line provenance", async () => {
  const bytes = new TextEncoder().encode(
    "# Heading\n\nA supported claim.\n\n## Detail\nMore evidence.",
  );
  const result = await normalizeDocumentFile(bytes, "report.md", "text/markdown");
  assert(result.kind === "markdown", "expected Markdown kind");
  assert(result.units.length === 2, "expected heading-aware units");
  assert(result.units[0].locator.includes("Heading:"), "expected heading locator");
  assert(result.units[0].id === "ref_00000001", "expected stable reference id");
});

Deno.test("normalizes plain text with bounded chunks", async () => {
  const bytes = new TextEncoder().encode("line one\nline two\nline three");
  const result = await normalizeDocumentFile(bytes, "notes.txt", "text/plain");
  const chunks = chunkUnits(result.units);
  assert(result.pageCount === null, "plain text must not invent page count");
  assert(chunks.length === 1, "expected a small text document to use one chunk");
  assert(chunks[0].text.includes("ref_00000001"), "expected provenance marker in chunk");
});

Deno.test("maps in bounded concurrent batches and preserves input order", async () => {
  let active = 0;
  let maxActive = 0;
  const values = [0, 1, 2, 3, 4, 5, 6];

  const result = await mapInBatches(values, 3, async (value, index) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, value % 3 === 0 ? 5 : 0));
    active -= 1;
    return `${index}:${value}`;
  });

  assert(maxActive === 3, "batch mapper did not run a full batch concurrently");
  assert(
    JSON.stringify(result) === JSON.stringify(values.map((value, index) => `${index}:${value}`)),
    "batch mapper changed input order",
  );
});

Deno.test("retains all source units for a 55-page research-sized document", () => {
  const normalized = syntheticResearchDocument();
  const chunks = chunkUnits(normalized.units);
  const retainedIds = chunks.flatMap((chunk) => chunk.sourceReferenceIds);

  assert(normalized.units.length === 55, "expected one source unit per synthetic page");
  assert(
    normalized.extractedCharacterCount > 16 * 7_000,
    "fixture must exceed the old 16-chunk, 7,000-character policy",
  );
  assert(validateNormalizedDocument(normalized), "expected synthetic document to validate");
  assert(chunks.length > 16, "fixture must exercise the expanded chunk budget");
  assert(chunks.length <= DOCUMENT_MAX_CHUNKS, "expected chunks within the shared budget");
  assert(retainedIds.length === normalized.units.length, "expected every source unit in a chunk");
  assert(
    new Set(retainedIds).size === normalized.units.length,
    "expected no source unit loss or duplication",
  );
  assert(
    normalized.units.every((unit) => retainedIds.includes(unit.id)),
    "expected every source reference to be retained",
  );
});

Deno.test("accepts a 71,800-byte Markdown file with 195 heading-derived units", async () => {
  const sectionCount = 195;
  const sections = Array.from(
    { length: sectionCount },
    (_, index) =>
      `## Neutral section ${index + 1}\n\nSection ${index + 1} records synthetic evidence and a short neutral observation.\n\n`,
  );
  let text = sections.join("");
  const targetBytes = 71_800;
  const encoder = new TextEncoder();
  while (encoder.encode(text).byteLength + 16 <= targetBytes) text += "Neutral filler. ";
  text += "x".repeat(targetBytes - encoder.encode(text).byteLength);
  const bytes = encoder.encode(text);

  const normalized = await normalizeDocumentFile(bytes, "heading-rich.md", "text/markdown");
  const chunks = chunkUnits(normalized.units);
  assert(bytes.byteLength === targetBytes, "expected the fixture to be 71,800 bytes");
  assert((text.match(/^#{1,6}\s+/gm) ?? []).length === sectionCount, "expected 195 headings");
  assert(normalized.units.length > 128, "expected more than 128 heading-derived units");
  assert(normalized.extractedCharacterCount < 400_000, "expected text below extraction bound");
  assert(chunks.length <= DOCUMENT_MAX_CHUNKS, "expected bounded analysis workload");
  assert(
    validateNormalizedDocument(normalized),
    "expected heading-rich normalized input to validate",
  );
  assert(
    encoder.encode(JSON.stringify(normalized)).byteLength <= DOCUMENT_MAX_NORMALIZED_BYTES,
    "expected normalized representation under its byte bound",
  );
  assert(
    normalized.units.every((unit) => unit.locator.includes("Lines")),
    "expected line provenance",
  );
});

Deno.test(
  "rejects a real file larger than the 10 MB limit with a file-size diagnostic",
  async () => {
    let error: unknown;
    try {
      await normalizeDocumentFile(
        new Uint8Array(DOCUMENT_MAX_FILE_BYTES + 1),
        "oversized.md",
        "text/markdown",
      );
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error, "expected oversized file to be rejected");
    assert(error.message === "The selected file is too large.", "expected the true size error");
    assert(
      "diagnostic" in error && error.diagnostic === "file_too_large",
      "expected the actual byte limit diagnostic",
    );
  },
);

Deno.test("rejects empty, unsupported, and binary text input", async () => {
  let rejected = false;
  try {
    await normalizeDocumentFile(new Uint8Array(), "empty.txt", "text/plain");
  } catch {
    rejected = true;
  }
  assert(rejected, "expected empty input to fail");

  rejected = false;
  try {
    await normalizeDocumentFile(new TextEncoder().encode("hello"), "notes.csv", "text/csv");
  } catch {
    rejected = true;
  }
  assert(rejected, "expected unsupported input to fail");

  rejected = false;
  try {
    await normalizeDocumentFile(new Uint8Array([0, 1, 2]), "binary.txt", "text/plain");
  } catch {
    rejected = true;
  }
  assert(rejected, "expected binary input to fail");
});

Deno.test("rejects tampered normalized provenance", async () => {
  const bytes = new TextEncoder().encode("# Heading\n\nSupported evidence.");
  const normalized = await normalizeDocumentFile(bytes, "report.md", "text/markdown");
  assert(validateNormalizedDocument(normalized), "expected normalized data to validate");

  const tampered = structuredClone(normalized);
  tampered.units[0].order = 99;
  assert(!validateNormalizedDocument(tampered), "expected reordered units to fail validation");
});

Deno.test("compacts duplicate insights, merges citations, and enforces the cap", () => {
  const result = compactInsightList(
    [
      {
        text: "  Supported   claim. ",
        sourceReferenceIds: ["ref_00000002", "ref_00000002"],
      },
      { text: "supported claim.", sourceReferenceIds: ["ref_00000001", "ref_00000002"] },
      { text: "Another claim.", sourceReferenceIds: ["ref_00000003"] },
      { text: "A claim beyond the cap.", sourceReferenceIds: ["ref_00000004"] },
    ],
    2,
  );
  assert(result.length === 2, "expected duplicate insight text to collapse");
  assert(result[0].text === "Supported claim.", "expected whitespace to normalize");
  assert(
    JSON.stringify(result[0].sourceReferenceIds) ===
      JSON.stringify(["ref_00000002", "ref_00000001"]),
    "expected duplicate citations to merge without reordering",
  );
});

Deno.test("orders compact source references by document order", () => {
  const result = orderSourceReferenceIds(
    ["ref_00000003", "ref_00000001", "ref_00000002", "ref_00000001"],
    ["ref_00000001", "ref_00000002", "ref_00000003"],
  );
  assert(
    JSON.stringify(result) === JSON.stringify(["ref_00000001", "ref_00000002", "ref_00000003"]),
    "expected source references to be unique and document ordered",
  );
});

Deno.test("contains unexpected authentication lookup failures", async () => {
  const response = await handleDocumentExtract(
    new Request("https://example.test", { method: "POST" }),
    {
      authenticate: async () => {
        throw new Error("private authentication detail");
      },
    },
  );
  const body = await response.json();
  assert(response.status === 503, "expected authentication failures to be service unavailable");
  assert(body.diagnostic === "authentication_unavailable", "expected safe auth diagnostic");
  assert(!JSON.stringify(body).includes("private authentication detail"), "leaked auth detail");
});

Deno.test("keeps missing authentication at 401", async () => {
  const response = await handleDocumentExtract(
    new Request("https://example.test", { method: "POST" }),
    { authenticate: async () => null },
  );
  assert(response.status === 401, "expected missing authentication to remain unauthorized");
});

Deno.test("does not consume quota when deterministic document preflight fails", async () => {
  let quotaCalls = 0;
  let providerCalls = 0;
  const auth = extractionAuth(async () => {
    quotaCalls += 1;
    return { data: { allowed: true, remaining: 9, retryAfterSeconds: 0 }, error: null };
  });
  const response = await handleDocumentExtract(
    await documentExtractRequest(new Uint8Array([0xff, 0xfe])),
    {
      authenticate: async () => auth,
      resolveFunding: async () => ({ ok: true, apiKey: "test-key", model: "test-model" }),
      fetchProvider: async () => {
        providerCalls += 1;
        return providerResponse({});
      },
    },
  );
  const body = await response.json();
  assert(response.status === 400, "expected malformed UTF-8 to fail as input");
  assert(body.diagnostic === "malformed_document", "expected a safe input diagnostic");
  assert(quotaCalls === 0, "preflight rejection must not consume quota");
  assert(providerCalls === 0, "preflight rejection must not call the provider");
});

Deno.test("rejects an excessive chunk workload without consuming quota", async () => {
  let quotaCalls = 0;
  let providerCalls = 0;
  const auth = extractionAuth(async () => {
    quotaCalls += 1;
    return { data: { allowed: true, remaining: 9, retryAfterSeconds: 0 }, error: null };
  });
  const text = "bounded workload ".repeat(21_000);
  const response = await handleDocumentExtract(
    await documentExtractRequest(new TextEncoder().encode(text)),
    {
      authenticate: async () => auth,
      resolveFunding: async () => ({ ok: true, apiKey: "test-key", model: "test-model" }),
      fetchProvider: async () => {
        providerCalls += 1;
        return providerResponse({});
      },
    },
  );
  const body = await response.json();
  assert(response.status === 413, "expected the analysis chunk bound to reject the input");
  assert(body.diagnostic === "analysis_chunk_limit", "expected a chunk-bound diagnostic");
  assert(quotaCalls === 0, "bounded input failure must not consume quota");
  assert(providerCalls === 0, "bounded input failure must not call the provider");
});

Deno.test("rejects actual files over 10 MB before quota admission", async () => {
  let quotaCalls = 0;
  const auth = extractionAuth(async () => {
    quotaCalls += 1;
    return { data: { allowed: true, remaining: 9, retryAfterSeconds: 0 }, error: null };
  });
  const response = await handleDocumentExtract(
    await documentExtractRequest(new Uint8Array(DOCUMENT_MAX_FILE_BYTES + 1)),
    {
      authenticate: async () => auth,
      resolveFunding: async () => ({ ok: true, apiKey: "test-key", model: "test-model" }),
    },
  );
  const body = await response.json();
  assert(response.status === 413, "expected HTTP 413 for an actual oversized file");
  assert(body.diagnostic === "file_too_large", "expected the actual file-size diagnostic");
  assert(quotaCalls === 0, "oversized files must not consume quota");
});

Deno.test("admits sequential valid excavations through the configured quota RPC", async () => {
  let quotaCalls = 0;
  let providerCalls = 0;
  const auth = extractionAuth(async () => {
    quotaCalls += 1;
    return {
      data: { allowed: true, remaining: 10 - quotaCalls, retryAfterSeconds: 0 },
      error: null,
    };
  });
  const chunkResult = {
    highSignalFindings: [],
    keyClaims: [],
    contradictions: [],
    uncertainties: [],
  };
  const synthesisResult = {
    title: "Excavated notes",
    summary: "A short neutral source.",
    tags: [],
    documentDate: null,
    pageCount: null,
    highSignalFindings: [],
    keyClaims: [],
    contradictions: [],
    uncertainties: [],
    sourceReferences: [],
    suggestedRecordIds: [],
  };
  for (let index = 0; index < 2; index += 1) {
    const response = await handleDocumentExtract(
      await documentExtractRequest(new TextEncoder().encode(`Valid document ${index + 1}.`)),
      {
        authenticate: async () => auth,
        resolveFunding: async () => ({ ok: true, apiKey: "test-key", model: "test-model" }),
        fetchProvider: async (_input, init) => {
          providerCalls += 1;
          const body = init && "body" in init ? init.body : undefined;
          assert(typeof body === "string", "expected a JSON provider request body");
          const requestBody = JSON.parse(body);
          const schemaName = requestBody.text.format.name;
          return providerResponse(
            schemaName === "document_chunk_analysis" ? chunkResult : synthesisResult,
          );
        },
      },
    );
    assert(response.status === 200, "expected each valid sequential excavation to complete");
  }
  assert(quotaCalls === 2, "each accepted excavation must consume one quota slot");
  assert(providerCalls === 4, "each document must run analysis and synthesis");
});

Deno.test(
  "returns bounded retry metadata for local cooldown and rolling-hour denials",
  async () => {
    for (const retryAfterSeconds of [5, 3_600]) {
      const auth = extractionAuth(async () => ({
        data: { allowed: false, remaining: retryAfterSeconds === 5 ? 9 : 0, retryAfterSeconds },
        error: null,
      }));
      const response = await handleDocumentExtract(
        await documentExtractRequest(new TextEncoder().encode("Valid document.")),
        {
          authenticate: async () => auth,
          resolveFunding: async () => ({ ok: true, apiKey: "test-key", model: "test-model" }),
          fetchProvider: async () => {
            throw new Error("quota rejection must happen before provider calls");
          },
        },
      );
      const body = await response.json();
      assert(response.status === 429, "expected local quota denials to remain 429");
      assert(body.diagnostic === "quota_exceeded", "expected the local quota diagnostic");
      assert(
        response.headers.get("Retry-After") === String(retryAfterSeconds),
        "expected a bounded Retry-After header",
      );
    }
  },
);

Deno.test("reports missing owner funding before provider contact", async () => {
  const auth = {
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    },
    user: { id: "11111111-1111-4111-8111-111111111111" },
    authorization: "Bearer test",
  } as unknown as AuthenticatedSupabase;
  const response = await handleDocumentExtract(
    new Request("https://example.test", { method: "POST" }),
    {
      authenticate: async () => auth,
      resolveFunding: async () => ({ ok: false, reason: "provider_key_missing" }),
    },
  );
  const body = await response.json();
  assert(response.status === 409, "expected missing owner key to conflict closed");
  assert(body.diagnostic === "provider_key_missing", "expected provider_key_missing diagnostic");
  assert(
    typeof body.error === "string" && body.error.includes("Settings"),
    "expected a clear Settings-directed message",
  );
  assert(!JSON.stringify(body).includes("OPENAI_API_KEY"), "must not mention operator key");
  assert(!JSON.stringify(body).includes("sk-"), "must not leak key material");
});

Deno.test("reports missing model preference before provider contact", async () => {
  const auth = {
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    },
    user: { id: "11111111-1111-4111-8111-111111111111" },
    authorization: "Bearer test",
  } as unknown as AuthenticatedSupabase;
  const response = await handleDocumentExtract(
    new Request("https://example.test", { method: "POST" }),
    {
      authenticate: async () => auth,
      resolveFunding: async () => ({ ok: false, reason: "model_not_selected" }),
    },
  );
  const body = await response.json();
  assert(response.status === 409, "expected missing model to conflict closed");
  assert(body.diagnostic === "model_not_selected", "expected model_not_selected diagnostic");
});

Deno.test("classifies OpenAi failures without retaining upstream details", () => {
  assert(
    classifyOpenAiFailure(401, { error: { message: "private" } }) === "upstream_authentication",
    "expected authentication classification",
  );
  assert(
    classifyOpenAiFailure(403, { error: { message: "private" } }) === "upstream_authentication",
    "expected authorization classification",
  );
  assert(
    classifyOpenAiFailure(429, { error: { type: "rate_limit_exceeded" } }) ===
      "upstream_rate_limit",
    "expected rate-limit classification",
  );
  assert(
    classifyOpenAiFailure(429, { error: { code: "insufficient_quota" } }) === "upstream_quota",
    "expected quota classification",
  );
  assert(
    classifyOpenAiFailure(503, null) === "upstream_service_failure",
    "expected service classification",
  );
});

// ---------------------------------------------------------------------------
// Structured-output contract. Strict Structured Outputs enforce types, required
// keys, additionalProperties and array/integer bounds. They do not enforce
// maxLength, citation membership, or date format, so model output that is
// legal for the provider must not fail the whole excavation on those alone.

function loreMarkdownFixture(targetBytes = 71_800): Uint8Array {
  const encoder = new TextEncoder();
  let text =
    "---\ntitle: Synthetic Kingdom — Expanded Lore\nrevision: 2026-09-28\n---\n\n# Synthetic Kingdom\n\n> “Salt remembers what stone forgets.”\n\n";
  for (let index = 1; encoder.encode(text).byteLength < targetBytes - 600; index += 1) {
    text +=
      `## Province ${index}: Žumberak\n\nIn year ${index} of the Crowned Era the Ban ceded the saltworks. Chroniclers disagree.\n\n` +
      `| Holding | Tithe |\n| --- | --- |\n| Solana ${index} | ${index * 3} marks |\n\n- Banner: argent, a wolf sable\n\n` +
      `### Customs ${index}\n\nThe feast of Sveti Vlaho is kept with bonfires.\n\n`;
  }
  while (encoder.encode(text).byteLength < targetBytes) text += ".";
  return encoder.encode(text);
}

function providerEnvelope(messages: Array<{ text: string; phase?: string }>): Response {
  return new Response(
    JSON.stringify({
      status: "completed",
      output: messages.map(({ text, phase }) => ({
        type: "message",
        role: "assistant",
        ...(phase ? { phase } : {}),
        content: [{ type: "output_text", text }],
      })),
    }),
    { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_test123" } },
  );
}

type ProviderScript = {
  chunk?: (ids: string[], index: number) => unknown;
  synthesis?: (allIds: string[]) => unknown;
  raw?: (schemaName: string) => Response | undefined;
};

const emptyAnalysis = {
  highSignalFindings: [],
  keyClaims: [],
  contradictions: [],
  uncertainties: [],
};

function groundedChunk(ids: string[]) {
  return {
    ...emptyAnalysis,
    highSignalFindings: [{ text: "The Crown holds the saltworks.", sourceReferenceIds: [ids[0]] }],
    keyClaims: [{ text: "The Ban ceded the saltworks.", sourceReferenceIds: [ids[1] ?? ids[0]] }],
  };
}

function groundedSynthesis(ids: string[]) {
  return {
    title: "Synthetic Kingdom",
    summary: "An expanded lore book.",
    tags: ["lore"],
    documentDate: null,
    pageCount: null,
    highSignalFindings: [{ text: "The Crown holds the saltworks.", sourceReferenceIds: [ids[0]] }],
    keyClaims: [{ text: "The Ban ceded the saltworks.", sourceReferenceIds: [ids[1] ?? ids[0]] }],
    contradictions: [],
    uncertainties: [],
    sourceReferences: [{ id: ids[0], note: "Opening section." }],
    suggestedRecordIds: [],
  };
}

async function runExtraction(
  bytes: Uint8Array,
  script: ProviderScript = {},
  name = "lore.md",
): Promise<{
  status: number;
  body: Record<string, unknown>;
  logs: string[];
  providerCalls: number;
}> {
  const mimeType = name.endsWith(".txt") ? "text/plain" : "text/markdown";
  const normalized = await normalizeDocumentFile(bytes, name, mimeType);
  const allIds = normalized.units.map((unit) => unit.id);
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => logs.push(JSON.stringify(args));
  let chunkIndex = 0;
  let providerCalls = 0;
  try {
    const request = await documentExtractRequest(bytes, name, mimeType);
    const response = await handleDocumentExtract(request, {
      authenticate: async () =>
        extractionAuth(async () => ({
          data: { allowed: true, remaining: 9, retryAfterSeconds: 0 },
          error: null,
        })),
      resolveFunding: async () => ({ ok: true, apiKey: "test-key", model: "test-model" }),
      fetchProvider: async (_input, init) => {
        providerCalls += 1;
        const body = init && "body" in init ? init.body : undefined;
        assert(typeof body === "string", "expected a JSON provider request body");
        const requestBody = JSON.parse(body);
        const schemaName = requestBody.text.format.name as string;
        const raw = script.raw?.(schemaName);
        if (raw) return raw;
        if (schemaName === "document_chunk_analysis") {
          const ids = JSON.parse(requestBody.input[1].content).sourceReferenceIds as string[];
          const value = (script.chunk ?? groundedChunk)(ids, chunkIndex++);
          return providerEnvelope([{ text: JSON.stringify(value) }]);
        }
        return providerEnvelope([
          { text: JSON.stringify((script.synthesis ?? groundedSynthesis)(allIds)) },
        ]);
      },
    });
    return { status: response.status, body: await response.json(), logs, providerCalls };
  } finally {
    console.error = originalError;
  }
}

Deno.test("excavates a 71,800-byte heading-dense Markdown lore book end to end", async () => {
  const bytes = loreMarkdownFixture();
  const normalized = await normalizeDocumentFile(bytes, "lore.md", "text/markdown");
  assert(bytes.byteLength === 71_800, "expected the 71,800-byte fixture");
  assert(normalized.units.length > 128, "fixture must exceed the removed 128-unit cap");
  const chunkCount = chunkUnits(normalized.units).length;
  assert(chunkCount > 4, "fixture must need more than one analysis batch");

  const result = await runExtraction(bytes);
  assert(result.status === 200, `expected success, got ${result.status}`);
  assert(result.providerCalls === chunkCount + 1, "expected every chunk and one synthesis");
  assert(result.body.title === "Synthetic Kingdom", "expected the synthesized title");
  assert(result.body.fileSizeBytes === 71_800, "expected the real byte size on the draft");
  assert(result.body.mimeType === "text/markdown", "expected the Markdown MIME type");
});

Deno.test("excavates small Markdown and UTF-8 plain text", async () => {
  const markdown = await runExtraction(new TextEncoder().encode("# A\n\nOne.\n\n## B\n\nTwo."));
  assert(markdown.status === 200, "expected small Markdown to succeed");
  const text = await runExtraction(
    new TextEncoder().encode("Čćžšđ — plain UTF-8 text.\nLine two."),
    {},
    "notes.txt",
  );
  assert(text.status === 200, "expected UTF-8 text to succeed");
  assert(text.body.mimeType === "text/plain", "expected the plain-text MIME type");
});

Deno.test(
  "normalizes provider-legal values the schema cannot length- or format-limit",
  async () => {
    for (const documentDate of ["", "Year 412 of the Crowned Era", "2026-09", "2026-02-30"]) {
      const result = await runExtraction(loreMarkdownFixture(), {
        synthesis: (ids) => ({ ...groundedSynthesis(ids), documentDate }),
      });
      assert(result.status === 200, `expected ${JSON.stringify(documentDate)} to be accepted`);
      assert(result.body.documentDate === null, "a non-calendar date must become null");
    }
    const dated = await runExtraction(loreMarkdownFixture(), {
      synthesis: (ids) => ({ ...groundedSynthesis(ids), documentDate: "2026-09-28" }),
    });
    assert(dated.body.documentDate === "2026-09-28", "a real ISO date must be kept");

    const result = await runExtraction(loreMarkdownFixture(), {
      synthesis: (ids) => ({
        ...groundedSynthesis(ids),
        title: "Title ".repeat(60),
        summary: "Lore of the realm. ".repeat(60),
        tags: ["x".repeat(60), " lore ", "lore", ""],
        suggestedRecordIds: ["22222222-2222-4222-8222-222222222222"],
      }),
    });
    assert(result.status === 200, "expected provider-legal bounds overflow to be normalized");
    assert((result.body.title as string).length <= 240, "title must be bounded");
    assert((result.body.summary as string).length <= 800, "summary must be bounded");
    assert((result.body.summary as string).endsWith("…"), "a bounded summary is marked truncated");
    assert(JSON.stringify(result.body.tags) === JSON.stringify(["lore"]), "tags must be cleaned");
    assert(
      JSON.stringify(result.body.suggestedRecordIds) === "[]",
      "suggestions outside caller-owned candidates must be dropped",
    );
  },
);

Deno.test("drops individually unverifiable insights and keeps grounded ones", async () => {
  const result = await runExtraction(loreMarkdownFixture(), {
    chunk: (ids, index) =>
      index === 1
        ? {
            ...groundedChunk(ids),
            uncertainties: [
              { text: "Cites another chunk.", sourceReferenceIds: [ids[0], "ref_00000001"] },
            ],
          }
        : groundedChunk(ids),
    synthesis: (ids) => ({
      ...groundedSynthesis(ids),
      contradictions: [{ text: "Invented citation.", sourceReferenceIds: ["ref_ffffffff"] }],
      sourceReferences: [
        { id: ids[0], note: "Opening section." },
        { id: "ref_ffffffff", note: "Unknown." },
      ],
    }),
  });
  assert(result.status === 200, "a minority of unverifiable items must not fail the excavation");
  assert(JSON.stringify(result.body.contradictions) === "[]", "unverifiable item must be dropped");
  assert((result.body.highSignalFindings as unknown[]).length === 1, "grounded item must be kept");
  const references = result.body.sourceReferences as Array<{ id: string }>;
  assert(
    references.every((reference) => reference.id !== "ref_ffffffff"),
    "an unknown reference must never be materialized",
  );
  assert(
    result.logs.some((line) => line.includes("unverifiable_items_dropped")),
    "dropped items must be counted in diagnostics",
  );
  assert(
    !result.logs.some((line) => line.includes("Invented citation")),
    "diagnostics must not contain model or document text",
  );
});

Deno.test("still fails mostly unverifiable output with a logged schema diagnostic", async () => {
  const chunkFailure = await runExtraction(loreMarkdownFixture(), {
    chunk: (ids, index) =>
      index === 0
        ? {
            ...emptyAnalysis,
            keyClaims: [
              { text: "Invented.", sourceReferenceIds: ["ref_ffffffff"] },
              { text: "Grounded.", sourceReferenceIds: [ids[0]] },
              { text: " ", sourceReferenceIds: [ids[0]] },
            ],
          }
        : groundedChunk(ids),
  });
  assert(chunkFailure.status === 502, "majority-unverifiable chunk output must fail");
  assert(
    chunkFailure.body.diagnostic === "schema_validation_failure",
    "expected schema diagnostic",
  );
  assert(
    chunkFailure.logs.some(
      (line) =>
        line.includes("document_chunk_analysis") &&
        line.includes("unverifiable_items") &&
        line.includes('"dropped":2'),
    ),
    "the chunk-stage failure must be logged with its reason and counts",
  );

  const synthesisFailure = await runExtraction(loreMarkdownFixture(), {
    synthesis: (ids) => ({
      ...groundedSynthesis(ids),
      highSignalFindings: [{ text: "Invented.", sourceReferenceIds: ["ref_ffffffff"] }],
      keyClaims: [],
    }),
  });
  assert(synthesisFailure.status === 502, "unverifiable synthesis output must fail");
  assert(
    synthesisFailure.logs.some(
      (line) => line.includes("document_synthesis") && line.includes("unverifiable_items"),
    ),
    "the synthesis-stage failure must be logged",
  );
});

Deno.test("fails structural violations and distinguishes null from absent fields", async () => {
  const cases: Array<[string, (ids: string[]) => unknown]> = [
    ["unexpected key", (ids) => ({ ...groundedSynthesis(ids), recordType: "document" })],
    ["wrong type", (ids) => ({ ...groundedSynthesis(ids), summary: 7 })],
    [
      "absent required field",
      (ids) => {
        const { documentDate: _omitted, ...rest } = groundedSynthesis(ids);
        return rest;
      },
    ],
    ["array over its bound", (ids) => ({ ...groundedSynthesis(ids), tags: Array(9).fill("t") })],
  ];
  for (const [label, synthesis] of cases) {
    const result = await runExtraction(loreMarkdownFixture(), { synthesis });
    assert(result.status === 502, `expected ${label} to fail`);
    assert(result.body.diagnostic === "schema_validation_failure", `expected ${label} diagnostic`);
    assert(
      result.logs.some((line) => line.includes("output_shape")),
      `expected ${label} to log an output_shape reason`,
    );
  }
  const explicitNull = await runExtraction(loreMarkdownFixture(), {
    synthesis: (ids) => ({ ...groundedSynthesis(ids), documentDate: null }),
  });
  assert(explicitNull.status === 200, "an explicit null optional value must be accepted");
});

Deno.test("selects the final structured answer from multi-message provider output", () => {
  const completed = (output: unknown[]) => ({ status: "completed", output });
  const message = (text: string, phase?: string) => ({
    type: "message",
    role: "assistant",
    ...(phase ? { phase } : {}),
    content: [{ type: "output_text", text }],
  });
  const single = extractAssistantOutputText(
    completed([
      { type: "reasoning", summary: [] },
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: '{"a":' },
          { type: "output_text", text: "1}" },
        ],
      },
    ]),
  );
  assert(single.ok && single.text === '{"a":1}', "parts of one message must be joined");
  const preamble = extractAssistantOutputText(
    completed([message("Reviewing the source."), message('{"a":1}')]),
  );
  assert(preamble.ok && preamble.text === '{"a":1}', "a preamble message must not be joined");
  const phased = extractAssistantOutputText(
    completed([message('{"a":1}', "final_answer"), message("Done.", "commentary")]),
  );
  assert(phased.ok && phased.text === '{"a":1}', "the final_answer phase must win");
  const refusal = extractAssistantOutputText(
    completed([
      { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "no" }] },
    ]),
  );
  assert(!refusal.ok && refusal.reason === "refusal", "a refusal must be distinguished");
  const incomplete = extractAssistantOutputText({ status: "incomplete", output: [] });
  assert(!incomplete.ok, "an incomplete response must not yield text");
});

Deno.test("reports malformed provider output as invalid_output with a stage log", async () => {
  const result = await runExtraction(new TextEncoder().encode("# A\n\nOne."), {
    raw: (schemaName) =>
      schemaName === "document_chunk_analysis"
        ? providerEnvelope([{ text: '{"highSignalFindings": [' }])
        : undefined,
  });
  assert(result.status === 502, "malformed output must fail");
  assert(result.body.diagnostic === "invalid_output", "expected invalid_output");
  assert(
    result.logs.some(
      (line) =>
        line.includes("document_chunk_analysis") &&
        line.includes("output_parse") &&
        line.includes("req_test123"),
    ),
    "the parse failure must be logged with stage and provider request id",
  );
  assert(!result.logs.some((line) => line.includes("highSignalFindings")), "no output text logged");

  const refused = await runExtraction(new TextEncoder().encode("# A\n\nOne."), {
    raw: () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "no" }] },
          ],
        }),
        { status: 200 },
      ),
  });
  assert(refused.body.diagnostic === "invalid_output", "a refusal remains invalid output");
  assert(
    refused.logs.some((line) => line.includes("output_shape") && line.includes("refusal")),
    "a refusal must be logged distinctly",
  );
});

Deno.test(
  "reports a provider abort during body read as a timeout, not invalid output",
  async () => {
    const result = await runExtraction(new TextEncoder().encode("# A\n\nOne."), {
      raw: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new DOMException("The signal has been aborted", "AbortError"));
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    assert(result.status === 504, "expected a gateway timeout status");
    assert(result.body.diagnostic === "extraction_timeout", "expected extraction_timeout");
    assert(
      result.logs.some((line) => line.includes("body_read_aborted")),
      "expected the body-read abort stage in diagnostics",
    );
  },
);

Deno.test("bounds free text at a word boundary within the limit", () => {
  assert(boundedText("  short  ", 10) === "short", "short text is only trimmed");
  const bounded = boundedText("alpha beta gamma delta", 12);
  assert(bounded.length <= 12, "bounded text must respect the limit");
  assert(bounded === "alpha beta…", "bounded text cuts at a word boundary");
  assert(boundedText("x".repeat(30), 10).length === 10, "unbroken text is hard-cut");
});
