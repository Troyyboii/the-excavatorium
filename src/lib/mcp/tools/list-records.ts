import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_records",
  title: "List archive records",
  description:
    "List the signed-in user's archive records, optionally filtered by record type or a text query matching the title, summary, or tags.",
  inputSchema: {
    recordType: z
      .enum(["tool", "repository", "conversation", "decision"])
      .optional()
      .describe("Restrict results to one record type."),
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Text to match in title or summary."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum rows to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ recordType, query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let request = supabase
      .from("records")
      .select("id,record_type,title,summary,tags,is_example,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 25);
    if (recordType) request = request.eq("record_type", recordType);
    if (query) {
      const escaped = query.replace(/[%,()]/g, " ").trim();
      if (escaped) request = request.or(`title.ilike.%${escaped}%,summary.ilike.%${escaped}%`);
    }
    const { data, error } = await request;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { count: rows.length, records: rows },
    };
  },
});
