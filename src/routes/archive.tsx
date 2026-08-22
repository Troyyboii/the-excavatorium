import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChatCircleText,
  FileText,
  Scales,
  Wrench,
} from "@phosphor-icons/react";
import { useArchive } from "@/lib/archive";
import { formatArchiveDate } from "@/lib/date-format";
import {
  CustodianPage,
  CustodianStatus,
  FoundationState,
  Section,
} from "@/components/custodian/custodian-ui";
import { useOnlineStatus } from "@/hooks/use-online";
import { buildArchiveDirectory, type ArchiveDirectorySummary } from "./-archive-helpers";

export const Route = createFileRoute("/archive")({ component: ArchivePage, ssr: false });

const ROUTES = [
  {
    type: "conversation",
    label: "Conversations",
    to: "/conversations",
    description: "Persisted conversation records.",
    icon: ChatCircleText,
  },
  {
    type: "document",
    label: "Documents",
    to: "/documents",
    description: "Persisted document records.",
    icon: FileText,
  },
  {
    type: "decision",
    label: "Decisions",
    to: "/decisions",
    description: "Persisted decisions and their status.",
    icon: Scales,
  },
  {
    type: "repository",
    label: "Repositories",
    to: "/repositories",
    description: "Persisted repository evaluations.",
    icon: BookOpen,
  },
  {
    type: "tool",
    label: "Tools",
    to: "/tools",
    description: "Persisted tool evaluations.",
    icon: Wrench,
  },
] as const;

function ArchivePage() {
  const query = useArchive(true);
  const online = useOnlineStatus();
  const directory = useMemo(
    () => buildArchiveDirectory(query.data?.records ?? []),
    [query.data?.records],
  );

  return (
    <CustodianPage
      title="Archive"
      description="Canonical record surfaces. Browse the authenticated archive by record class."
      status={
        <CustodianStatus
          online={online}
          fetching={query.isFetching}
          foundationPending={!query.data && query.isPending}
          error={query.recordsError?.message ?? null}
        />
      }
    >
      {!query.data ? (
        <FoundationState
          title={query.isPending ? "Retrieving archive directory" : "Archive retrieval blocked"}
        >
          {query.isPending
            ? "Reading persisted record counts and update times…"
            : (query.recordsError?.message ?? "The archive returned no record data.")}
        </FoundationState>
      ) : (
        <Section
          title="Record directory"
          description="Counts and latest updates come from persisted records only."
          action={`${query.data.records.length} total ${query.data.records.length === 1 ? "record" : "records"}`}
        >
          <div className="divide-y divide-border">
            {ROUTES.map((route) => (
              <ArchiveDirectoryRow key={route.to} route={route} summary={directory[route.type]} />
            ))}
          </div>
        </Section>
      )}
    </CustodianPage>
  );
}

function ArchiveDirectoryRow({
  route,
  summary,
}: {
  route: (typeof ROUTES)[number];
  summary: ArchiveDirectorySummary;
}) {
  const Icon = route.icon;
  const countLabel = `${summary.count} ${summary.count === 1 ? "record" : "records"}`;

  return (
    <Link
      to={route.to}
      className="group grid min-h-24 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 transition-colors hover:bg-record-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-luminous-gold sm:grid-cols-[auto_minmax(0,1fr)_minmax(9rem,auto)_auto] sm:gap-5"
    >
      <span className="flex h-10 w-10 items-center justify-center border border-border bg-secondary text-luminous-gold">
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-serif text-lg text-foreground group-hover:text-primary">
          {route.label}
        </span>
        <span className="mt-1 block text-sm leading-5 text-muted-foreground">
          {route.description}
        </span>
      </span>
      <span className="col-span-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs sm:col-span-1 sm:block sm:text-right">
        <span className="font-mono text-sm text-foreground">{countLabel}</span>
        <span className="text-muted-foreground">
          {summary.latestUpdatedAt
            ? `Latest ${formatArchiveDate(summary.latestUpdatedAt)}`
            : "No updates yet"}
        </span>
      </span>
      <ArrowUpRight
        size={18}
        className="text-luminous-gold transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
