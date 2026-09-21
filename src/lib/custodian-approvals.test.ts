import { describe, expect, test } from "bun:test";
import {
  assembleOwnerGateItems,
  assertOwnerGateDecision,
  CUSTODIAN_APPROVAL_READ_LIMIT,
  CUSTODIAN_OWNER_GATE_CAN_EXECUTE,
  filterOwnerGateItems,
  isApprovalExpired,
  mapCustodianApprovalPolicyRow,
  mapCustodianApprovalRow,
  mapCustodianApprovalRunRow,
  mapCustodianChangeProposalRow,
  ownerGateAllowsDecision,
  ownerGateExecutionUnavailableReason,
  ownerGateIdempotencyKey,
  presentOwnerGate,
  toolActionClass,
  type CustodianApproval,
  type CustodianChangeProposal,
} from "./custodian-approvals";

const timestamps = {
  requested_at: "2026-09-21T14:00:00.000Z",
  created_at: "2026-09-21T14:00:00.000Z",
  updated_at: "2026-09-21T14:00:01.000Z",
};

function approvalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    case_id: "22222222-2222-4222-8222-222222222222",
    run_id: "33333333-3333-4333-8333-333333333333",
    idempotency_key: "gate-1",
    approval_kind: "tool_action",
    status: "pending",
    title: "Inspectable proposed action",
    rationale: "The finding identified a bounded internal change.",
    proposed_diff: { field: "status", from: "open", to: "paused" },
    tool_action: { operation_class: "evidence_write", tool_name: "record_evidence" },
    exact_action_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    response_note: null,
    requested_at: timestamps.requested_at,
    responded_at: null,
    expires_at: "2026-09-22T14:00:00.000Z",
    provenance: { origin: "fixture" },
    lifecycle_status: "active",
    ...timestamps,
    ...overrides,
  };
}

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    case_id: "22222222-2222-4222-8222-222222222222",
    run_id: "33333333-3333-4333-8333-333333333333",
    approval_request_id: "11111111-1111-4111-8111-111111111111",
    idempotency_key: "proposal-1",
    target_type: "evidence_item",
    target_id: "55555555-5555-4555-8555-555555555555",
    operation: "update",
    before_snapshot: { status: "open" },
    proposed_diff: { status: "paused" },
    after_snapshot: { status: "paused" },
    status: "pending",
    rationale: "Pause the evidence item until the owner revisits it.",
    provenance: { origin: "fixture" },
    lifecycle_status: "active",
    created_at: timestamps.created_at,
    updated_at: timestamps.updated_at,
    ...overrides,
  };
}

function approval(overrides: Partial<CustodianApproval> = {}): CustodianApproval {
  return { ...mapCustodianApprovalRow(approvalRow()), ...overrides };
}

