import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useCurrentUserId } from "./session";
import {
  ACTION_STATUSES,
  CASE_STATUSES,
  CLAIM_STATUSES,
  EVIDENCE_LIFECYCLE_STATUSES,
  FINDING_ANALYSIS_MODES,
  FINDING_EVIDENCE_RELATIONSHIP_KINDS,
  FINDING_ANALYSIS_OUTCOMES,
  FINDING_ORIGIN_KINDS,
  FINDING_STATUSES,
  INBOX_KINDS,
  INBOX_STATUSES,
  LIFECYCLE_STATUSES,
  SOURCE_CLASSIFICATIONS,
  type ActionRow,
  type ActionStatus,
  type CaseArchiveScope,
  type CaseMember,
  type CaseMemberRow,
  type CaseStatus,
  type Claim,
  type ClaimEvidence,
  type ClaimEvidenceRow,
  type ClaimRow,
  type ClaimStatus,
  type CustodianAction,
  type CustodianCase,
  type CustodianCaseRow,
  type CustodianFinding,
  type CustodianFindingEvidence,
  type CustodianFindingEvidenceRow,
  type CustodianFindingRow,
  type CustodianRecordContext,
  type EvidenceItem,
  type EvidenceItemRow,
  type EvidenceLifecycleStatus,
  type FindingAnalysisMode,
  type FindingStatus,
  type InboxItem,
  type InboxItemRow,
  type InboxKind,
  type InboxStatus,
  type JsonValue,
  type LifecycleStatus,
  type RecordRevision,
  type RecordRevisionRow,
  type SourceClassification,
} from "./custodian-types";
import { caseArchiveScopePayload, parseCaseArchiveScope } from "./custodian-surfaces";

export const CUSTODIAN_PAGE_SIZE = 500;
export type CustodianResource =
  | "cases"
  | "inbox_items"
  | "case_members"
  | "claims"
  | "evidence_items"
  | "claim_evidence"
  | "actions"
  | "custodian_findings"
  | "custodian_finding_evidence"
  | "record_revisions";

export type CustodianCollectionOptions = {
  pageSize?: number;
  maxPages?: number;
  sourceRecordId?: string;
  ids?: readonly string[];
  claimIds?: readonly string[];
  evidenceIds?: readonly string[];
  findingIds?: readonly string[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a database row object`);
  }
  return value as UnknownRecord;
}

function text(row: UnknownRecord, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Custodian row field ${key} must be text`);
  return value;
}

function nullableText(row: UnknownRecord, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new Error(`Custodian row field ${key} must be text or null`);
  }
  return value as string | null;
}

function numberValue(row: UnknownRecord, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Custodian row field ${key} must be a finite number`);
  }
  return value;
}

function booleanValue(row: UnknownRecord, key: string): boolean {
  if (typeof row[key] !== "boolean") throw new Error(`Custodian row field ${key} must be boolean`);
  return row[key] as boolean;
}

function jsonValue(row: UnknownRecord, key: string): JsonValue {
  const value = row[key];
  if (value === undefined) throw new Error(`Custodian row field ${key} is missing`);
  return value as JsonValue;
}

function jsonObject(row: UnknownRecord, key: string): { [key: string]: JsonValue } {
  const value = jsonValue(row, key);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Custodian row field ${key} must be a JSON object`);
  }
  return value as { [key: string]: JsonValue };
}

function jsonArray(row: UnknownRecord, key: string): JsonValue[] {
  const value = jsonValue(row, key);
  if (!Array.isArray(value)) throw new Error(`Custodian row field ${key} must be a JSON array`);
  return value as JsonValue[];
}

function stringArray(row: UnknownRecord, key: string): string[] {
  const value = jsonArray(row, key);
  if (!value.every((item) => typeof item === "string")) {
    throw new Error(`Custodian row field ${key} must be an array of strings`);
  }
  return value as string[];
}

function timestamp(row: UnknownRecord, key: string): string {
  const value = text(row, key);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`Custodian row field ${key} is not a timestamp`);
  return parsed.toISOString();
}

function enumValue<T extends string>(row: UnknownRecord, key: string, values: readonly T[]): T {
  const value = text(row, key);
  if (!values.includes(value as T))
    throw new Error(`Custodian row field ${key} has invalid enum value`);
  return value as T;
}

function owner(row: UnknownRecord): string {
  return text(row, "owner_id");
}

