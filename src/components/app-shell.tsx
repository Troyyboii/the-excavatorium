import { Link, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  BookOpen,
  ChatCenteredDots,
  FileText,
  FolderOpen,
  Gear,
  House,
  MagnifyingGlass,
  Plus,
  Scales,
  SignOut,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/hooks/use-online";

type CaptureLinkItem = {
  to:
    | "/conversations/new"
    | "/documents/new"
    | "/decisions/new"
    | "/repositories/new"
    | "/tools/new";
  label: string;
  icon: typeof House;
};
const CAPTURE_LINKS: readonly CaptureLinkItem[] = [
  { to: "/conversations/new", label: "Paste text", icon: ChatCenteredDots },
  { to: "/documents/new", label: "Add document", icon: FileText },
  { to: "/conversations/new", label: "Add conversation", icon: ChatCenteredDots },
  { to: "/decisions/new", label: "Record a decision", icon: Scales },
] as const;
const MORE_CAPTURE_LINKS: readonly CaptureLinkItem[] = [
  { to: "/repositories/new", label: "Code repository", icon: BookOpen },
  { to: "/tools/new", label: "Tool", icon: Wrench },
] as const;
type ShellLink = {
  to: "/" | "/archive" | "/cases" | "/approvals";
  label: "Home" | "Archive" | "Investigations" | "Review";
  icon: typeof House;
};
const PRIMARY_LINKS: readonly ShellLink[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/archive", label: "Archive", icon: Archive },
  { to: "/cases", label: "Investigations", icon: FolderOpen },
  { to: "/approvals", label: "Review", icon: Scales },
];

export function AppShell({ email, children }: { email: string | null; children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const isGraph = pathname === "/graph";
  async function onSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
  }
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const archiveActive =
    isActive("/archive") ||
    pathname === "/graph" ||
    pathname === "/timeline" ||
    pathname === "/search";
  const moreActive = isActive("/settings") || isActive("/advanced") || isActive("/run-room");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center gap-2 px-4 md:px-6">
          <Link
            to="/"
            aria-label="The Excavatorium home"
            className="flex min-h-11 min-w-0 items-center gap-2 rounded-sm pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
          >
            <img
              src="/brand/excavatorium-lantern.png"
              alt=""
              aria-hidden="true"
              className="h-9 w-9 shrink-0 object-contain"
            />
            <span className="hidden truncate font-serif text-xl tracking-tight sm:block">
              The Excavatorium
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {PRIMARY_LINKS.map((item) => (
              <DesktopNavLink
                key={item.to}
                {...item}
                active={item.to === "/archive" ? archiveActive : isActive(item.to)}
              />
            ))}
            <MoreMenu email={email} onSignOut={onSignOut} active={moreActive} />
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <Link
              to="/search"
              aria-label="Search Archive"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-sidebar-border px-3 text-sm text-sidebar-foreground transition-colors hover:border-sidebar-ring hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
            >
              <MagnifyingGlass size={18} aria-hidden="true" />
              <span className="hidden md:inline">Search</span>
            </Link>
            <div className="hidden md:block">
              <CaptureMenu online={online} />
            </div>
            <div className="md:hidden">
              <MoreMenu email={email} onSignOut={onSignOut} active={moreActive} compact />
            </div>
          </div>
        </div>
      </header>
      {!online ? (
        <div
          className="border-b border-[color:var(--warning)]/60 bg-[color:var(--warning)]/15 px-4 py-2 text-center text-xs text-foreground"
          role="status"
        >
          Offline. Cached screens may remain visible, but saving and examination are disabled.
        </div>
      ) : null}
      <main
        className={cn(
          "min-w-0 max-w-full pb-28 md:pb-8",
          isGraph ? "px-0 py-0" : "px-4 py-6 md:px-6 md:py-8",
        )}
      >
        <div className={cn("mx-auto w-full min-w-0 max-w-[1440px]", isGraph && "max-w-none")}>
          {children}
        </div>
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-sidebar-border bg-sidebar px-1 pb-[env(safe-area-inset-bottom)] text-sidebar-foreground shadow-[0_-8px_24px_rgba(17,20,18,0.18)] md:hidden"
        aria-label="Mobile primary"
      >
        <MobileNavLink to="/" label="Home" icon={House} active={pathname === "/"} />
        <MobileNavLink to="/archive" label="Archive" icon={Archive} active={archiveActive} />
        <CaptureMenu online={online} mobile />
        <MobileNavLink
          to="/cases"
          label="Investigations"
          icon={FolderOpen}
          active={isActive("/cases")}
        />
        <MobileNavLink
          to="/approvals"
          label="Review"
          icon={Scales}
          active={isActive("/approvals")}
        />
      </nav>
    </div>
  );
}

function DesktopNavLink({ to, label, active }: ShellLink & { active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-sm border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold",
        active
          ? "border-[color:var(--brass)] text-sidebar-foreground"
          : "border-transparent text-sidebar-foreground/75 hover:border-sidebar-ring/70 hover:text-sidebar-foreground",
      )}
    >
      {label}
    </Link>
  );
}

