import { useState, type FormEvent } from "react";
import { Check, ClipboardText, PaperPlaneTilt } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FoundationState, Section } from "./custodian-ui";

export const INBOX_SOURCE_KINDS = [
  "thought",
  "conversation",
  "document",
  "url",
  "github",
  "context7",
  "record",
  "clipboard",
  "mobile_share",
] as const;

export type InboxSourceKind = (typeof INBOX_SOURCE_KINDS)[number];

export type InboxCreatePayload = {
  sourceKind: InboxSourceKind;
  title: string;
  content: string;
};

export function InboxIntake({
  onCreate,
  foundationPending = false,
}: {
  onCreate?: (payload: InboxCreatePayload) => Promise<unknown> | unknown;
  foundationPending?: boolean;
}) {
  const [sourceKind, setSourceKind] = useState<InboxSourceKind>("thought");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [candidate, setCandidate] = useState<InboxCreatePayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (foundationPending) {
      setMessage("Inbox intake is disabled while the data foundation is pending.");
      return;
    }
    const normalizedContent = content.trim();
    if (!normalizedContent) {
      setMessage("Add the thought, excerpt, link, or context before submitting.");
      return;
    }
    const payload = { sourceKind, title: title.trim(), content: normalizedContent };
    setMessage(null);
    setSubmitting(true);
    try {
      if (onCreate) {
        await onCreate(payload);
        setMessage("Inbox item created. Review the candidate below before downstream use.");
      } else {
        setMessage("Review candidate prepared locally. No inbox writer is connected yet.");
      }
      setCandidate(payload);
      setTitle("");
      setContent("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inbox item could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {foundationPending ? (
        <FoundationState title="Inbox writer foundation pending">
          The protected inbox RPC is wired. Apply the reviewed Custodian migration before persisted
          intake becomes available.
        </FoundationState>
      ) : null}

      <Section
        title="Universal intake"
        description="Capture a source without pretending it is already a verified archive record."
      >
        <form onSubmit={submit} className="space-y-4 p-4">
          <div className="grid gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
            <label className="space-y-2 text-sm text-muted-foreground">
              <span>Source kind</span>
              <select
                value={sourceKind}
                onChange={(event) => setSourceKind(event.target.value as InboxSourceKind)}
                className="min-h-10 w-full border border-luminous-gold/30 bg-background px-3 text-sm text-white-gold outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
              >
                {INBOX_SOURCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm text-muted-foreground">
              <span>
                Working title <span className="text-muted-foreground">(optional)</span>
              </span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Short title for review"
                className="min-h-10 rounded-none border-luminous-gold/30 bg-background text-white-gold placeholder:text-brass-muted focus-visible:ring-luminous-gold"
              />
            </label>
          </div>
          <label className="block space-y-2 text-sm text-muted-foreground">
            <span>Content or locator</span>
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste a thought, conversation excerpt, document note, URL, GitHub issue, Context7 reference, record ID, or mobile share payload."
              rows={8}
              className="resize-y rounded-none border-luminous-gold/30 bg-background text-white-gold placeholder:text-brass-muted focus-visible:ring-luminous-gold"
            />
          </label>
          {message ? (
            <p className="text-sm text-luminous-gold" role="status">
              {message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting || foundationPending}
            className="inline-flex min-h-11 items-center gap-2 border border-luminous-gold/40 bg-burgundy-muted/80 px-4 py-2 text-sm text-white-gold transition-colors hover:bg-risk/80 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-luminous-gold"
          >
            <PaperPlaneTilt size={16} aria-hidden="true" />
            {submitting ? "Creating…" : "Create inbox item"}
          </button>
        </form>
      </Section>

      <Section
        title="Review candidate"
        description="This is the submitted payload. Verification, classification, and promotion belong to the connected data layer."
      >
        {candidate ? (
          <div className="space-y-4 p-4">
            <dl className="grid gap-4 border-b border-luminous-gold/20 pb-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Source kind</dt>
                <dd className="mt-1 text-sm text-white-gold">{candidate.sourceKind}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Title</dt>
                <dd className="mt-1 text-sm text-white-gold">{candidate.title || "Untitled"}</dd>
              </div>
            </dl>
            <div className="flex items-start gap-3">
              <ClipboardText
                size={18}
                className="mt-0.5 shrink-0 text-luminous-gold"
                aria-hidden="true"
              />
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                {candidate.content}
              </p>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check size={15} className="text-luminous-gold" aria-hidden="true" />
              Awaiting downstream review state from the data foundation.
            </p>
          </div>
        ) : (
          <div className="p-5 text-sm text-muted-foreground">
            No intake candidate has been submitted in this session.
          </div>
        )}
      </Section>
    </div>
  );
}
