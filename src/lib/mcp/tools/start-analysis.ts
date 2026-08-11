import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleStartAnalysis } from "../capability-handlers";

export default defineTool({
  name: "start_analysis",
  title: "Start Custodian analysis",
  description:
    "Reserved read-safe boundary for analysis execution; never fakes a run or performs a direct write.",
  inputSchema: {
    caseId: z.string().uuid().describe("The case to analyze."),
    recordIds: z.array(z.string().uuid()).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  handler: handleStartAnalysis,
});
