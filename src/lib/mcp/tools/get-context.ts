import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetContext } from "../record-handlers";

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
  name: "get_context",
  title: "Get record context",
  description:
    "Use to load an anchor record plus its caller-owned linked records for bounded context. Key inputs: id (the anchor record UUID), limit (default 25, max 50 linked records). Returns the anchor record, linkedRecordIds, and linkedRecords with safe projections.",
  inputSchema: {
    id: z.string().uuid().describe("The anchor record id."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum linked records (default 25)."),
  },
  outputSchema: {
    record: safeRecordSchema,
    linkedRecordIds: z.array(z.string().uuid()),
    linkedRecords: z.array(safeRecordSchema),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetContext,
});
