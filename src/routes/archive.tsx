import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ArchiveViewNav } from "@/components/archive-view-nav";
import { CryptIcon } from "@/components/crypt-icon";
import { archiveRecordHref } from "@/components/custodian/custodian-format";
import { CustodianLine, CustodianPortrait } from "@/components/custodian/custodian-presence";
import { useArchive } from "@/lib/archive";
import { formatArchiveDate } from "@/lib/date-format";
import {
  RECORD_KIND_SIGN,
  recordStanding,
  standingSign,
  STANDING_KINDS,
  STANDING_TONE_CLASS,
  type StandingKind,
} from "@/lib/record-standing";
import { RECORD_TYPE_LABEL, type ArchiveRecord, type RecordType } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  archiveCustodianLine,
  buildArchiveDirectory,
  filterArchive,
  parseArchiveFilters,
  type ArchiveFilters,
} from "./-archive-helpers";

export const Route = createFileRoute("/archive")({
  component: ArchivePage,
  ssr: false,
  validateSearch: parseArchiveFilters,
});

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--candlelight)]";

const CHAMBERS: readonly { type: RecordType; label: string }[] = [
  { type: "document", label: "Documents" },
  { type: "tool", label: "Tools" },
  { type: "conversation", label: "Conversations" },
  { type: "decision", label: "Decisions" },
  { type: "repository", label: "Repositories" },
];

