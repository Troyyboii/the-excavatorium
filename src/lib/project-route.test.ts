import { describe, expect, test } from "bun:test";
import { emptyConversationData, emptyDocumentData, emptyRecordData } from "./types";
import type { ArchiveRecord } from "./types";
import { validateBackup } from "./format";
import {
  isValidProjectRoute,
  normalizeProjectRoute,
  ownerProjectRoutes,
  PROJECT_ROUTE_MAX_LENGTH,
  withNormalizedProjectRoute,
} from "./project-route";

const HISTORICAL = ["The Forge", "The Chamber", "The Book", "General", "Do not preserve"];

function record(
  id: string,
  recordType: "conversation" | "document" | "tool",
  data: Record<string, unknown>,
  updatedAt: string,
): ArchiveRecord {
  return { id, recordType, recordData: data, updatedAt } as unknown as ArchiveRecord;
}

describe("project route", () => {
  test("blank input persists as null, arbitrary strings are kept and trimmed", () => {
    expect(normalizeProjectRoute("")).toBeNull();
    expect(normalizeProjectRoute("   ")).toBeNull();
    expect(normalizeProjectRoute(null)).toBeNull();
    expect(normalizeProjectRoute("  Kitchen renovation ")).toBe("Kitchen renovation");
  });

  test("validity: null or a bounded non-blank string; historical values stay valid", () => {
    expect(isValidProjectRoute(null)).toBe(true);
    expect(isValidProjectRoute("Q4 research")).toBe(true);
    for (const value of HISTORICAL) expect(isValidProjectRoute(value)).toBe(true);
    expect(isValidProjectRoute("x".repeat(PROJECT_ROUTE_MAX_LENGTH))).toBe(true);
    expect(isValidProjectRoute("x".repeat(PROJECT_ROUTE_MAX_LENGTH + 1))).toBe(false);
    expect(isValidProjectRoute("   ")).toBe(false);
    expect(isValidProjectRoute(7)).toBe(false);
  });

  test("new records carry no Dario-specific default", () => {
    expect(emptyConversationData.projectRoute).toBeNull();
    expect(emptyDocumentData.projectRoute).toBeNull();
    const conversation = emptyRecordData("conversation", "2026-01-01") as { projectRoute: unknown };
    expect(conversation.projectRoute).toBeNull();
  });

  test("suggestions come only from the given owner's records; a new owner gets none", () => {
    expect(ownerProjectRoutes([])).toEqual([]);
    const mine = [
      record("1", "conversation", { projectRoute: "Alpha" }, "2026-01-01T00:00:00Z"),
      record("2", "document", { projectRoute: "Beta" }, "2026-03-01T00:00:00Z"),
      record("3", "conversation", { projectRoute: "Alpha" }, "2026-02-01T00:00:00Z"),
      record("4", "conversation", { projectRoute: null }, "2026-04-01T00:00:00Z"),
      record("5", "tool", { projectRoute: "Ignored" }, "2026-05-01T00:00:00Z"),
    ];
    expect(ownerProjectRoutes(mine)).toEqual(["Beta", "Alpha"]);
  });

  test("save normalization only touches conversations and documents", () => {
    expect(withNormalizedProjectRoute("conversation", { projectRoute: "  " })).toEqual({
      projectRoute: null,
    });
    expect(withNormalizedProjectRoute("document", { projectRoute: " Lab " })).toEqual({
      projectRoute: "Lab",
    });
    expect(withNormalizedProjectRoute("tool", { projectRoute: "  " })).toEqual({
      projectRoute: "  ",
    });
  });

  test("backups accept null, arbitrary and historical conversation routes", () => {
    const build = (route: unknown) =>
      validateBackup({
        application: "The Excavatorium",
        schemaVersion: 1,
        exportedAt: "2026-01-01T00:00:00.000Z",
        records: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            recordType: "conversation",
            title: "T",
            summary: "",
            tags: [],
            isExample: false,
            seedKey: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            recordData: { ...emptyConversationData, projectRoute: route },
          },
        ],
        links: [],
      });
    for (const route of [null, "Anything at all", ...HISTORICAL]) {
      expect(build(route)).toMatchObject({ ok: true });
    }
    const tooLong = build("x".repeat(121));
    expect(tooLong.ok).toBe(false);
  });
});

describe("no hard-coded personal taxonomy in product code", () => {
  test("sources no longer ship the historical route list", async () => {
    const files = [
      "src/lib/types.ts",
      "src/lib/document.ts",
      "src/lib/conversation-excavation.ts",
      "src/components/record-form.tsx",
      "src/components/record-list-page.tsx",
      "supabase/functions/conversation-extract/index.ts",
      "supabase/functions/_shared/document.ts",
    ];
    for (const file of files) {
      const source = await Bun.file(file).text();
      for (const value of ["The Forge", "The Chamber", "The Book", "Do not preserve"]) {
        expect(source.includes(value)).toBe(false);
      }
    }
  });
});
