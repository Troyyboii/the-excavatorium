import type { ReactNode } from "react";
import { useArchive } from "@/lib/archive";
import { RECORD_KIND_SIGN } from "@/lib/record-standing";
import type { RecordType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CryptIcon } from "./crypt-icon";
import { Banner } from "./page-parts";
import { RecordForm } from "./record-form";

export function NewRecordPage({
  recordType,
  title,
  aside,
}: {
  recordType: RecordType;
  title: string;
  /** Optional Custodian column shown beside the form on wide screens. */
  aside?: ReactNode;
}) {
  const query = useArchive(true);
  const header = <NewRecordHeader recordType={recordType} title={title} />;
  if (!query.data && query.isPending) {
    return (
      <div className="mx-auto max-w-[1216px]">
        {header}
        <p className="text-base text-muted-foreground" role="status">
          Loading archive context…
        </p>
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="mx-auto max-w-[1216px]">
        {header}
        <Banner kind="error" title="The form cannot load safely">
          <span>{query.error?.message ?? "Archive records are unavailable."}</span>{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </Banner>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "mx-auto grid max-w-[1216px] gap-10",
        aside && "lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-16",
      )}
    >
      {aside ? <div className="hidden lg:block">{aside}</div> : null}
      <div className="min-w-0">
        {header}
        {query.linksError ? (
          <div className="mb-4">
            <Banner kind="warning" title="Connections unavailable">
              You can create the record, but connected-record choices will remain empty until links
              reload.
            </Banner>
          </div>
        ) : null}
        <RecordForm
          recordType={recordType}
          existing={null}
          allRecords={query.data.records}
          allLinks={query.data.links}
        />
      </div>
    </div>
  );
}

function NewRecordHeader({ recordType, title }: { recordType: RecordType; title: string }) {
  const sign = RECORD_KIND_SIGN[recordType];
  return (
    <header className="mb-7 flex items-center gap-5">
      <span
        className={cn(
          "flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-current md:h-[68px] md:w-[68px]",
          sign.toneClass,
        )}
      >
        <CryptIcon glyph={sign.glyph} size={30} />
      </span>
      <h1 className="break-words font-serif text-4xl leading-tight text-foreground md:text-[2.75rem]">
        {title}
      </h1>
    </header>
  );
}
