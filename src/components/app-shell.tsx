import { Link, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  BookOpen,
  ChatCenteredDots,
  ClockCounterClockwise,
  FileText,
  FolderOpen,
  Gear,
  Graph,
  House,
  MagnifyingGlass,
  Play,
  Plus,
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

const NAV_GROUPS = [
  {
    label: "Work",
    items: [
      { to: "/", label: "Custodian Desk", icon: House, end: true },
      { to: "/inbox", label: "Inbox", icon: Tray },
      { to: "/cases", label: "Cases", icon: FolderOpen },
      { to: "/run-room", label: "Run Room", icon: Play },
    ],
  },
  {
    label: "Records",
    items: [
      { to: "/archive", label: "Archive", icon: Archive },
      { to: "/conversations", label: "Conversations", icon: ChatCenteredDots },
      { to: "/documents", label: "Documents", icon: FileText },
      { to: "/repositories", label: "Repositories", icon: BookOpen },
    ],
  },
  {
    label: "Judgment",
    items: [
      { to: "/decisions", label: "Decisions", icon: Scales },
      { to: "/graph", label: "Graph", icon: Graph },
      { to: "/timeline", label: "Timeline", icon: ClockCounterClockwise },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/tools", label: "Tools", icon: Wrench },
      { to: "/search", label: "Search", icon: MagnifyingGlass },
      { to: "/settings", label: "Settings", icon: Gear },
    ],
  },
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
  const isGraph = pathname === "/graph";

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
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
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
            className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,82vw)] max-w-full flex-col border-r border-sidebar-border bg-sidebar md:hidden"
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-sidebar-border bg-sidebar/95 px-4 text-sidebar-foreground backdrop-blur md:hidden">
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <img
              src="/lantern-icon-192.png"
              alt=""
              aria-hidden="true"
              className="h-9 w-9 shrink-0 object-contain"
            />
            <span className="truncate font-serif text-xl tracking-tight text-sidebar-foreground">
              The Excavatorium
            </span>
          </span>
          <CommandPalette enabled={online} shortcutScope="mobile" inverse />
          <NewMenu compact online={online} />
        </header>

        <header className="z-30 hidden h-16 shrink-0 items-center justify-end gap-3 border-b border-[color:var(--strong-border)] bg-background/95 px-8 backdrop-blur md:flex">
          <CommandPalette enabled={online} shortcutScope="desktop" />
          <NewMenu online={online} />
        </header>

        {!online ? (
          <div className="border-b border-[color:var(--warning)]/50 bg-[color:var(--warning)]/10 px-4 py-2 text-center text-xs text-foreground">
            Offline. Cached screens may remain visible, but saving and excavation are disabled.
          </div>
        ) : null}

        <main
          className={cn(
            "min-w-0 max-w-full flex-1 pb-28 md:pb-6",
            isGraph ? "px-0 py-0" : "px-4 py-6 md:px-8 md:py-6",
          )}
        >
          <div className={cn("w-full min-w-0", !isGraph && "mx-auto max-w-[1500px]")}>
            {children}
          </div>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[color:var(--strong-border)] bg-sidebar/98 px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
          <MobileNavLink to="/" label="Desk" icon={House} active={isActive("/", true)} />
          <MobileNavLink to="/inbox" label="Inbox" icon={Tray} active={isActive("/inbox")} />
          <MobileExcavateMenu online={online} />
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-sidebar-foreground/70"
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
    </div>
  );
}

function NewMenu({ compact = false, online }: { compact?: boolean; online: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Create a new capture"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={!online}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[color:var(--luminous-gold)]/55 bg-primary text-primary-foreground transition-colors hover:border-[color:var(--white-gold)] hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "w-11 px-0" : "px-4",
        )}
      >
        <Plus size={19} weight="bold" />
        {compact ? null : <span className="text-sm font-medium">New capture</span>}
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

function MobileExcavateMenu({ online }: { online: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-sidebar-foreground">
      {open ? (
        <div
          id="mobile-excavate-menu"
          role="dialog"
          aria-label="Excavate"
          className="absolute bottom-[calc(100%-0.5rem)] left-1/2 z-50 w-64 -translate-x-1/2 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          <div
            role="presentation"
            className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-luminous-gold"
          >
            Excavate
          </div>
          <Link
            to="/conversations/new"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm hover:bg-[color:var(--record-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
          >
            <ChatCenteredDots size={18} className="text-[color:var(--brass)]" />
            Conversation
          </Link>
          <Link
            to="/documents/new"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm hover:bg-[color:var(--record-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
          >
            <FileText size={18} className="text-[color:var(--brass)]" />
            Document
          </Link>
          <div className="my-1 border-t border-border" />
          <Link
            to="/inbox"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm text-muted-foreground hover:bg-[color:var(--record-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
          >
            <Tray size={18} className="text-[color:var(--brass)]" />
            Inbox
          </Link>
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Open Excavate menu"
        aria-haspopup="dialog"
        aria-controls="mobile-excavate-menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={!online}
        className="-mt-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--luminous-gold)] bg-primary text-sidebar-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={23} weight="bold" />
      </button>
      <span>Excavate</span>
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
        active ? "bg-[color:var(--burgundy-muted)] text-foreground" : "text-sidebar-foreground/70",
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
      <div className="flex min-h-16 items-center justify-between border-b border-sidebar-border px-4">
        <span className="flex min-w-0 items-center gap-2">
          <img
            src="/lantern-icon-192.png"
            alt=""
            aria-hidden="true"
            className="h-9 w-9 shrink-0 object-contain"
          />
          <span className="truncate font-serif text-lg tracking-tight text-sidebar-foreground">
            The Excavatorium
          </span>
        </span>
        {onClose ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-sidebar-border text-sidebar-foreground"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        ) : null}
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 py-4" aria-label="Primary">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/70">
              {group.label}
            </p>
            {group.items.map((item) => {
              const active = isActive(item.to, "end" in item ? item.end : undefined);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm transition-colors",
                    active
                      ? "border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground"
                      : "border-transparent text-sidebar-foreground/70 hover:border-sidebar-ring/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                >
                  <Icon
                    size={18}
                    weight={active ? "fill" : "regular"}
                    className={active ? "text-sidebar-primary-foreground" : "text-brass"}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border px-3 py-3 text-xs text-sidebar-foreground/70">
        <div className="mb-2 truncate font-mono" title={email ?? ""}>
          {email ?? "—"}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:border-sidebar-ring hover:bg-sidebar-accent/80"
        >
          <SignOut size={16} /> Sign out
        </button>
      </div>
    </>
  );
}
