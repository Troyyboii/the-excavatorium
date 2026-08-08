import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_record",
  title: "Get archive record",
  description:
    "Fetch one archive record by id, including its full structured record data and the ids of records linked to it.",
  inputSchema: {
    id: z.string().uuid().describe("The record id."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("records")
      .select(
        "id,record_type,title,summary,tags,record_data,is_example,seed_key,created_at,updated_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "No record found." }], isError: true };

    const { data: links, error: linkError } = await supabase
      .from("record_links")
      .select("id,source_record_id,target_record_id")
      .or(`source_record_id.eq.${id},target_record_id.eq.${id}`);
    if (linkError) return { content: [{ type: "text", text: linkError.message }], isError: true };

    const linkedIds = (links ?? []).map((l) =>
      l.source_record_id === id ? l.target_record_id : l.source_record_id,
    );
    const payload = { record: data, linkedRecordIds: linkedIds };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
