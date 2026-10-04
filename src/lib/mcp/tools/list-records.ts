import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleSearchRecords } from "../record-handlers";
import { searchOutputSchema } from "./search";

// Compatibility alias for the original public tool name.
export default defineTool({
  name: "list_records",
  title: "List archive records",
  description:
    "Compatibility alias for search: use to discover or list the signed-in owner's records. Key inputs: query (optional here; omit to list recent records, otherwise 1-200 chars matched against title, summary, exact tag, and key record_data fields), recordType (optional filter to one canonical type), tags (optional exact-match tag list, max 10), updatedAfter (optional ISO datetime), projectRoute (optional, max 120 chars), limit (default 25, max 100), cursor (optional opaque page cursor). Returns count, record summaries with per-record matchedFields, and nextCursor (null when done).",
  inputSchema: {
    recordType: z
      .enum(["tool", "repository", "conversation", "decision", "document"])
      .optional()
      .describe("Restrict results to one canonical record type."),
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Text to match in title, summary, tags, and key record_data fields."),
    tags: z
      .array(z.string().trim().min(1).max(100))
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
