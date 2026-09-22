import { afterEach, describe, expect, test } from "bun:test";
import type { ToolContext } from "@lovable.dev/mcp-js";
import {
  APPROVAL_SELECT,
  handleCancelRun,
  handleStartAnalysis,
  projectFindings,
} from "./capability-handlers";

const allowedClientId = "11111111-1111-4111-8111-111111111111";
const caseId = "00000000-0000-4000-8000-000000000001";

function context(authenticated: boolean, clientId?: string): ToolContext {
  return {
    isAuthenticated: () => authenticated,
    getClientId: () => clientId,
    getToken: () => (authenticated ? "verified-token" : undefined),
    getUserId: () => (authenticated ? "33333333-3333-4333-8333-333333333333" : undefined),
    getUserEmail: () => undefined,
    getScopes: () => undefined,
    getIssuer: () => undefined,
    getClaims: () => undefined,
  } as unknown as ToolContext;
}

afterEach(() => {
  delete process.env.MCP_ALLOWED_CLIENT_IDS;
});

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

describe("Custodian MCP run controls", () => {
  test("start_analysis and cancel_run stay unavailable after authentication", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = allowedClientId;
    const authenticated = context(true, allowedClientId);
    const started = await handleStartAnalysis({ caseId, recordIds: [caseId] }, authenticated);
    const cancelled = await handleCancelRun({ id: caseId }, authenticated);
    expect(started.isError).toBe(true);
    expect(cancelled.isError).toBe(true);
    expect(JSON.stringify(started.structuredContent)).toContain("RUNTIME_UNAVAILABLE");
    expect(JSON.stringify(cancelled.structuredContent)).toContain("RUNTIME_UNAVAILABLE");
    expect(JSON.stringify(started)).not.toContain("invoked");
    expect(JSON.stringify(cancelled)).not.toContain("cancelled");
  });

  test("start_analysis and cancel_run do not skip authentication", async () => {
    const signedOut = context(false);
    const started = await handleStartAnalysis({ caseId }, signedOut);
    const cancelled = await handleCancelRun({ id: caseId }, signedOut);
    expect(JSON.stringify(started.structuredContent)).toContain("AUTH_REQUIRED");
    expect(JSON.stringify(cancelled.structuredContent)).toContain("AUTH_REQUIRED");
  });
});
