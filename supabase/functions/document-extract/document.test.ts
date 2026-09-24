import {
  chunkUnits,
  DOCUMENT_MAX_CHUNKS,
  DOCUMENT_MAX_SOURCE_UNITS,
  mapInBatches,
  normalizeDocumentFile,
  type NormalizedDocument,
  validateNormalizedDocument,
} from "../_shared/document.ts";
import {
  compactInsightList,
  DOCUMENT_SYNTHESIS_LIMITS,
  orderSourceReferenceIds,
} from "../_shared/document-draft.ts";
import { type AuthenticatedSupabase } from "../_shared/http.ts";
import { classifyOpenAiFailure, handleDocumentExtract } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
    normalized.units.length <= DOCUMENT_MAX_SOURCE_UNITS,
    "source-unit cap must remain explicit",
  );
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
