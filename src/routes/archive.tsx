import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, ChatCircleText, FileText, Scales, Wrench } from "@phosphor-icons/react";
import { CustodianPage, CustodianStatus, Section } from "@/components/custodian/custodian-ui";
import { useOnlineStatus } from "@/hooks/use-online";

export const Route = createFileRoute("/archive")({ component: ArchivePage, ssr: false });

const ROUTES = [
  {
    label: "Conversations",
    href: "/conversations",
    description: "Persisted conversation records.",
    icon: ChatCircleText,
  },
  {
    label: "Documents",
    href: "/documents",
    description: "Persisted document records.",
    icon: FileText,
  },
  {
    label: "Decisions",
    href: "/decisions",
    description: "Persisted decisions and their status.",
    icon: Scales,
  },
  {
    label: "Repositories",
    href: "/repositories",
    description: "Persisted repository evaluations.",
    icon: BookOpen,
  },
  { label: "Tools", href: "/tools", description: "Persisted tool evaluations.", icon: Wrench },
] as const;

function ArchivePage() {
  const online = useOnlineStatus();
  return (
    <CustodianPage
      title="Archive"
      description="Canonical record surfaces. The archive landing page contains navigation only; record counts are not duplicated here."
      status={<CustodianStatus online={online} status={online ? "Observing" : undefined} />}
    >
      <Section
        title="Canonical record routes"
        description="Open a record class to browse persisted entries."
      >
        <div className="grid gap-px bg-[#D5B56D]/15 sm:grid-cols-2 lg:grid-cols-3">
          {ROUTES.map(({ label, href, description, icon: Icon }) => (
            <a
              key={href}
              href={href}
              className="group flex min-h-32 flex-col justify-between bg-[#11100e] p-4 transition-colors hover:bg-[#4a2029]/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D5B56D]"
            >
              <Icon size={21} className="text-[#D5B56D]" aria-hidden="true" />
              <span>
                <span className="block font-serif text-lg text-[#F0E3BE]">{label}</span>
                <span className="mt-1 block text-xs text-[#9d9587]">{description}</span>
              </span>
            </a>
          ))}
        </div>
      </Section>
    </CustodianPage>
  );
}
