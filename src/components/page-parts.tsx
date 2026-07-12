import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Plus } from "@phosphor-icons/react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="font-serif text-2xl tracking-tight text-foreground break-words md:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground break-words">{description}</p>
        ) : null}
      </div>
      {action ? (
        <div className="flex flex-wrap gap-2 sm:shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none">
          {action}
        </div>
      ) : null}
    </header>
  );
}

export function NewRecordButton({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[color:var(--brass-muted)] bg-[color:var(--burgundy-muted)] px-3 py-2 text-sm text-foreground transition-colors hover:bg-[color:var(--record-hover)]"
    >
      <Plus size={16} weight="bold" />
      {label}
    </Link>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 p-8 text-center">
      <p className="text-sm text-foreground">{title}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Banner({
  kind,
  title,
  children,
}: {
  kind: "error" | "warning" | "info" | "success";
  title: string;
  children?: ReactNode;
}) {
  const border =
    kind === "error"
      ? "border-[color:var(--destructive)]/60 bg-[color:var(--destructive)]/10"
      : kind === "warning"
        ? "border-[color:var(--warning)]/60 bg-[color:var(--warning)]/10"
        : kind === "success"
          ? "border-[color:var(--success)]/60 bg-[color:var(--success)]/10"
          : "border-border bg-card";
  return (
    <div className={`rounded-md border p-3 text-sm ${border}`} role={kind === "error" ? "alert" : "status"}>
      <div className="font-medium text-foreground">{title}</div>
      {children ? <div className="mt-1 text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground shadow" role="status">
      <span>{message}</span>
      <button
        type="button"
        className="ml-3 text-xs text-muted-foreground hover:text-foreground"
        onClick={onClose}
      >
        dismiss
      </button>
    </div>
  );
}