export function isInboxKind(value: unknown): value is InboxKind {
  return typeof value === "string" && (INBOX_KINDS as readonly string[]).includes(value);
}
export function isInboxStatus(value: unknown): value is InboxStatus {
  return typeof value === "string" && (INBOX_STATUSES as readonly string[]).includes(value);
}
export function isCaseStatus(value: unknown): value is CaseStatus {
  return typeof value === "string" && (CASE_STATUSES as readonly string[]).includes(value);
}
export function isClaimStatus(value: unknown): value is ClaimStatus {
  return typeof value === "string" && (CLAIM_STATUSES as readonly string[]).includes(value);
}
export function isLifecycleStatus(value: unknown): value is LifecycleStatus {
  return typeof value === "string" && (LIFECYCLE_STATUSES as readonly string[]).includes(value);
}
export function isEvidenceLifecycleStatus(value: unknown): value is EvidenceLifecycleStatus {
  return (
    typeof value === "string" && (EVIDENCE_LIFECYCLE_STATUSES as readonly string[]).includes(value)
  );
}
export function isSourceClassification(value: unknown): value is SourceClassification {
  return typeof value === "string" && (SOURCE_CLASSIFICATIONS as readonly string[]).includes(value);
}
export function isActionStatus(value: unknown): value is ActionStatus {
  return typeof value === "string" && (ACTION_STATUSES as readonly string[]).includes(value);
}
export function isFindingAnalysisMode(value: unknown): value is FindingAnalysisMode {
  return typeof value === "string" && (FINDING_ANALYSIS_MODES as readonly string[]).includes(value);
}
export function isFindingStatus(value: unknown): value is FindingStatus {
  return typeof value === "string" && (FINDING_STATUSES as readonly string[]).includes(value);
}

