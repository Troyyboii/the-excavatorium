import { describe, expect, it } from "bun:test";
import { mcpTools } from "./index";

describe("MCP registry", () => {
  it("keeps compatibility tools and registers the safe Custodian slice", () => {
    expect(mcpTools.map((tool) => tool.name)).toEqual([
      "archive_stats",
      "list_records",
      "get_record",
      "search",
      "fetch",
      "get_context",
      "list_cases",
      "get_case",
      "compare_records",
      "get_findings",
      "get_pending_approvals",
      "start_analysis",
      "get_run",
      "cancel_run",
    ]);
  });
});
