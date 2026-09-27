import { Link, useRouterState } from "@tanstack/react-router";
import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CryptIcon, type CryptGlyph } from "@/components/crypt-icon";
import { RECORD_KIND_SIGN } from "@/lib/record-standing";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/hooks/use-online";

const CANDLE = "text-[color:var(--candlelight)]";
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--candlelight)]";

type CaptureLinkItem = {
  to:
    | "/conversations/new"
    | "/documents/new"
    | "/decisions/new"
    | "/repositories/new"
    | "/tools/new";
  label: string;
  glyph: CryptGlyph;
  toneClass: string;
};
const CAPTURE_LINKS: readonly CaptureLinkItem[] = [
  { to: "/conversations/new", label: "Paste text", glyph: "shovel", toneClass: CANDLE },
  { to: "/documents/new", label: "Add document", ...RECORD_KIND_SIGN.document },
  { to: "/conversations/new", label: "Add conversation", ...RECORD_KIND_SIGN.conversation },
  { to: "/decisions/new", label: "Record a decision", ...RECORD_KIND_SIGN.decision },
] as const;
const MORE_CAPTURE_LINKS: readonly CaptureLinkItem[] = [
  { to: "/repositories/new", label: "Code repository", ...RECORD_KIND_SIGN.repository },
  { to: "/tools/new", label: "Tool", ...RECORD_KIND_SIGN.tool },
] as const;
type ShellLink = {
  to: "/" | "/archive" | "/cases" | "/approvals";
  label: "Home" | "Archive" | "Investigations" | "Review";
  glyph: CryptGlyph;
};
const PRIMARY_LINKS: readonly ShellLink[] = [
  { to: "/", label: "Home", glyph: "lantern" },
  { to: "/archive", label: "Archive", glyph: "crypt" },
  { to: "/cases", label: "Investigations", glyph: "key" },
  { to: "/approvals", label: "Review", glyph: "seal" },
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
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-3 px-4 md:gap-5 md:px-6 xl:gap-10 xl:px-14">
          <Link
            to="/"
            aria-label="The Excavatorium home"
            className={cn("flex min-h-11 min-w-0 items-center gap-2.5 rounded-sm pr-2", FOCUS_RING)}
          >
            <CryptIcon glyph="lantern" size={28} className={CANDLE} />
            <span className="truncate font-serif text-[1.45rem] leading-none text-foreground md:hidden lg:inline xl:text-[1.625rem]">
              The Excavatorium
            </span>
          </Link>
          <nav className="hidden h-full flex-1 items-stretch gap-1 md:flex" aria-label="Primary">
            {PRIMARY_LINKS.map((item) => (
              <DesktopNavLink
                key={item.to}
                {...item}
                active={item.to === "/archive" ? archiveActive : isActive(item.to)}
              />
            ))}
            <div className="ml-auto flex items-center">
              <MoreMenu email={email} onSignOut={onSignOut} active={moreActive} />
            </div>
          </nav>
          <div className="ml-auto flex items-center gap-2.5 md:ml-0">
            <Link
              to="/search"
              aria-label="Search Archive"
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-sm border border-[color:var(--mortar-strong)] text-[color:var(--mist)] transition-colors hover:border-[color:var(--candlelight)] hover:text-foreground",
                FOCUS_RING,
              )}
            >
              <CryptIcon glyph="search" size={20} />
            </Link>
            <div className="hidden md:block">
              <CaptureMenu online={online} />
            </div>
            <div className="md:hidden">
              <MoreMenu email={email} onSignOut={onSignOut} active={moreActive} />
            </div>
          </div>
        </div>
      </header>
      {!online ? (
        <div
          className="border-b border-[color:var(--warning)]/60 bg-[color:var(--warning)]/15 px-4 py-2 text-center text-sm text-foreground"
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
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-sidebar-border bg-sidebar px-1 pb-[env(safe-area-inset-bottom)] text-sidebar-foreground shadow-[0_-8px_24px_rgba(0,0,0,0.35)] md:hidden"
        aria-label="Mobile primary"
      >
        <MobileNavLink to="/" label="Home" glyph="lantern" active={pathname === "/"} />
        <MobileNavLink to="/archive" label="Archive" glyph="crypt" active={archiveActive} />
        <CaptureMenu online={online} mobile />
        <MobileNavLink to="/cases" label="Investigations" glyph="key" active={isActive("/cases")} />
        <MobileNavLink
          to="/approvals"
          label="Review"
          glyph="seal"
          active={isActive("/approvals")}
        />
      </nav>
    </div>
  );
}

