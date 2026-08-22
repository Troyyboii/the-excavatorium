import { describe, expect, test } from "bun:test";
import { buildArchiveGraph, defaultGraphRecordId, getGraphNeighbors } from "./graph-layout";
import type { ArchiveLink, ArchiveRecord, RecordType } from "./types";

function record(id: string, recordType: RecordType, updatedAt: string): ArchiveRecord {
  return {
    id,
    recordType,
    title: id,
    summary: "",
    tags: [],
    isExample: false,
    seedKey: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt,
    recordData: {},
  } as ArchiveRecord;
}

const records = [
  record("b", "document", "2026-08-02T00:00:00Z"),
  record("a", "conversation", "2026-08-03T00:00:00Z"),
  record("c", "tool", "2026-08-01T00:00:00Z"),
];
const links: ArchiveLink[] = [
  { id: "l2", sourceId: "b", targetId: "missing", seedKey: null, createdAt: "2026-08-01" },
  { id: "l1", sourceId: "a", targetId: "b", seedKey: null, createdAt: "2026-08-01" },
];

describe("archive graph", () => {
  test("produces repeatable coordinates from sorted stable ids", () => {
    const first = buildArchiveGraph(records, links);
    const second = buildArchiveGraph([...records].reverse(), [...links].reverse());
    expect(first.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      second.nodes.map(({ id, x, y }) => ({ id, x, y })),
    );
  });

  test("uses persisted resolved links only and reports unresolved endpoints", () => {
    const graph = buildArchiveGraph(records, links);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["l1"]);
    expect(graph.unresolvedLinks.map((link) => link.id)).toEqual(["l2"]);
    expect(getGraphNeighbors(graph, "a")).toEqual(["b"]);
  });

  test("selects the most recently updated linked record", () => {
    expect(defaultGraphRecordId(buildArchiveGraph(records, links))).toBe("a");
  });

  test("filters records and links without fabricating topology", () => {
    const graph = buildArchiveGraph(records, links, new Set<RecordType>(["tool"]));
    expect(graph.nodes.map((node) => node.id)).toEqual(["c"]);
    expect(graph.edges).toHaveLength(0);
  });
});
