import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  Graph,
  LinkSimple,
  ListBullets,
  MagnifyingGlass,
  Minus,
  Plus,
  X,
} from "@phosphor-icons/react";
import { useArchive } from "@/lib/archive";
import {
  buildArchiveGraph,
  defaultGraphRecordId,
  getGraphNeighbors,
  type GraphNode,
} from "@/lib/graph-layout";
import { formatArchiveDate, formatArchiveDateTime } from "@/lib/date-format";
import { RECORD_TYPES, RECORD_TYPE_LABEL, type ArchiveRecord, type RecordType } from "@/lib/types";
import { archiveRecordHref } from "@/components/custodian/custodian-format";
import { FoundationState } from "@/components/custodian/custodian-ui";
import { useOnlineStatus } from "@/hooks/use-online";
import { cn } from "@/lib/utils";
import { ArchiveViewNav } from "@/components/archive-view-nav";
import {
  getGraphLinkReadState,
  graphLinkEvidenceLabel,
  type GraphLinkReadState,
} from "@/lib/graph-read-state";

type GraphSearch = {
  record?: string;
  view: "map" | "links";
  types?: string;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const Route = createFileRoute("/graph")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): GraphSearch => ({
    record: typeof search.record === "string" && search.record ? search.record : undefined,
    view: search.view === "links" ? "links" : "map",
    types: typeof search.types === "string" && search.types ? search.types : undefined,
  }),
  component: GraphPage,
});

const NODE_COLORS: Record<RecordType, string> = {
  conversation: "var(--graph-conversation)",
  document: "var(--graph-document)",
  decision: "var(--graph-decision)",
  repository: "var(--graph-repository)",
  tool: "var(--graph-tool)",
};

function parseTypes(value?: string): Set<RecordType> {
  const requested = new Set(value?.split(",") ?? []);
  const valid = RECORD_TYPES.filter((type) => requested.has(type));
  return new Set(valid.length ? valid : RECORD_TYPES);
}

