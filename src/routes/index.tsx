import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, MagnifyingGlass, Question } from "@phosphor-icons/react";
import { useMemo } from "react";
import { RecordRow } from "@/components/record-list";
import { useArchive } from "@/lib/archive";
import { buildDashboardViewModel } from "@/lib/dashboard";
import { homeAttentionCopy } from "./-home-helpers";
import { CaptureMenu } from "@/components/app-shell";
import { useOnlineStatus } from "@/hooks/use-online";
import { CustodianFigure } from "@/components/custodian/custodian-figure";

export const Route = createFileRoute("/")({ component: HomePage, ssr: false });

function HomePage() {
  const archive = useArchive(true);
  const online = useOnlineStatus();
  const model = useMemo(
    () => archive.data && buildDashboardViewModel(archive.data.records, archive.data.links),
    [archive.data],
  );

  if (archive.state.isColdOffline) {
    return (
      <section className="mx-auto max-w-4xl py-8" aria-labelledby="home-title">
        <PageHeading title="Home" />
        <p className="mt-5 text-base text-muted-foreground">
          The archive is unavailable on this device while offline.
        </p>
      </section>
    );
  }

  if (!archive.data && archive.isPending) {
    return (
      <section className="mx-auto max-w-4xl py-8" aria-labelledby="home-title" aria-busy="true">
        <PageHeading title="Home" />
        <p className="mt-5 text-base text-muted-foreground" role="status">
          Reading the archive…
        </p>
      </section>
    );
  }

  if (!archive.data || !model) {
    return (
      <section className="mx-auto max-w-4xl py-8" aria-labelledby="home-title">
        <PageHeading title="Home" />
        <p className="mt-5 text-base text-muted-foreground">
          The archive could not be read.{" "}
          {archive.recordsError?.message ?? "Try again when connected."}
        </p>
        <button
          type="button"
          className="mt-4 inline-flex min-h-11 items-center rounded-md border border-input px-4 text-sm hover:bg-record-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void archive.refetch()}
        >
          Retry
        </button>
      </section>
    );
  }

  const attentionCopy = homeAttentionCopy(model.attentionItems.length > 0);

  return (
    <div className="mx-auto grid max-w-5xl gap-10 py-5 sm:py-9 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <CustodianFigure className="w-52 self-start" />
      <div className="min-w-0 space-y-10 lg:col-start-2 lg:row-start-1">
        <header className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-brass">Home</p>
          <h1 className="mt-3 font-serif text-4xl leading-tight text-foreground sm:text-5xl">
            {attentionCopy.heading}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            {attentionCopy.explanation}
          </p>
        </header>

        {model.attentionItems.length ? (
          <section
            aria-labelledby="attention-heading"
            className="overflow-hidden border-y border-border"
          >
            <div className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-3 sm:px-4">
              <h2 id="attention-heading" className="font-serif text-xl text-foreground">
                For your attention
              </h2>
              <Link
                to="/search"
                className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Search Archive <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <div className="divide-y divide-border">
              {model.attentionItems.map((item) => (
                <div key={item.record.id}>
                  <RecordRow r={item.record} showType />
                  <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4">
                    Needs attention: {item.status}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="next-actions-heading">
          <h2 id="next-actions-heading" className="font-serif text-xl text-foreground">
            What would you like to do?
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <HomeAction to="/cases" icon={Question} title="Ask a question">
              Start an Investigation
            </HomeAction>
            <HomeAction to="/search" icon={MagnifyingGlass} title="Search Archive">
              Find a record or piece of material
            </HomeAction>
            <div className="min-h-28 border border-border bg-card p-4">
              <CaptureMenu online={online} label="Add material" />
              <p className="mt-2 text-sm text-muted-foreground">Choose a supported capture path</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PageHeading({ title }: { title: string }) {
  return (
    <h1 id="home-title" className="font-serif text-4xl text-foreground">
      {title}
    </h1>
  );
}

function HomeAction({
  to,
  icon: Icon,
  title,
  children,
}: {
  to: string;
  icon: typeof Question;
  title: string;
  children: string;
}) {
  return (
    <Link
      to={to}
      className="group flex min-h-28 items-start gap-4 border border-border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-border text-brass">
        <Icon size={21} aria-hidden="true" />
      </span>
      <span>
        <span className="block font-medium text-foreground">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{children}</span>
      </span>
    </Link>
  );
}
