import { Link } from "@tanstack/react-router";
import { CryptIcon } from "@/components/crypt-icon";
import { cn } from "@/lib/utils";

const VIEWS = [
  { id: "browse", label: "Browse", to: "/archive", glyph: "crypt" },
  { id: "connections", label: "Connections", to: "/graph", glyph: "chains" },
  { id: "timeline", label: "Timeline", to: "/timeline", glyph: "hourglass" },
  { id: "search", label: "Search", to: "/search", glyph: "search" },
] as const;

export function ArchiveViewNav({
  active,
  className,
}: {
  active: (typeof VIEWS)[number]["id"];
  className?: string;
}) {
  return (
    <nav
      aria-label="Archive views"
      className={cn(
        "flex max-w-full overflow-x-auto border border-[color:var(--mortar-strong)]",
        className,
      )}
    >
      {VIEWS.map((view) => {
        const current = active === view.id;
        return (
          <Link
            key={view.id}
            to={view.to}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 px-3.5 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--candlelight)]",
              current
                ? "bg-[color:var(--vault-raised)] text-foreground"
                : "text-[color:var(--mist)] hover:text-foreground",
            )}
          >
            <CryptIcon
              glyph={view.glyph}
              size={18}
              className={current ? "text-[color:var(--candlelight)]" : undefined}
            />
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
