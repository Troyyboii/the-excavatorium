import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { handleGetCase } from "../capability-handlers";

export default defineTool({
  name: "get_case",
  title: "Get a Custodian case",
  description:
    "Use to read one caller-owned Custodian case after listing. Key input: id (the case UUID). Returns the case. Returns NOT_FOUND when the id is unknown and FOUNDATION_UNAVAILABLE when the case tables are absent.",
  inputSchema: { id: z.string().uuid().describe("The case id.") },
  outputSchema: {
    case: z
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
      .catchall(z.unknown()),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: handleGetCase,
});
