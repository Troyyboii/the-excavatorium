import { Link } from "@tanstack/react-router";

const VIEWS = [
  { id: "browse", label: "Browse", to: "/archive" },
  { id: "connections", label: "Connections", to: "/graph" },
  { id: "timeline", label: "Timeline", to: "/timeline" },
  { id: "search", label: "Search", to: "/search" },
] as const;

export function ArchiveViewNav({ active }: { active: (typeof VIEWS)[number]["id"] }) {
  return (
    <nav aria-label="Archive views" className="flex flex-wrap gap-1 border-b border-border">
      {VIEWS.map((view) => (
        <Link
          key={view.id}
          to={view.to}
          aria-current={active === view.id ? "page" : undefined}
          className={[
            "inline-flex min-h-11 items-center border-b-2 px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === view.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
