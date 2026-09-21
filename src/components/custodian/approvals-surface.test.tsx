// Bun supplies this module at test runtime; it is not part of the app's type surface.
// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OwnerGateItem } from "@/lib/custodian-approvals";
import { mapCustodianApprovalRow, mapCustodianChangeProposalRow } from "@/lib/custodian-approvals";
import { ApprovalsSurface } from "./approvals-surface";

afterEach(() => cleanup());

const now = new Date("2026-09-21T18:00:00.000Z");

function item(overrides: Record<string, unknown> = {}): OwnerGateItem {
  return {
    approval: mapCustodianApprovalRow({
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
      requested_at: "2026-09-21T14:00:00.000Z",
      responded_at: null,
      expires_at: "2026-09-22T14:00:00.000Z",
      provenance: { origin: "fixture" },
      lifecycle_status: "active",
      created_at: "2026-09-21T14:00:00.000Z",
      updated_at: "2026-09-21T14:00:01.000Z",
      ...overrides,
    }),
    proposal: mapCustodianChangeProposalRow({
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
      created_at: "2026-09-21T14:00:00.000Z",
      updated_at: "2026-09-21T14:00:01.000Z",
    }),
    run: {
      id: "33333333-3333-4333-8333-333333333333",
      caseId: "22222222-2222-4222-8222-222222222222",
      status: "awaiting_approval",
      toolPolicyId: "66666666-6666-4666-8666-666666666666",
      failureCode: null,
      failureMessage: null,
    },
    policy: {
      id: "66666666-6666-4666-8666-666666666666",
      caseId: "22222222-2222-4222-8222-222222222222",
      name: "Case policy",
      status: "active",
      killSwitch: false,
    },
  };
}

describe("Approvals owner-gate surface", () => {
  test("keeps empty, error, and foundation-pending states truthful", () => {
    const { rerender } = render(
      <ApprovalsSurface items={[]} now={now} onDecide={mock(() => undefined)} />,
    );
    expect(screen.getByText("No approval requests.")).not.toBeNull();
    expect(screen.getByText(/does not invent a pending decision/)).not.toBeNull();

    rerender(
      <ApprovalsSurface
        error="Custodian runtime storage is unavailable in the connected Supabase project."
        now={now}
        onDecide={mock(() => undefined)}
      />,
    );
    expect(screen.getByText(/runtime storage is unavailable/)).not.toBeNull();
    expect(screen.queryByText("Inspectable proposed action")).toBeNull();
  });

  test("renders an inspectable pending proposal and requires confirmation before a decision", async () => {
    const onDecide = mock(() => Promise.resolve());
    const user = userEvent.setup();
    render(<ApprovalsSurface items={[item()]} now={now} onDecide={onDecide} />);

    expect(screen.getByText("Awaiting owner decision")).not.toBeNull();
    expect(screen.getByText("Inspectable proposed action")).not.toBeNull();
    expect(screen.getByText("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).not.toBeNull();
    expect(screen.getAllByText(/evidence_write/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Case policy/)).not.toBeNull();
    expect(
      screen.getAllByText(/No internal V1 execution class has been selected/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reject" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Defer" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm decision" }));
    expect(onDecide).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("checkbox", {
        name: /I inspected exact action hash aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm decision" }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    const request = onDecide.mock.calls[0]?.[0] as { decision: string; inspectedHash: string };
    expect(request.decision).toBe("approved");
    expect(request.inspectedHash).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  test("distinguishes rejected, deferred, expired, and approved-unavailable states", () => {
    const { rerender } = render(
      <ApprovalsSurface
        items={[item({ status: "rejected", response_note: "Not this action." })]}
        now={now}
        onDecide={mock(() => undefined)}
      />,
    );
    expect(screen.getByText("Rejected")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText(/No further owner decision is available/)).not.toBeNull();

    rerender(
      <ApprovalsSurface
        items={[item({ status: "deferred" })]}
        now={now}
        onDecide={mock(() => undefined)}
      />,
    );
    expect(screen.getAllByText("Deferred").length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Defer" })).toBeNull();

    rerender(
      <ApprovalsSurface
        items={[item({ expires_at: "2026-09-21T17:00:00.000Z" })]}
        now={now}
        onDecide={mock(() => undefined)}
      />,
    );
    expect(screen.getAllByText("Expired").length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark expired" })).not.toBeNull();

    rerender(
      <ApprovalsSurface
        items={[item({ status: "expired" })]}
        now={now}
        onDecide={mock(() => undefined)}
      />,
    );
    expect(screen.getAllByText("Expired").length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Mark expired" })).toBeNull();
    expect(screen.getByText(/No further owner decision is available/)).not.toBeNull();

    rerender(
      <ApprovalsSurface
        items={[item({ status: "approved" })]}
        now={now}
        onDecide={mock(() => undefined)}
      />,
    );
    expect(screen.getByText("Approved — execution unavailable")).not.toBeNull();
    expect(
      screen.getByText(/The owner approved this exact action. Execution remains unavailable./),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  test("requires a new gate when the persisted action hash changes after inspection", () => {
    const { rerender } = render(
      <ApprovalsSurface items={[item()]} now={now} onDecide={mock(() => undefined)} />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeNull();

    rerender(
      <ApprovalsSurface
        items={[item({ exact_action_hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })]}
        now={now}
        onDecide={mock(() => undefined)}
      />,
    );
    expect(screen.getByText("Action changed after inspection")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
