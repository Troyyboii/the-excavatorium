import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetRun } from "../capability-handlers";

export default defineTool({
  name: "get_run",
  title: "Get Custodian run status",
  description:
    "Use to check the status of one caller-owned analysis run. Key input: id (the analysis run UUID). Returns the run with its status, model tier, and failure details when present. Returns NOT_FOUND for an unknown id and RUNTIME_UNAVAILABLE when the runtime tables are absent.",
  inputSchema: { id: z.string().uuid().describe("The analysis run id.") },
  outputSchema: {
    run: z
      .object({
        id: z.string().uuid(),
        status: z.string().nullish(),
      })
      .catchall(z.unknown()),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetRun,
});
