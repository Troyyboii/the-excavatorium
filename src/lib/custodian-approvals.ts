import { useQuery } from "@tanstack/react-query";
import { CustodianFoundationMissingError, isCustodianFoundationMissing } from "./custodian";
import {
  APPROVAL_KINDS,
  APPROVAL_STATUSES,
  CHANGE_PROPOSAL_OPERATIONS,
  CHANGE_PROPOSAL_STATUSES,
  CHANGE_PROPOSAL_TARGET_TYPES,
  CUSTODIAN_OWNER_GATE_CAN_EXECUTE,
  CUSTODIAN_V1_INTERNAL_EXECUTION_CLASS,
  OWNER_GATE_DECISIONS,
  isRuntimeRunState,
  type ApprovalKind,
  type ApprovalStatus,
  type ChangeProposalOperation,
  type ChangeProposalStatus,
  type ChangeProposalTargetType,
  type JsonObject,
  type OwnerGateDecision,
  type OwnerGatePresentation,
  type RuntimeRunState,
} from "./custodian-runtime-types";
import { useCurrentUserId } from "./session";
import { supabase } from "./supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_HASH_PATTERN = /^[0-9a-fA-F]{32}$/;

export const CUSTODIAN_APPROVAL_READ_LIMIT = 100;
export const OWNER_GATE_RESPONSE_NOTE_MAX = 10_000;

export {
  CUSTODIAN_OWNER_GATE_CAN_EXECUTE,
  CUSTODIAN_V1_INTERNAL_EXECUTION_CLASS,
  OWNER_GATE_DECISIONS,
};

export const OWNER_GATE_FILTERS = ["all", "awaiting", "deferred", "decided", "expired"] as const;
export type OwnerGateFilter = (typeof OWNER_GATE_FILTERS)[number];

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a database row object`);
  }
  return value as UnknownRecord;
}

function text(row: UnknownRecord, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Custodian ${key} must be text`);
  return value;
}

function nullableText(row: UnknownRecord, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new Error(`Custodian ${key} must be text or null`);
  }
  return value as string | null;
}

function jsonObject(row: UnknownRecord, key: string): JsonObject {
  const value = row[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Custodian ${key} must be a JSON object`);
  }
  return value as JsonObject;
}

function timestamp(row: UnknownRecord, key: string): string {
  const value = text(row, key);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Custodian ${key} is invalid`);
  return parsed.toISOString();
}

