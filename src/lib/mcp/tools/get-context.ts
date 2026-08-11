import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetContext } from "../record-handlers";

export default defineTool({
  name: "get_context",
  title: "Get record context",
  description:
    "Fetch one safe archive record and its caller-owned linked records for bounded context.",
  inputSchema: {
    id: z.string().uuid().describe("The anchor record id."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum linked records (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetContext,
});
