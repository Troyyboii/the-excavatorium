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
import getFindings from "./tools/get-findings";
import getPendingApprovals from "./tools/get-pending-approvals";
import startAnalysis from "./tools/start-analysis";
import getRun from "./tools/get-run";
import cancelRun from "./tools/cancel-run";
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
  listCases,
  getCase,
  compareRecords,
  getFindings,
  getPendingApprovals,
  startAnalysis,
  getRun,
  cancelRun,
  excavateDocument,
] as const;

export default defineMcp({
  name: "the-excavatorium",
  title: "The Excavatorium",
  version: "0.3.0",
  instructions:
    "Bounded tools over a private technical archive of tools, repositories, conversations, decisions, and documents. Use `search` or the compatibility alias `list_records` to find records, `fetch` or `get_record` for a safe detail view, and `get_context` or `compare_records` for bounded analysis. `excavate_document` is the one intentional mutation: it excavates a user-supplied document and saves it to the authenticated owner's archive. Custodian case, finding, approval, and run tools report capability-unavailable when their owner-RLS foundation or runtime is absent. All access is scoped to the signed-in user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: mcpTools,
});
