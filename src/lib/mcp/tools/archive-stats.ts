import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";
import { authResult, errorResult, jsonResult } from "../mcp-utils";

const TYPES = ["tool", "repository", "conversation", "decision", "document"] as const;

export default defineTool({
  name: "archive_stats",
  title: "Archive statistics",
  description:
    "Return counts of the signed-in user's archive: records per type, total records, and total links.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const authError = await authResult(ctx);
    if (authError) return authError;
    try {
      const supabase = supabaseForUser(ctx);
      const byType: Record<string, number> = {};
      for (const type of TYPES) {
        const { count, error } = await supabase
          .from("records")
          .select("id", { count: "exact", head: true })
          .eq("record_type", type);
        if (error) return errorResult("DATA_UNAVAILABLE");
        byType[type] = count ?? 0;
      }
      const { count: linkCount, error: linkError } = await supabase
        .from("record_links")
        .select("id", { count: "exact", head: true });
      if (linkError) return errorResult("DATA_UNAVAILABLE");

      const totalRecords = Object.values(byType).reduce((sum, n) => sum + n, 0);
      return jsonResult({ recordsByType: byType, totalRecords, totalLinks: linkCount ?? 0 });
    } catch {
      return errorResult("DATA_UNAVAILABLE");
    }
  },
});
