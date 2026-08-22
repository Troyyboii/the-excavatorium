import { describe, expect, test } from "bun:test";
import { parseArchiveExportSnapshot } from "./archive";

const recordRow = {
  id: "record-1",
  user_id: "user-1",
  record_type: "conversation",
  title: "Snapshot record",
  summary: null,
  tags: ["archive"],
  record_data: {},
  is_example: false,
  seed_key: null,
  created_at: "2026-08-22T10:00:00.000Z",
  updated_at: "2026-08-22T11:00:00.000Z",
};

const linkRow = {
  id: "link-1",
  user_id: "user-1",
  source_record_id: "record-1",
  target_record_id: "record-2",
  seed_key: null,
  created_at: "2026-08-22T12:00:00.000Z",
};

describe("export_user_archive_snapshot response parsing", () => {
  test("maps complete snake_case RPC rows into the existing archive snapshot shape", () => {
    const snapshot = parseArchiveExportSnapshot({ records: [recordRow], links: [linkRow] });

    expect(snapshot.records[0]).toMatchObject({
      id: "record-1",
      recordType: "conversation",
      summary: "",
      createdAt: "2026-08-22T10:00:00.000Z",
    });
    expect(snapshot.links[0]).toMatchObject({
      id: "link-1",
      sourceId: "record-1",
      targetId: "record-2",
    });
  });

  test("rejects an incomplete response instead of exposing a partial export", () => {
    expect(() => parseArchiveExportSnapshot({ records: [recordRow] })).toThrow(
      "invalid records or links collection",
    );
    expect(() =>
      parseArchiveExportSnapshot({ records: [{ ...recordRow, id: "" }], links: [] }),
    ).toThrow("malformed records[0].id");
    expect(() =>
      parseArchiveExportSnapshot({ records: [], links: [{ ...linkRow, created_at: 42 }] }),
    ).toThrow("malformed links[0].created_at");
  });
});
