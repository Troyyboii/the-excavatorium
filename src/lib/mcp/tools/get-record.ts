import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleFetchRecord } from "../record-handlers";
import { fetchOutputSchema } from "./fetch";

// Compatibility alias for the original public tool name.
export default defineTool({
  name: "get_record",
  title: "Get archive record",
  description:
    "Compatibility alias for fetch: use to read one full record from the signed-in owner's archive. Key input: id (the record UUID). Returns the record with its safe record_data projection plus linkedRecordIds.",
  inputSchema: {
    id: z.string().uuid().describe("The record id."),
  },
  outputSchema: fetchOutputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleFetchRecord,
});
