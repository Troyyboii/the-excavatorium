import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleCompareRecords } from "../record-handlers";

const recordTypeEnum = z.enum(["tool", "repository", "conversation", "decision", "document"]);

const safeRecordSchema = z.object({
  id: z.string().uuid(),
  record_type: recordTypeEnum,
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  is_example: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  record_data: z.record(z.unknown()),
});

export default defineTool({
  name: "compare_records",
  title: "Compare archive records",
  description:
    "Use after fetching records to contrast 2-4 of them. Key input: ids (2-4 distinct record UUIDs). Returns recordIds, differences (only fields whose values differ across the set), and the full safe records.",
  inputSchema: {
    ids: z.array(z.string().uuid()).min(2).max(4).describe("Two to four distinct record ids."),
  },
  outputSchema: {
    recordIds: z.array(z.string().uuid()),
    differences: z.record(z.array(z.unknown())),
    records: z.array(safeRecordSchema),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleCompareRecords,
});
