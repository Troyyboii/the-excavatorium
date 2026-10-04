import { afterEach, describe, expect, test } from "bun:test";
import type { ToolContext } from "@lovable.dev/mcp-js";
import {
  decodeSearchCursor,
  encodeSearchCursor,
  handleGetDecisions,
  handleListRecent,
  handleListTags,
  handleSearchRecords,
} from "./record-handlers";
import { buildRecordDataSearchFilter, buildSearchFilter } from "./mcp-utils";

const ALLOWED_CLIENT = "11111111-1111-4111-8111-111111111111";

function authenticatedCtx(): ToolContext {
  return {
    isAuthenticated: () => true,
    getClientId: () => ALLOWED_CLIENT,
    getToken: () => "verified-token",
    getUserId: () => "33333333-3333-4333-8333-333333333333",
    getUserEmail: () => undefined,
    getScopes: () => undefined,
    getIssuer: () => undefined,
    getClaims: () => undefined,
  } as unknown as ToolContext;
}

function signedOutCtx(): ToolContext {
  return {
    isAuthenticated: () => false,
    getClientId: () => undefined,
    getToken: () => undefined,
    getUserId: () => undefined,
    getUserEmail: () => undefined,
    getScopes: () => undefined,
    getIssuer: () => undefined,
    getClaims: () => undefined,
  } as unknown as ToolContext;
}

const previousAllowedClientIds = process.env.MCP_ALLOWED_CLIENT_IDS;
const originalFetch = globalThis.fetch;
const requestedUrls: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  requestedUrls.length = 0;
  if (previousAllowedClientIds === undefined) delete process.env.MCP_ALLOWED_CLIENT_IDS;
  else process.env.MCP_ALLOWED_CLIENT_IDS = previousAllowedClientIds;
});

