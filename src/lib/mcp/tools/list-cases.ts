import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleListCases } from "../capability-handlers";

export default defineTool({
  name: "list_cases",
  title: "List Custodian cases",
  description: "List caller-owned Custodian cases when the owner-RLS case foundation is available.",
  inputSchema: {
    query: z.string().trim().min(1).max(200).optional(),
    status: z.string().trim().min(1).max(50).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleListCases,
});
