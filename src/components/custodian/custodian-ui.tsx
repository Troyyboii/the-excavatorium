import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleNotch, WarningCircle } from "@phosphor-icons/react";

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
      ? "bg-risk"
      : resolved === "Foundation pending"
        ? "bg-brass-muted"
        : resolved === "Retrieving"
          ? "bg-luminous-gold"
          : resolved === "Observing"
            ? "bg-white-gold"
            : "bg-brass-muted";
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
    <div className="flex items-center gap-2 text-xs" role="status" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
      <span className="text-white-gold">{resolved}</span>
      <span className="hidden text-muted-foreground sm:inline">· {explanation}</span>
    </div>
  );
}

export function CustodianPage({
  title,
  eyebrow = "THE CUSTODIAN",
  description,
  status,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  status?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 text-foreground">
      <header className="mb-7 border-b border-luminous-gold/25 pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 font-mono text-[10px] tracking-[0.24em] text-luminous-gold">
              {eyebrow}
            </p>
            <h1 className="font-serif text-3xl tracking-tight text-white-gold md:text-4xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>
            ) : null}
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
    <section className="border border-luminous-gold/25 bg-background/70">
      <header className="flex flex-col gap-2 border-b border-luminous-gold/20 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h2 className="font-serif text-xl text-white-gold">{title}</h2>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0 text-xs text-luminous-gold">{action}</div> : null}
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
      className="border border-dashed border-luminous-gold/30 bg-background/50 px-5 py-8"
      role="status"
    >
      <div className="flex items-start gap-3">
        <WarningCircle
          size={20}
          className="mt-0.5 shrink-0 text-luminous-gold"
          aria-hidden="true"
        />
        <div>
          <h2 className="font-serif text-lg text-white-gold">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{children}</p>
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
          className="ml-2 text-luminous-gold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
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
      className="inline-flex min-h-10 items-center gap-2 border border-luminous-gold/35 px-3 py-2 text-sm text-white-gold transition-colors hover:bg-burgundy-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
    >
      {children}
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}

export function LoadingMark({ label = "Retrieving persisted state…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <CircleNotch
        size={17}
        className="animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      {label}
    </div>
  );
}
