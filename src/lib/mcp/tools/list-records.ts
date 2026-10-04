import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleSearchRecords } from "../record-handlers";
import { searchOutputSchema } from "./search";

// Compatibility alias for the original public tool name.
export default defineTool({
  name: "list_records",
  title: "List archive records",
  description:
    "Compatibility alias for search: use to discover or list the signed-in owner's records. Key inputs: query (optional here; omit to list recent records, otherwise 1-200 chars matched against title, summary, or exact tag), recordType (optional filter to one canonical type), limit (default 25, max 100). Returns count plus records summaries without record_data.",
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
      .describe("Text to match in title, summary, or tags."),
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
