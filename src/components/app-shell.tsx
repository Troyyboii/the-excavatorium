import { Link, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  Binoculars,
  BookOpen,
  ChatCenteredDots,
  CheckSquareOffset,
  ClockCounterClockwise,
  FileText,
  FolderOpen,
  Gear,
  Graph,
  House,
  Plus,
  Pulse,
  Scales,
  SignOut,
  Tray,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/hooks/use-online";
import { CommandPalette } from "@/components/custodian/command-palette";
import { CustodianStatus } from "@/components/custodian/custodian-ui";

const NAV = [
  { to: "/", label: "Custodian Desk", icon: House, end: true },
  { to: "/inbox", label: "Inbox", icon: Tray },
  { to: "/cases", label: "Cases", icon: FolderOpen },
  { to: "/archive", label: "Archive", icon: Archive },
  { to: "/graph", label: "Graph", icon: Graph },
  { to: "/timeline", label: "Timeline", icon: ClockCounterClockwise },
  { to: "/run-room", label: "Run Room", icon: Pulse },
  { to: "/observatory", label: "Observatory", icon: Binoculars },
  { to: "/approvals", label: "Approvals", icon: CheckSquareOffset },
  { to: "/settings", label: "Settings", icon: Gear },
] as const;

const NEW_LINKS = [
  { to: "/conversations/new", label: "Conversation", icon: ChatCenteredDots },
  { to: "/tools/new", label: "Tool", icon: Wrench },
  { to: "/repositories/new", label: "Repository", icon: BookOpen },
  { to: "/decisions/new", label: "Decision", icon: Scales },
  { to: "/documents/new", label: "Document", icon: FileText },
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
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-[color:var(--strong-border)] bg-sidebar md:flex">
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[color:var(--strong-border)] bg-background/95 px-4 backdrop-blur md:hidden">
          <span className="min-w-0 flex-1 truncate font-serif text-xl tracking-tight text-white-gold">
            The Excavatorium
          </span>
          <CommandPalette enabled={online} />
          <NewMenu compact online={online} />
        </header>

        <header className="z-30 hidden h-16 shrink-0 items-center justify-end gap-3 border-b border-[color:var(--strong-border)] bg-background/95 px-8 backdrop-blur md:flex">
          <CommandPalette enabled={online} />
          <NewMenu online={online} />
        </header>

        {!online ? (
          <div className="border-b border-[color:var(--warning)]/50 bg-[color:var(--warning)]/10 px-4 py-2 text-center text-xs text-foreground">
            Offline. Cached screens may remain visible, but saving and excavation are disabled.
          </div>
        ) : null}

        <main className="min-w-0 max-w-full flex-1 px-4 py-6 pb-28 md:px-8 md:py-6">
          <div className="mx-auto w-full max-w-[1500px] min-w-0">{children}</div>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[color:var(--strong-border)] bg-sidebar/98 px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
          <MobileNavLink to="/" label="Desk" icon={House} active={isActive("/", true)} />
          <MobileNavLink to="/inbox" label="Inbox" icon={Tray} active={isActive("/inbox")} />
          <Link
            to="/inbox"
            aria-label="Capture into the inbox"
            className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-white-gold"
          >
            <span className="-mt-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--luminous-gold)] bg-primary text-white-gold shadow-lg">
              <Plus size={23} weight="bold" />
            </span>
            <span>Capture</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
          >
            <Archive size={22} />
            <span>More</span>
          </button>
          <MobileNavLink
            to="/settings"
            label="Settings"
            icon={Gear}
            active={isActive("/settings")}
          />
        </nav>
      </div>

      <aside className="hidden w-[286px] shrink-0 border-l border-[color:var(--strong-border)] bg-sidebar xl:block">
        <div className="sticky top-0 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-luminous-gold">
            Custodian status
          </p>
          <h2 className="mt-2 font-serif text-xl text-white-gold">Operational presence</h2>
          <div className="mt-4 border-y border-[color:var(--strong-border)] py-3">
            <CustodianStatus
              status="Dormant"
              online={online}
              detail={online ? "No agent run is active." : "Network unavailable."}
            />
          </div>
          <dl className="mt-4 divide-y divide-[color:var(--border)] text-xs">
            <StatusRow label="Current task" value="No run active" />
            <StatusRow label="Evidence" value="Authenticated archive" />
            <StatusRow label="Model" value="None selected" />
            <StatusRow label="Approvals" value="Foundation pending" tone="gold" />
            <StatusRow label="Execution" value="Owner-gated" />
          </dl>
          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            The rail reports persisted or directly observable state only. It does not simulate agent
            activity.
          </p>
        </div>
      </aside>
    </div>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone?: "gold" }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3">
      <dt className="text-[color:var(--brass)]">{label}</dt>
      <dd
        className={cn(
          "text-right font-mono text-[11px]",
          tone ? "text-luminous-gold" : "text-white-gold",
        )}
      >
        {value}
      </dd>
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
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[color:var(--luminous-gold)]/55 bg-primary text-primary-foreground transition-colors hover:border-[color:var(--white-gold)] hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50",
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
        active ? "bg-[color:var(--burgundy-muted)] text-white-gold" : "text-muted-foreground",
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
      <div className="flex min-h-16 items-center justify-between border-b border-[color:var(--strong-border)] px-4">
        <span className="font-serif text-lg tracking-tight text-white-gold">The Excavatorium</span>
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
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {NAV.map((item) => {
          const active = isActive(item.to, "end" in item ? item.end : undefined);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-[color:var(--luminous-gold)] bg-[color:var(--burgundy-muted)] text-white-gold"
                  : "border-transparent text-muted-foreground hover:border-[color:var(--brass-muted)] hover:bg-sidebar-accent hover:text-white-gold",
              )}
            >
              <Icon
                size={18}
                weight={active ? "fill" : "regular"}
                className="text-[color:var(--brass)]"
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-[color:var(--strong-border)] px-3 py-3 text-xs text-muted-foreground">
        <div className="mb-2 truncate font-mono" title={email ?? ""}>
          {email ?? "—"}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[color:var(--brass-muted)] bg-card px-3 py-2 text-sm text-white-gold transition-colors hover:border-[color:var(--luminous-gold)] hover:bg-[color:var(--record-hover)]"
        >
          <SignOut size={16} /> Sign out
        </button>
      </div>
    </>
  );
}
