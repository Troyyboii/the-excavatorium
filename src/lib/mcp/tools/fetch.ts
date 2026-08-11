import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleFetchRecord } from "../record-handlers";

export default defineTool({
  name: "fetch",
  title: "Fetch an archive record",
  description:
    "Fetch one signed-in user's archive record with an explicit safe projection and linked record ids.",
  inputSchema: {
    id: z.string().uuid().describe("The record id."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleFetchRecord,
});