describe("Custodian owner-gate mapping", () => {
  test("maps an approval, proposal, run, and policy without exposing owner identifiers", () => {
    const mapped = mapCustodianApprovalRow(approvalRow());
    expect(mapped).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      caseId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      idempotencyKey: "gate-1",
      approvalKind: "tool_action",
      status: "pending",
      title: "Inspectable proposed action",
      rationale: "The finding identified a bounded internal change.",
      proposedDiff: { field: "status", from: "open", to: "paused" },
      toolAction: { operation_class: "evidence_write", tool_name: "record_evidence" },
      exactActionHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      responseNote: null,
      requestedAt: "2026-09-21T14:00:00.000Z",
      respondedAt: null,
      expiresAt: "2026-09-22T14:00:00.000Z",
      provenance: { origin: "fixture" },
      lifecycleStatus: "active",
      createdAt: "2026-09-21T14:00:00.000Z",
      updatedAt: "2026-09-21T14:00:01.000Z",
    });
    expect(mapped).not.toHaveProperty("ownerId");
    expect(toolActionClass(mapped.toolAction)).toBe("evidence_write");

    const proposal = mapCustodianChangeProposalRow(proposalRow());
    expect(proposal.targetType).toBe("evidence_item");
    expect(proposal.beforeSnapshot).toEqual({ status: "open" });
    expect(proposal.afterSnapshot).toEqual({ status: "paused" });

    const run = mapCustodianApprovalRunRow({
      id: "33333333-3333-4333-8333-333333333333",
      case_id: "22222222-2222-4222-8222-222222222222",
      status: "awaiting_approval",
      tool_policy_id: "66666666-6666-4666-8666-666666666666",
      failure_code: null,
      failure_message: null,
    });
    expect(run.toolPolicyId).toBe("66666666-6666-4666-8666-666666666666");

    const policy = mapCustodianApprovalPolicyRow({
      id: "66666666-6666-4666-8666-666666666666",
      case_id: "22222222-2222-4222-8222-222222222222",
      policy_name: "Case policy",
      status: "active",
      kill_switch: false,
    });
    expect(policy.name).toBe("Case policy");
    expect(CUSTODIAN_APPROVAL_READ_LIMIT).toBe(100);
  });

  test("rejects malformed status, hash, and payload shapes", () => {
    expect(() => mapCustodianApprovalRow({ ...approvalRow(), status: "success" })).toThrow(
      "status",
    );
    expect(() =>
      mapCustodianApprovalRow({ ...approvalRow(), exact_action_hash: "not-a-hash" }),
    ).toThrow("exact_action_hash");
    expect(() =>
      mapCustodianApprovalRow({ ...approvalRow(), proposed_diff: ["not-an-object"] }),
    ).toThrow("proposed_diff");
  });
});

