import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleSearchRecords } from "../record-handlers";

export default defineTool({
  name: "search",
  title: "Search archive records",
  description:
    "Search the signed-in user's five canonical archive record types by title, summary, or exact tag.",
  inputSchema: {
    recordType: z
      .enum(["tool", "repository", "conversation", "decision", "document"])
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
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleSearchRecords,
});