function DesktopNavLink({ to, label, glyph, active }: ShellLink & { active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-2.5 text-base transition-colors focus-visible:ring-inset lg:px-3.5 lg:text-[1.0625rem]",
        FOCUS_RING,
        active
          ? "border-[color:var(--candlelight)] text-foreground"
          : "border-transparent text-[color:var(--mist)] hover:text-foreground",
      )}
    >
      <CryptIcon glyph={glyph} size={20} className={active ? CANDLE : undefined} />
      {label}
    </Link>
  );
}

const MENU_ITEM =
  "flex min-h-11 items-center rounded-sm px-3 py-2 text-left text-base text-foreground hover:bg-accent";

function MoreMenu({
  email,
  onSignOut,
  active,
}: {
  email: string | null;
  onSignOut: () => void;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const restoreFocusRef = useRef(false);

  function closeMenu(restoreFocus = true) {
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
  }

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        if (restoreFocusRef.current) triggerRef.current?.focus();
        restoreFocusRef.current = false;
      }
      return;
    }
    wasOpenRef.current = true;
  }, [open]);
  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          closeMenu(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="More destinations"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            queueMicrotask(() =>
              menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(),
            );
          }
        }}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-sm border transition-colors",
          FOCUS_RING,
          active || open
            ? "border-[color:var(--candlelight)] text-[color:var(--candlelight)]"
            : "border-[color:var(--mortar-strong)] text-[color:var(--mist)] hover:border-[color:var(--candlelight)] hover:text-foreground",
        )}
      >
        <CryptIcon glyph="hood" size={20} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More destinations"
          onKeyDown={(event) => {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
            );
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "Escape") {
              event.preventDefault();
              closeMenu();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!items.length) return;
              const direction = event.key === "ArrowDown" ? 1 : -1;
              items[(index + direction + items.length) % items.length]?.focus();
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              (event.key === "Home" ? items[0] : items.at(-1))?.focus();
            }
          }}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 overflow-hidden rounded-sm border border-[color:var(--mortar-strong)] bg-popover p-1 text-popover-foreground shadow-xl"
        >
          <Link
            to="/settings"
            role="menuitem"
            onClick={() => closeMenu(false)}
            className={cn(MENU_ITEM, FOCUS_RING)}
          >
            Settings
          </Link>
          <Link
            to="/advanced"
            role="menuitem"
            onClick={() => closeMenu(false)}
            className={cn(MENU_ITEM, FOCUS_RING)}
          >
            Advanced
          </Link>
          <div className="my-1 border-t border-border" />
          <p className="truncate px-3 py-1.5 text-sm text-[color:var(--ash)]" title={email ?? ""}>
            {email ?? "Not signed in"}
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu(false);
              onSignOut();
            }}
            className={cn(MENU_ITEM, "w-full", FOCUS_RING)}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

const CHOICE =
  "flex min-h-16 items-center gap-4 rounded-sm border border-border bg-card px-4 py-3 text-left text-foreground hover:border-[color:var(--candlelight)] hover:bg-accent";