function queueSupabaseResponses(bodies: unknown[]) {
  const queue = [...bodies];
  globalThis.fetch = (async (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    requestedUrls.push(url);
    return new Response(JSON.stringify(queue.length > 0 ? queue.shift() : []), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function lastParams(): URLSearchParams {
  return new URL(requestedUrls[requestedUrls.length - 1]!).searchParams;
}

function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    record_type: "tool",
    title: "Lantern review",
    summary: "A bright find",
    tags: ["lantern", "review"],
    is_example: false,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    // Search selects JSON-path columns, which arrive flat rather than nested.
    finalVerdict: "Keep the lantern",
    ...overrides,
  };
}

function decisionRow(id: string, supersedesDecisionId: string | null, updatedAt: string) {
  return {
    id,
    record_type: "decision",
    title: `Decision ${id.slice(0, 8)}`,
    summary: "A recorded choice",
    tags: [],
    is_example: false,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: updatedAt,
    record_data: {
      reason: "The evidence pointed this way",
      trigger: "A review of the lantern findings",
      status: "Current",
      supersedesDecisionId,
    },
  };
}

describe("search v2", () => {
  test("matches record_data fields and reports matchedFields with cursor pagination", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([
      [
        recordRow(),
        recordRow({
          id: "00000000-0000-4000-8000-000000000002",
          title: "Other notes",
          summary: "Unrelated writing",
          tags: ["misc"],
          updated_at: "2026-09-15T00:00:00.000Z",
          finalVerdict: "Keep the lantern",
        }),
        recordRow({
          id: "00000000-0000-4000-8000-000000000003",
          updated_at: "2026-09-01T00:00:00.000Z",
        }),
      ],
    ]);

    const result = await handleSearchRecords({ query: "lantern", limit: 2 }, authenticatedCtx());
    expect(result.isError).toBeUndefined();
    const params = lastParams();
    expect(params.get("or")).toContain("title.ilike.");
    expect(params.get("or")).toContain("record_data->>finalVerdict.ilike.");
    expect(params.get("order")).toBe("updated_at.desc,id.desc");
    expect(params.get("limit")).toBe("3");
    const select = params.get("select");
    expect(select).toContain("record_data->finalVerdict");
    expect(select?.split(",")).not.toContain("record_data");
    expect(select).not.toContain("rawConversationText");

    const payload = result.structuredContent as {
      count: number;
      records: Array<{ id: string; matchedFields: string[] }>;
      nextCursor: string | null;
    };
    expect(payload.count).toBe(2);
    expect(payload.records[0]?.matchedFields).toEqual(["title", "tags", "finalVerdict"]);
    expect(payload.records[1]?.matchedFields).toEqual(["finalVerdict"]);
    expect(typeof payload.nextCursor).toBe("string");
    expect(decodeSearchCursor(payload.nextCursor!)).toEqual({
      updated_at: "2026-09-15T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000002",
    });
    expect(payload.records[0]).not.toHaveProperty("record_data");
  });

  test("applies tag, date, route, and type filters without a text query", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([[]]);

    const result = await handleSearchRecords(
      {
        recordType: "tool",
        tags: ["lantern"],
        updatedAfter: "2026-09-01T00:00:00.000Z",
        projectRoute: "night-crypt",
      },
      authenticatedCtx(),
    );
    expect(result.isError).toBeUndefined();
    const params = lastParams();
    expect(params.get("record_type")).toBe("eq.tool");
    expect(params.get("tags")).toBe("cs.{lantern}");
    expect(params.get("updated_at")).toBe("gte.2026-09-01T00:00:00.000Z");
    expect(params.get("record_data->>projectRoute")).toBe("eq.night-crypt");
    expect(params.get("or")).toBeNull();
    const payload = result.structuredContent as { count: number; nextCursor: null };
    expect(payload.count).toBe(0);
    expect(payload.nextCursor).toBeNull();
  });

  test("pages with an opaque cursor", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([[recordRow()]]);
    const cursor = encodeSearchCursor({
      updated_at: "2026-10-01T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000009",
    });

    const result = await handleSearchRecords({ cursor }, authenticatedCtx());
    expect(result.isError).toBeUndefined();
    const orFilters = lastParams().getAll("or");
    expect(orFilters).toHaveLength(1);
    expect(orFilters[0]).toContain("updated_at.lt.2026-10-01T00:00:00.000Z");
    expect(orFilters[0]).toContain("id.lt.00000000-0000-4000-8000-000000000009");
  });

  test("combines text and cursor filters in one explicit and()", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([[recordRow()]]);
    const cursor = encodeSearchCursor({
      updated_at: "2026-10-01T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000009",
    });

    const result = await handleSearchRecords({ query: "lantern", cursor }, authenticatedCtx());
    expect(result.isError).toBeUndefined();
    const baseFilter = buildSearchFilter("lantern");
    const dataFilter = buildRecordDataSearchFilter(undefined, "lantern");
    const textFilter = [baseFilter, dataFilter].filter((part) => part !== null).join(",");
    const cursorKeyset =
      "updated_at.lt.2026-10-01T00:00:00.000Z,and(updated_at.eq.2026-10-01T00:00:00.000Z,id.lt.00000000-0000-4000-8000-000000000009)";
    const orFilters = lastParams().getAll("or");
    expect(orFilters).toHaveLength(1);
    // postgrest-js wraps the or() value in one paren pair; inside sits a
    // single explicit conjunction of the two filter groups.
    expect(orFilters[0]).toBe(`(and(or(${textFilter}),or(${cursorKeyset})))`);
  });

  test("rejects cursors carrying filter syntax before any request", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([[]]);
    const fragments = [",", ")", "(", "or("];
    for (const fragment of fragments) {
      const cursors = [
        btoa(
          JSON.stringify({
            updated_at: "2026-10-01T00:00:00.000Z",
            id: `00000000-0000-4000-8000-000000000001${fragment}`,
          }),
        ),
        btoa(
          JSON.stringify({
            updated_at: `2026-10-01T00:00:00.000Z${fragment}`,
            id: "00000000-0000-4000-8000-000000000001",
          }),
        ),
      ];
      for (const cursor of cursors) {
        const result = await handleSearchRecords({ cursor }, authenticatedCtx());
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(result.content[0]?.text).toContain("INVALID_INPUT");
        expect(requestedUrls).toHaveLength(0);
      }
    }
  });

  test("never surfaces unselected record_data", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([
      [
        recordRow({
          title: "Other",
          summary: "Elsewhere",
          tags: [],
          finalVerdict: "Keep the lantern",
          rawConversationText: "secret transcript",
        }),
      ],
    ]);

    const result = await handleSearchRecords({ query: "lantern" }, authenticatedCtx());
    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as {
      records: Array<{ matchedFields: string[] }>;
    };
    expect(payload.records[0]?.matchedFields).toEqual(["finalVerdict"]);
    expect(JSON.stringify(result)).not.toContain("secret transcript");
  });

  test("normalizes datetimes to UTC ISO before sending", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([[], []]);

    const search = await handleSearchRecords(
      { updatedAfter: "2026-09-01T02:00:00+02:00" },
      authenticatedCtx(),
    );
    expect(search.isError).toBeUndefined();
    expect(new URL(requestedUrls[0]!).searchParams.get("updated_at")).toBe(
      "gte.2026-09-01T00:00:00.000Z",
    );

    const recent = await handleListRecent(
      { since: "2026-09-15T05:30:00+05:30" },
      authenticatedCtx(),
    );
    expect(recent.isError).toBeUndefined();
    expect(new URL(requestedUrls[1]!).searchParams.get("updated_at")).toBe(
      "gte.2026-09-15T00:00:00.000Z",
    );
  });

  test("rejects invalid inputs without structuredContent", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([[]]);
    const badInputs = [
      { cursor: "not-a-cursor!!!" },
      { cursor: encodeSearchCursor({ updated_at: "x", id: "y" }).slice(0, 4) },
      { updatedAfter: "yesterday" },
      { updatedAfter: "2026" },
      { tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) },
      { tags: ["ok", "bad,tag"] },
      { tags: ['quoted"tag'] },
      { tags: ["back\\slash"] },
      { limit: 101 },
      { query: "%%%" },
    ];
    for (const input of badInputs) {
      const result = await handleSearchRecords(
        input as Parameters<typeof handleSearchRecords>[0],
        authenticatedCtx(),
      );
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content[0]?.text).toContain("INVALID_INPUT");
    }
  });

  test("requires authentication before any Supabase request", async () => {
    queueSupabaseResponses([[]]);
    const result = await handleSearchRecords({ query: "lantern" }, signedOutCtx());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("AUTH_REQUIRED");
    expect(requestedUrls).toHaveLength(0);
  });
});