function MoreMenu({
  email,
  onSignOut,
  active,
  compact = false,
}: {
  email: string | null;
  onSignOut: () => void;
  active: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="More destinations"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex min-h-11 items-center justify-center rounded-sm border-b-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold",
          compact ? "w-11 border-transparent" : "px-3",
          active
            ? "border-[color:var(--brass)] text-sidebar-foreground"
            : "border-transparent text-sidebar-foreground/75 hover:text-sidebar-foreground",
        )}
      >
        {compact ? <Gear size={19} aria-hidden="true" /> : "More"}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="More destinations"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-56 overflow-hidden rounded-sm border border-sidebar-border bg-[color:var(--charcoal-stone)] p-1 shadow-xl"
        >
          <Link
            to="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
          >
            <Gear size={18} aria-hidden="true" /> Settings
          </Link>
          <Link
            to="/advanced"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
          >
            <BookOpen size={18} aria-hidden="true" /> Advanced
          </Link>
          <div className="my-1 border-t border-sidebar-border" />
          <p
            className="truncate px-3 py-1 font-mono text-[10px] text-sidebar-foreground/65"
            title={email ?? ""}
          >
            {email ?? "—"}
          </p>
          <button
            type="button"
            onClick={onSignOut}
            className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
          >
            <SignOut size={18} aria-hidden="true" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CaptureMenu({
  online,
  mobile = false,
  label = "Capture",
}: {
  online: boolean;
  mobile?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"choice" | "material">("choice");
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const close = () => {
    setOpen(false);
    setStep("choice");
  };
  useEffect(() => {
    if (!open) {
      returnFocusRef.current?.focus();
      return;
    }
    dialogRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"),
      );
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
  const trigger = (
    <button
      type="button"
      aria-label={label === "Capture" ? "Add or capture material" : label}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={!online}
      onClick={(event) => {
        returnFocusRef.current = event.currentTarget;
        setOpen(true);
      }}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-[color:var(--brass)] bg-[color:var(--deep-moss)] px-3 text-sm text-[color:var(--bone)] transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold disabled:cursor-not-allowed disabled:opacity-50",
        mobile && "-mt-5 h-12 w-12 rounded-full px-0 shadow-lg",
      )}
    >
      <Plus size={mobile ? 23 : 18} weight="bold" aria-hidden="true" />
      {mobile ? <span className="sr-only">Add or capture material</span> : <span>{label}</span>}
    </button>
  );
  return (
    <div className={cn("relative", mobile && "flex min-h-16 flex-col items-center justify-center")}>
      {trigger}
      {mobile ? <span className="mt-1 text-xs">Add</span> : null}
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close capture"
            className="fixed inset-0 z-40 cursor-default bg-black/50"
            onClick={close}
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={step === "choice" ? "Choose an action" : "Capture material"}
            className={cn(
              "fixed z-50 w-[min(30rem,calc(100vw-2rem))] border border-[color:var(--brass)] bg-popover p-5 text-popover-foreground shadow-2xl",
              mobile
                ? "inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-h-[min(36rem,calc(100dvh-7rem))] overflow-y-auto rounded-t-lg"
                : "right-4 top-20 rounded-sm md:right-6",
            )}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="font-serif text-xl text-foreground">
                  {step === "choice" ? "Add to the Archive" : "Capture material"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step === "choice"
                    ? "Choose what you want to do. Nothing is created yet."
                    : "Choose a supported path. Saving happens in the selected form."}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close capture"
                onClick={close}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {step === "choice" ? (
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setStep("material")}
                  className="flex min-h-14 items-center justify-between rounded-sm border border-border bg-card px-4 text-left text-foreground hover:border-[color:var(--brass)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
                >
                  <span>
                    <span className="block font-medium">Capture material</span>
                    <span className="block text-sm text-muted-foreground">
                      Add something to the Archive.
                    </span>
                  </span>
                  <Archive size={20} aria-hidden="true" />
                </button>
                <Link
                  to="/cases"
                  onClick={close}
                  className="flex min-h-14 items-center justify-between rounded-sm border border-border bg-card px-4 text-left text-foreground hover:border-[color:var(--brass)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
                >
                  <span>
                    <span className="block font-medium">Start an Investigation</span>
                    <span className="block text-sm text-muted-foreground">
                      Frame a question and select evidence.
                    </span>
                  </span>
                  <FolderOpen size={20} aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <div className="grid gap-1">
                {CAPTURE_LINKS.map((item) => (
                  <CaptureLink key={item.label} {...item} onChoose={close} />
                ))}
                <p className="mt-3 border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  More capture types
                </p>
                {MORE_CAPTURE_LINKS.map((item) => (
                  <CaptureLink key={item.label} {...item} onChoose={close} />
                ))}
                <button
                  type="button"
                  onClick={() => setStep("choice")}
                  className="mt-2 min-h-11 self-start px-2 text-sm text-muted-foreground underline decoration-[color:var(--brass)] underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
                >
                  Back
                </button>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CaptureLink({
  to,
  label,
  icon: Icon,
  onChoose,
}: CaptureLinkItem & { onChoose: () => void }) {
  return (
    <Link
      to={to}
      onClick={onChoose}
      className="flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
    >
      <Icon size={18} className="text-[color:var(--brass)]" aria-hidden="true" />
      {label}
    </Link>
  );
}

function MobileNavLink({ to, label, icon: Icon, active }: ShellLink & { active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-16 flex-col items-center justify-center gap-1 rounded-sm text-[11px] leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold",
        active
          ? "bg-[color:var(--deep-moss)] text-[color:var(--bone)]"
          : "text-sidebar-foreground/75",
      )}
    >
      <Icon size={21} weight={active ? "fill" : "regular"} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}