function GraphPage() {
  const query = useArchive(true);
  const online = useOnlineStatus();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [term, setTerm] = useState("");
  const [zoom, setZoom] = useState(1.15);
  const [mobileSheet, setMobileSheet] = useState<"details" | "links" | null>(null);
  const linkReadState = getGraphLinkReadState({
    pending: query.state.linksPending,
    error: query.linksError,
    coldOffline: query.state.linksColdOffline,
  });
  const selectedTypes = useMemo(() => parseTypes(search.types), [search.types]);
  const graph = useMemo(
    () => buildArchiveGraph(query.data?.records ?? [], query.data?.links ?? [], selectedTypes),
    [query.data, selectedTypes],
  );
  const defaultId = useMemo(() => defaultGraphRecordId(graph), [graph]);
  const selectedId = graph.nodes.some((node) => node.id === search.record)
    ? search.record!
    : defaultId;
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const neighborIds = useMemo(
    () => new Set(selectedId ? getGraphNeighbors(graph, selectedId) : []),
    [graph, selectedId],
  );
  const directNeighbors = graph.nodes.filter((node) => neighborIds.has(node.id));
  const incidentLinks = selectedId
    ? graph.edges.filter((edge) => edge.source.id === selectedId || edge.target.id === selectedId)
    : graph.edges;
  const normalizedTerm = term.trim().toLocaleLowerCase("en-GB");
  const matches = normalizedTerm
    ? graph.nodes.filter(
        (node) =>
          node.record.title.toLocaleLowerCase("en-GB").includes(normalizedTerm) ||
          node.id.toLocaleLowerCase("en-GB").includes(normalizedTerm),
      )
    : [];
  const projected = useMemo(
    () => projectNodes(graph.nodes, selectedId, neighborIds),
    [graph.nodes, neighborIds, selectedId],
  );
  const projectedById = new Map(projected.map((node) => [node.id, node]));

  useEffect(() => setZoom(1.15), [search.types]);

  function updateSearch(patch: Partial<GraphSearch>) {
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  }

  function selectRecord(id: string) {
    updateSearch({ record: id });
    setTerm("");
  }

  function toggleType(type: RecordType) {
    const next = new Set(selectedTypes);
    if (next.has(type) && next.size > 1) next.delete(type);
    else next.add(type);
    const sorted = [...next].sort();
    updateSearch({
      types: sorted.length === RECORD_TYPES.length ? undefined : sorted.join(","),
      record: selected && !next.has(selected.record.recordType) ? undefined : search.record,
    });
  }

  if (query.state.isColdOffline) {
    return (
      <div className="p-4 md:p-8">
        <FoundationState title="Archive unavailable offline">
          Network unavailable and no cached archive is available on this device. Reconnect to read
          persisted records and links.
        </FoundationState>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="p-4 md:p-8">
        <FoundationState
          title={query.isPending ? "Retrieving archive graph" : "Graph retrieval blocked"}
        >
          {query.isPending
            ? "Reading persisted records and links…"
            : (query.recordsError?.message ??
              query.linksError?.message ??
              "No graph data returned.")}
        </FoundationState>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background text-foreground">
      <header className="border-b border-strong-border px-4 py-5 md:px-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-brass">
              Archive connections
            </p>
            <h1 className="mt-1 text-3xl md:text-4xl">Connections</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Records and saved links only. No inferred relationships, weights, or activity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span>{query.data.records.length} records</span>
            <span aria-hidden="true">·</span>
            <span>
              {linkReadState === "pending"
                ? "Retrieving persisted links"
                : linkReadState === "cold-offline"
                  ? "No cached link evidence"
                  : linkReadState === "error"
                    ? "Link evidence unavailable"
                    : `${query.data.links.length} persisted links`}
            </span>
            <span aria-hidden="true">·</span>
            <span>{online ? "Archive available" : "Cached view"}</span>
          </div>
        </div>
      </header>

      <div className="px-4 md:px-7">
        <ArchiveViewNav active="connections" />
      </div>

      <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 border-strong-border xl:border-r">
          <div className="grid gap-3 border-b border-border bg-card px-4 py-4 md:px-7 lg:grid-cols-[minmax(260px,1fr)_auto_auto] lg:items-center">
            <div className="relative">
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <MagnifyingGlass size={17} className="shrink-0 text-brass" aria-hidden="true" />
                <span className="sr-only">Search graph records by title or ID</span>
                <input
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Search title or record ID"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                {term ? (
                  <button type="button" onClick={() => setTerm("")} aria-label="Clear graph search">
                    <X size={16} />
                  </button>
                ) : null}
              </label>
              {term ? (
                <div className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-20 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-xl">
                  {matches.length ? (
                    matches.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => selectRecord(node.id)}
                        className="flex min-h-11 w-full items-center justify-between gap-3 rounded px-3 text-left text-sm hover:bg-record-hover"
                      >
                        <span className="truncate">{node.record.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {RECORD_TYPE_LABEL[node.record.recordType]}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-sm text-muted-foreground">No matching record.</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1" aria-label="Record type filters">
              {RECORD_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={selectedTypes.has(type)}
                  onClick={() => toggleType(type)}
                  className={cn(
                    "min-h-11 rounded-full border px-2.5 text-[11px]",
                    selectedTypes.has(type)
                      ? "border-primary bg-burgundy-muted text-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {RECORD_TYPE_LABEL[type]}
                </button>
              ))}
            </div>

            <div
              className="flex rounded-md border border-border bg-background p-1"
              aria-label="Graph view"
            >
              <ViewButton
                active={search.view === "map"}
                onClick={() => updateSearch({ view: "map" })}
              >
                <Graph size={16} /> Map
              </ViewButton>
              <ViewButton
                active={search.view === "links"}
                onClick={() => updateSearch({ view: "links" })}
              >
                <ListBullets size={16} /> Links
              </ViewButton>
            </div>
          </div>

          {search.view === "map" ? (
            <GraphCanvas
              graph={graph}
              projected={projected}
              projectedById={projectedById}
              selected={selected}
              selectedId={selectedId}
              neighborIds={neighborIds}
              directNeighbors={directNeighbors}
              zoom={zoom}
              setZoom={setZoom}
              selectRecord={selectRecord}
              setMobileSheet={setMobileSheet}
              linkReadState={linkReadState}
            />
          ) : null}

          <LinkLedger
            edges={selectedId ? incidentLinks : graph.edges}
            records={query.data.byId}
            selected={Boolean(selectedId)}
            emphasized={search.view === "links"}
            linkReadState={linkReadState}
            linksError={query.linksError}
            onRetry={online ? () => void query.refetchLinks() : undefined}
          />
        </div>

        <aside className="hidden bg-card xl:block" aria-label="Selected record inspector">
          <div className="sticky top-16 p-6">
            <RecordInspector
              selected={selected}
              neighbors={directNeighbors}
              onSelect={selectRecord}
            />
          </div>
        </aside>
      </div>

      {mobileSheet ? (
        <div
          className="fixed inset-0 z-50 bg-black/50 p-4 pt-20 xl:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={mobileSheet === "details" ? "Record details" : "Record links"}
        >
          <div className="ml-auto max-h-full w-full max-w-md overflow-y-auto rounded-lg bg-card p-5 shadow-2xl">
            <button
              type="button"
              className="ml-auto flex h-11 w-11 items-center justify-center rounded-md border border-border"
              onClick={() => setMobileSheet(null)}
              aria-label="Close sheet"
            >
              <X size={18} />
            </button>
            {mobileSheet === "details" ? (
              <RecordInspector
                selected={selected}
                neighbors={directNeighbors}
                onSelect={selectRecord}
              />
            ) : (
              <LinkLedger
                edges={incidentLinks}
                records={query.data.byId}
                selected
                emphasized
                linkReadState={linkReadState}
                linksError={query.linksError}
                onRetry={online ? () => void query.refetchLinks() : undefined}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GraphCanvas({
  graph,
  projected,
  projectedById,
  selected,
  selectedId,
  neighborIds,
  directNeighbors,
  zoom,
  setZoom,
  selectRecord,
  setMobileSheet,
  linkReadState,
}: {
  graph: ReturnType<typeof buildArchiveGraph>;
  projected: GraphNode[];
  projectedById: Map<string, GraphNode>;
  selected: GraphNode | null;
  selectedId: string | null;
  neighborIds: Set<string>;
  directNeighbors: GraphNode[];
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  selectRecord: (id: string) => void;
  setMobileSheet: (value: "details" | "links") => void;
  linkReadState: GraphLinkReadState;
}) {
  return (
    <section
      aria-label="Record relationship map"
      className="relative min-h-[520px] overflow-hidden bg-[color:var(--canvas)] md:min-h-[620px]"
    >
      <div className="absolute right-4 top-4 z-10 flex rounded-md border border-border bg-card shadow-sm">
        <CanvasButton
          label="Zoom out"
          onClick={() => setZoom((value) => Math.max(0.65, value - 0.15))}
        >
          <Minus size={16} />
        </CanvasButton>
        <CanvasButton
          label="Zoom in"
          onClick={() => setZoom((value) => Math.min(1.7, value + 0.15))}
        >
          <Plus size={16} />
        </CanvasButton>
        <CanvasButton label="Reset graph view" onClick={() => setZoom(1.15)}>
          <ArrowCounterClockwise size={16} />
        </CanvasButton>
      </div>
      {projected.length ? (
        <svg
          viewBox="-500 -340 1000 680"
          className="h-[520px] w-full md:h-[620px]"
          aria-label={`${projected.length} persisted archive records; ${graphLinkEvidenceLabel(linkReadState, graph.edges.length)}`}
        >
          <g
            transform={`translate(${selectedId ? -(projectedById.get(selectedId)?.x ?? 0) : 0} ${selectedId ? -(projectedById.get(selectedId)?.y ?? 0) : 0}) scale(${zoom})`}
          >
            {graph.edges.map((edge) => {
              const source = projectedById.get(edge.source.id)!;
              const target = projectedById.get(edge.target.id)!;
              const related =
                !selectedId || edge.source.id === selectedId || edge.target.id === selectedId;
              return (
                <line
                  key={edge.id}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={related ? "var(--brass)" : "var(--brass-muted)"}
                  strokeWidth={related ? 2 : 1}
                  opacity={related ? 0.8 : 0.24}
                />
              );
            })}
            {projected.map((node) => {
              const active = node.id === selectedId;
              const related = active || neighborIds.has(node.id) || !selectedId;
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.record.title}, ${RECORD_TYPE_LABEL[node.record.recordType]}`}
                  aria-pressed={active}
                  onClick={() => selectRecord(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectRecord(node.id);
                    }
                  }}
                  className="cursor-pointer outline-none focus-visible:[&_circle]:stroke-primary focus-visible:[&_circle]:stroke-[4]"
                  opacity={related ? 1 : 0.1}
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={active ? 18 : 12}
                    fill={NODE_COLORS[node.record.recordType]}
                    stroke={active ? "var(--foreground)" : "var(--card)"}
                    strokeWidth={active ? 4 : 2}
                  />
                  {active || !selectedId ? (
                    <text
                      x={node.x + 21}
                      y={node.y + 4}
                      fill="var(--foreground)"
                      fontSize="12"
                      fontFamily="Geist Variable, sans-serif"
                      fontWeight={active ? 700 : 520}
                    >
                      {truncate(node.record.title, 34)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      ) : (
        <div className="flex min-h-[520px] items-center justify-center p-6 text-sm text-muted-foreground">
          No records match the selected types.
        </div>
      )}

      {selected ? (
        <div className="absolute inset-x-4 bottom-4 rounded-md border border-strong-border bg-card/95 p-3 shadow-lg backdrop-blur xl:hidden">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label="Previous connected record"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-border"
              onClick={() => stepMobile(selected.id, directNeighbors, -1, selectRecord)}
            >
              <CaretLeft size={18} />
            </button>
            <div className="min-w-0 text-center">
              <p className="truncate font-serif text-sm">{selected.record.title}</p>
              <p className="font-mono text-[10px] text-muted-foreground">
                {directNeighbors.length} direct neighbor{directNeighbors.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              aria-label="Next connected record"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-border"
              onClick={() => stepMobile(selected.id, directNeighbors, 1, selectRecord)}
            >
              <CaretRight size={18} />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="min-h-11 rounded-md bg-primary px-3 text-sm text-primary-foreground"
              onClick={() => setMobileSheet("details")}
            >
              Details
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md border border-input px-3 text-sm"
              onClick={() => setMobileSheet("links")}
            >
              Links
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function projectNodes(
  nodes: GraphNode[],
  selectedId: string | null,
  neighborIds: ReadonlySet<string>,
): GraphNode[] {
  if (!nodes.length) return [];
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const projected = nodes.map((node) => ({
    ...node,
    x: ((node.x - minX) / spanX) * 760 - 420,
    y: ((node.y - minY) / spanY) * 520 - 260,
  }));
  if (!selectedId) return projected;

  const selected = projected.find((node) => node.id === selectedId);
  if (selected) {
    selected.x = 0;
    selected.y = 0;
  }
  const neighbors = projected
    .filter((node) => neighborIds.has(node.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  neighbors.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / neighbors.length - Math.PI / 2;
    node.x = Math.cos(angle) * 155;
    node.y = Math.sin(angle) * 125;
  });
  return projected;
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-9 items-center gap-2 rounded px-3 text-xs",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-record-hover",
      )}
    >
      {children}
    </button>
  );
}

function CanvasButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center border-r border-border text-foreground last:border-r-0 hover:bg-record-hover"
    >
      {children}
    </button>
  );
}

function RecordInspector({
  selected,
  neighbors,
  onSelect,
}: {
  selected: GraphNode | null;
  neighbors: GraphNode[];
  onSelect: (id: string) => void;
}) {
  if (!selected) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a record to inspect its persisted neighborhood.
      </p>
    );
  }
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brass">
        Selected record
      </p>
      <h2 className="mt-3 text-2xl leading-tight">{selected.record.title}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-primary bg-burgundy-muted px-2 py-1 text-[11px]">
          {RECORD_TYPE_LABEL[selected.record.recordType]}
        </span>
        <span className="rounded-full border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground">
          {neighbors.length} direct
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        {selected.record.summary || "No summary recorded."}
      </p>
      <dl className="mt-5 divide-y divide-border border-y border-border text-xs">
        <div className="grid grid-cols-[80px_1fr] gap-3 py-3">
          <dt className="text-muted-foreground">Updated</dt>
          <dd>{formatArchiveDateTime(selected.record.updatedAt)}</dd>
        </div>
        <div className="grid grid-cols-[80px_1fr] gap-3 py-3">
          <dt className="text-muted-foreground">Record ID</dt>
          <dd className="break-all font-mono text-[10px]">{selected.id}</dd>
        </div>
      </dl>
      <Link
        to={archiveRecordHref(selected.record)}
        className="mt-5 flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
      >
        Open record
      </Link>
      <h3 className="mt-7 border-b border-border pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-brass">
        Direct neighbors
      </h3>
      {neighbors.length ? (
        <div className="divide-y divide-border">
          {neighbors.map((neighbor) => (
            <button
              key={neighbor.id}
              type="button"
              onClick={() => onSelect(neighbor.id)}
              className="flex min-h-11 w-full items-center gap-3 py-2 text-left text-sm hover:text-primary"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: NODE_COLORS[neighbor.record.recordType] }}
              />
              <span className="min-w-0 flex-1 truncate">{neighbor.record.title}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No direct persisted neighbors.</p>
      )}
    </div>
  );
}

function LinkLedger({
  edges,
  records,
  selected,
  emphasized,
  linkReadState,
  linksError,
  onRetry,
}: {
  edges: ReturnType<typeof buildArchiveGraph>["edges"];
  records: Map<string, ArchiveRecord>;
  selected: boolean;
  emphasized?: boolean;
  linkReadState: GraphLinkReadState;
  linksError: unknown;
  onRetry?: () => void;
}) {
  return (
    <section
      className={cn("border-t border-strong-border bg-card", emphasized && "min-h-[620px]")}
      aria-labelledby="link-ledger-heading"
    >
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 md:px-7">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brass">
            Evidence ledger
          </p>
          <h2 id="link-ledger-heading" className="mt-1 text-xl">
            {selected ? "Incident links" : "Visible links"}
          </h2>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {linkReadState === "pending"
            ? "Retrieving…"
            : linkReadState === "cold-offline"
              ? "No cached links"
              : linkReadState === "error"
                ? `${edges.length} cached`
                : `${edges.length} persisted`}
        </span>
      </header>
      {linkReadState === "cold-offline" ? (
        <p className="px-4 py-8 text-sm text-muted-foreground md:px-7">
          Network unavailable. This device has no cached persisted link evidence.
        </p>
      ) : linkReadState === "pending" ? (
        <p className="px-4 py-8 text-sm text-muted-foreground md:px-7">
          Retrieving persisted links…
        </p>
      ) : linkReadState === "error" && edges.length === 0 ? (
        <div className="space-y-3 px-4 py-8 text-sm text-muted-foreground md:px-7">
          <p>{errorMessage(linksError, "Persisted links could not be retrieved.")}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center border border-input px-3 py-2 text-sm text-foreground hover:bg-record-hover"
            >
              Retry links
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {linkReadState === "error" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm text-muted-foreground md:px-7">
              <span>
                Showing cached links. The latest refresh failed:{" "}
                {errorMessage(linksError, "unknown error")}
              </span>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex min-h-11 items-center border border-input px-3 py-2 text-sm text-foreground hover:bg-record-hover"
                >
                  Retry links
                </button>
              ) : null}
            </div>
          ) : null}
          {edges.length ? (
            <div className="overflow-x-auto">
              <table className="custodian-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Target</th>
                    <th>Type</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {edges.map((edge) => (
                    <tr key={edge.id}>
                      <td>
                        <LedgerRecord record={records.get(edge.source.id)} id={edge.source.id} />
                      </td>
                      <td>
                        <LedgerRecord record={records.get(edge.target.id)} id={edge.target.id} />
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                          <LinkSimple size={15} className="text-brass" /> Persisted link
                        </span>
                      </td>
                      <td className="font-mono text-xs text-muted-foreground">
                        {formatArchiveDate(edge.link.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-8 text-sm text-muted-foreground md:px-7">
              No persisted links are available in this view.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function LedgerRecord({ record, id }: { record?: ArchiveRecord; id: string }) {
  return record ? (
    <Link to={archiveRecordHref(record)} className="font-serif text-sm hover:text-primary">
      {record.title}
    </Link>
  ) : (
    <span className="font-mono text-[10px] text-muted-foreground">Unavailable · {id}</span>
  );
}

function stepMobile(
  currentId: string,
  neighbors: GraphNode[],
  direction: -1 | 1,
  onSelect: (id: string) => void,
) {
  const sequence = [currentId, ...neighbors.map((neighbor) => neighbor.id)];
  if (sequence.length < 2) return;
  onSelect(direction === 1 ? sequence[1] : sequence[sequence.length - 1]);
}