function ArchivePage() {
  const archive = useArchive(true);
  const filters = Route.useSearch();
  const navigate = useNavigate({ from: "/archive" });
  const [text, setText] = useState(filters.q ?? "");
  const all = archive.data?.records;
  const directory = useMemo(() => buildArchiveDirectory(all ?? []), [all]);
  const records = useMemo(
    () => filterArchive(all ?? [], { ...filters, q: text }),
    [all, filters, text],
  );

  const setFilters = (next: Partial<ArchiveFilters>) =>
    void navigate({
      search: (prev: ArchiveFilters) => {
        const merged = { ...prev, ...next };
        return Object.fromEntries(
          Object.entries(merged).filter(([, value]) => value !== undefined && value !== ""),
        ) as ArchiveFilters;
      },
      replace: true,
    });

  const header = (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <h1 className="font-serif text-4xl leading-none text-foreground sm:text-5xl">The Archive</h1>
      <ArchiveViewNav active="browse" className="sm:ml-auto" />
    </header>
  );

  if (archive.state.isColdOffline || !archive.data) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-4 sm:py-7">
        {header}
        {archive.state.isColdOffline ? (
          <Notice>
            No cached archive is available on this device. Reconnect to read persisted records.
          </Notice>
        ) : archive.isPending ? (
          <p className="p-4 text-base text-muted-foreground" role="status">
            Reading persisted records…
          </p>
        ) : (
          <Notice>
            <p>
              Archive records could not be retrieved:{" "}
              {archive.recordsError?.message ?? "No data returned."}
            </p>
            <button
              type="button"
              className={cn(
                "mt-3 inline-flex min-h-11 items-center underline decoration-[color:var(--candlelight)] underline-offset-4",
                FOCUS_RING,
              )}
              onClick={() => void archive.refetch()}
            >
              Retry
            </button>
          </Notice>
        )}
      </div>
    );
  }

  const total = archive.data.records.length;
  const filtered = Boolean(filters.type || filters.standing || text.trim());

  return (
    <div className="mx-auto grid max-w-[1296px] gap-x-14 gap-y-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
      <div className="min-w-0 pt-1 lg:col-start-2 lg:row-start-1 lg:pt-9">{header}</div>
      <aside
        aria-label="Chambers"
        className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-[calc(72px+2rem)] lg:flex lg:h-[calc(100dvh-72px-4rem)] lg:min-h-[30rem] lg:flex-col lg:self-start lg:overflow-y-auto lg:border lg:border-border lg:bg-[color:var(--vault-deep)] lg:px-6 lg:py-9"
      >
        <h2 className="mb-3 ml-3 hidden font-serif text-[1.375rem] text-[color:var(--mist)] lg:block">
          Chambers
        </h2>
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:p-0">
          <li className="shrink-0">
            <ChamberLink
              glyph="crypt"
              toneClass="text-[color:var(--candlelight)]"
              label="All records"
              count={total}
              active={!filters.type}
              onSelect={() => setFilters({ type: undefined })}
            />
          </li>
          {CHAMBERS.map((chamber) => (
            <li key={chamber.type} className="shrink-0">
              <ChamberLink
                {...RECORD_KIND_SIGN[chamber.type]}
                label={chamber.label}
                count={directory[chamber.type].count}
                active={filters.type === chamber.type}
                onSelect={() => setFilters({ type: chamber.type })}
              />
            </li>
          ))}
        </ul>
        <figure className="mt-auto hidden gap-3 border-t border-border px-3 pt-[18px] lg:flex">
          <CustodianPortrait size={52} />
          <CustodianLine
            size="sm"
            className="text-[1.0625rem] leading-[1.4] text-[color:var(--mist)]"
          >
            {archiveCustodianLine(total)}
          </CustodianLine>
        </figure>
      </aside>

      <div className="min-w-0 space-y-4 pb-1 lg:col-start-2 lg:row-start-2 lg:pb-9">
        <label className="flex h-[52px] items-center gap-3 border border-[color:var(--mortar-strong)] bg-card px-4 focus-within:border-[color:var(--candlelight)]">
          <CryptIcon glyph="search" size={22} className="text-[color:var(--candlelight)]" />
          <span className="sr-only">Search the Archive</span>
          <input
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setFilters({ q: event.target.value || undefined });
            }}
            placeholder="Search titles, verdicts, reasons and raw text"
            className="min-w-0 flex-1 bg-transparent text-[1.0625rem] text-foreground outline-none placeholder:text-[color:var(--ash)]"
          />
        </label>

        <div role="group" aria-label="Filter by standing" className="flex flex-wrap gap-2">
          {STANDING_KINDS.map((kind) => (
            <StandingChip
              key={kind}
              kind={kind}
              pressed={filters.standing === kind}
              onToggle={() =>
                setFilters({ standing: filters.standing === kind ? undefined : kind })
              }
            />
          ))}
        </div>

        <p className="text-base text-muted-foreground" role="status">
          {records.length} {records.length === 1 ? "record" : "records"}
          {filtered ? ` of ${total}` : ""}
          {archive.recordsError ? ". Showing cached records." : ""}
        </p>

        <section aria-label="Records">
          {records.length ? (
            <ul className="border-t border-[color:var(--vault-raised)]">
              {records.map((record) => (
                <li key={record.id}>
                  <RegisterRow record={record} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="border border-border bg-card p-8 text-center">
              <p className="font-serif text-xl text-foreground">
                {filtered ? "No records match these filters." : "Nothing is filed here yet."}
              </p>
              {filtered ? (
                <button
                  type="button"
                  className={cn(
                    "mt-3 inline-flex min-h-11 items-center px-3 text-base text-muted-foreground underline decoration-[color:var(--candlelight)] underline-offset-4 hover:text-foreground",
                    FOCUS_RING,
                  )}
                  onClick={() => {
                    setText("");
                    setFilters({ type: undefined, standing: undefined, q: undefined });
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <p className="mt-2 text-base text-muted-foreground">
                  Add material when you are ready.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="border border-border bg-card p-5 text-base text-muted-foreground">
      {children}
    </div>
  );
}

function ChamberLink({
  glyph,
  toneClass,
  label,
  count,
  active,
  onSelect,
}: (typeof RECORD_KIND_SIGN)[RecordType] & {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-sm border border-transparent px-3 text-left transition-colors lg:border-0",
        FOCUS_RING,
        active
          ? "border-[color:var(--mortar-strong)] bg-[color:var(--vault-raised)]"
          : "hover:bg-[color:var(--vault-stone)]",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-current",
          toneClass,
        )}
      >
        <CryptIcon glyph={glyph} size={20} />
      </span>
      <span className="whitespace-nowrap text-[1.0625rem] text-foreground lg:flex-1">{label}</span>
      <span className="text-base text-[color:var(--mist)]">{count}</span>
    </button>
  );
}

function StandingChip({
  kind,
  pressed,
  onToggle,
}: {
  kind: StandingKind;
  pressed: boolean;
  onToggle: () => void;
}) {
  const sign = standingSign(kind);
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-full border pl-2.5 pr-3.5 text-[0.9375rem] text-foreground transition-colors",
        FOCUS_RING,
        pressed
          ? "border-[color:var(--candlelight)] bg-[color:var(--vault-raised)]"
          : "border-[color:var(--mortar-strong)] bg-card hover:border-[color:var(--candlelight)]",
      )}
    >
      <CryptIcon glyph={sign.glyph} size={18} className={STANDING_TONE_CLASS[sign.tone]} />
      {sign.label}
    </button>
  );
}

function RegisterRow({ record }: { record: ArchiveRecord }) {
  const kind = RECORD_KIND_SIGN[record.recordType];
  const standing = recordStanding(record);
  const standingMark = (
    <>
      <CryptIcon glyph={standing.glyph} size={20} className={STANDING_TONE_CLASS[standing.tone]} />
      <span className="truncate">{standing.label}</span>
    </>
  );
  return (
    <Link
      to={archiveRecordHref(record)}
      className={cn(
        "grid min-h-[60px] grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 border-b border-[color:var(--vault-raised)] px-3 py-2.5 transition-colors hover:bg-[color:var(--vault-stone)] focus-visible:ring-inset md:grid-cols-[40px_minmax(0,1fr)_170px_110px]",
        FOCUS_RING,
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-current",
          kind.toneClass,
        )}
      >
        <CryptIcon glyph={kind.glyph} size={20} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[1.0625rem] font-medium text-foreground">
          {record.title}
        </span>
        <span className="flex min-w-0 items-center gap-3 text-sm text-[color:var(--ash)]">
          {RECORD_TYPE_LABEL[record.recordType]}
          <span className="flex min-w-0 items-center gap-1.5 text-[color:var(--mist)] md:hidden">
            {standingMark}
          </span>
        </span>
      </span>
      <span className="hidden min-w-0 items-center gap-2 text-[0.9375rem] text-[color:var(--mist)] md:flex">
        {standingMark}
      </span>
      <span className="hidden text-right text-[0.9375rem] text-[color:var(--ash)] md:block">
        {formatArchiveDate(record.updatedAt)}
      </span>
    </Link>
  );
}
