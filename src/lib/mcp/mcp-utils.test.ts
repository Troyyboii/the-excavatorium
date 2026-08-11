import { describe, expect, it } from "bun:test";
import {
  boundedLimit,
  buildSearchFilter,
  compareProjectedRecords,
  errorResult,
  mapSupabaseError,
  projectRecord,
} from "./mcp-utils";

describe("MCP safe projection", () => {
  it("keeps canonical fields and redacts sensitive archive values by default", () => {
    const projected = projectRecord({
      id: "record-1",
      user_id: "user-secret",
      seed_key: "seed-secret",
      record_type: "conversation",
      title: "Conversation",
      summary: "Summary",
      tags: ["tag"],
      is_example: false,
      created_at: "2026-08-11T00:00:00Z",
      updated_at: "2026-08-11T00:00:00Z",
      record_data: {
        conversationDate: "2026-08-11",
        rawConversationText: "private transcript",
        highSignalFindings: [{ text: "finding", user_id: "nested-secret" }],
      },
    });

    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("user-secret");
    expect(serialized).not.toContain("seed-secret");
    expect(serialized).not.toContain("private transcript");
    expect(serialized).not.toContain("nested-secret");
    expect(projected.record_data).toEqual({
      conversationDate: "2026-08-11",
      highSignalFindings: [{ text: "finding" }],
    });
  });

  it("redacts document storage paths and unknown document fields", () => {
    const projected = projectRecord({
      id: "record-2",
      record_type: "document",
      title: "Document",
      summary: "Summary",
      tags: [],
      is_example: false,
      created_at: "",
      updated_at: "",
      record_data: {
        originalFileName: "notes.md",
        storagePath: "user/documents/secret",
        extractedContentPath: "user/documents/extracted",
        contentHash: "hash",
        privateBody: "not allowed",
      },
    });

    expect(projected.record_data).toEqual({ originalFileName: "notes.md", contentHash: "hash" });
  });
});

describe("MCP comparison and input boundaries", () => {
  it("returns only differing comparable fields", () => {
    const first = projectRecord({
      id: "a",
      record_type: "tool",
      title: "Same",
      summary: "One",
      tags: [],
      is_example: false,
      created_at: "",
      updated_at: "",
      record_data: { status: "Active", category: "AI" },
    });
    const second = { ...first, id: "b", summary: "Two", record_data: { status: "Buried" } };

    expect(compareProjectedRecords([first, second])).toEqual({
      recordIds: ["a", "b"],
      differences: {
        summary: ["One", "Two"],
        "record_data.category": ["AI", undefined],
        "record_data.status": ["Active", "Buried"],
      },
    });
  });

  it("bounds limits and neutralizes PostgREST filter metacharacters", () => {
    expect(boundedLimit(undefined)).toBe(25);
    expect(boundedLimit(100)).toBe(100);
    expect(() => boundedLimit(101)).toThrow();
    expect(buildSearchFilter("  alpha%,(beta  ")).toBe(
      "title.ilike.%alpha beta%,summary.ilike.%alpha beta%,tags.cs.{alpha beta}",
    );
    expect(buildSearchFilter("alpha},summary.eq.true:foo*bar&baz|qux\"quoted'")).toBe(
      "title.ilike.%alpha summary eq true foo bar baz qux quoted%,summary.ilike.%alpha summary eq true foo bar baz qux quoted%,tags.cs.{alpha summary eq true foo bar baz qux quoted}",
    );
    expect(buildSearchFilter("%%% ")).toBeNull();
  });
});

describe("MCP error mapping", () => {
  it("maps unavailable capabilities without exposing upstream error text", () => {
    expect(
      mapSupabaseError(
        { code: "42P01", message: "relation secret does not exist" },
        "FOUNDATION_UNAVAILABLE",
      ),
    ).toBe("FOUNDATION_UNAVAILABLE");
    expect(
      mapSupabaseError(
        { code: "PGRST205", message: "schema cache details" },
        "RUNTIME_UNAVAILABLE",
      ),
    ).toBe("RUNTIME_UNAVAILABLE");
    expect(
      mapSupabaseError(
        { code: "42703", message: 'column "summary" does not exist' },
        "FOUNDATION_UNAVAILABLE",
      ),
    ).toBe("DATA_UNAVAILABLE");
    const result = errorResult("RUNTIME_UNAVAILABLE");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("RUNTIME_UNAVAILABLE");
    expect(result.content[0].text).not.toContain("secret");
  });
});
