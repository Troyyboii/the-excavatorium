import { Cpu, Eye, Flag, Gauge, Play, ShieldCheck } from "@phosphor-icons/react";
import { Section, FoundationState } from "./custodian-ui";

const ICONS = { run: Play, observatory: Eye, approvals: ShieldCheck } as const;

export function CustodianScaffold({
  kind,
  title,
  description,
  points,
}: {
  kind: keyof typeof ICONS;
  title: string;
  description: string;
  points: readonly string[];
}) {
  const Icon = ICONS[kind];
  return (
    <div className="space-y-6">
      <FoundationState title={`${title} foundation pending`}>{description}</FoundationState>
      <Section
        title="Declared boundary"
        description="These statements describe the current surface, not an active runtime. "
      >
        <div className="grid gap-px bg-luminous-gold/15 sm:grid-cols-2 lg:grid-cols-3">
          {points.map((point) => (
            <div key={point} className="bg-background p-4">
              <Icon size={19} className="mb-3 text-luminous-gold" aria-hidden="true" />
              <p className="text-sm leading-6 text-foreground">{point}</p>
            </div>
          ))}
        </div>
      </Section>
      <p className="flex items-center gap-2 text-xs text-luminous-gold">
        <Flag size={15} aria-hidden="true" />
        No execution, model, cost, approval, or health value is being claimed here.
      </p>
    </div>
  );
}

export function ObservatorySignals() {
  return (
    <div className="grid gap-px bg-luminous-gold/15 sm:grid-cols-3">
      <Signal icon={Gauge} label="Runtime signal" value="Not connected" />
      <Signal icon={Cpu} label="Model signal" value="Not recorded" />
      <Signal icon={ShieldCheck} label="Verification signal" value="Not available" />
    </div>
  );
}

function Signal({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-background p-4">
      <Icon size={18} className="text-luminous-gold" aria-hidden="true" />
      <p className="mt-3 text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-white-gold">{value}</p>
    </div>
  );
}
