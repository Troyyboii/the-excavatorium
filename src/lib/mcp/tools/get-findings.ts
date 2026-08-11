import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetFindings } from "../capability-handlers";

export default defineTool({
  name: "get_findings",
  title: "Get Custodian findings",
  description:
    "List caller-owned Custodian findings when the owner-RLS case foundation is available.",
  inputSchema: {
    caseId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetFindings,
});