export function mapCustodianCaseRow(value: unknown): CustodianCase {
  const row = asRecord(value, "case");
  owner(row);
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    objective: text(row, "objective"),
    currentQuestion: text(row, "current_question"),
    defaultWorkingSet: jsonArray(row, "default_working_set"),
    archiveScope: parseCaseArchiveScope(jsonValue(row, "archive_scope")),
    status: enumValue(row, "status", CASE_STATUSES),
    closedAt: nullableText(row, "closed_at"),
    createdBy: text(row, "created_by"),
    updatedBy: text(row, "updated_by"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapInboxItemRow(value: unknown): InboxItem {
  const row = asRecord(value, "inbox item");
  owner(row);
  const promotedKind = nullableText(row, "promoted_kind");
  if (
    promotedKind !== null &&
    !["claim", "evidence_item", "action", "custodian_finding"].includes(promotedKind)
  ) {
    throw new Error("Custodian inbox row has an invalid promoted kind");
  }
  return {
    id: text(row, "id"),
    kind: enumValue(row, "kind", INBOX_KINDS),
    rawContent: text(row, "raw_content"),
    title: text(row, "title"),
    candidate: jsonObject(row, "candidate"),
    status: enumValue(row, "status", INBOX_STATUSES),
    sourceLabel: text(row, "source_label"),
    capturedAt: timestamp(row, "captured_at"),
    triagedAt: nullableText(row, "triaged_at"),
    promotedKind: promotedKind as InboxItemRow["promoted_kind"],
    promotedId: nullableText(row, "promoted_id"),
    createdBy: text(row, "created_by"),
    updatedBy: text(row, "updated_by"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapCaseMemberRow(value: unknown): CaseMember {
  const row = asRecord(value, "case member");
  owner(row);
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    displayName: text(row, "display_name"),
    roleLabel: text(row, "role_label"),
    metadata: jsonObject(row, "metadata"),
    lifecycleStatus: enumValue(row, "lifecycle_status", ["active", "inactive", "archived"]),
    createdBy: text(row, "created_by"),
    updatedBy: text(row, "updated_by"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapClaimRow(value: unknown): Claim {
  const row = asRecord(value, "claim");
  owner(row);
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    statement: text(row, "statement"),
    status: enumValue(row, "status", CLAIM_STATUSES),
    confidence: numberValue(row, "confidence"),
    whatWouldChangeMind: text(row, "what_would_change_mind"),
    revisitCondition: text(row, "revisit_condition"),
    sourceRecordId: nullableText(row, "source_record_id"),
    lifecycleStatus: enumValue(row, "lifecycle_status", LIFECYCLE_STATUSES),
    createdBy: text(row, "created_by"),
    updatedBy: text(row, "updated_by"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapEvidenceItemRow(value: unknown): EvidenceItem {
  const row = asRecord(value, "evidence item");
  owner(row);
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    title: text(row, "title"),
    content: jsonValue(row, "content"),
    contentHash: text(row, "content_hash"),
    sourceClassification: enumValue(row, "source_classification", SOURCE_CLASSIFICATIONS),
    sourceUri: text(row, "source_uri"),
    sourceRecordId: nullableText(row, "source_record_id"),
    provenance: jsonObject(row, "provenance"),
    lifecycleStatus: enumValue(row, "lifecycle_status", EVIDENCE_LIFECYCLE_STATUSES),
    immutable: booleanValue(row, "immutable"),
    capturedAt: timestamp(row, "captured_at"),
    supersedesId: nullableText(row, "supersedes_id"),
    createdBy: text(row, "created_by"),
    updatedBy: text(row, "updated_by"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapClaimEvidenceRow(value: unknown): ClaimEvidence {
  const row = asRecord(value, "claim evidence link");
  owner(row);
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    claimId: text(row, "claim_id"),
    evidenceId: text(row, "evidence_id"),
    relationshipNote: text(row, "relationship_note"),
    lifecycleStatus: enumValue(row, "lifecycle_status", ["active", "archived"]),
    createdBy: text(row, "created_by"),
    updatedBy: text(row, "updated_by"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapCustodianFindingEvidenceRow(value: unknown): CustodianFindingEvidence {
  const row = asRecord(value, "finding evidence link");
  owner(row);
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    findingId: text(row, "finding_id"),
    evidenceId: text(row, "evidence_id"),
    relationshipKind: enumValue(row, "relationship_kind", FINDING_EVIDENCE_RELATIONSHIP_KINDS),
    relationshipNote: text(row, "relationship_note"),
    lifecycleStatus: enumValue(row, "lifecycle_status", ["active", "archived"]),
    createdBy: text(row, "created_by"),
    updatedBy: text(row, "updated_by"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapActionRow(value: unknown): CustodianAction {
  const row = asRecord(value, "action");
  owner(row);
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    title: text(row, "title"),
    description: text(row, "description"),
    status: enumValue(row, "status", ACTION_STATUSES),
    priority: numberValue(row, "priority"),
    dueAt: nullableText(row, "due_at"),
    sourceRecordId: nullableText(row, "source_record_id"),
    lifecycleStatus: enumValue(row, "lifecycle_status", ["active", "archived"]),
    createdBy: text(row, "created_by"),
    updatedBy: text(row, "updated_by"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapCustodianFindingRow(value: unknown): CustodianFinding {
  const row = asRecord(value, "finding");
  owner(row);
  return {
    id: text(row, "id"),
    caseId: text(row, "case_id"),
    analysisMode: enumValue(row, "analysis_mode", FINDING_ANALYSIS_MODES),
    title: text(row, "title"),
    finding: text(row, "finding"),
    confidence: numberValue(row, "confidence"),
    whatWouldChangeMind: text(row, "what_would_change_mind"),
    revisitCondition: text(row, "revisit_condition"),
    sourceRecordId: nullableText(row, "source_record_id"),
    status: enumValue(row, "status", FINDING_STATUSES),
    lifecycleStatus: enumValue(row, "lifecycle_status", ["active", "archived"]),
    originKind: enumValue(row, "origin_kind", FINDING_ORIGIN_KINDS),
    analysisOutcome:
      row.analysis_outcome === null
        ? null
        : enumValue(row, "analysis_outcome", FINDING_ANALYSIS_OUTCOMES),
    originRunId: nullableText(row, "origin_run_id"),
    originStepId: nullableText(row, "origin_step_id"),
    candidateIndex: row.candidate_index === null ? null : numberValue(row, "candidate_index"),
    analysisResultHash: nullableText(row, "analysis_result_hash"),
    uncertainties: stringArray(row, "uncertainties"),
    assumptions: stringArray(row, "assumptions"),
    scopeLimits: stringArray(row, "scope_limits"),
    evidenceGaps: stringArray(row, "evidence_gaps"),
    createdBy: text(row, "created_by"),
    updatedBy: text(row, "updated_by"),
    createdAt: timestamp(row, "created_at"),
    updatedAt: timestamp(row, "updated_at"),
  };
}

export function mapRecordRevisionRow(value: unknown): RecordRevision {
  const row = asRecord(value, "record revision");
  owner(row);
  const operation = enumValue(row, "operation", ["insert", "update"]);
  return {
    id: text(row, "id"),
    recordId: text(row, "record_id"),
    revisionNumber: numberValue(row, "revision_number"),
    operation,
    snapshot: jsonObject(row, "snapshot"),
    changedBy: text(row, "changed_by"),
    changedAt: timestamp(row, "changed_at"),
  };
}

export class CustodianFoundationMissingError extends Error {
  readonly code = "CUSTODIAN_FOUNDATION_MISSING";

  constructor(message = "Custodian Release 1 migrations are not available yet") {
    super(message);
    this.name = "CustodianFoundationMissingError";
  }
}

export function isCustodianFoundationMissing(error: unknown): boolean {
  if (error instanceof CustodianFoundationMissingError) return true;
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("schema cache") && message.includes("custodian")) ||
    (message.includes("relation") && message.includes("does not exist") && message.includes("case"))
  );
}

export type CustodianErrorKind = "missing_foundation" | "unauthorized" | "validation" | "unknown";

export function classifyCustodianError(error: unknown): CustodianErrorKind {
  if (isCustodianFoundationMissing(error)) return "missing_foundation";
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  if (code === "28000" || candidate?.status === 401 || candidate?.status === 403)
    return "unauthorized";
  if (code === "22023" || code === "23514" || code === "23505") return "validation";
  return "unknown";
}

export function pageRange(
  pageIndex: number,
  pageSize = CUSTODIAN_PAGE_SIZE,
): { from: number; to: number } {
  if (!Number.isInteger(pageIndex) || pageIndex < 0)
    throw new Error("pageIndex must be a non-negative integer");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)
    throw new Error("pageSize must be between 1 and 1000");
  const from = pageIndex * pageSize;
  return { from, to: from + pageSize - 1 };
}

export async function paginateOwnerRows<T>(
  fetchPage: (range: { from: number; to: number }) => Promise<readonly T[]>,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? CUSTODIAN_PAGE_SIZE;
  const maxPages = options.maxPages ?? 10000;
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("maxPages must be positive");
  const rows: T[] = [];
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await fetchPage(pageRange(pageIndex, pageSize));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error("Custodian pagination exceeded its safety bound");
}

async function fetchOwnerCollection<Row, Domain>(
  ownerId: string,
  resource: CustodianResource,
  select: string,
  mapper: (row: unknown) => Domain,
  options?: CustodianCollectionOptions,
): Promise<Domain[]> {
  if (!ownerId.trim()) throw new Error("ownerId is required for Custodian reads");
  if (
    options?.ids?.length === 0 ||
    options?.claimIds?.length === 0 ||
    options?.evidenceIds?.length === 0 ||
    options?.findingIds?.length === 0
  ) {
    return [];
  }
  try {
    return await paginateOwnerRows(async (range) => {
      let query = supabase.from(resource).select(select).eq("owner_id", ownerId);
      if (options?.sourceRecordId !== undefined) {
        query = query.eq("source_record_id", options.sourceRecordId);
      }
      if (options?.ids !== undefined) query = query.in("id", options.ids);
      if (options?.claimIds !== undefined) query = query.in("claim_id", options.claimIds);
      if (options?.evidenceIds !== undefined) {
        query = query.in("evidence_id", options.evidenceIds);
      }
      if (options?.findingIds !== undefined) {
        query = query.in("finding_id", options.findingIds);
      }
      const { data, error } = await query
        .order("id", { ascending: true })
        .range(range.from, range.to);
      if (error) throw error;
      if (!data) throw new Error(`Custodian ${resource} read returned no data`);
      return (data as unknown as Row[]).map(mapper);
    }, options);
  } catch (error) {
    if (isCustodianFoundationMissing(error)) throw new CustodianFoundationMissingError();
    throw error;
  }
}

const FULL_CASE_SELECT =
  "id,owner_id,title,objective,current_question,default_working_set,archive_scope,status,closed_at,created_by,updated_by,created_at,updated_at";
const FULL_INBOX_SELECT =
  "id,owner_id,kind,raw_content,title,candidate,status,source_label,captured_at,triaged_at,promoted_kind,promoted_id,created_by,updated_by,created_at,updated_at";
const FULL_CLAIM_SELECT =
  "id,owner_id,case_id,statement,status,confidence,what_would_change_mind,revisit_condition,source_record_id,lifecycle_status,created_by,updated_by,created_at,updated_at";
const FULL_EVIDENCE_SELECT =
  "id,owner_id,case_id,title,content,content_hash,source_classification,source_uri,source_record_id,provenance,lifecycle_status,immutable,captured_at,supersedes_id,created_by,updated_by,created_at,updated_at";
const FULL_LINK_SELECT =
  "id,owner_id,case_id,claim_id,evidence_id,relationship_note,lifecycle_status,created_by,updated_by,created_at,updated_at";
const FULL_FINDING_EVIDENCE_SELECT =
  "id,owner_id,case_id,finding_id,evidence_id,relationship_kind,relationship_note,lifecycle_status,created_by,updated_by,created_at,updated_at";
const FULL_ACTION_SELECT =
  "id,owner_id,case_id,title,description,status,priority,due_at,source_record_id,lifecycle_status,created_by,updated_by,created_at,updated_at";
const FULL_FINDING_SELECT =
  "id,owner_id,case_id,analysis_mode,title,finding,confidence,what_would_change_mind,revisit_condition,source_record_id,status,lifecycle_status,origin_kind,analysis_outcome,origin_run_id,origin_step_id,candidate_index,analysis_result_hash,uncertainties,assumptions,scope_limits,evidence_gaps,created_by,updated_by,created_at,updated_at";
const FULL_REVISION_SELECT =
  "id,owner_id,record_id,revision_number,operation,snapshot,changed_by,changed_at";

export const custodianCasesKey = (userId: string | null) =>
  ["custodian", "cases", userId ?? "__anonymous__"] as const;
export const custodianInboxKey = (userId: string | null) =>
  ["custodian", "inbox", userId ?? "__anonymous__"] as const;
export const custodianRecordContextKey = (userId: string | null, recordId: string | null) =>
  ["custodian", "record-context", userId ?? "__anonymous__", recordId ?? "__unknown__"] as const;

export function fetchCustodianCases(ownerId: string, options?: CustodianCollectionOptions) {
  return fetchOwnerCollection<CustodianCaseRow, CustodianCase>(
    ownerId,
    "cases",
    FULL_CASE_SELECT,
    mapCustodianCaseRow,
    options,
  );
}
export function fetchCustodianInboxItems(ownerId: string, options?: CustodianCollectionOptions) {
  return fetchOwnerCollection<InboxItemRow, InboxItem>(
    ownerId,
    "inbox_items",
    FULL_INBOX_SELECT,
    mapInboxItemRow,
    options,
  );
}
export function fetchCustodianCaseMembers(ownerId: string, options?: CustodianCollectionOptions) {
  return fetchOwnerCollection<CaseMemberRow, CaseMember>(
    ownerId,
    "case_members",
    "id,owner_id,case_id,display_name,role_label,metadata,lifecycle_status,created_by,updated_by,created_at,updated_at",
    mapCaseMemberRow,
    options,
  );
}
export function fetchCustodianClaims(ownerId: string, options?: CustodianCollectionOptions) {
  return fetchOwnerCollection<ClaimRow, Claim>(
    ownerId,
    "claims",
    FULL_CLAIM_SELECT,
    mapClaimRow,
    options,
  );
}
export function fetchCustodianEvidence(ownerId: string, options?: CustodianCollectionOptions) {
  return fetchOwnerCollection<EvidenceItemRow, EvidenceItem>(
    ownerId,
    "evidence_items",
    FULL_EVIDENCE_SELECT,
    mapEvidenceItemRow,
    options,
  );
}
export function fetchCustodianClaimEvidence(ownerId: string, options?: CustodianCollectionOptions) {
  return fetchOwnerCollection<ClaimEvidenceRow, ClaimEvidence>(
    ownerId,
    "claim_evidence",
    FULL_LINK_SELECT,
    mapClaimEvidenceRow,
    options,
  );
}
export function fetchCustodianFindingEvidence(
  ownerId: string,
  options?: CustodianCollectionOptions,
) {
  return fetchOwnerCollection<CustodianFindingEvidenceRow, CustodianFindingEvidence>(
    ownerId,
    "custodian_finding_evidence",
    FULL_FINDING_EVIDENCE_SELECT,
    mapCustodianFindingEvidenceRow,
    options,
  );
}
export function fetchCustodianActions(ownerId: string, options?: CustodianCollectionOptions) {
  return fetchOwnerCollection<ActionRow, CustodianAction>(
    ownerId,
    "actions",
    FULL_ACTION_SELECT,
    mapActionRow,
    options,
  );
}
export function fetchCustodianFindings(ownerId: string, options?: CustodianCollectionOptions) {
  return fetchOwnerCollection<CustodianFindingRow, CustodianFinding>(
    ownerId,
    "custodian_findings",
    FULL_FINDING_SELECT,
    mapCustodianFindingRow,
    options,
  );
}

export async function fetchCustodianRecordContext(
  ownerId: string,
  recordId: string,
): Promise<CustodianRecordContext> {
  if (!ownerId.trim()) throw new Error("ownerId is required for Custodian reads");
  if (!recordId.trim()) throw new Error("recordId is required for Custodian reads");

  const [claims, evidence, findings] = await Promise.all([
    fetchCustodianClaims(ownerId, { sourceRecordId: recordId }),
    fetchCustodianEvidence(ownerId, { sourceRecordId: recordId }),
    fetchCustodianFindings(ownerId, { sourceRecordId: recordId }),
  ]);

  const caseIds = [...new Set([...claims, ...evidence, ...findings].map((entry) => entry.caseId))];
  const claimIds = claims.map((claim) => claim.id);
  const evidenceIds = evidence.map((entry) => entry.id);

  const [cases, linksByClaim, linksByEvidence, findingEvidence] = await Promise.all([
    fetchCustodianCases(ownerId, { ids: caseIds }),
    fetchCustodianClaimEvidence(ownerId, { claimIds }),
    fetchCustodianClaimEvidence(ownerId, { evidenceIds }),
    fetchCustodianFindingEvidence(ownerId, { findingIds: findings.map((finding) => finding.id) }),
  ]);
  return composeCustodianRecordContext({
    cases,
    claims,
    evidence,
    findings,
    claimEvidence: [...linksByClaim, ...linksByEvidence],
    findingEvidence,
  });
}

export function composeCustodianRecordContext({
  cases,
  claims,
  evidence,
  claimEvidence,
  findings,
  findingEvidence,
}: CustodianRecordContext): CustodianRecordContext {
  const caseIds = new Set([...claims, ...evidence, ...findings].map((entry) => entry.caseId));
  const claimIds = new Set(claims.map((claim) => claim.id));
  const evidenceIds = new Set(evidence.map((entry) => entry.id));
  const findingIds = new Set(findings.map((finding) => finding.id));
  const scopedLinks = claimEvidence.filter(
    (link) => claimIds.has(link.claimId) && evidenceIds.has(link.evidenceId),
  );

  return {
    cases: cases.filter((item) => caseIds.has(item.id)),
    claims,
    evidence,
    claimEvidence: Array.from(new Map(scopedLinks.map((link) => [link.id, link])).values()),
    findings,
    findingEvidence: findingEvidence.filter(
      (link) => findingIds.has(link.findingId) && evidenceIds.has(link.evidenceId),
    ),
  };
}

export function fetchCustodianRecordRevisions(
  ownerId: string,
  options?: CustodianCollectionOptions,
) {
  return fetchOwnerCollection<RecordRevisionRow, RecordRevision>(
    ownerId,
    "record_revisions",
    FULL_REVISION_SELECT,
    mapRecordRevisionRow,
    options,
  );
}

export function useCustodianCases(enabled = true) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: custodianCasesKey(userId),
    enabled: enabled && userId !== null,
    staleTime: 30_000,
    retry: (failureCount, error) => !isCustodianFoundationMissing(error) && failureCount < 2,
    queryFn: () => fetchCustodianCases(userId as string),
  });
}

export function useCustodianRecordContext(recordId: string | null, enabled = true) {
  const userId = useCurrentUserId();
  return useQuery<CustodianRecordContext>({
    queryKey: custodianRecordContextKey(userId, recordId),
    enabled: enabled && userId !== null && recordId !== null,
    staleTime: 30_000,
    retry: (failureCount, error) => !isCustodianFoundationMissing(error) && failureCount < 2,
    queryFn: () => fetchCustodianRecordContext(userId as string, recordId as string),
  });
}

export function useCustodianInboxItems(enabled = true) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: custodianInboxKey(userId),
    enabled: enabled && userId !== null,
    staleTime: 30_000,
    retry: (failureCount, error) => !isCustodianFoundationMissing(error) && failureCount < 2,
    queryFn: () => fetchCustodianInboxItems(userId as string),
  });
}

export function validateConfidence(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100)
    throw new Error("confidence must be an integer from 0 to 100");
  return value;
}

function validateTextInput(
  value: string,
  field: string,
  maxLength: number,
  required = true,
): string {
  if (typeof value !== "string" || (required && value.trim() === ""))
    throw new Error(`${field} is required`);
  if (value.length > maxLength) throw new Error(`${field} exceeds its maximum length`);
  return value;
}

function rpcPayload(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

async function callCustodianRpc<T>(
  name: string,
  args: Record<string, unknown>,
  mapper: (value: unknown) => T,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (isCustodianFoundationMissing(error)) throw new CustodianFoundationMissingError();
    throw new Error(error.message);
  }
  return mapper(data);
}

export type CaseWriteInput = {
  title: string;
  objective?: string;
  currentQuestion?: string;
  archiveScope?: CaseArchiveScope;
  /** @deprecated Kept only for legacy callers. New Case UI must not send it. */
  defaultWorkingSet?: JsonValue[];
  status?: CaseStatus;
  closedAt?: string | null;
};

function caseWritePayload(input: CaseWriteInput): Record<string, unknown> {
  validateTextInput(input.title, "title", 300);
  if (input.objective !== undefined) validateTextInput(input.objective, "objective", 10000, false);
  if (input.currentQuestion !== undefined)
    validateTextInput(input.currentQuestion, "current_question", 10000, false);
  if (input.archiveScope !== undefined) caseArchiveScopePayload(input.archiveScope);
  if (input.defaultWorkingSet !== undefined && !Array.isArray(input.defaultWorkingSet))
    throw new Error("default_working_set must be an array");
  if (input.status !== undefined && !isCaseStatus(input.status))
    throw new Error("invalid case status");
  return {
    title: input.title,
    objective: input.objective ?? "",
    current_question: input.currentQuestion ?? "",
    ...(input.archiveScope !== undefined
      ? { archive_scope: caseArchiveScopePayload(input.archiveScope) }
      : {}),
    ...(input.defaultWorkingSet !== undefined
      ? { default_working_set: input.defaultWorkingSet }
      : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.closedAt !== undefined ? { closed_at: input.closedAt } : {}),
  };
}

export function createCustodianCase(input: CaseWriteInput) {
  return callCustodianRpc(
    "custodian_create_case",
    { case_payload: caseWritePayload(input) },
    mapCustodianCaseRow,
  );
}
export function updateCustodianCase(caseId: string, input: CaseWriteInput) {
  validateTextInput(caseId, "case_id", 200);
  return callCustodianRpc(
    "custodian_update_case",
    { case_id: caseId, case_payload: caseWritePayload(input) },
    mapCustodianCaseRow,
  );
}

export type InboxWriteInput = {
  kind: InboxKind;
  rawContent: string;
  title?: string;
  candidate?: { [key: string]: JsonValue };
  sourceLabel?: string;
};

export function createCustodianInboxItem(input: InboxWriteInput) {
  if (!isInboxKind(input.kind)) throw new Error("invalid inbox kind");
  validateTextInput(input.rawContent, "raw_content", 200000);
  return callCustodianRpc(
    "custodian_create_inbox_item",
    {
      item_payload: {
        kind: input.kind,
        raw_content: input.rawContent,
        title: input.title ?? "",
        candidate: input.candidate ?? {},
        source_label: input.sourceLabel ?? "",
      },
    },
    mapInboxItemRow,
  );
}

export function triageCustodianInboxItem(
  itemId: string,
  status: Exclude<InboxStatus, "new" | "promoted">,
  candidate?: { [key: string]: JsonValue },
) {
  validateTextInput(itemId, "item_id", 200);
  if (!isInboxStatus(status)) throw new Error("invalid triage status");
  return callCustodianRpc(
    "custodian_triage_inbox_item",
    { item_id: itemId, triage_payload: { status, ...(candidate ? { candidate } : {}) } },
    mapInboxItemRow,
  );
}

export type ClaimWriteInput = {
  id?: string;
  caseId: string;
  statement: string;
  status?: ClaimStatus;
  confidence?: number;
  whatWouldChangeMind?: string;
  revisitCondition?: string;
  sourceRecordId?: string | null;
  lifecycleStatus?: LifecycleStatus;
};

export function upsertCustodianClaim(input: ClaimWriteInput) {
  validateTextInput(input.caseId, "case_id", 200);
  validateTextInput(input.statement, "statement", 20000);
  if (input.status !== undefined && !isClaimStatus(input.status))
    throw new Error("invalid claim status");
  if (input.confidence !== undefined) validateConfidence(input.confidence);
  if (input.lifecycleStatus !== undefined && !isLifecycleStatus(input.lifecycleStatus))
    throw new Error("invalid claim lifecycle status");
  return callCustodianRpc(
    "custodian_upsert_claim",
    {
      claim_payload: {
        ...(input.id ? { id: input.id } : {}),
        case_id: input.caseId,
        statement: input.statement,
        status: input.status ?? "observed",
        confidence: input.confidence ?? 0,
        what_would_change_mind: input.whatWouldChangeMind ?? "",
        revisit_condition: input.revisitCondition ?? "",
        source_record_id: input.sourceRecordId ?? null,
        ...(input.lifecycleStatus ? { lifecycle_status: input.lifecycleStatus } : {}),
      },
    },
    mapClaimRow,
  );
}

export type EvidenceWriteInput = {
  id?: string;
  caseId: string;
  title?: string;
  content: JsonValue;
  contentHash: string;
  sourceClassification: SourceClassification;
  sourceUri?: string;
  sourceRecordId?: string | null;
  provenance: { [key: string]: JsonValue };
  lifecycleStatus?: EvidenceLifecycleStatus;
  supersedesId?: string | null;
};

export function upsertCustodianEvidence(input: EvidenceWriteInput) {
  validateTextInput(input.caseId, "case_id", 200);
  if (!isSourceClassification(input.sourceClassification))
    throw new Error("invalid evidence source classification");
  if (!/^[0-9a-fA-F]{16,128}$/.test(input.contentHash))
    throw new Error("content_hash must be a hexadecimal digest");
  if (input.lifecycleStatus !== undefined && !isEvidenceLifecycleStatus(input.lifecycleStatus))
    throw new Error("invalid evidence lifecycle status");
  return callCustodianRpc(
    "custodian_upsert_evidence",
    {
      evidence_payload: {
        ...(input.id ? { id: input.id } : {}),
        case_id: input.caseId,
        title: input.title ?? "",
        content: input.content,
        content_hash: input.contentHash,
        source_classification: input.sourceClassification,
        source_uri: input.sourceUri ?? "",
        source_record_id: input.sourceRecordId ?? null,
        provenance: input.provenance,
        ...(input.lifecycleStatus ? { lifecycle_status: input.lifecycleStatus } : {}),
        ...(input.supersedesId !== undefined ? { supersedes_id: input.supersedesId } : {}),
      },
    },
    mapEvidenceItemRow,
  );
}

export type ActionWriteInput = {
  id?: string;
  caseId: string;
  title: string;
  description?: string;
  status?: ActionStatus;
  priority?: number;
  dueAt?: string | null;
  sourceRecordId?: string | null;
  lifecycleStatus?: "active" | "archived";
};

export function upsertCustodianAction(input: ActionWriteInput) {
  validateTextInput(input.caseId, "case_id", 200);
  validateTextInput(input.title, "title", 500);
  if (input.status !== undefined && !isActionStatus(input.status))
    throw new Error("invalid action status");
  if (
    input.priority !== undefined &&
    (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 100)
  )
    throw new Error("priority must be an integer from 0 to 100");
  return callCustodianRpc(
    "custodian_upsert_action",
    {
      action_payload: {
        ...(input.id ? { id: input.id } : {}),
        case_id: input.caseId,
        title: input.title,
        description: input.description ?? "",
        status: input.status ?? "proposed",
        priority: input.priority ?? 50,
        due_at: input.dueAt ?? null,
        source_record_id: input.sourceRecordId ?? null,
        ...(input.lifecycleStatus ? { lifecycle_status: input.lifecycleStatus } : {}),
      },
    },
    mapActionRow,
  );
}

export type FindingWriteInput = {
  id?: string;
  caseId: string;
  analysisMode: FindingAnalysisMode;
  title: string;
  finding: string;
  confidence?: number;
  whatWouldChangeMind?: string;
  revisitCondition?: string;
  sourceRecordId?: string | null;
  status?: FindingStatus;
  lifecycleStatus?: "active" | "archived";
};

export type MaterializeFindingInput = {
  agentStepId: string;
  candidateIndex: number;
};

export type MaterializeFindingResult =
  | CustodianFinding
  | { materialized: false; outcome: "refusal" | "no_finding"; idempotent: false };

function mapMaterializeFindingResult(value: unknown): MaterializeFindingResult {
  const row = asRecord(value, "Finding materialization result");
  if (row.materialized === false) {
    if (row.outcome !== "refusal" && row.outcome !== "no_finding") {
      throw new Error("Finding materialization returned an invalid non-Finding outcome");
    }
    return { materialized: false, outcome: row.outcome, idempotent: false };
  }
  return mapCustodianFindingRow(value);
}

export function materializeCustodianFinding(input: MaterializeFindingInput) {
  validateTextInput(input.agentStepId, "agent_step_id", 200);
  if (
    !Number.isInteger(input.candidateIndex) ||
    input.candidateIndex < 0 ||
    input.candidateIndex > 63
  ) {
    throw new Error("candidate_index must be an integer from 0 to 63");
  }
  return callCustodianRpc(
    "custodian_materialize_finding",
    { agent_step_id: input.agentStepId, candidate_index: input.candidateIndex },
    mapMaterializeFindingResult,
  );
}

export function upsertCustodianFinding(input: FindingWriteInput) {
  validateTextInput(input.caseId, "case_id", 200);
  if (!isFindingAnalysisMode(input.analysisMode)) throw new Error("invalid finding analysis mode");
  validateTextInput(input.title, "title", 500);
  validateTextInput(input.finding, "finding", 30000);
  if (input.confidence !== undefined) validateConfidence(input.confidence);
  if (input.status !== undefined && !isFindingStatus(input.status))
    throw new Error("invalid finding status");
  return callCustodianRpc(
    "custodian_upsert_finding",
    {
      finding_payload: {
        ...(input.id ? { id: input.id } : {}),
        case_id: input.caseId,
        analysis_mode: input.analysisMode,
        title: input.title,
        finding: input.finding,
        confidence: input.confidence ?? 0,
        what_would_change_mind: input.whatWouldChangeMind ?? "",
        revisit_condition: input.revisitCondition ?? "",
        source_record_id: input.sourceRecordId ?? null,
        status: input.status ?? "draft",
        ...(input.lifecycleStatus ? { lifecycle_status: input.lifecycleStatus } : {}),
      },
    },
    mapCustodianFindingRow,
  );
}

export function linkCustodianClaimEvidence(
  claimId: string,
  evidenceId: string,
  relationshipNote = "",
) {
  validateTextInput(claimId, "claim_id", 200);
  validateTextInput(evidenceId, "evidence_id", 200);
  validateTextInput(relationshipNote, "relationship_note", 10000, false);
  return callCustodianRpc(
    "custodian_link_claim_evidence",
    { claim_id: claimId, evidence_id: evidenceId, relationship_note: relationshipNote },
    mapClaimEvidenceRow,
  );
}

export type CustodianPromotionTarget = "claim" | "evidence_item" | "action" | "custodian_finding";
export type CustodianPromotionResult = {
  inboxItem: InboxItem;
  promoted: Claim | EvidenceItem | CustodianAction | CustodianFinding;
};

export function promoteCustodianInboxItem(
  itemId: string,
  target: CustodianPromotionTarget,
  caseId: string,
): Promise<CustodianPromotionResult> {
  validateTextInput(itemId, "item_id", 200);
  validateTextInput(caseId, "case_id", 200);
  const mapper = (value: unknown): CustodianPromotionResult => {
    const result = asRecord(value, "promotion result");
    const inboxItem = mapInboxItemRow(result.inbox_item);
    switch (target) {
      case "claim":
        return { inboxItem, promoted: mapClaimRow(result.promoted) };
      case "evidence_item":
        return { inboxItem, promoted: mapEvidenceItemRow(result.promoted) };
      case "action":
        return { inboxItem, promoted: mapActionRow(result.promoted) };
      case "custodian_finding":
        return { inboxItem, promoted: mapCustodianFindingRow(result.promoted) };
    }
  };
  return callCustodianRpc(
    "custodian_promote_inbox_item",
    { item_id: itemId, target_kind: target, target_case_id: caseId },
    mapper,
  );
}

// Keep these row imports structurally checked by the compiler even though
// runtime reads intentionally pass through the ungenerated Supabase client.
void (0 as unknown as ActionRow);
void (0 as unknown as CaseMemberRow);
void (0 as unknown as CustodianCaseRow);
void (0 as unknown as CustodianFindingRow);
void (0 as unknown as CustodianFindingEvidenceRow);
void (0 as unknown as EvidenceItemRow);
void (0 as unknown as RecordRevisionRow);