export function CaptureMenu({
  online,
  mobile = false,
  label = "Capture",
  quiet = false,
}: {
  online: boolean;
  mobile?: boolean;
  label?: string;
  /** Secondary, outlined trigger for in-page use (the header keeps candlelight). */
  quiet?: boolean;
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
  }, [open, step]);
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
        "inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-[color:var(--candlelight)] px-[18px] text-base font-bold text-[color:var(--candle-ink)] transition-colors hover:bg-[color:var(--moonbone)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--moonbone)] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        mobile && "-mt-7 h-16 w-16 rounded-full px-0 shadow-[0_6px_18px_rgba(0,0,0,0.45)]",
        quiet &&
          "min-h-12 gap-2.5 border border-[color:var(--mortar-strong)] bg-transparent font-normal text-foreground hover:border-[color:var(--candlelight)] hover:bg-transparent",
      )}
    >
      <CryptIcon glyph="shovel" size={mobile ? 28 : 20} className={quiet ? CANDLE : undefined} />
      {mobile ? <span className="sr-only">Add or capture material</span> : <span>{label}</span>}
    </button>
  );
  return (
    <div className={cn("relative", mobile && "flex min-h-16 flex-col items-center justify-center")}>
      {trigger}
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close capture"
            className="fixed inset-0 z-40 cursor-default bg-black/60"
            onClick={close}
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={step === "choice" ? "Choose an action" : "Capture material"}
            className={cn(
              "fixed z-50 w-[min(30rem,calc(100vw-2rem))] border border-[color:var(--mortar-strong)] bg-popover p-5 text-popover-foreground shadow-2xl",
              mobile
                ? "inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-h-[min(36rem,calc(100dvh-7rem))] overflow-y-auto rounded-t-lg"
                : "right-4 top-20 rounded-sm md:right-6",
            )}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="font-serif text-2xl text-foreground">
                  {step === "choice" ? "Add to the Archive" : "Capture material"}
                </p>
                <p className="mt-1 text-base text-muted-foreground">
                  {step === "choice"
                    ? "Choose what you want to do. Nothing is created yet."
                    : "Choose a supported path. Saving happens in the selected form."}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close capture"
                onClick={close}
                className={cn(
                  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-[color:var(--mortar-strong)] text-foreground hover:bg-accent",
                  FOCUS_RING,
                )}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {step === "choice" ? (
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setStep("material")}
                  className={cn(CHOICE, FOCUS_RING)}
                >
                  <CryptIcon glyph="shovel" size={24} className={CANDLE} />
                  <span>
                    <span className="block font-bold">Capture material</span>
                    <span className="block text-sm text-muted-foreground">
                      Add something to the Archive.
                    </span>
                  </span>
                </button>
                <Link to="/cases" onClick={close} className={cn(CHOICE, FOCUS_RING)}>
                  <CryptIcon glyph="key" size={24} className={CANDLE} />
                  <span>
                    <span className="block font-bold">Start an Investigation</span>
                    <span className="block text-sm text-muted-foreground">
                      Frame a question and select evidence.
                    </span>
                  </span>
                </Link>
              </div>
            ) : (
              <div className="grid gap-1">
                {CAPTURE_LINKS.map((item) => (
                  <CaptureLink key={item.label} {...item} onChoose={close} />
                ))}
                <p className="mt-3 border-t border-border px-3 pt-3 text-sm text-muted-foreground">
                  More capture types
                </p>
                {MORE_CAPTURE_LINKS.map((item) => (
                  <CaptureLink key={item.label} {...item} onChoose={close} />
                ))}
                <button
                  type="button"
                  onClick={() => setStep("choice")}
                  className={cn(
                    "mt-2 min-h-11 self-start px-3 text-base text-muted-foreground underline decoration-[color:var(--candlelight)] underline-offset-4 hover:text-foreground",
                    FOCUS_RING,
                  )}
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
  glyph,
  toneClass,
  onChoose,
}: CaptureLinkItem & { onChoose: () => void }) {
  return (
    <Link
      to={to}
      onClick={onChoose}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-base text-foreground hover:bg-accent",
        FOCUS_RING,
      )}
    >
      <CryptIcon glyph={glyph} size={20} className={toneClass} />
      {label}
    </Link>
  );
}

function MobileNavLink({ to, label, glyph, active }: ShellLink & { active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-16 flex-col items-center justify-center gap-1 rounded-sm text-xs leading-tight focus-visible:ring-inset",
        FOCUS_RING,
        active ? CANDLE : "text-[color:var(--mist)]",
      )}
    >
      <CryptIcon glyph={glyph} size={24} />
      <span>{label}</span>
    </Link>
  );
}
