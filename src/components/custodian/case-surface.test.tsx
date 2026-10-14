// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  CustodianFinding,
  CustodianFindingEvidence,
  EvidenceItem,
} from "@/lib/custodian-types";
import { FindingDetails } from "./case-surface";

afterEach(() => cleanup());

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
  sourceCitations: [],
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
    expect(screen.getByText("Run ID")).not.toBeNull();
    expect(screen.getByText("run-1")).not.toBeNull();
    expect(screen.getByText("Synthesis step ID")).not.toBeNull();
    expect(screen.getByText("step-1")).not.toBeNull();
    expect(screen.getByText("Candidate index")).not.toBeNull();
    expect(screen.getByText("0")).not.toBeNull();
    expect(screen.getByText(/Numeric confidence:/)).not.toBeNull();
  });

  test("shows cited archive material with its evidence level and keeps the score for grounded findings", () => {
    const grounded = {
      ...finding,
      sourceCitations: [
        {
          ref: "r1.f3",
          relationship: "supporting",
          recordId: "c1000000-0000-4000-8000-0000000000c1",
          recordType: "conversation",
          recordTitle: "Trait research notes A",
          selectionIndex: 1,
          field: "High-signal findings",
          unitKind: "finding",
          evidenceLevel: "owner_extracted_notes",
          currency: "unspecified",
          excerpt: "Claim A3: a generated hypothesis says trait X is separable.",
        },
        {
          ref: "r2.f2",
          relationship: "contrary",
          recordId: "c2000000-0000-4000-8000-0000000000c2",
          recordType: "conversation",
          recordTitle: "Trait research notes B",
          selectionIndex: 2,
          field: "High-signal findings",
          unitKind: "finding",
          evidenceLevel: "owner_extracted_notes",
          currency: "superseded",
          excerpt: "Claim B2: overlap is substantial.",
        },
      ],
    } satisfies CustodianFinding;
    render(<FindingDetails finding={grounded} evidence={[]} evidenceLinks={[]} />);
    expect(screen.getByText("Cited archive material")).not.toBeNull();
    expect(screen.getByText(/Supporting · Trait research notes A/)).not.toBeNull();
    expect(screen.getByText(/Contrary · Trait research notes B/)).not.toBeNull();
    expect(screen.getByText(/Claim A3: a generated hypothesis/)).not.toBeNull();
    expect(screen.getAllByText(/not independently verified/).length).toBe(2);
    expect(screen.getByText(/Supported by cited archive material/)).not.toBeNull();
    fireEvent.click(screen.getByText("Analysis details"));
    expect(screen.getByText(/80% \(not a calibrated probability\)/)).not.toBeNull();
  });

  test("an analysis result that cites nothing says so and shows no confidence number", () => {
    const starved = {
      ...finding,
      analysisOutcome: "unresolved",
      confidence: 98,
      sourceCitations: [],
    } satisfies CustodianFinding;
    render(<FindingDetails finding={starved} evidence={[]} evidenceLinks={[]} />);
    expect(screen.getByText(/Insufficient source material — nothing was cited/)).not.toBeNull();
    fireEvent.click(screen.getByText("Analysis details"));
    expect(screen.getByText(/Not shown: no source material was cited/)).not.toBeNull();
    expect(screen.queryByText(/98%/)).toBeNull();
  });
});
