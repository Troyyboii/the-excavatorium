import { describe, expect, test } from "bun:test";
import { CASE_READING_MAX_CHARS } from "./custodian-types";
import { emptyDecisionData, emptyDocumentData, emptyToolData, type ArchiveRecord } from "./types";
import {
  buildCaseReadingBundle,
  describeCaseReadingAdmission,
  describeCaseReadingExclusion,
} from "./case-reading";

const timestamps = {
  createdAt: "2026-09-04T09:00:00.000Z",
  updatedAt: "2026-09-04T09:01:00.000Z",
};

function toolRecord(
  id: string,
  overrides: Partial<ArchiveRecord & { recordType: "tool" }>["recordData"] = {},
): ArchiveRecord {
  return {
    id,
    recordType: "tool",
    title: "Tool " + id,
    summary: "",
    tags: [],
    isExample: false,
    seedKey: null,
    ...timestamps,
    recordData: { ...emptyToolData, ...overrides },
  };
}

function toolRecordWithRepeatedText(id: string, length: number): ArchiveRecord {
  const text = "x".repeat(length);
  return toolRecord(id, {
    whatCaughtMyEye: text,
    whatItPromised: text,
    whatActuallyHappened: text,
    whatWorked: text,
    whatFailed: text,
    whyIKeptOrStoppedUsingIt: text,
    finalVerdict: text,
  });
}

function decisionRecord(
  id: string,
  overrides: Partial<ArchiveRecord & { recordType: "decision" }>["recordData"] = {},
): ArchiveRecord {
  return {
    id,
    recordType: "decision",
    title: "Decision " + id,
    summary: "Decision summary",
    tags: [],
    isExample: false,
    seedKey: null,
    ...timestamps,
    recordData: { ...emptyDecisionData("2026-09-04"), ...overrides },
  };
}

function conversationRecord(id: string): ArchiveRecord {
  return {
    id,
    recordType: "conversation",
    title: "Conversation " + id,
    summary: "Conversation summary",
    tags: [],
    isExample: false,
    seedKey: null,
    ...timestamps,
    recordData: {
      conversationDate: "2026-09-04",
      projectRoute: "General",
      highSignalFindings: "A high-signal finding",
      decisionsMade: "A decision",
      openLoops: "An open loop",
      reusablePrompts: "",
      memoryCandidates: "",
      rawConversationText: "PRIVATE TRANSCRIPT MUST NOT ENTER CASE READING",
    },
  };
}

function documentRecord(id: string, withSources = true): ArchiveRecord {
  return {
    id,
    recordType: "document",
    title: "Document " + id,
    summary: "Document summary",
    tags: [],
    isExample: false,
    seedKey: null,
    ...timestamps,
    recordData: {
      ...emptyDocumentData,
      originalFileName: "source.pdf",
      storagePath: "/private/document-files/source.pdf",
      extractedContentPath: "/private/extracted/source.txt",
      contradictions: [{ text: "The dates disagree.", sourceReferenceIds: [] }],
      uncertainties: [{ text: "The source date is uncertain.", sourceReferenceIds: [] }],
      sourceReferences: withSources
        ? [{ id: "source-1", label: "Page 2", locator: "p. 2", note: "Primary source." }]
        : [],
    },
  };
}

