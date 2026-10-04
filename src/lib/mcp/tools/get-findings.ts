import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetFindings } from "../capability-handlers";

const findingSchema = z
  .object({
    id: z.string().uuid(),
    evidence: z.array(z.record(z.unknown())).optional(),
  })
  .catchall(z.unknown());

export default defineTool({
  name: "get_findings",
  title: "Get Custodian findings",
  description:
    "Use to read the signed-in owner's Custodian findings with their evidence links. Key inputs: caseId (optional filter to one case UUID), limit (default 25, max 100). Returns count plus findings, each with an evidence array where each link carries its relationship_kind. Returns FOUNDATION_UNAVAILABLE when the finding tables are absent.",
  inputSchema: {
    caseId: z.string().uuid().optional().describe("Filter findings to one case id."),
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
    findings: z.array(findingSchema),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetFindings,
});
