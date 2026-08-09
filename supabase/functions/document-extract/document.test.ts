import {
  chunkUnits,
  normalizeDocumentFile,
  validateNormalizedDocument,
} from "../_shared/document.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
