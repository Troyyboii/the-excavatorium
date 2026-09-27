import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleNotch } from "@phosphor-icons/react";
import { CryptIcon, type CryptGlyph } from "@/components/crypt-icon";

export type CustodianStatusKind =
  | "Dormant"
  | "Observing"
  | "Retrieving"
  | "Blocked"
  | "Foundation pending";

export function CustodianStatus({
  status,
  online = true,
  fetching = false,
  foundationPending = false,
  error = null,
  detail,
}: {
  status?: CustodianStatusKind;
  online?: boolean;
  fetching?: boolean;
  foundationPending?: boolean;
  error?: string | null;
  detail?: string;
}) {
  const resolved: CustodianStatusKind = foundationPending
    ? "Foundation pending"
    : error || !online
      ? "Blocked"
      : fetching
        ? "Retrieving"
        : (status ?? "Dormant");
  const tone =
    resolved === "Blocked"
      ? "bg-[color:var(--ember)]"
      : resolved === "Foundation pending"
        ? "bg-[color:var(--ash)]"
        : resolved === "Retrieving"
          ? "bg-[color:var(--candlelight)]"
          : resolved === "Observing"
            ? "bg-[color:var(--moonbone)]"
            : "bg-[color:var(--ash)]";
  const explanation =
    detail ??
    (resolved === "Foundation pending"
      ? "Waiting for the Custodian data foundation."
      : resolved === "Blocked"
        ? (error ?? (!online ? "Network unavailable." : "The current operation is blocked."))
        : resolved === "Retrieving"
          ? "Reading persisted archive state."
          : resolved === "Observing"
            ? "Watching persisted archive state."
            : "No Custodian operation is active.");

  return (
    <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
      <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />
      <span className="text-foreground">{resolved}</span>
      <span className="hidden text-muted-foreground sm:inline">{explanation}</span>
    </div>
  );
}

export function CustodianPage({
  title,
  glyph,
  description,
  status,
  actions,
  children,
}: {
  title: string;
  /** Optional sign shown in a candlelight ring beside the title. */
  glyph?: CryptGlyph;
  description?: string;
  status?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto min-w-0 max-w-[1216px] text-foreground">
      <header className="mb-7 border-b border-border pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-center gap-5">
            {glyph ? (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--candlelight)] text-[color:var(--candlelight)] md:h-[84px] md:w-[84px]">
                <CryptIcon glyph={glyph} size={36} />
              </span>
            ) : null}
            <div className="min-w-0">
              <h1 className="break-words font-serif text-4xl leading-tight text-foreground md:text-5xl">
                {title}
              </h1>
              {description ? (
                <p className="mt-2 max-w-3xl text-lg text-muted-foreground">{description}</p>
              ) : null}
            </div>
          </div>
          {status ? <div className="shrink-0">{status}</div> : null}
        </div>
        {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border border-border bg-card">
      <header className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h2 className="font-serif text-[1.5rem] text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action ? (
          <div className="shrink-0 text-sm text-[color:var(--candlelight)]">{action}</div>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function FoundationState({
  title = "Foundation pending",
  children = "This surface is ready for persisted data, but its data foundation is not connected yet.",
  action,
}: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="border border-dashed border-[color:var(--mortar-strong)] bg-[color:var(--vault-deep)] px-5 py-6"
      role="status"
    >
      <div className="flex items-start gap-3">
        <CryptIcon glyph="hourglass" size={22} className="mt-1 text-[color:var(--mist)]" />
        <div>
          <h2 className="font-serif text-xl text-foreground">{title}</h2>
          <p className="mt-1 max-w-2xl text-base leading-7 text-muted-foreground">{children}</p>
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function EmptyArchiveState({
  title = "No persisted records in this view.",
  hint = "The archive returned an empty result. Nothing is being inferred or filled in.",
}: {
  title?: string;
  hint?: string;
}) {
  return <FoundationState title={title}>{hint}</FoundationState>;
}

export function ArchiveErrorState({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <FoundationState title="Archive retrieval blocked">
      <span>{error ?? "The persisted archive could not be read."}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="ml-2 inline-flex min-h-11 items-center text-[color:var(--candlelight)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--candlelight)]"
        >
          Retry
        </button>
      ) : null}
    </FoundationState>
  );
}

export function RouteLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      to={href}
      className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-[color:var(--mortar-strong)] px-3.5 py-2 text-base text-foreground transition-colors hover:border-[color:var(--candlelight)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--candlelight)]"
    >
      {children}
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}

export function LoadingMark({ label = "Retrieving persisted state…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-base text-muted-foreground" role="status">
      <CircleNotch
        size={17}
        className="animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      {label}
    </div>
  );
}
