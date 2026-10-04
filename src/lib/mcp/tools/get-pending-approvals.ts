import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetPendingApprovals } from "../capability-handlers";

export default defineTool({
  name: "get_pending_approvals",
  title: "Get pending Custodian approvals",
  description:
    "Use to check pending approvals before acting on a case. Key inputs: caseId (optional filter to one case UUID), limit (default 25, max 100). Returns count plus approvals including the exact proposed action hash, proposed_diff, tool_action, and provenance. Read-only: it never records an owner decision or executes work. Returns RUNTIME_UNAVAILABLE when the runtime tables are absent.",
  inputSchema: {
    caseId: z.string().uuid().optional().describe("Filter approvals to one case id."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum rows to return (default 25)."),
  },
  outputSchema: {
    count: z.number(),
    approvals: z.array(
      z
        .object({
          id: z.string().uuid(),
          status: z.string().nullish(),
        })
        .catchall(z.unknown()),
    ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetPendingApprovals,
});
