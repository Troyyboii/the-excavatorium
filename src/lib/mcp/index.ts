import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listRecords from "./tools/list-records";
import getRecord from "./tools/get-record";
import archiveStats from "./tools/archive-stats";
import search from "./tools/search";
import fetchRecord from "./tools/fetch";
import getContext from "./tools/get-context";
import listCases from "./tools/list-cases";
import getCase from "./tools/get-case";
import compareRecords from "./tools/compare-records";
import listTags from "./tools/list-tags";
import listRecent from "./tools/list-recent";
import getDecisions from "./tools/get-decisions";
import getFindings from "./tools/get-findings";
import getPendingApprovals from "./tools/get-pending-approvals";
import getRun from "./tools/get-run";
import excavateDocument from "./tools/excavate-document";

// The OAuth issuer must be the direct Supabase host, never a proxy URL.
const projectRef =
  (import.meta.env["VITE_SUPABASE_PROJECT_ID"] as string | undefined) ?? "rmlaknguklxwbbdnywcd";

export const mcpTools = [
  archiveStats,
  listRecords,
  getRecord,
  search,
  fetchRecord,
  getContext,
  listTags,
  listRecent,
  getDecisions,
  listCases,
  getCase,
  compareRecords,
  getFindings,
  getPendingApprovals,
  getRun,
  excavateDocument,
] as const;

export default defineMcp({
  name: "the-excavatorium",
  title: "The Excavatorium",
  version: "0.5.0",
  instructions:
    "Private owner-scoped archive with five record types: tool, repository, conversation, decision, document. Workflow: search (list_records is an alias) to discover records, fetch (get_record is an alias) for one safe record, then get_context for linked records or compare_records for 2-4 records. Search also matches key record_data text fields and supports tag, updatedAfter, projectRoute, and cursor filters with per-record matchedFields and nextCursor. list_tags reports tag usage, list_recent catches up on records updated since a time, and get_decisions reads decisions with their resolved supersedes chain. archive_stats reports counts; list_cases, get_case, get_findings, get_pending_approvals, and get_run read Custodian cases, findings, approvals, and runs. excavate_document is the only mutation: it saves a user-supplied PDF, Markdown, or text file as a document record. All access is scoped to the signed-in owner. Errors use stable machine-readable codes: AUTH_REQUIRED, AUTH_CONFIGURATION_ERROR, CLIENT_NOT_ALLOWED, INVALID_INPUT, FILE_UNAVAILABLE, FILE_TOO_LARGE, UNSUPPORTED_FILE, QUOTA_EXCEEDED, EXTRACTION_FAILED, SAVE_FAILED, NOT_FOUND, DATA_UNAVAILABLE, FOUNDATION_UNAVAILABLE, RUNTIME_UNAVAILABLE. Safe projections never include raw transcripts, user ids, seed keys, or storage paths.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: mcpTools,
});