describe("list_tags", () => {
  test("aggregates tag counts sorted by count desc", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([
      [{ tags: ["b", "a"] }, { tags: ["a"] }, { tags: [] }, { tags: null }, {}],
    ]);

    const result = await handleListTags({ limit: 1 }, authenticatedCtx());
    expect(result.isError).toBeUndefined();
    expect(lastParams().get("select")).toBe("tags");
    const payload = result.structuredContent as {
      count: number;
      tags: Array<{ tag: string; count: number }>;
    };
    // Limit applies to returned tags, not the aggregation.
    expect(payload).toEqual({ count: 1, tags: [{ tag: "a", count: 2 }] });
  });

  test("returns an empty result when no tags exist", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([[]]);
    const result = await handleListTags({}, authenticatedCtx());
    expect(result.structuredContent).toEqual({ count: 0, tags: [] });
  });
});

describe("list_recent", () => {
  test("returns summaries updated since the given time", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([[recordRow()]]);

    const result = await handleListRecent(
      { since: "2026-09-15T00:00:00.000Z", recordType: "tool" },
      authenticatedCtx(),
    );
    expect(result.isError).toBeUndefined();
    const params = lastParams();
    expect(params.get("updated_at")).toBe("gte.2026-09-15T00:00:00.000Z");
    expect(params.get("record_type")).toBe("eq.tool");
    const payload = result.structuredContent as {
      count: number;
      records: Array<Record<string, unknown>>;
    };
    expect(payload.count).toBe(1);
    expect(payload.records[0]).not.toHaveProperty("record_data");
  });

  test("rejects a missing or unparsable since", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([[]]);
    for (const since of ["not-a-date", "", "2026"]) {
      const result = await handleListRecent({ since }, authenticatedCtx());
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content[0]?.text).toContain("INVALID_INPUT");
    }
  });
});

