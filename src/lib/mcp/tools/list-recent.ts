import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleListRecent } from "../record-handlers";

export default defineTool({
  name: "list_recent",
  title: "List recently updated records",
  description:
    "Use to catch up on what changed in the signed-in owner's archive. Key inputs: since (required ISO datetime; only records updated at or after it come back), recordType (optional filter to one of tool, repository, conversation, decision, document), limit (default 25, max 100). Returns count plus record summaries ordered newest first, without record_data.",
  inputSchema: {
    since: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("Only return records updated at or after this ISO datetime."),
    recordType: z
      .enum(["tool", "repository", "conversation", "decision", "document"])
      .optional()
      .describe("Restrict results to one canonical record type."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum rows to return (default 25)."),
  },
  outputSchema: {
    count: z.number(),
    records: z.array(
      z.object({
        id: z.string().uuid(),
        record_type: z.enum(["tool", "repository", "conversation", "decision", "document"]),
        title: z.string(),
        summary: z.string(),
        tags: z.array(z.string()),
        is_example: z.boolean(),
        created_at: z.string(),
        updated_at: z.string(),
      }),
    ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleListRecent,
});
