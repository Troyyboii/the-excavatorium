import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleCancelRun } from "../capability-handlers";

export default defineTool({
  name: "cancel_run",
  title: "Cancel Custodian run",
  description:
    "Reserved cancellation boundary; never fakes cancellation or performs a direct write.",
  inputSchema: { id: z.string().uuid().describe("The analysis run id.") },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  handler: handleCancelRun,
});
