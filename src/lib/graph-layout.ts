import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { ArchiveLink, ArchiveRecord, RecordType } from "@/lib/types";

export type GraphNode = SimulationNodeDatum & {
  id: string;
  record: ArchiveRecord;
  x: number;
  y: number;
};

export type GraphEdge = SimulationLinkDatum<GraphNode> & {
  id: string;
  link: ArchiveLink;
  source: GraphNode;
  target: GraphNode;
};

export type ArchiveGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolvedLinks: ArchiveLink[];
};

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function graphSeed(ids: string[]): number {
  let hash = 2166136261;
  for (const id of ids) {
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

export function buildArchiveGraph(
  records: ArchiveRecord[],
  links: ArchiveLink[],
  includedTypes?: ReadonlySet<RecordType>,
): ArchiveGraph {
  const visibleRecords = records
    .filter((record) => !includedTypes || includedTypes.has(record.recordType))
    .sort((a, b) => a.id.localeCompare(b.id));
  const nodes: GraphNode[] = visibleRecords.map((record) => ({
    id: record.id,
    record,
    x: 0,
    y: 0,
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const resolved: GraphEdge[] = [];
  const unresolvedLinks: ArchiveLink[] = [];

  for (const link of [...links].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = byId.get(link.sourceId);
    const target = byId.get(link.targetId);
    if (!source || !target) {
      unresolvedLinks.push(link);
      continue;
    }
    resolved.push({ id: link.id, link, source, target });
  }

  if (nodes.length > 0) {
    const simulation = forceSimulation(nodes)
      .randomSource(seededRandom(graphSeed(nodes.map((node) => node.id))))
      .force("charge", forceManyBody().strength(-265))
      .force("center", forceCenter(0, 0).strength(0.16))
      .force("collision", forceCollide<GraphNode>().radius(42).strength(0.95))
      .force(
        "links",
        forceLink<GraphNode, GraphEdge>(resolved)
          .id((node) => node.id)
          .distance(118)
          .strength(0.32),
      )
      .stop();
    for (let tick = 0; tick < 260; tick += 1) simulation.tick();
    simulation.stop();
    for (const node of nodes) {
      node.x = Math.round((node.x ?? 0) * 100) / 100;
      node.y = Math.round((node.y ?? 0) * 100) / 100;
      node.vx = 0;
      node.vy = 0;
    }
  }

  return { nodes, edges: resolved, unresolvedLinks };
}

export function getGraphNeighbors(graph: ArchiveGraph, recordId: string): string[] {
  const ids = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source.id === recordId) ids.add(edge.target.id);
    if (edge.target.id === recordId) ids.add(edge.source.id);
  }
  return [...ids].sort();
}

export function defaultGraphRecordId(graph: ArchiveGraph): string | null {
  const linked = new Set<string>();
  for (const edge of graph.edges) {
    linked.add(edge.source.id);
    linked.add(edge.target.id);
  }
  return (
    [...graph.nodes]
      .filter((node) => linked.has(node.id))
      .sort((a, b) => {
        const updated = Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt);
        return updated || a.id.localeCompare(b.id);
      })[0]?.id ?? null
  );
}
