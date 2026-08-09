import { describe, expect, test } from "bun:test";
import { documentDataSchema, validateSelectedDocumentFile } from "./document";

function file(name: string, type: string, size: number): File {
  return { name, type, size } as File;
}

const emptyDocument = {
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
};

describe("Document input contracts", () => {
  test("accepts the three V1 file families", () => {
    expect(validateSelectedDocumentFile(file("report.pdf", "application/pdf", 10))).toBeNull();
    expect(validateSelectedDocumentFile(file("notes.md", "text/markdown", 10))).toBeNull();
    expect(validateSelectedDocumentFile(file("notes.txt", "text/plain", 10))).toBeNull();
  });

  test("rejects empty, oversized, unsupported, and mismatched files", () => {
    expect(validateSelectedDocumentFile(file("empty.txt", "text/plain", 0))).toContain("empty");
    expect(validateSelectedDocumentFile(file("large.txt", "text/plain", 10_000_001))).toContain(
      "10 MB",
    );
    expect(
      validateSelectedDocumentFile(
        file(
          "report.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          10,
        ),
      ),
    ).toContain("Supported");
    expect(validateSelectedDocumentFile(file("notes.md", "application/pdf", 10))).toContain("MIME");
  });

  test("rejects conclusions that cite unknown source references", () => {
    const result = documentDataSchema.safeParse({
      ...emptyDocument,
      highSignalFindings: [{ text: "Finding", sourceReferenceIds: ["ref_00000001"] }],
    });
    expect(result.success).toBe(false);
  });
});
