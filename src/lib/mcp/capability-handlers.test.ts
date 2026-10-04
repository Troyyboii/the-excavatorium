import { describe, expect, test } from "bun:test";
import { APPROVAL_SELECT, projectFindings } from "./capability-handlers";

describe("get_pending_approvals projection", () => {
  test("exposes the exact action without owner identifiers", () => {
    expect(APPROVAL_SELECT).toContain("exact_action_hash");
    expect(APPROVAL_SELECT).toContain("proposed_diff");
    expect(APPROVAL_SELECT).toContain("tool_action");
    expect(APPROVAL_SELECT).toContain("provenance");
    expect(APPROVAL_SELECT).not.toContain("owner_id");
    expect(APPROVAL_SELECT).not.toContain("requested_by");
    expect(APPROVAL_SELECT).not.toContain("responded_by");
  });
});

describe("get_findings projection", () => {
  test("keeps support and contrary evidence distinct and excludes runtime payloads", () => {
    const findings = projectFindings(
      [
        {
          id: "finding-1",
          case_id: "case-1",
          origin_kind: "analysis",
          origin_run_id: "run-1",
          origin_step_id: "step-1",
          title: "Bounded conclusion",
        },
      ],
      [
        {
          id: "link-1",
          finding_id: "finding-1",
          evidence_id: "evidence-supporting",
          relationship_kind: "supporting",
          relationship_note: "Direct support",
        },
        {
          id: "link-2",
          finding_id: "finding-1",
          evidence_id: "evidence-contrary",
          relationship_kind: "contrary",
          relationship_note: "Limits confidence",
        },
      ],
      [
        {
          id: "evidence-supporting",
          title: "Supporting evidence",
          source_classification: "primary",
          source_uri: "fixture://supporting",
        },
        {
          id: "evidence-contrary",
          title: "Contrary evidence",
          source_classification: "secondary",
          source_uri: "fixture://contrary",
        },
      ],
    );

    expect(findings[0]?.evidence.map((entry) => entry.relationship_kind)).toEqual([
      "supporting",
      "contrary",
    ]);
    expect(findings[0]?.evidence[0]?.evidence).toMatchObject({
      id: "evidence-supporting",
      title: "Supporting evidence",
    });
    expect(findings[0]).not.toHaveProperty("output_payload");
  });
});
