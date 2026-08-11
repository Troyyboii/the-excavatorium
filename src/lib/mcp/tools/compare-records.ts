import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleCompareRecords } from "../record-handlers";

export default defineTool({
  name: "compare_records",
  title: "Compare archive records",
  description:
    "Compare two to four signed-in user's archive records using their safe projected fields.",
  inputSchema: {
    ids: z.array(z.string().uuid()).min(2).max(4).describe("Two to four distinct record ids."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleCompareRecords,
});
