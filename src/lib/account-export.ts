// Account-level portable export (Wave 2). Expands beyond archive records+links
// without claiming Storage binaries or secrets are included.
import type { ArchiveExport, ArchiveLink, ArchiveRecord } from "./types";
import { buildBackup } from "./format";
import type { ProviderKeyStatus } from "./provider-key";

export const ACCOUNT_EXPORT_SCHEMA_VERSION = 2 as const;
export const ACCOUNT_DELETE_CONFIRMATION = "DELETE MY ACCOUNT";

export type AccountExportLimitations = {
  storageBinariesIncluded: false;
  storageBucket: "document-files";
  storageNote: string;
  secretsExcluded: readonly string[];
};

export type AccountExport = {
  application: "The Excavatorium";
  exportKind: "account";
  schemaVersion: typeof ACCOUNT_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  limitations: AccountExportLimitations;
  records: ArchiveRecord[];
  links: ArchiveLink[];
  cases: unknown[];
  evidence: unknown[];
  findings: unknown[];
  findingEvidence: unknown[];
  claims: unknown[];
  claimEvidence: unknown[];
  approvals: unknown[];
  decisionReviews: unknown[];
  custodianRuns: unknown[];
  providerSettings: unknown[];
  providerKeyStatus: ProviderKeyStatus;
};

export const ACCOUNT_EXPORT_LIMITATIONS: AccountExportLimitations = {
  storageBinariesIncluded: false,
  storageBucket: "document-files",
  storageNote:
    "This JSON does not contain uploaded document files or extracted Storage objects under document-files/<owner-id>/. Binary uploads must be preserved separately if needed.",
  secretsExcluded: [
    "plaintext_api_keys",
    "provider_ciphertext",
    "encryption_wrapping_keys",
    "service_role_secrets",
  ],
};

export function accountExportFilename(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `the-excavatorium-account-${y}-${m}-${d}-${hh}${mm}.json`;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export type AccountSnapshotPayload = {
  archive: { records: ArchiveRecord[]; links: ArchiveLink[] };
  cases: unknown[];
  evidence: unknown[];
  findings: unknown[];
  findingEvidence: unknown[];
  claims: unknown[];
  claimEvidence: unknown[];
  approvals: unknown[];
  decisionReviews: unknown[];
  custodianRuns: unknown[];
  providerSettings: unknown[];
  providerKeyStatus: ProviderKeyStatus;
};

/** Builds the downloadable account export. Never embeds secrets or Storage bytes. */
export function buildAccountExport(snapshot: AccountSnapshotPayload): AccountExport {
  const archive: ArchiveExport = buildBackup(snapshot.archive.records, snapshot.archive.links);
  return {
    application: "The Excavatorium",
    exportKind: "account",
    schemaVersion: ACCOUNT_EXPORT_SCHEMA_VERSION,
    exportedAt: archive.exportedAt,
    limitations: ACCOUNT_EXPORT_LIMITATIONS,
    records: archive.records,
    links: archive.links,
    cases: snapshot.cases,
    evidence: snapshot.evidence,
    findings: snapshot.findings,
    findingEvidence: snapshot.findingEvidence,
    claims: snapshot.claims,
    claimEvidence: snapshot.claimEvidence,
    approvals: snapshot.approvals,
    decisionReviews: snapshot.decisionReviews,
    custodianRuns: snapshot.custodianRuns,
    providerSettings: snapshot.providerSettings,
    providerKeyStatus: snapshot.providerKeyStatus,
  };
}

export function parseAccountSnapshotRpc(
  value: unknown,
  archive: { records: ArchiveRecord[]; links: ArchiveLink[] },
  providerKeyStatus: ProviderKeyStatus,
): AccountSnapshotPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Account export returned an invalid snapshot");
  }
  const row = value as Record<string, unknown>;
  return {
    archive,
    cases: asArray(row.cases),
    evidence: asArray(row.evidence),
    findings: asArray(row.findings),
    findingEvidence: asArray(row.finding_evidence),
    claims: asArray(row.claims),
    claimEvidence: asArray(row.claim_evidence),
    approvals: asArray(row.approvals),
    decisionReviews: asArray(row.decision_reviews),
    custodianRuns: asArray(row.custodian_runs),
    providerSettings: asArray(row.provider_settings),
    providerKeyStatus,
  };
}

export function accountExportContainsSecretMaterial(payload: AccountExport): boolean {
  const text = JSON.stringify(payload);
  if (/"ciphertext"\s*:/i.test(text)) return true;
  if (/"apiKey"\s*:/i.test(text)) return true;
  if (/"api_key"\s*:/i.test(text)) return true;
  if (/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}\b/.test(text)) return true;
  if (/"PROVIDER_KEY_ENCRYPTION_KEYS"\s*:/.test(text)) return true;
  if (/"SUPABASE_SERVICE_ROLE_KEY"\s*:/.test(text)) return true;
  return false;
}

/** Restorable archive slice from an account export (records+links only). */
export function archiveExportFromAccount(exportPayload: AccountExport): ArchiveExport {
  return buildBackup(exportPayload.records, exportPayload.links);
}
