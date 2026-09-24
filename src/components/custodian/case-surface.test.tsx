// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
  CustodianFinding,
  CustodianFindingEvidence,
  EvidenceItem,
} from "@/lib/custodian-types";
import { FindingDetails } from "./case-surface";

const finding = {
  id: "finding-1",
  caseId: "case-1",
  analysisMode: "synthesis",
  title: "Attributed conclusion",
  finding: "The bounded evidence supports the conclusion.",
  confidence: 80,
  whatWouldChangeMind: "A newer primary record.",
  revisitCondition: "When the Case scope changes.",
  sourceRecordId: null,
  status: "open",
  lifecycleStatus: "active",
  originKind: "analysis",
  analysisOutcome: "finding",
  originRunId: "run-1",
  originStepId: "step-1",
  candidateIndex: 0,
  analysisResultHash: "hash-1",
  uncertainties: ["Only bounded evidence was reviewed."],
  assumptions: [],
  scopeLimits: [],
  evidenceGaps: [],
  createdBy: "owner-1",
  updatedBy: "owner-1",
  createdAt: "2026-08-11T19:00:00.000Z",
  updatedAt: "2026-08-11T19:01:00.000Z",
} satisfies CustodianFinding;

const evidence = [
  {
    id: "supporting-1",
    caseId: "case-1",
    title: "Supporting source",
    content: { text: "support" },
    contentHash: "support-hash",
    sourceClassification: "primary",
    sourceUri: "fixture://supporting",
    sourceRecordId: null,
    provenance: {},
    lifecycleStatus: "active",
    immutable: true,
    capturedAt: "2026-08-11T19:00:00.000Z",
    supersedesId: null,
    createdBy: "owner-1",
    updatedBy: "owner-1",
    createdAt: "2026-08-11T19:00:00.000Z",
    updatedAt: "2026-08-11T19:01:00.000Z",
  },
  {
    id: "contrary-1",
    caseId: "case-1",
    title: "Contrary source",
    content: { text: "contrary" },
    contentHash: "contrary-hash",
    sourceClassification: "secondary",
    sourceUri: "fixture://contrary",
    sourceRecordId: null,
    provenance: {},
    lifecycleStatus: "active",
    immutable: true,
    capturedAt: "2026-08-11T19:00:00.000Z",
    supersedesId: null,
    createdBy: "owner-1",
    updatedBy: "owner-1",
    createdAt: "2026-08-11T19:00:00.000Z",
    updatedAt: "2026-08-11T19:01:00.000Z",
  },
] satisfies EvidenceItem[];

const evidenceLinks = [
  {
    id: "link-1",
    caseId: "case-1",
    findingId: "finding-1",
    evidenceId: "supporting-1",
    relationshipKind: "supporting",
    relationshipNote: "Direct support",
    lifecycleStatus: "active",
    createdBy: "owner-1",
    updatedBy: "owner-1",
    createdAt: "2026-08-11T19:00:00.000Z",
    updatedAt: "2026-08-11T19:01:00.000Z",
  },
  {
    id: "link-2",
    caseId: "case-1",
    findingId: "finding-1",
    evidenceId: "contrary-1",
    relationshipKind: "contrary",
    relationshipNote: "Limits confidence",
    lifecycleStatus: "active",
    createdBy: "owner-1",
    updatedBy: "owner-1",
    createdAt: "2026-08-11T19:00:00.000Z",
    updatedAt: "2026-08-11T19:01:00.000Z",
  },
] satisfies CustodianFindingEvidence[];

describe("Case Finding details", () => {
  test("renders attribution, caveats, and distinct evidence relationships", () => {
    render(<FindingDetails finding={finding} evidence={evidence} evidenceLinks={evidenceLinks} />);

    expect(screen.getByText(/The bounded evidence supports the conclusion/)).not.toBeNull();
    expect(screen.getByText(/not Owner Judgment/)).not.toBeNull();
    expect(screen.getByText(/Supporting evidence:/)).not.toBeNull();
    expect(screen.getByText(/Tensions and alternatives:/)).not.toBeNull();
    expect(screen.getByText(/Only bounded evidence was reviewed/)).not.toBeNull();
    expect(screen.getByText(/A newer primary record/)).not.toBeNull();
    expect(screen.getByText(/When the Case scope changes/)).not.toBeNull();
    const analysisDetails = screen.getByText("Analysis details").closest("details");
    expect(analysisDetails?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("Analysis details"));
    expect(analysisDetails?.hasAttribute("open")).toBe(true);
    expect(screen.getByText(/Run run-1 · synthesis step step-1 · candidate 0/)).not.toBeNull();
    expect(screen.getByText(/Numeric confidence:/)).not.toBeNull();
  });
});
