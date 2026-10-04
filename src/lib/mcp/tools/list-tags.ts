import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleListTags } from "../record-handlers";

export default defineTool({
  name: "list_tags",
  title: "List archive tags",
  description:
    "Use to see which tags the signed-in owner's archive uses and how often. Takes no required inputs; optional limit caps how many tags come back. Returns count plus tags sorted by count descending, each with its tag and count. Scans up to 1000 records.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Maximum tags to return (default 100)."),
  },
  outputSchema: {
    count: z.number(),
    tags: z.array(
      z.object({
        tag: z.string(),
        count: z.number(),
      }),
    ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleListTags,
});
