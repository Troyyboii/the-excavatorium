import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Graph, LinkSimple } from "@phosphor-icons/react";
import { useArchive } from "@/lib/archive";
import {
  CustodianPage,
  CustodianStatus,
  FoundationState,
  Section,
} from "@/components/custodian/custodian-ui";
import { archiveRecordHref } from "@/components/custodian/custodian-format";
import { useOnlineStatus } from "@/hooks/use-online";

export const Route = createFileRoute("/graph")({ component: GraphPage, ssr: false });

function GraphPage() {
  const query = useArchive(true);
  const online = useOnlineStatus();
  const [filter, setFilter] = useState("");
  const links = useMemo(() => {
    if (!query.data) return [];
    const term = filter.trim().toLocaleLowerCase();
    return query.data.links.filter((link) => {
      const source = query.data?.byId.get(link.sourceId);
      const target = query.data?.byId.get(link.targetId);
      return (
        !term ||
        source?.title.toLocaleLowerCase().includes(term) ||
        target?.title.toLocaleLowerCase().includes(term) ||
        link.id.toLocaleLowerCase().includes(term)
      );
    });
  }, [filter, query.data]);

  const foundationPending = !query.data && query.isPending;
  return (
    <CustodianPage
      title="Graph"
      description="A functional archive link matrix. Every row below comes from a persisted record link."
      status={
        <CustodianStatus
          online={online}
          fetching={query.isFetching}
          foundationPending={foundationPending}
          error={query.recordsError?.message ?? null}
        />
      }
    >
      {!query.data ? (
        <FoundationState
          title={query.isPending ? "Retrieving archive links" : "Graph retrieval blocked"}
        >
          {query.isPending
            ? "Reading persisted records and links…"
            : (query.recordsError?.message ??
              query.linksError?.message ??
              "The archive link reader returned no data.")}
        </FoundationState>
      ) : (
        <Section
          title="Link matrix"
          description={
            query.state.linksPending
              ? "Links are still retrieving; the current list may be incomplete."
              : "No inferred edges or visual-only nodes are added."
          }
          action={
            query.state.linksPending
              ? "Retrieving…"
              : `${links.length} matching link${links.length === 1 ? "" : "s"}`
          }
        >
          <div className="border-b border-[#D5B56D]/20 p-4">
            <label className="flex min-h-10 items-center gap-2 border border-[#D5B56D]/30 bg-[#0b0b0a] px-3 text-sm text-[#9d9587] focus-within:ring-2 focus-within:ring-[#D5B56D]">
              <Graph size={16} className="text-[#D5B56D]" aria-hidden="true" />
              <span className="sr-only">Filter persisted links</span>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by endpoint or link id"
                className="min-w-0 flex-1 bg-transparent text-[#F0E3BE] outline-none placeholder:text-[#6b6252]"
              />
            </label>
          </div>
          {links.length === 0 ? (
            <div className="p-5 text-sm text-[#9d9587]">
              {query.state.linksPending
                ? "No links have arrived yet."
                : "No persisted links match this filter."}
            </div>
          ) : (
            <div className="divide-y divide-[#D5B56D]/15">
              {links.map((link) => {
                const source = query.data?.byId.get(link.sourceId);
                const target = query.data?.byId.get(link.targetId);
                return (
                  <div
                    key={link.id}
                    className="grid gap-3 px-4 py-4 text-sm md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center"
                  >
                    <GraphEndpoint
                      href={source ? archiveRecordHref(source) : undefined}
                      label={source?.title}
                      id={link.sourceId}
                    />
                    <LinkSimple
                      size={17}
                      className="hidden text-[#D5B56D] md:block"
                      aria-hidden="true"
                    />
                    <GraphEndpoint
                      href={target ? archiveRecordHref(target) : undefined}
                      label={target?.title}
                      id={link.targetId}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}
    </CustodianPage>
  );
}

function GraphEndpoint({ href, label, id }: { href?: string; label?: string; id: string }) {
  return href && label ? (
    <a
      href={href}
      className="min-w-0 truncate text-[#F0E3BE] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D5B56D]"
    >
      {label}
    </a>
  ) : (
    <span className="min-w-0 truncate font-mono text-xs text-[#9d9587]">Unavailable · {id}</span>
  );
}
