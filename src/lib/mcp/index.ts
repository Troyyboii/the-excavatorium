import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listRecords from "./tools/list-records";
import getRecord from "./tools/get-record";
import archiveStats from "./tools/archive-stats";

// The OAuth issuer must be the direct Supabase host, never a proxy URL.
const projectRef =
  (import.meta.env["VITE_SUPABASE_PROJECT_ID"] as string | undefined) ?? "rmlaknguklxwbbdnywcd";

export default defineMcp({
  name: "the-excavatorium",
  title: "The Excavatorium",
  version: "0.1.0",
  instructions:
    "Read-only tools over a private technical archive of tools, repositories, conversations and decisions. Use `archive_stats` for an overview, `list_records` to find records by type or text, and `get_record` for the full detail of one record. All access is scoped to the signed-in user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [archiveStats, listRecords, getRecord],
});
