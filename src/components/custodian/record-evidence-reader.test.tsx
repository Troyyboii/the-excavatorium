// Bun supplies this module at test runtime; it is not part of the app's TypeScript type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ArchiveRecord } from "@/lib/types";
import type { CustodianRecordContext, EvidenceItem } from "@/lib/custodian-types";
import {
  EVIDENCE_DISPLAY_MAX_CHARACTERS,
  EVIDENCE_DISPLAY_MAX_ENTRIES,
  formatEvidenceContent,
} from "@/lib/evidence-display";
import { RecordEvidenceReader } from "./record-evidence-reader";

afterEach(cleanup);

const record = {
  id: "record-1",
  recordType: "document",
  createdAt: "2026-08-11T19:00:00.000Z",
  updatedAt: "2026-08-11T19:01:00.000Z",
} as ArchiveRecord;

const emptyContext: CustodianRecordContext = {
  cases: [],
  claims: [],
  evidence: [],
  claimEvidence: [],
  findings: [],
};

describe("Record evidence display", () => {
  test("keeps plain text readable and bounded", () => {
    const result = formatEvidenceContent("<script>not markup</script>");
    expect(result.text).toBe("<script>not markup</script>");
    expect(result.truncated).toBe(false);
  });

  test("renders structured content without exceeding the display limit", () => {
    const result = formatEvidenceContent({
      source: "archive",
      nested: { level1: { level2: { level3: { level4: { level5: "hidden" } } } } },
    });
    expect(result.text).toContain('"source": "archive"');
    expect(result.text).toContain("nested content truncated");
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(EVIDENCE_DISPLAY_MAX_CHARACTERS);
  });

  test("marks oversized source content as truncated", () => {
    const result = formatEvidenceContent("x".repeat(EVIDENCE_DISPLAY_MAX_CHARACTERS + 500));
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(EVIDENCE_DISPLAY_MAX_CHARACTERS);
    expect(result.text.endsWith("…")).toBe(true);
  });

  test("stops traversing oversized structured collections", () => {
    const result = formatEvidenceContent(
      Object.fromEntries(
        Array.from({ length: EVIDENCE_DISPLAY_MAX_ENTRIES + 100 }, (_, i) => [`key-${i}`, i]),
      ),
    );
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(EVIDENCE_DISPLAY_MAX_CHARACTERS);
    expect(result.text.endsWith("…")).toBe(true);
  });

  test("keeps foundation-missing and empty states truthful", () => {
    render(
      <RecordEvidenceReader
        record={record}
        linkedRecordCount={0}
        backlinkCount={0}
        foundationPending
      />,
    );
    expect(screen.getByText("Custodian foundation pending")).not.toBeNull();

    cleanup();
    render(
      <RecordEvidenceReader
        record={record}
        context={emptyContext}
        linkedRecordCount={0}
        backlinkCount={0}
      />,
    );
    expect(screen.getByText("No persisted evidence is linked to this record.")).not.toBeNull();
    expect(
      screen.getByText("No persisted claims or findings are linked to this record."),
    ).not.toBeNull();
  });

  test("renders unsafe source URIs as text and labels interpretation separately", () => {
    const evidence = {
      id: "evidence-1",
      caseId: "case-1",
      title: "Unsafe URI evidence",
      content: { observed: "value" },
      contentHash: "hash-1",
      sourceClassification: "primary",
      sourceUri: "javascript:alert(1)",
      sourceRecordId: "record-1",
      provenance: { imported: true },
      lifecycleStatus: "archived",
      immutable: false,
      capturedAt: "2026-08-11T19:00:00.000Z",
      supersedesId: null,
      createdBy: "owner-1",
      updatedBy: "owner-1",
      createdAt: "2026-08-11T19:00:00.000Z",
      updatedAt: "2026-08-11T19:01:00.000Z",
    } satisfies EvidenceItem;
    render(
      <RecordEvidenceReader
        record={record}
        context={{ ...emptyContext, evidence: [evidence] }}
        linkedRecordCount={0}
        backlinkCount={0}
      />,
    );
    expect(screen.getByText("javascript:alert(1)")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "javascript:alert(1)" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Interpretation — not source truth" }),
    ).not.toBeNull();
  });
});
