import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CaptureMenu } from "@/components/app-shell";
import { CryptIcon } from "@/components/crypt-icon";
import {
  CustodianLine,
  CustodianNiche,
  CustodianPortrait,
} from "@/components/custodian/custodian-presence";
import { recordHref } from "@/components/record-list";
import { useOnlineStatus } from "@/hooks/use-online";
import { useArchive } from "@/lib/archive";
import { buildDashboardViewModel } from "@/lib/dashboard";
import { RECORD_KIND_SIGN, type StandingTone } from "@/lib/record-standing";
import { cn } from "@/lib/utils";
import {
  CHAMBERS,
  groupAttention,
  homeAttentionCopy,
  homeGreeting,
  type AttentionGroup,
} from "./-home-helpers";

export const Route = createFileRoute("/")({ component: HomePage, ssr: false });

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--candlelight)]";

function HomePage() {
  const archive = useArchive(true);
  const online = useOnlineStatus();
  const records = archive.data?.records;
  const model = useMemo(
    () => archive.data && buildDashboardViewModel(archive.data.records, archive.data.links),
    [archive.data],
  );
  const groups = useMemo(() => (records ? groupAttention(records) : []), [records]);

  if (archive.state.isColdOffline) {
    return (
      <HomeNotice>
        <p className="mt-5 text-lg text-muted-foreground">
          The archive is unavailable on this device while offline.
        </p>
      </HomeNotice>
    );
  }

  if (!archive.data && archive.isPending) {
    return (
      <HomeNotice busy>
        <p className="mt-5 text-lg text-muted-foreground" role="status">
          Reading the archive…
        </p>
      </HomeNotice>
    );
  }

  if (!archive.data || !model) {
    return (
      <HomeNotice>
        <p className="mt-5 text-lg text-muted-foreground">
          The archive could not be read.{" "}
          {archive.recordsError?.message ?? "Try again when connected."}
        </p>
        <button
          type="button"
          className={cn(
            "mt-4 inline-flex min-h-11 items-center rounded-sm border border-input px-4 text-base hover:border-[color:var(--candlelight)]",
            FOCUS_RING,
          )}
          onClick={() => void archive.refetch()}
        >
          Retry
        </button>
      </HomeNotice>
    );
  }

  const attentionCount = groups.reduce((sum, group) => sum + group.count, 0);
  const greeting = homeGreeting(model.totalRecords, attentionCount);
  const attentionCopy = homeAttentionCopy(attentionCount > 0);
  const counts = new Map(model.typeBreakdown.map((item) => [item.key, item.count]));

  return (
    <div className="mx-auto grid max-w-[1296px] gap-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-16 lg:pt-2">
      <CustodianNiche className="hidden lg:flex" />
      <section aria-labelledby="home-title" className="min-w-0 max-w-[780px] lg:pt-5">
        <h1 id="home-title" className="sr-only">
          Home
        </h1>
        <CustodianLine size="lg" className="hidden lg:block">
          {greeting.full}
        </CustodianLine>
        <div className="flex items-center gap-4 lg:hidden">
          <CustodianPortrait size={80} ring="candle" />
          <CustodianLine size="lg">{greeting.short}</CustodianLine>
        </div>

        <HomeSearch />

        <section aria-labelledby="attention-heading" className="mt-9">
          <h2 id="attention-heading" className="font-serif text-[1.625rem] text-foreground">
            What stirs tonight
          </h2>
          {groups.length ? (
            <>
              <p className="mt-1 text-base text-muted-foreground">{attentionCopy.explanation}</p>
              <ul className="mt-4 grid items-start gap-3 sm:grid-cols-2 sm:gap-[18px]">
                {groups.map((group) => (
                  <li key={group.key} className="min-w-0">
                    <AttentionTile group={group} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="mt-3 border border-border bg-card p-5">
              <p className="font-serif text-xl text-foreground">{attentionCopy.heading}</p>
              <p className="mt-1 text-base text-muted-foreground">{attentionCopy.explanation}</p>
            </div>
          )}
        </section>

        <section aria-labelledby="chambers-heading" className="mt-9">
          <h2 id="chambers-heading" className="font-serif text-[1.625rem] text-foreground">
            The chambers
          </h2>
          <ul className="mt-4 grid grid-cols-5 gap-2 sm:gap-3.5">
            {CHAMBERS.map((chamber) => {
              const count = counts.get(chamber.type) ?? 0;
              const sign = RECORD_KIND_SIGN[chamber.type];
              return (
                <li key={chamber.type} className="min-w-0">
                  <Link
                    to="/archive"
                    search={{ type: chamber.type }}
                    className={cn(
                      "flex h-full flex-col items-center gap-2 border border-border bg-card px-1 pb-4 pt-[18px] transition-colors hover:border-[color:var(--mortar-strong)] hover:bg-accent",
                      FOCUS_RING,
                    )}
                  >
                    <span
                      className={cn(
                        "flex items-center justify-center rounded-full sm:h-[52px] sm:w-[52px] sm:border-[1.5px] sm:border-current",
                        sign.toneClass,
                      )}
                    >
                      <CryptIcon glyph={sign.glyph} size={28} />
                    </span>
                    <span className="font-serif text-[1.875rem] leading-none text-foreground">
                      {count}
                    </span>
                    <span className="sr-only text-[0.9375rem] text-muted-foreground sm:not-sr-only">
                      {count === 1 ? chamber.one : chamber.many}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p aria-hidden="true" className="mt-2 text-base text-muted-foreground sm:hidden">
            Documents, tools, conversations, decisions, repositories
          </p>
        </section>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/cases"
            className={cn(
              "inline-flex min-h-12 items-center justify-center gap-2.5 rounded-sm border border-[color:var(--mortar-strong)] px-[18px] text-base text-foreground transition-colors hover:border-[color:var(--candlelight)]",
              FOCUS_RING,
            )}
          >
            <CryptIcon glyph="key" size={20} className="text-[color:var(--candlelight)]" />
            Start an Investigation
          </Link>
          <div className="hidden md:block">
            <CaptureMenu online={online} label="Add material" quiet />
          </div>
        </div>
      </section>
    </div>
  );
}

function HomeNotice({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <section className="mx-auto max-w-4xl py-8" aria-labelledby="home-title" aria-busy={busy}>
      <h1 id="home-title" className="font-serif text-4xl text-foreground">
        Home
      </h1>
      {children}
    </section>
  );
}

function HomeSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const q = text.trim();
    void navigate({ to: "/search", search: q ? { q } : {} });
  }
  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="mt-8 hidden h-[60px] items-center gap-3 border border-[color:var(--mortar-strong)] bg-card pl-[18px] pr-2 focus-within:border-[color:var(--candlelight)] md:flex"
    >
      <CryptIcon glyph="search" size={24} className="text-[color:var(--candlelight)]" />
      <label className="flex min-w-0 flex-1">
        <span className="sr-only">Search the Archive</span>
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search titles, verdicts, reasons and raw text"
          className="min-w-0 flex-1 bg-transparent text-lg text-foreground outline-none placeholder:text-[color:var(--ash)]"
        />
      </label>
      <button
        type="submit"
        className={cn(
          "h-11 shrink-0 rounded-sm border border-[color:var(--candlelight)] px-5 text-base text-foreground transition-colors hover:bg-accent",
          FOCUS_RING,
        )}
      >
        Search
      </button>
    </form>
  );
}

const TONE: Record<StandingTone, { text: string; tile: string }> = {
  ember: {
    text: "text-[color:var(--ember)]",
    tile: "border-[color:color-mix(in_srgb,var(--ember)_38%,var(--mortar))]",
  },
  spectre: {
    text: "text-[color:var(--spectre)]",
    tile: "border-[color:color-mix(in_srgb,var(--spectre)_38%,var(--mortar))]",
  },
  candle: {
    text: "text-[color:var(--candlelight)]",
    tile: "border-[color:color-mix(in_srgb,var(--candlelight)_38%,var(--mortar))]",
  },
  mist: { text: "text-[color:var(--mist)]", tile: "border-[color:var(--mortar-strong)]" },
  ash: { text: "text-[color:var(--ash)]", tile: "border-[color:var(--mortar-strong)]" },
};

const TILE =
  "flex w-full items-center gap-[18px] border bg-card p-4 text-left transition-colors hover:bg-accent sm:p-5";

function AttentionTile({ group }: { group: AttentionGroup }) {
  const tone = TONE[group.tone];
  const face = (subtitle: string) => (
    <>
      <span
        className={cn(
          "flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[1.5px] border-current sm:h-16 sm:w-16",
          tone.text,
        )}
      >
        <CryptIcon glyph={group.glyph} size={32} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("font-serif text-[2.125rem] leading-none", tone.text)}>
          {group.count}
        </span>
        <span className="text-[1.0625rem] font-medium text-foreground">{group.reason}</span>
        <span className="truncate text-[0.9375rem] text-muted-foreground">{subtitle}</span>
      </span>
    </>
  );

  if (group.count === 1) {
    const [record] = group.records;
    return (
      <Link to={recordHref(record)} className={cn(TILE, tone.tile, FOCUS_RING)}>
        {face(record.title)}
      </Link>
    );
  }

  return (
    <details className={cn("border bg-card", tone.tile)}>
      <summary
        className={cn(
          TILE,
          "cursor-pointer list-none border-0 [&::-webkit-details-marker]:hidden",
          FOCUS_RING,
          "focus-visible:ring-inset",
        )}
      >
        {face("Review them")}
      </summary>
      <ul className="border-t border-border px-2 py-2">
        {group.records.map((record) => {
          const sign = RECORD_KIND_SIGN[record.recordType];
          return (
            <li key={record.id}>
              <Link
                to={recordHref(record)}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-base text-foreground hover:bg-accent",
                  FOCUS_RING,
                )}
              >
                <CryptIcon glyph={sign.glyph} size={20} className={sign.toneClass} />
                <span className="min-w-0 truncate">{record.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
