import { useEffect, useMemo, useState } from "react";
import { Command as CommandIcon, MagnifyingGlass } from "@phosphor-icons/react";
import type { ArchiveRecord } from "@/lib/types";
import { useArchive } from "@/lib/archive";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { RECORD_TYPE_LABEL } from "@/lib/types";
import { archiveRecordHref } from "./custodian-format";

const NAVIGATION = [
  ["Custodian Desk", "/"],
  ["Archive", "/archive"],
  ["Conversations", "/conversations"],
  ["Documents", "/documents"],
  ["Tools", "/tools"],
  ["Repositories", "/repositories"],
  ["Decisions", "/decisions"],
  ["Cases", "/cases"],
  ["Graph", "/graph"],
  ["Timeline", "/timeline"],
  ["Inbox", "/inbox"],
  ["Search", "/search"],
  ["Settings", "/settings"],
] as const;

const CREATION_ROUTES = [
  ["Conversation", "/conversations/new"],
  ["Document", "/documents/new"],
  ["Tool", "/tools/new"],
  ["Repository", "/repositories/new"],
  ["Decision", "/decisions/new"],
] as const;

type CommandPaletteProps = {
  enabled?: boolean;
  shortcutScope?: "all" | "mobile" | "desktop";
};

export function CommandPalette({ enabled = true, shortcutScope = "all" }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const archive = useArchive(enabled);
  const records = useMemo(
    () => archive.data?.records.slice().sort((a, b) => a.title.localeCompare(b.title)) ?? [],
    [archive.data?.records],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const desktop = window.matchMedia("(min-width: 768px)").matches;
        const active =
          shortcutScope === "all" ||
          (shortcutScope === "desktop" && desktop) ||
          (shortcutScope === "mobile" && !desktop);
        if (!active) {
          setOpen(false);
          return;
        }
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcutScope]);

  const navigate = (href: string) => {
    setOpen(false);
    window.location.assign(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          aria-label="Open Custodian command palette"
          className="inline-flex min-h-10 items-center gap-3 border border-luminous-gold/30 bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-luminous-gold/60 hover:text-white-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
        >
          <MagnifyingGlass size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Command the archive…</span>
          <span className="font-mono text-[10px] text-luminous-gold">⌘K</span>
        </button>
      }
    >
      <CommandInput placeholder="Search routes and persisted records…" />
      <CommandList>
        <CommandEmpty>No matching route or persisted record.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {NAVIGATION.map(([label, href]) => (
            <CommandItem key={href} value={label} onSelect={() => navigate(href)}>
              <CommandIcon size={16} aria-hidden="true" />
              <span>{label}</span>
              {href === "/archive" ? <CommandShortcut>⌘A</CommandShortcut> : null}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Create">
          {CREATION_ROUTES.map(([label, href]) => (
            <CommandItem
              key={href}
              value={`Create ${label}`}
              disabled={!enabled}
              onSelect={() => {
                if (enabled) navigate(href);
              }}
            >
              <CommandIcon size={16} aria-hidden="true" />
              <span>New {label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Open persisted record">
          {archive.data ? (
            records.map((record) => (
              <CommandItem
                key={record.id}
                value={`${record.title} ${record.recordType}`}
                onSelect={() => navigate(archiveRecordHref(record))}
              >
                <span className="font-mono text-[10px] text-luminous-gold">
                  {RECORD_TYPE_LABEL[record.recordType]}
                </span>
                <span className="min-w-0 truncate">{record.title}</span>
              </CommandItem>
            ))
          ) : (
            <CommandItem disabled value="archive unavailable">
              {archive.isPending ? "Retrieving archive…" : "Archive records unavailable"}
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
