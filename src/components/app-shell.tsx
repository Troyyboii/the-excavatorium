import { Link, useRouterState } from "@tanstack/react-router";
import {
  House,
  Wrench,
  BookOpen,
  ChatCenteredDots,
  Scales,
  MagnifyingGlass,
  Gear,
  List,
  X,
  SignOut,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: House, end: true },
  { to: "/tools", label: "Tools", icon: Wrench },
  { to: "/repositories", label: "Repositories", icon: BookOpen },
  { to: "/conversations", label: "Conversations", icon: ChatCenteredDots },
  { to: "/decisions", label: "Decisions", icon: Scales },
  { to: "/search", label: "Search", icon: MagnifyingGlass },
  { to: "/settings", label: "Settings", icon: Gear },
] as const;

export function AppShell({ email, children }: { email: string | null; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();

  // Close mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function onSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
  }

  const isActive = (to: string, end?: boolean) =>
    end ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <SidebarInner email={email} onSignOut={onSignOut} isActive={isActive} />
      </aside>

      {/* Mobile drawer + backdrop */}
      {mobileOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-[min(280px,85vw)] max-w-full flex-col border-r border-border bg-sidebar md:hidden"
            role="dialog"
            aria-label="Navigation"
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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground"
            onClick={() => setMobileOpen(true)}
          >
            <List size={20} />
          </button>
          <span className="min-w-0 truncate font-serif text-lg tracking-tight">
            The Excavatorium
          </span>
        </header>

        <main className="min-w-0 max-w-full flex-1 px-4 py-6 md:px-8 md:py-10">
          <div className="mx-auto w-full max-w-5xl min-w-0">{children}</div>
        </main>
      </div>
    </div>
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
      <div className="flex items-center justify-between border-b border-border px-4 py-4">
        <span className="font-serif text-lg tracking-tight text-foreground">The Excavatorium</span>
        {onClose ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        ) : null}
      </div>
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {NAV.map((n) => {
          const active = isActive(n.to, "end" in n ? n.end : undefined);
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-[color:var(--burgundy-muted)] text-foreground"
                  : "text-[color:var(--muted-foreground)] hover:bg-sidebar-accent hover:text-foreground",
              )}
            >
              <Icon
                size={18}
                weight={active ? "fill" : "regular"}
                className={active ? "text-[color:var(--brass)]" : ""}
              />
              <span>{n.label}</span>
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