describe("get_decisions", () => {
  const d1 = "10000000-0000-4000-8000-000000000001";
  const d2 = "10000000-0000-4000-8000-000000000002";
  const d3 = "10000000-0000-4000-8000-000000000003";

  test("filters Current plus Tentative by default and resolves the chain", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([
      [decisionRow(d1, d2, "2026-10-03T00:00:00.000Z")],
      [decisionRow(d2, d3, "2026-10-02T00:00:00.000Z")],
      [decisionRow(d3, null, "2026-10-01T00:00:00.000Z")],
    ]);

    const result = await handleGetDecisions({ query: "lantern" }, authenticatedCtx());
    expect(result.isError).toBeUndefined();
    // The chain resolver issues follow-up requests; assert on the initial query.
    const params = new URL(requestedUrls[0]!).searchParams;
    expect(params.get("record_type")).toBe("eq.decision");
    expect(params.get("record_data->>status")).toBe("in.(Current,Tentative)");
    expect(params.get("or")).toContain("record_data->>reason.ilike.");

    const payload = result.structuredContent as {
      count: number;
      decisions: Array<{
        id: string;
        record_data: Record<string, unknown>;
        supersedes: { id: string; record_data: Record<string, unknown> } | null;
        supersedesChain: string[];
      }>;
    };
    expect(payload.count).toBe(1);
    expect(payload.decisions[0]?.supersedes?.id).toBe(d2);
    expect(payload.decisions[0]?.supersedes?.record_data).toMatchObject({ status: "Current" });
    expect(payload.decisions[0]?.supersedesChain).toEqual([d2, d3]);
    expect(JSON.stringify(payload)).not.toContain("rawConversationText");
  });

  test("caps the chain at depth 5", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    const ids = Array.from({ length: 7 }, (_, i) => `20000000-0000-4000-8000-00000000000${i + 1}`);
    const rows = ids.map((id, i) =>
      decisionRow(id, i < ids.length - 1 ? ids[i + 1]! : null, "2026-10-03T00:00:00.000Z"),
    );
    queueSupabaseResponses([[rows[0]], [rows[1]], [rows[2]], [rows[3]], [rows[4]], [rows[5]]]);

    const result = await handleGetDecisions({}, authenticatedCtx());
    const payload = result.structuredContent as {
      decisions: Array<{ supersedesChain: string[] }>;
    };
    expect(payload.decisions[0]?.supersedesChain).toEqual(ids.slice(1, 6));
  });

  test("stops cleanly on cycles and missing predecessors", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([
      [decisionRow(d1, d2, "2026-10-03T00:00:00.000Z")],
      [decisionRow(d2, d1, "2026-10-02T00:00:00.000Z")],
    ]);
    const cycled = await handleGetDecisions({}, authenticatedCtx());
    const cycledPayload = cycled.structuredContent as {
      decisions: Array<{ supersedesChain: string[] }>;
    };
    expect(cycledPayload.decisions[0]?.supersedesChain).toEqual([d2]);

    queueSupabaseResponses([[decisionRow(d1, d2, "2026-10-03T00:00:00.000Z")], []]);
    const missing = await handleGetDecisions({}, authenticatedCtx());
    const missingPayload = missing.structuredContent as {
      decisions: Array<{
        supersedes: unknown;
        supersedesChain: string[];
      }>;
    };
    expect(missingPayload.decisions[0]?.supersedes).toBeNull();
    expect(missingPayload.decisions[0]?.supersedesChain).toEqual([]);
  });

  test("rejects an unknown status", async () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = ALLOWED_CLIENT;
    queueSupabaseResponses([[]]);
    const result = await handleGetDecisions({ status: "Decided" as never }, authenticatedCtx());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("INVALID_INPUT");
  });
});
