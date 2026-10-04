import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleFetchRecord } from "../record-handlers";

const recordTypeEnum = z.enum(["tool", "repository", "conversation", "decision", "document"]);

export const fetchOutputSchema = {
  record: z.object({
    id: z.string().uuid(),
    record_type: recordTypeEnum,
    title: z.string(),
    summary: z.string(),
    tags: z.array(z.string()),
    is_example: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
    record_data: z.record(z.unknown()),
  }),
  linkedRecordIds: z.array(z.string().uuid()),
};

export default defineTool({
  name: "fetch",
  title: "Fetch an archive record",
  description:
    "Use after search to read one full record from the signed-in owner's archive. Key input: id (the record UUID). Returns the record with its safe record_data projection (never raw transcripts, user ids, seed keys, or storage paths) plus linkedRecordIds; call get_context for the linked records themselves.",
  inputSchema: {
    id: z.string().uuid().describe("The record id."),
  },
  outputSchema: fetchOutputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleFetchRecord,
});
