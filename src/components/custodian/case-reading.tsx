import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CheckCircle, FileText, Info, WarningCircle } from "@phosphor-icons/react";
import { useMemo } from "react";
import { recordHref, TypeIcon } from "@/components/record-list";
import { RECORD_TYPE_LABEL, type ArchiveRecord } from "@/lib/types";
import { CASE_READING_MAX_CHARS, type CaseArchiveScope } from "@/lib/custodian-types";
import {
  buildCaseReadingBundle,
  describeCaseReadingAdmission,
  describeCaseReadingExclusion,
  type CaseReadingSignal,
} from "@/lib/case-reading";

export function CaseReadingSurface({
  scope,
  archiveRecords,
  archiveReady = false,
  archiveLoading = false,
  archiveError = null,
  archiveStale = false,
}: {
  scope: CaseArchiveScope;
  archiveRecords: readonly ArchiveRecord[];
  archiveReady?: boolean;
  archiveLoading?: boolean;
  archiveError?: string | null;
  archiveStale?: boolean;
}) {
  const bundle = useMemo(
    () => buildCaseReadingBundle({ scope, archiveRecords }),
    [archiveRecords, scope],
  );

  if (!archiveReady) {
    return (
      <section className="border border-[#b79b68]/45 bg-[#fffdf8] text-[#2c2721]">
        <ReadingHeader
          selectedCount={scope.recordIds.length}
          includedCount={0}
          serializedChars={0}
        />
        <div
          className="flex items-start gap-3 border-t border-[#d7c9ae] px-4 py-5 text-sm"
          role="status"
        >
          <WarningCircle size={19} className="mt-0.5 shrink-0 text-[#8a2525]" aria-hidden="true" />
          <div className="min-w-0">
            {archiveLoading ? (
              <p className="text-[#675c4f]">Retrieving the selected archive snapshot…</p>
            ) : (
              <>
                <p className="font-medium">Case Reading withheld.</p>
                <p className="mt-1 text-[#675c4f]">
                  {archiveError ??
                    "Archive records are unavailable. No evidence bundle has been constructed."}
                </p>
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="border border-[#b79b68]/55 bg-[#fffdf8] text-[#2c2721]">
      <ReadingHeader
        selectedCount={bundle.selectedRecordIds.length}
        includedCount={bundle.includedRecords.length}
        serializedChars={bundle.serializedChars}
      />
      {archiveStale ? (
        <div className="flex items-start gap-3 border-b border-[#d7c9ae] bg-[#f5ead8] px-4 py-3 text-sm">
          <Info size={18} className="mt-0.5 shrink-0 text-[#795a28]" aria-hidden="true" />
          <p>
            Showing the last successful archive snapshot. A refresh failed; unavailable and excluded
            records are reported below.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 p-4 md:p-5">
        <div className="border border-[#d7c9ae] bg-[#f8f1e5] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#795a28]">
            Owner context
          </p>
          <h3 className="mt-1 font-serif text-lg">Not archive evidence</h3>
          {bundle.ownerContext.trim() ? (
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
              {bundle.ownerContext}
            </p>
          ) : (
            <p className="mt-3 text-sm text-[#675c4f]">No free-text context recorded.</p>
          )}
        </div>

        <div className="border border-[#d7c9ae]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#d7c9ae] px-4 py-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#795a28]">
                Read-only evidence bundle
              </p>
              <h3 className="mt-1 font-serif text-xl">Included archive records</h3>
            </div>
            <span className="font-mono text-[10px] text-[#675c4f]">
              {bundle.serializedChars.toLocaleString()} / {CASE_READING_MAX_CHARS.toLocaleString()}{" "}
              serialized chars
            </span>
          </div>
          {bundle.includedRecords.length ? (
            <div className="divide-y divide-[#d7c9ae]">
              {bundle.includedRecords.map((record, index) => {
                const archiveRecord = archiveRecords.find((item) => item.id === record.recordId);
                return (
                  <article key={record.recordId} className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 font-mono text-xs text-[#795a28]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start gap-2">
                          {archiveRecord ? (
                            <Link
                              to={recordHref(archiveRecord)}
                              className="inline-flex min-h-11 min-w-0 items-center gap-2 font-serif text-lg underline decoration-[#b79b68] underline-offset-4 hover:text-[#7b2030] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#795a28]"
                            >
                              <TypeIcon type={record.recordType} size={17} />
                              <span className="break-words">{record.title}</span>
                              <ArrowUpRight size={15} aria-hidden="true" />
                            </Link>
                          ) : (
                            <h4 className="font-serif text-lg">{record.title}</h4>
                          )}
                          <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-[#b79b68] px-2 py-1 font-mono text-[10px] uppercase text-[#795a28]">
                            <FileText size={12} aria-hidden="true" />
                            {RECORD_TYPE_LABEL[record.recordType]}
                          </span>
                        </div>
                        <p className="mt-2 break-all font-mono text-[10px] text-[#675c4f]">
                          Record ID · {record.recordId}
                        </p>
                        <p className="mt-2 text-xs text-[#795a28]">
                          Why admitted ·{" "}
                          {describeCaseReadingAdmission({
                            decision: "included",
                            reasonCode: "selected_scope",
                          })}
                        </p>
                        {record.summary ? (
                          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                            {record.summary}
                          </p>
                        ) : (
                          <p className="mt-3 text-sm text-[#675c4f]">No summary recorded.</p>
                        )}
                        {record.fields.length ? (
                          <dl className="mt-4 divide-y divide-[#e4dac8] border-y border-[#e4dac8]">
                            {record.fields.map((field) => (
                              <div
                                key={record.recordId + "-" + field.label}
                                className="grid gap-1 py-3 sm:grid-cols-[minmax(9rem,0.35fr)_minmax(0,1fr)] sm:gap-4"
                              >
                                <dt className="text-xs font-medium text-[#675c4f]">
                                  {field.label}
                                </dt>
                                <dd className="whitespace-pre-wrap break-words text-sm">
                                  {field.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                        {record.truncatedFields.length ? (
                          <p className="mt-3 text-xs text-[#795a28]">
                            Truncated fields: {record.truncatedFields.join(", ")}.
                          </p>
                        ) : null}
                        {record.omittedFields.length ? (
                          <p className="mt-2 text-xs text-[#8a2525]">
                            Omitted from the reading limit: {record.omittedFields.join(", ")}.
                          </p>
                        ) : null}
                        <details className="mt-4 border-t border-[#e4dac8] pt-3">
                          <summary className="min-h-11 cursor-pointer py-2 text-xs font-medium text-[#795a28] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#795a28]">
                            Source provenance
                          </summary>
                          <ul className="mt-2 space-y-2 text-xs text-[#675c4f]">
                            {record.provenance.map((line) => (
                              <li key={line} className="break-words">
                                {line}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-[#675c4f]">
              No selected archive records are available in this snapshot.
            </div>
          )}
        </div>

        <ReadingBoundary bundle={bundle} />
      </div>
    </section>
  );
}

function ReadingHeader({
  selectedCount,
  includedCount,
  serializedChars,
}: {
  selectedCount: number;
  includedCount: number;
  serializedChars: number;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-[#d7c9ae] px-4 py-4 sm:flex-row sm:items-end sm:justify-between md:px-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#795a28]">
          Custodian boundary
        </p>
        <h2 className="mt-1 font-serif text-2xl">Case Reading</h2>
        <p className="mt-1 max-w-2xl text-sm text-[#675c4f]">
          Bounded, read-only projection of the Case&apos;s selected canonical archive records. No AI
          or provider run is invoked.
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-right font-mono text-[10px] text-[#675c4f]">
        <div>
          <dt>Selected</dt>
          <dd className="mt-1 text-sm text-[#2c2721]">{selectedCount}</dd>
        </div>
        <div>
          <dt>Included</dt>
          <dd className="mt-1 text-sm text-[#2c2721]">{includedCount}</dd>
        </div>
        <div>
          <dt>Serialized</dt>
          <dd className="mt-1 text-sm text-[#2c2721]">{serializedChars.toLocaleString()}</dd>
        </div>
      </dl>
    </header>
  );
}

function ReadingBoundary({ bundle }: { bundle: ReturnType<typeof buildCaseReadingBundle> }) {
  const omittedSignalCount = bundle.truncation.omittedSignalCounts.reduce(
    (total, item) => total + item.superseded + item.conflicts + item.uncertainties,
    0,
  );
  const hasBoundaryItems =
    bundle.excludedRecords.length > 0 ||
    bundle.truncation.occurred ||
    bundle.supersededMaterial.length > 0 ||
    bundle.conflictSignals.length > 0 ||
    bundle.uncertaintySignals.length > 0 ||
    bundle.evidenceGaps.length > 0;

  if (!hasBoundaryItems) {
    return (
      <div className="flex items-start gap-3 border border-[#c2d3c0] bg-[#f3f7f0] p-4 text-sm">
        <CheckCircle size={19} className="mt-0.5 shrink-0 text-[#3f6840]" aria-hidden="true" />
        <p>
          No deterministic exclusions, supersession markers, conflicts, or evidence gaps were found.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-[#b79b68]/55 bg-[#f8f1e5]">
      <div className="border-b border-[#d7c9ae] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#795a28]">
          Reading boundaries
        </p>
        <h3 className="mt-1 font-serif text-xl">What the bundle does not resolve</h3>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        {bundle.excludedRecords.length ? (
          <BoundaryList
            title="Excluded or unavailable"
            items={bundle.excludedRecords.map(
              (item) => item.recordId + " · " + describeCaseReadingExclusion(item.reason),
            )}
          />
        ) : null}
        {bundle.truncation.occurred ? (
          <BoundaryList
            title="Truncation"
            items={[
              bundle.truncation.reason ?? "The bounded reading was truncated.",
              ...(bundle.truncation.omittedRecordIds.length
                ? ["Omitted IDs: " + bundle.truncation.omittedRecordIds.join(", ")]
                : []),
              ...(bundle.truncation.omittedSignalCounts.length
                ? [
                    `Omitted ${omittedSignalCount} derived boundary signal${omittedSignalCount === 1 ? "" : "s"} across ${bundle.truncation.omittedSignalCounts.length} record${bundle.truncation.omittedSignalCounts.length === 1 ? "" : "s"}.`,
                  ]
                : []),
              ...(bundle.truncation.omittedEvidenceGapCount
                ? [`Omitted evidence-gap entries: ${bundle.truncation.omittedEvidenceGapCount}.`]
                : []),
              ...(bundle.truncation.ownerContextTruncated
                ? ["Owner context was shortened to keep the serialized bundle within the limit."]
                : []),
            ]}
          />
        ) : null}
        {bundle.supersededMaterial.length ? (
          <SignalList title="Superseded material" items={bundle.supersededMaterial} />
        ) : null}
        {bundle.conflictSignals.length ? (
          <SignalList title="Conflicts" items={bundle.conflictSignals} />
        ) : null}
        {bundle.uncertaintySignals.length ? (
          <SignalList title="Uncertainties" items={bundle.uncertaintySignals} />
        ) : null}
        {bundle.evidenceGaps.length ? (
          <BoundaryList title="Unresolved evidence gaps" items={bundle.evidenceGaps} />
        ) : null}
      </div>
    </div>
  );
}

function BoundaryList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section>
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <WarningCircle size={16} className="text-[#8a2525]" aria-hidden="true" />
        {title}
      </h4>
      <ul className="mt-2 space-y-2 text-xs leading-5 text-[#675c4f]">
        {items.map((item) => (
          <li key={item} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SignalList({ title, items }: { title: string; items: readonly CaseReadingSignal[] }) {
  return (
    <section>
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <Info size={16} className="text-[#795a28]" aria-hidden="true" />
        {title}
      </h4>
      <ul className="mt-2 space-y-2 text-xs leading-5 text-[#675c4f]">
        {items.map((item) => (
          <li key={item.recordId + "-" + item.message} className="break-words">
            <span className="font-mono text-[10px] text-[#795a28]">{item.recordId}</span>
            <span className="mx-1">·</span>
            {item.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
