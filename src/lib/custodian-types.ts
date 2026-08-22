export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const INBOX_KINDS = [
  "thought",
  "conversation",
  "document",
  "url",
  "github",
  "context7",
  "record",
  "clipboard",
  "mobile_share",
] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const INBOX_STATUSES = ["new", "triaged", "promoted", "dismissed", "archived"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export const CASE_STATUSES = ["open", "paused", "closed", "archived"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CLAIM_STATUSES = [
  "observed",
  "reported",
  "inferred",
  "disputed",
  "falsified",
  "unresolved",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const LIFECYCLE_STATUSES = ["active", "superseded", "archived"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const EVIDENCE_LIFECYCLE_STATUSES = [
  "active",
  "superseded",
  "rejected",
  "archived",
] as const;
export type EvidenceLifecycleStatus = (typeof EVIDENCE_LIFECYCLE_STATUSES)[number];

export const SOURCE_CLASSIFICATIONS = [
  "primary",
  "secondary",
  "tertiary",
  "self_report",
  "inference",
  "unknown",
] as const;
export type SourceClassification = (typeof SOURCE_CLASSIFICATIONS)[number];

export const ACTION_STATUSES = [
  "proposed",
  "ready",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
  "deferred",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const FINDING_ANALYSIS_MODES = [
  "plan",
  "claim_review",
  "evidence_gap",
  "contradiction",
  "timeline",
  "causal",
  "risk",
  "decision",
  "synthesis",
] as const;
export type FindingAnalysisMode = (typeof FINDING_ANALYSIS_MODES)[number];

export const FINDING_STATUSES = ["draft", "open", "resolved", "superseded", "archived"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export type CustodianCaseRow = {
  id: string;
  owner_id: string;
  title: string;
  objective: string;
  current_question: string;
  default_working_set: JsonValue;
  status: CaseStatus;
  closed_at: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type CustodianCase = {
  id: string;
  title: string;
  objective: string;
  currentQuestion: string;
  defaultWorkingSet: JsonValue[];
  status: CaseStatus;
  closedAt: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type InboxItemRow = {
  id: string;
  owner_id: string;
  kind: InboxKind;
  raw_content: string;
  title: string;
  candidate: { [key: string]: JsonValue };
  status: InboxStatus;
  source_label: string;
  captured_at: string;
  triaged_at: string | null;
  promoted_kind: "claim" | "evidence_item" | "action" | "custodian_finding" | null;
  promoted_id: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type InboxItem = {
  id: string;
  kind: InboxKind;
  rawContent: string;
  title: string;
  candidate: { [key: string]: JsonValue };
  status: InboxStatus;
  sourceLabel: string;
  capturedAt: string;
  triagedAt: string | null;
  promotedKind: InboxItemRow["promoted_kind"];
  promotedId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CaseMemberRow = {
  id: string;
  owner_id: string;
  case_id: string;
  display_name: string;
  role_label: string;
  metadata: { [key: string]: JsonValue };
  lifecycle_status: "active" | "inactive" | "archived";
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type CaseMember = {
  id: string;
  caseId: string;
  displayName: string;
  roleLabel: string;
  metadata: { [key: string]: JsonValue };
  lifecycleStatus: CaseMemberRow["lifecycle_status"];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ClaimRow = {
  id: string;
  owner_id: string;
  case_id: string;
  statement: string;
  status: ClaimStatus;
  confidence: number;
  what_would_change_mind: string;
  revisit_condition: string;
  source_record_id: string | null;
  lifecycle_status: LifecycleStatus;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type Claim = {
  id: string;
  caseId: string;
  statement: string;
  status: ClaimStatus;
  confidence: number;
  whatWouldChangeMind: string;
  revisitCondition: string;
  sourceRecordId: string | null;
  lifecycleStatus: LifecycleStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceItemRow = {
  id: string;
  owner_id: string;
  case_id: string;
  title: string;
  content: JsonValue;
  content_hash: string;
  source_classification: SourceClassification;
  source_uri: string;
  source_record_id: string | null;
  provenance: { [key: string]: JsonValue };
  lifecycle_status: EvidenceLifecycleStatus;
  immutable: boolean;
  captured_at: string;
  supersedes_id: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type EvidenceItem = {
  id: string;
  caseId: string;
  title: string;
  content: JsonValue;
  contentHash: string;
  sourceClassification: SourceClassification;
  sourceUri: string;
  sourceRecordId: string | null;
  provenance: { [key: string]: JsonValue };
  lifecycleStatus: EvidenceLifecycleStatus;
  immutable: boolean;
  capturedAt: string;
  supersedesId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ClaimEvidenceRow = {
  id: string;
  owner_id: string;
  case_id: string;
  claim_id: string;
  evidence_id: string;
  relationship_note: string;
  lifecycle_status: "active" | "archived";
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type ClaimEvidence = {
  id: string;
  caseId: string;
  claimId: string;
  evidenceId: string;
  relationshipNote: string;
  lifecycleStatus: ClaimEvidenceRow["lifecycle_status"];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ActionRow = {
  id: string;
  owner_id: string;
  case_id: string;
  title: string;
  description: string;
  status: ActionStatus;
  priority: number;
  due_at: string | null;
  source_record_id: string | null;
  lifecycle_status: "active" | "archived";
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type CustodianAction = {
  id: string;
  caseId: string;
  title: string;
  description: string;
  status: ActionStatus;
  priority: number;
  dueAt: string | null;
  sourceRecordId: string | null;
  lifecycleStatus: ActionRow["lifecycle_status"];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CustodianFindingRow = {
  id: string;
  owner_id: string;
  case_id: string;
  analysis_mode: FindingAnalysisMode;
  title: string;
  finding: string;
  confidence: number;
  what_would_change_mind: string;
  revisit_condition: string;
  source_record_id: string | null;
  status: FindingStatus;
  lifecycle_status: "active" | "archived";
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type CustodianFinding = {
  id: string;
  caseId: string;
  analysisMode: FindingAnalysisMode;
  title: string;
  finding: string;
  confidence: number;
  whatWouldChangeMind: string;
  revisitCondition: string;
  sourceRecordId: string | null;
  status: FindingStatus;
  lifecycleStatus: CustodianFindingRow["lifecycle_status"];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CustodianRecordContext = {
  cases: CustodianCase[];
  claims: Claim[];
  evidence: EvidenceItem[];
  claimEvidence: ClaimEvidence[];
  findings: CustodianFinding[];
};

export type RecordRevisionRow = {
  id: string;
  owner_id: string;
  record_id: string;
  revision_number: number;
  operation: "insert" | "update";
  snapshot: { [key: string]: JsonValue };
  changed_by: string;
  changed_at: string;
};

export type RecordRevision = {
  id: string;
  recordId: string;
  revisionNumber: number;
  operation: RecordRevisionRow["operation"];
  snapshot: { [key: string]: JsonValue };
  changedBy: string;
  changedAt: string;
};
