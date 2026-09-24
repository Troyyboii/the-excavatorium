import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_DELETE_CONFIRMATION,
  ACCOUNT_EXPORT_LIMITATIONS,
  accountExportContainsSecretMaterial,
  buildAccountExport,
  parseAccountSnapshotRpc,
} from "./account-export";
import type { ArchiveLink, ArchiveRecord } from "./types";

const record: ArchiveRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  recordType: "tool",
  title: "Example",
  summary: "",
  tags: [],
  isExample: false,
  seedKey: null,
  createdAt: "2026-09-24T10:00:00.000Z",
  updatedAt: "2026-09-24T10:00:00.000Z",
  recordData: {
    category: "chat",
    status: "Active",
    whatCaughtMyEye: "",
    whatItPromised: "",
    whatActuallyHappened: "",
    whatWorked: "",
    whatFailed: "",
    whyIKeptOrStoppedUsingIt: "",
    replacementToolId: null,
    revisitCondition: "",
    finalVerdict: "",
    lastReviewed: null,
  },
};

const link: ArchiveLink = {
  id: "22222222-2222-4222-8222-222222222222",
  sourceId: "11111111-1111-4111-8111-111111111111",
  targetId: "33333333-3333-4333-8333-333333333333",
  seedKey: null,
  createdAt: "2026-09-24T10:00:00.000Z",
};

describe("account export builder", () => {
  test("builds schemaVersion 2 with limitations and expanded sections", () => {
    const exportPayload = buildAccountExport({
      archive: { records: [record], links: [] },
      cases: [{ id: "case-1", title: "Investigation" }],
      evidence: [{ id: "ev-1" }],
      findings: [{ id: "f-1" }],
      findingEvidence: [],
      claims: [],
      claimEvidence: [],
      approvals: [{ id: "a-1", status: "pending" }],
      decisionReviews: [{ id: "dr-1", status: "draft" }],
      custodianRuns: [{ id: "run-1", status: "completed", model_tier: "terra" }],
      providerSettings: [{ provider: "openai", model_name: "gpt-5.6-sol" }],
      providerKeyStatus: { configured: true, last4: "1234", keyVersion: 1, updatedAt: null },
    });

    expect(exportPayload.exportKind).toBe("account");
    expect(exportPayload.schemaVersion).toBe(2);
    expect(exportPayload.limitations).toEqual(ACCOUNT_EXPORT_LIMITATIONS);
    expect(exportPayload.limitations.storageBinariesIncluded).toBe(false);
    expect(exportPayload.cases).toHaveLength(1);
    expect(exportPayload.custodianRuns[0]).toMatchObject({ status: "completed" });
    expect(exportPayload.providerKeyStatus).toEqual({
      configured: true,
      last4: "1234",
      keyVersion: 1,
      updatedAt: null,
    });
    expect(accountExportContainsSecretMaterial(exportPayload)).toBe(false);
  });

  test("flags ciphertext or sk- shaped payloads", () => {
    const poisoned = buildAccountExport({
      archive: { records: [record], links: [link] },
      cases: [],
      evidence: [],
      findings: [],
      findingEvidence: [],
      claims: [],
      claimEvidence: [],
      approvals: [],
      decisionReviews: [],
      custodianRuns: [],
      providerSettings: [{ ciphertext: "opaque" }],
      providerKeyStatus: { configured: false },
    });
    expect(accountExportContainsSecretMaterial(poisoned)).toBe(true);
  });

  test("maps snake_case RPC collections without inventing missing arrays", () => {
    const snapshot = parseAccountSnapshotRpc(
      {
        cases: [{ id: "c1" }],
        evidence: null,
        findings: [{ id: "f1" }],
        finding_evidence: [{ id: "fe1" }],
        claims: [],
        claim_evidence: [],
        approvals: [],
        decision_reviews: [{ id: "d1" }],
        custodian_runs: [],
        provider_settings: [{ model_name: "gpt-5.6-luna" }],
      },
      { records: [record], links: [] },
      { configured: false },
    );
    expect(snapshot.cases).toEqual([{ id: "c1" }]);
    expect(snapshot.evidence).toEqual([]);
    expect(snapshot.findingEvidence).toEqual([{ id: "fe1" }]);
    expect(snapshot.decisionReviews).toEqual([{ id: "d1" }]);
  });

  test("delete confirmation phrase is deliberate and exact", () => {
    expect(ACCOUNT_DELETE_CONFIRMATION).toBe("DELETE MY ACCOUNT");
  });
});
