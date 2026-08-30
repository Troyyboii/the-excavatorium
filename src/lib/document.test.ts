import { describe, expect, test } from "bun:test";
import {
  applyDocumentDraft,
  documentDataSchema,
  documentDraftSchema,
  formatDocumentValidationIssues,
  mergeDocumentSuggestedRecordIds,
  validateSelectedDocumentFile,
} from "./document";

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

const draft = {
  title: "Excavated document",
  summary: "A concise summary.",
  tags: ["archive", "evidence"],
  documentDate: "2026-08-30",
  pageCount: 2,
  highSignalFindings: [{ text: "A finding", sourceReferenceIds: ["ref_00000001"] }],
  keyClaims: [{ text: "A claim", sourceReferenceIds: ["ref_00000001"] }],
  contradictions: [],
  uncertainties: [],
  sourceReferences: [{ id: "ref_00000001", locator: "p. 1", label: "Page 1", note: "" }],
  suggestedRecordIds: ["11111111-1111-4111-8111-111111111111"],
  originalFileName: "report.md",
  mimeType: "text/markdown",
  fileSizeBytes: 10,
  contentHash: "a".repeat(64),
};

describe("Document input contracts", () => {
  test("maps a draft without replacing user- and server-owned document fields", () => {
    const applied = applyDocumentDraft(
      {
        ...emptyDocument,
        projectRoute: "The Forge",
        storagePath: "owner/documents/record/original/report.md",
        extractedContentPath: "owner/documents/record/extracted/report.json",
      },
      draft,
    );

    expect(applied.title).toBe(draft.title);
    expect(applied.summary).toBe(draft.summary);
    expect(applied.tags).toEqual(draft.tags);
    expect(applied.data).toMatchObject({
      originalFileName: draft.originalFileName,
      mimeType: draft.mimeType,
      fileSizeBytes: draft.fileSizeBytes,
      documentDate: draft.documentDate,
      pageCount: draft.pageCount,
      contentHash: draft.contentHash,
      projectRoute: "The Forge",
      storagePath: "owner/documents/record/original/report.md",
      extractedContentPath: "owner/documents/record/extracted/report.json",
    });
    expect(applied.data.highSignalFindings).toEqual(draft.highSignalFindings);
    expect(applied.data.sourceReferences).toEqual(draft.sourceReferences);
  });

  test("retains selected links and adds only allowed non-self suggestions", () => {
    const currentId = "22222222-2222-4222-8222-222222222222";
    const allowedId = "11111111-1111-4111-8111-111111111111";
    const otherId = "33333333-3333-4333-8333-333333333333";

    expect(
      mergeDocumentSuggestedRecordIds(
        [otherId, otherId],
        [allowedId, currentId, "44444444-4444-4444-8444-444444444444", allowedId],
        new Set([allowedId, currentId]),
        currentId,
      ),
    ).toEqual([otherId, allowedId]);
  });

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

  test("accepts only real ISO document dates", () => {
    expect(
      documentDataSchema.safeParse({ ...emptyDocument, documentDate: "2026-08-09" }).success,
    ).toBe(true);
    expect(
      documentDataSchema.safeParse({ ...emptyDocument, documentDate: "09/08/2026" }).success,
    ).toBe(false);
    expect(
      documentDataSchema.safeParse({ ...emptyDocument, documentDate: "2026-02-30" }).success,
    ).toBe(false);
  });

  test("reports the field for blank or unknown draft evidence", () => {
    const result = documentDraftSchema.safeParse({
      title: "Draft",
      summary: "",
      tags: [],
      documentDate: null,
      pageCount: null,
      highSignalFindings: [{ text: "", sourceReferenceIds: ["ref_00000001", "ref_00000002"] }],
      keyClaims: [],
      contradictions: [],
      uncertainties: [],
      sourceReferences: [{ id: "ref_00000001", locator: "", label: "", note: "" }],
      suggestedRecordIds: [],
      originalFileName: "report.md",
      mimeType: "text/markdown",
      fileSizeBytes: 10,
      contentHash: "0".repeat(64),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = formatDocumentValidationIssues(result.error.issues);
    expect(messages.some((message) => message.includes("High-signal findings 1 · Text"))).toBe(
      true,
    );
    expect(messages.some((message) => message.includes("Source references 1 · Locator"))).toBe(
      true,
    );
    expect(messages.some((message) => message.includes("Every source reference ID"))).toBe(true);
  });

  test("rejects duplicate source reference IDs", () => {
    const result = documentDataSchema.safeParse({
      ...emptyDocument,
      sourceReferences: [
        { id: "ref_00000001", locator: "p. 1", label: "Page 1", note: "" },
        { id: "ref_00000001", locator: "p. 1", label: "Page 1", note: "" },
      ],
    });
    expect(result.success).toBe(false);
  });
});
