import {
  chunkUnits,
  DOCUMENT_MAX_CHUNKS,
  DOCUMENT_MAX_SOURCE_UNITS,
  normalizeDocumentFile,
  type NormalizedDocument,
  validateNormalizedDocument,
} from "../_shared/document.ts";

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
