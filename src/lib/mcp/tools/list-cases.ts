import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleListCases } from "../capability-handlers";

const caseSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().nullish(),
    objective: z.unknown().optional(),
    current_question: z.unknown().optional(),
    default_working_set: z.unknown().optional(),
    archive_scope: z.unknown().optional(),
    status: z.string().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
  })
  .catchall(z.unknown());

export default defineTool({
  name: "list_cases",
  title: "List Custodian cases",
  description:
    "Use to discover the signed-in owner's Custodian cases (Investigations). Key inputs: query (optional 1-200 char title/summary text), status (optional exact status filter), limit (default 25, max 100). Returns count plus cases. Returns FOUNDATION_UNAVAILABLE when the case tables are absent.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Text to match in case title or summary."),
    status: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .optional()
      .describe("Filter to one exact case status."),
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
    cases: z.array(caseSchema),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleListCases,
});