function nullableTimestamp(row: UnknownRecord, key: string): string | null {
  const value = nullableText(row, key);
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Custodian ${key} is invalid`);
  return parsed.toISOString();
}

function enumValue<T extends string>(row: UnknownRecord, key: string, values: readonly T[]): T {
  const value = text(row, key);
  if (!values.includes(value as T)) throw new Error(`Custodian ${key} has an invalid value`);
  return value as T;
}

function requireUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`A valid ${field} is required`);
  return value;
}

function requireActionHash(value: string, field = "exact_action_hash"): string {
  if (!ACTION_HASH_PATTERN.test(value))
    throw new Error(`${field} must be a 32-character hex digest`);
  return value;
}

export function isApprovalStatus(value: string): value is ApprovalStatus {
  return (APPROVAL_STATUSES as readonly string[]).includes(value);
}

export function isOwnerGateDecision(value: string): value is OwnerGateDecision {
  return (OWNER_GATE_DECISIONS as readonly string[]).includes(value);
}

export type CustodianApproval = {
  id: string;
  caseId: string;
  runId: string | null;
  idempotencyKey: string;
  approvalKind: ApprovalKind;
  status: ApprovalStatus;
  title: string;
  rationale: string;
  proposedDiff: JsonObject;
  toolAction: JsonObject;
  exactActionHash: string;
  responseNote: string | null;
  requestedAt: string;
  respondedAt: string | null;
  expiresAt: string | null;
  provenance: JsonObject;
  lifecycleStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type CustodianChangeProposal = {
  id: string;
  caseId: string;
  runId: string | null;
  approvalRequestId: string | null;
  idempotencyKey: string;
  targetType: ChangeProposalTargetType;
  targetId: string | null;
  operation: ChangeProposalOperation;
  beforeSnapshot: JsonObject;
  proposedDiff: JsonObject;
  afterSnapshot: JsonObject;
  status: ChangeProposalStatus;
  rationale: string;
  provenance: JsonObject;
  lifecycleStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type CustodianApprovalRun = {
  id: string;
  caseId: string;
  status: RuntimeRunState;
  toolPolicyId: string;
  failureCode: string | null;
  failureMessage: string | null;
};

export type CustodianApprovalPolicy = {
  id: string;
  caseId: string | null;
  name: string;
  status: string;
  killSwitch: boolean;
};

export type OwnerGateItem = {
  approval: CustodianApproval;
  proposal: CustodianChangeProposal | null;
  run: CustodianApprovalRun | null;
  policy: CustodianApprovalPolicy | null;
};

const APPROVAL_SELECT =
  "id,case_id,run_id,idempotency_key,approval_kind,status,title,rationale,proposed_diff,tool_action,exact_action_hash,response_note,requested_at,responded_at,expires_at,provenance,lifecycle_status,created_at,updated_at";
const PROPOSAL_SELECT =
  "id,case_id,run_id,approval_request_id,idempotency_key,target_type,target_id,operation,before_snapshot,proposed_diff,after_snapshot,status,rationale,provenance,lifecycle_status,created_at,updated_at";
const RUN_SELECT = "id,case_id,status,tool_policy_id,failure_code,failure_message";
const POLICY_SELECT = "id,case_id,policy_name,status,kill_switch";

export function mapCustodianApprovalRow(value: unknown): CustodianApproval {
  const row = record(value, "approval request");
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    runId: nullableText(row, "run_id"),
    idempotencyKey: text(row, "idempotency_key"),
    approvalKind: enumValue(row, "approval_kind", APPROVAL_KINDS),
    status: enumValue(row, "status", APPROVAL_STATUSES),
    title: text(row, "title"),
    rationale: text(row, "rationale"),
    proposedDiff: jsonObject(row, "proposed_diff"),
    toolAction: jsonObject(row, "tool_action"),
    exactActionHash: requireActionHash(text(row, "exact_action_hash")),
    responseNote: nullableText(row, "response_note"),
    requestedAt: timestamp(row, "requested_at"),
    respondedAt: nullableTimestamp(row, "responded_at"),
    expiresAt: nullableTimestamp(row, "expires_at"),
    provenance: jsonObject(row, "provenance"),
    lifecycleStatus: text(row, "lifecycle_status"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapCustodianChangeProposalRow(value: unknown): CustodianChangeProposal {
  const row = record(value, "change proposal");
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    runId: nullableText(row, "run_id"),
    approvalRequestId: nullableText(row, "approval_request_id"),
    idempotencyKey: text(row, "idempotency_key"),
    targetType: enumValue(row, "target_type", CHANGE_PROPOSAL_TARGET_TYPES),
    targetId: nullableText(row, "target_id"),
    operation: enumValue(row, "operation", CHANGE_PROPOSAL_OPERATIONS),
    beforeSnapshot: jsonObject(row, "before_snapshot"),
    proposedDiff: jsonObject(row, "proposed_diff"),
    afterSnapshot: jsonObject(row, "after_snapshot"),
    status: enumValue(row, "status", CHANGE_PROPOSAL_STATUSES),
    rationale: text(row, "rationale"),
    provenance: jsonObject(row, "provenance"),
    lifecycleStatus: text(row, "lifecycle_status"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapCustodianApprovalRunRow(value: unknown): CustodianApprovalRun {
  const row = record(value, "approval run");
  const status = text(row, "status");
  if (!isRuntimeRunState(status)) throw new Error("Custodian run status is invalid");
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    status,
    toolPolicyId: text(row, "tool_policy_id"),
    failureCode: nullableText(row, "failure_code"),
    failureMessage: nullableText(row, "failure_message"),
  };
}

export function mapCustodianApprovalPolicyRow(value: unknown): CustodianApprovalPolicy {
  const row = record(value, "tool policy");
  const killSwitch = row.kill_switch;
  if (typeof killSwitch !== "boolean") throw new Error("Custodian kill_switch must be boolean");
  return {
    id: text(row, "id"),
    caseId: nullableText(row, "case_id"),
    name: text(row, "policy_name"),
    status: text(row, "status"),
    killSwitch,
  };
}

export function toolActionClass(toolAction: JsonObject): string | null {
  const value = toolAction.operation_class ?? toolAction.operationClass;
  return typeof value === "string" && value.trim() ? value : null;
}

export function isApprovalExpired(approval: CustodianApproval, now: Date): boolean {
  if (approval.status === "expired") return true;
  if (approval.status !== "pending" && approval.status !== "deferred") return false;
  if (!approval.expiresAt) return false;
  return new Date(approval.expiresAt).getTime() <= now.getTime();
}

export function presentOwnerGate(
  approval: CustodianApproval,
  options: { now?: Date; inspectedHash?: string | null } = {},
): OwnerGatePresentation {
  const now = options.now ?? new Date();
  if (options.inspectedHash && options.inspectedHash !== approval.exactActionHash) {
    return "action_changed";
  }
  if (!ACTION_HASH_PATTERN.test(approval.exactActionHash)) return "invalid";
  if (approval.status === "rejected") return "rejected";
  if (approval.status === "cancelled") return "cancelled";
  if (approval.status === "approved") return "approved_execution_unavailable";
  if (isApprovalExpired(approval, now)) return "expired";
  if (approval.status === "deferred") return "deferred";
  if (approval.status === "pending") return "awaiting_decision";
  return "invalid";
}

export function ownerGateAllowsDecision(
  presentation: OwnerGatePresentation,
  decision: OwnerGateDecision,
  status?: ApprovalStatus,
): boolean {
  if (presentation === "awaiting_decision") return true;
  if (presentation === "deferred") return decision !== "deferred";
  if (presentation === "expired" && (status === "pending" || status === "deferred")) {
    return decision === "expired" || decision === "cancelled";
  }
  return false;
}

export function ownerGateExecutionUnavailableReason(kind: ApprovalKind): string {
  if (kind === "external_write") {
    return "External execution is unsupported. Approval does not override that block.";
  }
  if (kind === "canonical_write" || kind === "archive_change") {
    return "Canonical archive mutation is not authorized. Approval does not grant a write path.";
  }
  return "No internal V1 execution class has been selected. Approval records the decision only.";
}

export function ownerGateIdempotencyKey(
  approvalId: string,
  decision: OwnerGateDecision,
  exactActionHash: string,
): string {
  return `owner-gate:${approvalId}:${decision}:${exactActionHash}`;
}

export function filterOwnerGateItems(
  items: readonly OwnerGateItem[],
  filter: OwnerGateFilter,
  now = new Date(),
): OwnerGateItem[] {
  return items.filter((item) => {
    const presentation = presentOwnerGate(item.approval, { now });
    if (filter === "all") return true;
    if (filter === "awaiting") return presentation === "awaiting_decision";
    if (filter === "deferred") return presentation === "deferred";
    if (filter === "expired") return presentation === "expired";
    return (
      presentation === "rejected" ||
      presentation === "cancelled" ||
      presentation === "approved_execution_unavailable"
    );
  });
}

export function assembleOwnerGateItems(
  approvals: readonly CustodianApproval[],
  proposals: readonly CustodianChangeProposal[],
  runs: readonly CustodianApprovalRun[],
  policies: readonly CustodianApprovalPolicy[],
): OwnerGateItem[] {
  const proposalByApproval = new Map<string, CustodianChangeProposal>();
  for (const proposal of proposals) {
    if (!proposal.approvalRequestId) continue;
    const existing = proposalByApproval.get(proposal.approvalRequestId);
    if (!existing || existing.createdAt <= proposal.createdAt) {
      proposalByApproval.set(proposal.approvalRequestId, proposal);
    }
  }
  const runById = new Map(runs.map((run) => [run.id, run]));
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));
  return approvals.map((approval) => {
    const run = approval.runId ? (runById.get(approval.runId) ?? null) : null;
    const policy = run ? (policyById.get(run.toolPolicyId) ?? null) : null;
    return {
      approval,
      proposal: proposalByApproval.get(approval.id) ?? null,
      run,
      policy,
    };
  });
}

export const custodianApprovalsKey = (userId: string | null) =>
  ["custodian", "approvals", userId ?? "__anonymous__"] as const;

async function readMappedRows<T>(
  request: PromiseLike<{ data: unknown; error: unknown }>,
  mapper: (value: unknown) => T,
  table: string,
): Promise<T[]> {
  const { data, error } = await request;
  if (error) {
    if (isCustodianFoundationMissing(error)) throw new CustodianFoundationMissingError();
    throw error;
  }
  if (!Array.isArray(data)) throw new Error(`Custodian ${table} read returned no data`);
  return data.map(mapper);
}

export async function fetchOwnerGateItems(ownerId: string): Promise<OwnerGateItem[]> {
  requireUuid(ownerId, "owner");
  const approvals = await readMappedRows(
    supabase
      .from("approval_requests")
      .select(APPROVAL_SELECT)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(CUSTODIAN_APPROVAL_READ_LIMIT),
    mapCustodianApprovalRow,
    "approval_requests",
  );
  if (approvals.length === 0) return [];

  const approvalIds = approvals.map((approval) => approval.id);
  const runIds = [
    ...new Set(
      approvals
        .map((approval) => approval.runId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const [proposals, runs] = await Promise.all([
    readMappedRows(
      supabase
        .from("change_proposals")
        .select(PROPOSAL_SELECT)
        .eq("owner_id", ownerId)
        .in("approval_request_id", approvalIds)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(CUSTODIAN_APPROVAL_READ_LIMIT),
      mapCustodianChangeProposalRow,
      "change_proposals",
    ),
    runIds.length
      ? readMappedRows(
          supabase
            .from("agent_runs")
            .select(RUN_SELECT)
            .eq("owner_id", ownerId)
            .in("id", runIds)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(CUSTODIAN_APPROVAL_READ_LIMIT),
          mapCustodianApprovalRunRow,
          "agent_runs",
        )
      : Promise.resolve([] as CustodianApprovalRun[]),
  ]);

  const policyIds = [...new Set(runs.map((run) => run.toolPolicyId))];
  const policies = policyIds.length
    ? await readMappedRows(
        supabase
          .from("tool_policies")
          .select(POLICY_SELECT)
          .eq("owner_id", ownerId)
          .in("id", policyIds)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(CUSTODIAN_APPROVAL_READ_LIMIT),
        mapCustodianApprovalPolicyRow,
        "tool_policies",
      )
    : [];

  return assembleOwnerGateItems(approvals, proposals, runs, policies);
}

export function useCustodianOwnerGates(enabled = true) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: custodianApprovalsKey(userId),
    enabled: enabled && userId !== null,
    staleTime: 5_000,
    retry: (failureCount, error) => !isCustodianFoundationMissing(error) && failureCount < 2,
    queryFn: () => fetchOwnerGateItems(userId as string),
  });
}

export type OwnerGateDecisionInput = {
  approvalId: string;
  decision: OwnerGateDecision;
  responseNote?: string;
  inspectedHash: string;
  currentHash: string;
};

export type OwnerGateDecisionResult = {
  approval: CustodianApproval;
  runStatus: RuntimeRunState | null;
  idempotent: boolean;
  presentation: OwnerGatePresentation;
  executionAvailable: false;
};

function mapRpcApprovalPayload(value: unknown): {
  approval: CustodianApproval;
  runStatus: RuntimeRunState | null;
  idempotent: boolean;
} {
  const payload = record(value, "approval response");
  const approval = mapCustodianApprovalRow(payload.approval);
  const idempotent = payload.idempotent;
  if (typeof idempotent !== "boolean") throw new Error("Custodian approval replay flag is invalid");
  let runStatus: RuntimeRunState | null = null;
  if (payload.run !== null && payload.run !== undefined) {
    const run = record(payload.run, "approval run");
    const status = text(run, "status");
    if (!isRuntimeRunState(status)) throw new Error("Custodian run status is invalid");
    runStatus = status;
  }
  return { approval, runStatus, idempotent };
}

export function assertOwnerGateDecision(input: OwnerGateDecisionInput): void {
  if (!isOwnerGateDecision(input.decision)) throw new Error("approval decision is not allowed");
  requireUuid(input.approvalId, "approval_request_id");
  const inspected = requireActionHash(input.inspectedHash, "inspected exact action hash");
  const current = requireActionHash(input.currentHash, "current exact action hash");
  if (inspected !== current) {
    throw new Error(
      "The proposed action changed after it was inspected. A new owner gate is required.",
    );
  }
  const note = input.responseNote ?? "";
  if (note.length > OWNER_GATE_RESPONSE_NOTE_MAX) {
    throw new Error("response_note exceeds the maximum length");
  }
  if (CUSTODIAN_OWNER_GATE_CAN_EXECUTE) {
    throw new Error("Owner-gate execution was unexpectedly enabled");
  }
}

export async function respondCustodianOwnerGate(
  input: OwnerGateDecisionInput,
  now = new Date(),
): Promise<OwnerGateDecisionResult> {
  assertOwnerGateDecision(input);
  const { data, error } = await supabase.rpc("custodian_respond_approval", {
    approval_request_id: input.approvalId,
    decision: input.decision,
    response_note: input.responseNote ?? "",
    idempotency_key: ownerGateIdempotencyKey(input.approvalId, input.decision, input.inspectedHash),
    expected_action_hash: input.inspectedHash,
  });
  if (error) {
    if (isCustodianFoundationMissing(error)) throw new CustodianFoundationMissingError();
    throw new Error(error.message);
  }
  const mapped = mapRpcApprovalPayload(data);
  return {
    ...mapped,
    presentation: presentOwnerGate(mapped.approval, {
      now,
      inspectedHash: input.inspectedHash,
    }),
    executionAvailable: false,
  };
}
