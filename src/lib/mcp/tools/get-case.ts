import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetCase } from "../capability-handlers";

export default defineTool({
  name: "get_case",
  title: "Get a Custodian case",
  description:
    "Fetch one caller-owned Custodian case when the owner-RLS case foundation is available.",
  inputSchema: { id: z.string().uuid().describe("The case id.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetCase,
});
