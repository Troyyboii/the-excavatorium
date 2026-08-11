import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetRun } from "../capability-handlers";

export default defineTool({
  name: "get_run",
  title: "Get Custodian run status",
  description:
    "Read a caller-owned analysis run status when the agent-runs runtime foundation is available.",
  inputSchema: { id: z.string().uuid().describe("The analysis run id.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetRun,
});
