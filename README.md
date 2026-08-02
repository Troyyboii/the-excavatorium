# The Excavatorium

A private technical judgment archive for the things that deserve more than a
bookmark: tools, repositories, AI conversations, and decisions.

[Open the live application](https://the-excavatorium.lovable.app)

## Why The Excavatorium exists

Long AI conversations can hold technical lessons, decisions, and reasoning
worth returning to. Left in chat history, that judgment is difficult to find,
compare, or carry into the next project.

The Excavatorium exists to preserve judgment rather than merely store
information: what attracted you, what was promised, what actually happened,
what worked, what failed, and the final verdict.

## What it preserves

The archive has four connected record types:

- **Tools** — evaluations of software and AI tools, including their promises,
  outcomes, failures, replacements, revisit conditions, and final verdicts.
- **Repositories** — GitHub URLs plus a practical assessment of what a
  repository claims, what it actually does, its risks, and the recommended
  next action. The application stores the URL only; it does not call the
  GitHub API.
- **Conversations** — high-signal findings, decisions made, open loops,
  reusable prompts, memory candidates, and the original conversation text.
- **Decisions** — the reason and trigger, confidence, current status, and
  what would change your mind.

## Conversation Excavation with GPT-5.6

Conversation Excavation is an optional action within a Conversation record.
The user explicitly starts it by pasting a conversation and selecting
**Excavate with GPT-5.6**.

GPT-5.6 returns an editable structured draft: title, summary, tags, project
route, high-signal findings, decisions, open loops, reusable prompts, memory
candidates, and optional suggested links to existing records.

The model assists with excavation; it is not the authority. Nothing is saved
automatically. The user reviews the draft, edits it, chooses whether to apply
the suggested links, applies it to the form, and uses the ordinary Save action
to create or update the durable record.

## How the archive works

- Records can be linked to one another; each record shows both linked records
  and backlinks.
- Archive-wide search works across user-entered record fields. Tags and
  record-type views help keep the collection navigable.
- Tools keep their verdicts, including intentionally opinionated classifications
  such as **Buried** and, on rare occasion, **Grok-tier cursed**.
- Each record can be exported as readable Markdown.
- The complete archive can be exported as JSON and restored from a validated
  backup; replacement requires an explicit confirmation.
- The responsive interface supports use on iPhone and desktop.

## Privacy and ownership

The archive is stored in a directly managed Supabase project and is accessed
through authenticated sessions. Record reads are protected by Supabase Row
Level Security, and writes use the application's approved database RPCs.

An excavation is sent to the model only after the signed-in user explicitly
initiates it. The OpenAI request uses `store: false`. The application and Edge
Function do not persist extraction requests or generated drafts; a draft only
becomes archive data when the user reviews, applies, and saves it. Standard
OpenAI API abuse-monitoring retention policies may still apply.

Markdown record exports and full JSON backups keep the archive portable and
give the owner an independent recovery path.

## Technology

- React and TypeScript
- TanStack Start and Router
- Tailwind CSS and shadcn/ui
- Direct Supabase for authentication, PostgreSQL storage, Row Level Security,
  and approved write RPCs
- A Supabase Edge Function for authenticated Conversation Excavation with
  `gpt-5.6-terra`
- Lovable deployment; no Lovable Cloud backend and no second backend

## Local development

```sh
bun install
bun run dev
```

The development server runs on `http://localhost:8080`.

Only public Supabase configuration belongs in browser environment variables:

```sh
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never put service-role keys, database passwords, private API keys, or other
secrets in browser code or committed files. Conversation Excavation also
requires an `OPENAI_API_KEY` configured as a Supabase Edge Function secret;
see the setup guide below.

## Detailed setup and verification

- [Supabase setup](./docs/supabase-setup.md) — migrations, owner-account
  bootstrap, secrets, and Edge Function deployment.
- [Supabase verification checklist](./docs/supabase-verification.md) —
  database, authentication, production, and Conversation Excavation checks.

## Verification status and known limitations

Automated tests are not yet included. Source, database, and production
validation are tracked separately in the verification checklist.

Conversation Excavation runtime scenarios, including malformed requests,
timeouts, discarding drafts, edited saves, suggested-link removal, and
origin handling, remain marked **Not tested** in the verification checklist.

The function hard-limits the raw request body to 110 KB even when
`Content-Length` is missing or false. Valid, authenticated requests are also
admitted through a durable per-user limit of ten requests in a rolling hour,
with a 30-second cooldown to stop double-clicks and client loops. Invalid,
signed-out, or unconfigured requests do not consume the quota. An admitted
request that later fails upstream still consumes a slot, deliberately bounding
retry-driven OpenAI cost.
