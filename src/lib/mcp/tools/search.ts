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
  records: z.array(
    recordSummarySchema.extend({
      matchedFields: z.array(z.string()),
    }),
  ),
  nextCursor: z.string().nullable(),
};

const tagSchema = z.string().trim().min(1).max(100);

export default defineTool({
  name: "search",
  title: "Search archive records",
  description:
    "Use to discover records in the signed-in owner's archive by text. Key inputs: query (required, 1-200 chars, matched against title, summary, exact tag, plus key record_data text fields such as finalVerdict, reason, or highSignalFindings), recordType (optional filter to one canonical type), tags (optional exact-match tag list, max 10), updatedAfter (optional ISO datetime), projectRoute (optional, max 120 chars), limit (default 25, max 100), cursor (optional opaque page cursor). Returns count, record summaries with per-record matchedFields, and nextCursor (null when done); call fetch or get_context for detail.",
  inputSchema: {
    recordType: recordTypeEnum
      .optional()
      .describe("Restrict results to one canonical record type."),
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("Text to match in title, summary, tags, and key record_data fields."),
    tags: z
      .array(tagSchema)
      .max(10)
      .optional()
      .describe("Only return records carrying every listed tag (exact match, max 10)."),
    updatedAfter: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("Only return records updated at or after this ISO datetime."),
    projectRoute: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Only return records on this project route."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum rows to return (default 25)."),
    cursor: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe("Opaque page cursor from a previous result's nextCursor."),
  },
  outputSchema: searchOutputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleSearchRecords,
});
