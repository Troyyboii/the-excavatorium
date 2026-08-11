import type { ArchiveLink, ArchiveRecord } from "@/lib/types";
import { ArrowUpRight, FileText, LinkSimple, Rows } from "@phosphor-icons/react";
import { EmptyArchiveState, FoundationState, Section } from "./custodian-ui";
import { archiveRecordHref, formatRecordDate, valueOrNotRecorded } from "./custodian-format";

export function ArchiveRecordRows({ records }: { records: ArchiveRecord[] }) {
  if (records.length === 0) return <EmptyArchiveState />;
  return (
    <div className="divide-y divide-luminous-gold/15">
      {records.map((record) => (
        <a
          key={record.id}
          href={archiveRecordHref(record)}
          className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-burgundy-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-luminous-gold md:grid-cols-[auto_minmax(0,1fr)_150px_170px_auto]"
        >
          <FileText size={17} className="text-luminous-gold" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-sm text-white-gold">{record.title}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {record.summary || "No summary recorded."}
            </span>
          </span>
          <span className="hidden text-xs text-muted-foreground md:block">{record.recordType}</span>
          <span className="hidden text-xs text-muted-foreground md:block">
            Updated {formatRecordDate(record.updatedAt)}
          </span>
          <ArrowUpRight size={16} className="text-luminous-gold" aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}

export function ArchiveReadState({
  data,
  isPending,
  recordsError,
}: {
  data: { records: ArchiveRecord[] } | undefined;
  isPending: boolean;
  recordsError?: Error | null;
}) {
  if (!data && isPending) {
    return <FoundationState title="Retrieving archive">Reading persisted records…</FoundationState>;
  }
  if (!data) {
    return (
      <FoundationState title="Archive retrieval blocked">{recordsError?.message}</FoundationState>
    );
  }
  return <ArchiveRecordRows records={data.records} />;
}

export function LinksSection({
  records,
  links,
}: {
  records: ArchiveRecord[];
  links: ArchiveLink[];
}) {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (links.length === 0) {
    return (
      <Section title="Connections" description="Persisted record links only.">
        <div className="p-5 text-sm text-muted-foreground">No persisted links were returned.</div>
      </Section>
    );
  }
  return (
    <Section
      title="Connections"
      description="Persisted record links only. Missing endpoints remain visible as unavailable."
    >
      <div className="divide-y divide-luminous-gold/15">
        {links.map((link) => {
          const source = byId.get(link.sourceId);
          const target = byId.get(link.targetId);
          return (
            <div
              key={link.id}
              className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1fr_auto_1fr] md:items-center"
            >
              <RecordEndpoint record={source} fallback={link.sourceId} />
              <LinkSimple
                size={16}
                className="hidden text-luminous-gold md:block"
                aria-label="links to"
              />
              <RecordEndpoint record={target} fallback={link.targetId} />
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function RecordEndpoint({ record, fallback }: { record?: ArchiveRecord; fallback: string }) {
  if (!record)
    return (
      <span className="font-mono text-xs text-muted-foreground">Unavailable · {fallback}</span>
    );
  return (
    <a
      href={archiveRecordHref(record)}
      className="min-w-0 truncate text-white-gold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
    >
      {record.title}
    </a>
  );
}

export function RecordMeta({ record }: { record: ArchiveRecord }) {
  return (
    <dl className="grid gap-3 border-t border-luminous-gold/20 px-4 py-4 text-xs sm:grid-cols-3">
      <div>
        <dt className="text-muted-foreground">Record class</dt>
        <dd className="mt-1 text-white-gold">{record.recordType}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Created</dt>
        <dd className="mt-1 text-white-gold">{formatRecordDate(record.createdAt)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Tags</dt>
        <dd className="mt-1 text-white-gold">{valueOrNotRecorded(record.tags.join(", "))}</dd>
      </div>
    </dl>
  );
}

export function EmptySection({ title, description }: { title: string; description: string }) {
  return (
    <Section title={title} description={description}>
      <div className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
        <Rows size={17} className="text-luminous-gold" aria-hidden="true" />
        No persisted entries in this view.
      </div>
    </Section>
  );
}
