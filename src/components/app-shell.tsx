import { Link, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  BookOpen,
  ChatCenteredDots,
  Gear,
  House,
  MagnifyingGlass,
  Plus,
  Scales,
  SignOut,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/hooks/use-online";

const NAV = [
  { to: "/", label: "Dashboard", icon: House, end: true },
  { to: "/tools", label: "Tools", icon: Wrench },
  { to: "/repositories", label: "Repositories", icon: BookOpen },
  { to: "/conversations", label: "Conversations", icon: ChatCenteredDots },
  { to: "/decisions", label: "Decisions", icon: Scales },
  { to: "/search", label: "Search", icon: MagnifyingGlass },
  { to: "/settings", label: "Settings", icon: Gear },
] as const;

const NEW_LINKS = [
  { to: "/conversations/new", label: "Conversation", icon: ChatCenteredDots },
  { to: "/tools/new", label: "Tool", icon: Wrench },
  { to: "/repositories/new", label: "Repository", icon: BookOpen },
  { to: "/decisions/new", label: "Decision", icon: Scales },
] as const;

export function AppShell({ email, children }: { email: string | null; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();
  const online = useOnlineStatus();

  useEffect(() => setMobileOpen(false), [pathname]);

  async function onSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
  }

  const isActive = (to: string, end?: boolean) =>
    end ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <SidebarInner email={email} onSignOut={onSignOut} isActive={isActive} />
      </aside>

      {mobileOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/70 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,82vw)] max-w-full flex-col border-r border-border bg-sidebar md:hidden"
            role="dialog"
            aria-label="Browse archive"
          >
            <SidebarInner
              email={email}
              onSignOut={onSignOut}
              isActive={isActive}
              onClose={() => setMobileOpen(false)}
            />
          </aside>
        </>
      ) : null}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur md:hidden">
          <span className="min-w-0 flex-1 truncate font-serif text-xl tracking-tight">
            The Excavatorium
          </span>
          <Link
            to="/search"
            aria-label="Search archive"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-card text-foreground"
          >
            <MagnifyingGlass size={20} />
          </Link>
          <NewMenu compact online={online} />
        </header>

        <header className="z-30 hidden h-16 shrink-0 items-center justify-end gap-3 border-b border-border bg-background/95 px-8 backdrop-blur md:flex">
          <Link
            to="/search"
            className="flex min-h-11 w-full max-w-sm items-center gap-3 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <MagnifyingGlass size={18} />
            <span>Search archive…</span>
          </Link>
          <NewMenu online={online} />
        </header>

        {!online ? (
          <div className="border-b border-[color:var(--warning)]/50 bg-[color:var(--warning)]/10 px-4 py-2 text-center text-xs text-foreground">
            Offline. Cached screens may remain visible, but saving and excavation are disabled.
          </div>
        ) : null}

        <main className="min-w-0 max-w-full flex-1 px-4 py-6 pb-28 md:px-8 md:py-6">
          <div className="mx-auto w-full max-w-6xl min-w-0">{children}</div>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-sidebar/98 px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
          <MobileNavLink to="/" label="Dashboard" icon={House} active={isActive("/", true)} />
          <MobileNavLink
            to="/search"
            label="Search"
            icon={MagnifyingGlass}
            active={isActive("/search")}
          />
          <Link
            to="/conversations/new"
            aria-label="New conversation"
            className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-foreground"
          >
            <span className="-mt-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--brass-muted)] bg-primary shadow-lg">
              <Plus size={23} weight="bold" />
            </span>
            <span>New</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
          >
            <Archive size={22} />
            <span>Browse</span>
          </button>
          <MobileNavLink
            to="/settings"
            label="Settings"
            icon={Gear}
            active={isActive("/settings")}
          />
        </nav>
      </div>
    </div>
  );
}

function NewMenu({ compact = false, online }: { compact?: boolean; online: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Create a record"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={!online}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "w-11 px-0" : "px-4",
        )}
      >
        <Plus size={19} weight="bold" />
        {compact ? null : <span className="text-sm font-medium">New</span>}
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-52 overflow-hidden rounded-md border border-border bg-popover shadow-xl">
          {NEW_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2 text-sm text-foreground last:border-0 hover:bg-[color:var(--record-hover)]"
              >
                <Icon size={17} className="text-[color:var(--brass)]" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MobileNavLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: typeof House;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex min-h-16 flex-col items-center justify-center gap-1 rounded-md text-xs",
        active ? "bg-[color:var(--burgundy-muted)] text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon size={22} weight={active ? "fill" : "regular"} />
      <span>{label}</span>
    </Link>
  );
}

function SidebarInner({
  email,
  onSignOut,
  isActive,
  onClose,
}: {
  email: string | null;
  onSignOut: () => void;
  isActive: (to: string, end?: boolean) => boolean;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex min-h-16 items-center justify-between border-b border-border px-4">
        <span className="font-serif text-lg tracking-tight text-foreground">The Excavatorium</span>
        {onClose ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border text-foreground"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        ) : null}
      </div>
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {NAV.map((item) => {
          const active = isActive(item.to, "end" in item ? item.end : undefined);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-[color:var(--burgundy-muted)] text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
              )}
            >
              <Icon
                size={18}
                weight={active ? "fill" : "regular"}
                className={active ? "text-[color:var(--brass)]" : ""}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground">
        <div className="mb-2 truncate font-mono" title={email ?? ""}>
          {email ?? "—"}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-[color:var(--record-hover)]"
        >
          <SignOut size={16} /> Sign out
        </button>
      </div>
    </>
  );
}
