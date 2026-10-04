import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleSearchRecords } from "../record-handlers";

const recordTypeEnum = z.enum(["tool", "repository", "conversation", "decision", "document"]);

const recordSummarySchema = z.object({
  id: z.string().uuid(),
  record_type: recordTypeEnum,
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  is_example: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const searchOutputSchema = {
  count: z.number(),
  records: z.array(recordSummarySchema),
};

export default defineTool({
  name: "search",
  title: "Search archive records",
  description:
    "Use to discover records in the signed-in owner's archive by text. Key inputs: query (required, 1-200 chars, matched against title, summary, or exact tag), recordType (optional filter to one of tool, repository, conversation, decision, document), limit (default 25, max 100). Returns count plus records summaries without record_data; call fetch or get_context for detail.",
  inputSchema: {
    recordType: recordTypeEnum
      .optional()
      .describe("Restrict results to one canonical record type."),
    query: z.string().trim().min(1).max(200).describe("Text to match in title, summary, or tags."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum rows to return (default 25)."),
  },
  outputSchema: searchOutputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleSearchRecords,
});