describe("Custodian owner-gate presentation", () => {
  const now = new Date("2026-09-21T18:00:00.000Z");

  test("keeps pending, deferred, rejected, expired, cancelled, and approved states distinct", () => {
    expect(presentOwnerGate(approval(), { now })).toBe("awaiting_decision");
    expect(presentOwnerGate(approval({ status: "deferred" }), { now })).toBe("deferred");
    expect(presentOwnerGate(approval({ status: "rejected" }), { now })).toBe("rejected");
    expect(presentOwnerGate(approval({ status: "cancelled" }), { now })).toBe("cancelled");
    expect(presentOwnerGate(approval({ status: "expired" }), { now })).toBe("expired");
    expect(presentOwnerGate(approval({ status: "approved" }), { now })).toBe(
      "approved_execution_unavailable",
    );
  });

  test("treats a still-pending request as expired once its deadline has passed", () => {
    const expiredPending = approval({ expiresAt: "2026-09-21T17:00:00.000Z" });
    expect(isApprovalExpired(expiredPending, now)).toBe(true);
    expect(presentOwnerGate(expiredPending, { now })).toBe("expired");
    expect(
      presentOwnerGate(approval({ status: "deferred", expiresAt: "2026-09-21T17:00:00.000Z" }), {
        now,
      }),
    ).toBe("expired");
  });

  test("requires a new gate when the inspected action hash no longer matches", () => {
    expect(
      presentOwnerGate(approval(), {
        now,
        inspectedHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ).toBe("action_changed");
    expect(
      ownerGateAllowsDecision(
        presentOwnerGate(approval(), {
          now,
          inspectedHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        }),
        "approved",
      ),
    ).toBe(false);
  });

  test("allows owner decisions only while the gate is still answerable", () => {
    expect(ownerGateAllowsDecision("awaiting_decision", "approved")).toBe(true);
    expect(ownerGateAllowsDecision("awaiting_decision", "deferred")).toBe(true);
    expect(ownerGateAllowsDecision("deferred", "approved")).toBe(true);
    expect(ownerGateAllowsDecision("deferred", "deferred")).toBe(false);
    expect(ownerGateAllowsDecision("rejected", "approved")).toBe(false);
    expect(ownerGateAllowsDecision("approved_execution_unavailable", "approved")).toBe(false);
    expect(ownerGateAllowsDecision("expired", "expired", "pending")).toBe(true);
    expect(ownerGateAllowsDecision("expired", "cancelled", "deferred")).toBe(true);
    expect(ownerGateAllowsDecision("expired", "approved", "pending")).toBe(false);
    expect(ownerGateAllowsDecision("expired", "expired", "expired")).toBe(false);
    expect(ownerGateAllowsDecision("action_changed", "approved")).toBe(false);
  });

  test("keeps execution unavailable for every current approval kind", () => {
    expect(CUSTODIAN_OWNER_GATE_CAN_EXECUTE).toBe(false);
    expect(ownerGateExecutionUnavailableReason("tool_action")).toContain(
      "No internal V1 execution class",
    );
    expect(ownerGateExecutionUnavailableReason("external_write")).toContain("External execution");
    expect(ownerGateExecutionUnavailableReason("archive_change")).toContain(
      "Canonical archive mutation",
    );
  });

  test("refuses a decision when the inspected hash no longer matches the current hash", () => {
    expect(() =>
      assertOwnerGateDecision({
        approvalId: "11111111-1111-4111-8111-111111111111",
        decision: "approved",
        inspectedHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        currentHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ).toThrow("new owner gate is required");
    expect(() =>
      assertOwnerGateDecision({
        approvalId: "11111111-1111-4111-8111-111111111111",
        decision: "approved",
        inspectedHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        currentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).not.toThrow();
    expect(
      ownerGateIdempotencyKey(
        "11111111-1111-4111-8111-111111111111",
        "rejected",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toBe(
      "owner-gate:11111111-1111-4111-8111-111111111111:rejected:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });
});

describe("Custodian owner-gate assembly", () => {
  test("joins proposal, case/run, and policy without inventing missing rows", () => {
    const items = assembleOwnerGateItems(
      [mapCustodianApprovalRow(approvalRow())],
      [mapCustodianChangeProposalRow(proposalRow())],
      [
        mapCustodianApprovalRunRow({
          id: "33333333-3333-4333-8333-333333333333",
          case_id: "22222222-2222-4222-8222-222222222222",
          status: "awaiting_approval",
          tool_policy_id: "66666666-6666-4666-8666-666666666666",
          failure_code: null,
          failure_message: null,
        }),
      ],
      [
        mapCustodianApprovalPolicyRow({
          id: "66666666-6666-4666-8666-666666666666",
          case_id: "22222222-2222-4222-8222-222222222222",
          policy_name: "Case policy",
          status: "active",
          kill_switch: false,
        }),
      ],
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.proposal?.id).toBe("44444444-4444-4444-8444-444444444444");
    expect(items[0]?.run?.status).toBe("awaiting_approval");
    expect(items[0]?.policy?.name).toBe("Case policy");

    const orphan = assembleOwnerGateItems(
      [mapCustodianApprovalRow(approvalRow({ run_id: null }))],
      [],
      [],
      [],
    );
    expect(orphan[0]?.proposal).toBeNull();
    expect(orphan[0]?.run).toBeNull();
    expect(orphan[0]?.policy).toBeNull();
  });

  test("filters awaiting, deferred, expired, and decided gates without collapsing them", () => {
    const now = new Date("2026-09-21T18:00:00.000Z");
    const items = [
      { approval: approval(), proposal: null, run: null, policy: null },
      {
        approval: approval({
          id: "deferred",
          status: "deferred",
        }),
        proposal: null,
        run: null,
        policy: null,
      },
      {
        approval: approval({ id: "rejected", status: "rejected" }),
        proposal: null,
        run: null,
        policy: null,
      },
      {
        approval: approval({
          id: "expired",
          expiresAt: "2026-09-21T17:00:00.000Z",
        }),
        proposal: null,
        run: null,
        policy: null,
      },
    ];
    expect(filterOwnerGateItems(items, "awaiting", now).map((item) => item.approval.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(
      filterOwnerGateItems(items, "deferred", now).map((item) => item.approval.status),
    ).toEqual(["deferred"]);
    expect(filterOwnerGateItems(items, "expired", now).map((item) => item.approval.id)).toEqual([
      "expired",
    ]);
    expect(filterOwnerGateItems(items, "decided", now).map((item) => item.approval.status)).toEqual(
      ["rejected"],
    );
  });

  test("does not invent a proposal when only an approval exists", () => {
    const proposal = proposalRow() as unknown as CustodianChangeProposal;
    expect(proposal).not.toHaveProperty("executionResult");
  });
});