describe("bounded Case Reading", () => {
  test("preserves selected order, record identity, provenance, and owner context", () => {
    const decision = decisionRecord("decision-1");
    const document = documentRecord("document-1");
    const bundle = buildCaseReadingBundle({
      scope: {
        recordIds: [document.id, decision.id],
        freeTextContext: "Owner note, not evidence.",
      },
      archiveRecords: [decision, document],
    });

    expect(bundle.selectedRecordIds).toEqual(["document-1", "decision-1"]);
    expect(bundle.includedRecords.map((record) => [record.recordId, record.recordType])).toEqual([
      ["document-1", "document"],
      ["decision-1", "decision"],
    ]);
    expect(
      describeCaseReadingAdmission({ decision: "included", reasonCode: "selected_scope" }),
    ).toContain("Explicitly selected in the Case archive scope");
    expect(bundle.ownerContext).toBe("Owner note, not evidence.");
    expect(bundle.includedRecords[0]?.provenance).toContain(
      "Document source: Page 2 · p. 2 · Primary source.",
    );
  });

  test("reports unavailable records and deterministic supersession, conflict, uncertainty, and gaps", () => {
    const decision = decisionRecord("decision-2", {
      status: "Superseded",
      supersedesDecisionId: "decision-previous",
    });
    const document = documentRecord("document-2", false);
    const bundle = buildCaseReadingBundle({
      scope: {
        recordIds: ["missing-record", decision.id, document.id],
        freeTextContext: "",
      },
      archiveRecords: [decision, document],
    });

    expect(bundle.excludedRecords).toEqual([{ recordId: "missing-record", reason: "unavailable" }]);
    expect(describeCaseReadingExclusion("unavailable")).toContain(
      "unavailable in this archive snapshot",
    );
    expect(bundle.supersededMaterial.map((item) => item.recordId)).toEqual([
      "decision-2",
      "decision-2",
    ]);
    expect(bundle.conflictSignals[0]?.message).toBe("The dates disagree.");
    expect(bundle.uncertaintySignals[0]?.message).toBe("The source date is uncertain.");
    expect(bundle.evidenceGaps).toEqual(
      expect.arrayContaining([
        "Selected archive record missing-record is unavailable in this archive snapshot.",
      ]),
    );
    expect(bundle.evidenceGaps).not.toContain(
      "Document document-2 has no recorded source references.",
    );
  });

  test("does not expose raw conversation text or document storage paths", () => {
    const bundle = buildCaseReadingBundle({
      scope: {
        recordIds: ["conversation-1", "document-3"],
        freeTextContext: "",
      },
      archiveRecords: [conversationRecord("conversation-1"), documentRecord("document-3")],
    });
    const serialized = JSON.stringify(bundle);

    expect(serialized).not.toContain("PRIVATE TRANSCRIPT");
    expect(serialized).not.toContain("/private/document-files");
    expect(serialized).not.toContain("/private/extracted");
  });

  test("marks per-field and aggregate truncation while staying within the hard limit", () => {
    const long = "x".repeat(5_000);
    const records = ["tool-1", "tool-2", "tool-3"].map((id) =>
      toolRecord(id, {
        whatCaughtMyEye: long,
        whatItPromised: long,
        whatActuallyHappened: long,
        whatWorked: long,
        whatFailed: long,
        whyIKeptOrStoppedUsingIt: long,
        finalVerdict: long,
      }),
    );
    const bundle = buildCaseReadingBundle({
      scope: { recordIds: records.map((record) => record.id), freeTextContext: "" },
      archiveRecords: records,
    });

    expect(bundle.serializedChars).toBe(JSON.stringify(bundle).length);
    expect(bundle.serializedChars).toBeLessThanOrEqual(80_000);
    expect(bundle.truncation.occurred).toBe(true);
    expect(bundle.excludedRecords.every((record) => record.reason === "reading_limit")).toBe(true);
    expect(
      bundle.truncation.omittedRecordIds.length > 0 ||
        bundle.includedRecords.some(
          (record) => record.truncatedFields.length > 0 || record.omittedFields.length > 0,
        ),
    ).toBe(true);
  });

  test("keeps boundary inclusion independent of display-only admission reasoning", () => {
    const records = [
      toolRecordWithRepeatedText("tool-1", 3_950),
      toolRecordWithRepeatedText("tool-2", 3_950),
      toolRecordWithRepeatedText("tool-3", 3_000),
      toolRecordWithRepeatedText("tool-4", 0),
    ];
    const bundle = buildCaseReadingBundle({
      scope: {
        recordIds: records.map((record) => record.id),
        freeTextContext: "q".repeat(1_257),
      },
      archiveRecords: records,
    });
    const serialized = JSON.stringify(bundle);

    expect(bundle.serializedChars).toBe(serialized.length);
    expect(bundle.serializedChars).toBe(CASE_READING_MAX_CHARS);
    expect(bundle.includedRecords.map((record) => record.recordId)).toEqual(
      records.map((record) => record.id),
    );
    expect(bundle.excludedRecords).toEqual([]);
    expect(serialized).not.toContain("Explicitly selected in the Case archive scope");
    expect(
      describeCaseReadingAdmission({ decision: "included", reasonCode: "selected_scope" }),
    ).toContain("Explicitly selected in the Case archive scope");
  });
});
