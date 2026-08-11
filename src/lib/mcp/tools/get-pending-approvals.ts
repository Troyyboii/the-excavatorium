import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetPendingApprovals } from "../capability-handlers";

export default defineTool({
  name: "get_pending_approvals",
  title: "Get pending Custodian approvals",
  description:
    "Read pending caller-owned approvals when the Custodian runtime foundation is available.",
  inputSchema: {
    caseId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetPendingApprovals,
});
