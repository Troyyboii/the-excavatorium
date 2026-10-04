import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetDecisions } from "../record-handlers";

const decisionStatusEnum = z.enum(["Current", "Tentative", "Superseded", "Reversed", "Archived"]);

const decisionRecordSchema = z.object({
  id: z.string().uuid(),
  record_type: z.literal("decision"),
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  is_example: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  record_data: z.record(z.unknown()),
});

export default defineTool({
  name: "get_decisions",
  title: "Get decision records",
  description:
    "Use to read the signed-in owner's decision records with their safe record_data. Key inputs: query (optional 1-200 char text matched against title, summary, tags, reason, and trigger), status (optional decision status; omit for the default Current plus Tentative), limit (default 25, max 100). Returns count plus decisions, each with supersedes: the decision this one directly replaces, or null; supersedesChain: ids of older decisions it replaces, max depth 5.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Text to match in title, summary, tags, reason, or trigger."),
    status: decisionStatusEnum
      .optional()
      .describe("Filter to one decision status (default Current plus Tentative)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum rows to return (default 25)."),
  },
  outputSchema: {
    count: z.number(),
    decisions: z.array(
      decisionRecordSchema.extend({
        supersedes: decisionRecordSchema.nullable(),
        supersedesChain: z.array(z.string()),
      }),
    ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetDecisions,
});
