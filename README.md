# The Excavatorium

A private technical judgment archive for the things that deserve more than a
bookmark: tools, repositories, AI conversations, decisions, and documents.

[Open the live application](https://the-excavatorium.lovable.app)

## Why The Excavatorium exists

Long AI conversations can hold technical lessons, decisions, and reasoning
worth returning to. Left in chat history, that judgment is difficult to find,
compare, or carry into the next project.

The Excavatorium exists to preserve judgment rather than merely store
information: what attracted you, what was promised, what actually happened,
what worked, what failed, and the final verdict.

## What it preserves

The archive has five connected record types:

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
- **Documents** — generic records for PDFs, Markdown, plain text, reports,
  audits, papers, specifications, postmortems, and other reference material.
  The archive stores bounded conclusions and source references, not the full
  extracted body in ordinary record data.

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

## File Excavation with GPT-5.6

File Excavation is an optional action within a Document record. V1 accepts PDF,
Markdown (`.md`), and UTF-8 plain text (`.txt`). The user explicitly selects
**Excavate with GPT-5.6**. The function normalizes bounded page-, heading-, or
line-aware source units, analyzes bounded chunks, validates source-reference
IDs, and returns an editable draft. Applying the draft only populates local
form state; the ordinary Save action remains the only archive persistence path.

When a file is saved, the original and normalized representation are stored in
the private `document-files` Supabase Storage bucket under an owner- and
record-scoped path. The normalized object also carries a small server-generated
provenance manifest containing its content hash and source-unit IDs, which is
checked again on file-backed saves. The browser receives only a short-lived
signed URL when the authenticated owner opens the original. Scanned or
image-only PDFs are rejected when usable text cannot be extracted; OCR is not
included.

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

Saved Document files are private Supabase Storage objects. The browser never
receives the OpenAI key, service-role credentials, or a private file URL. File
excavation does not create an OpenAI File object: the server sends bounded
normalized text to the Responses API with `store: false`, then discards the
request and draft unless the user saves. OpenAI's standard abuse-monitoring or
organization retention controls may still apply.

An excavation is sent to the model only after the signed-in user explicitly
initiates it. The OpenAI request uses `store: false`. The application and Edge
Function do not persist extraction requests or generated drafts; a draft only
becomes archive data when the user reviews, applies, and saves it. Standard
OpenAI API abuse-monitoring retention policies may still apply.

Markdown record exports, restorable archive JSON backups (records and links), and
full account JSON exports keep the archive portable. Account exports also include
Investigations, evidence, findings, approvals, Custodian run metadata, review
state, and non-secret provider preferences. JSON never contains private Storage
objects or plaintext API keys; restored file-backed Documents remain detached
until a file is selected and saved again.

## Technology

- React and TypeScript
- TanStack Start and Router
- Tailwind CSS and shadcn/ui
- Direct Supabase for authentication, PostgreSQL storage, Row Level Security,
  and approved write RPCs
- Supabase Edge Functions for authenticated Conversation and File Excavation
  using the owner's encrypted key and Settings model preference (BYOK)
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
secrets in browser code or committed files. Conversation and File Excavation
use the authenticated owner's encrypted OpenAI key and Settings model preference
(same BYOK path as Custodian). There is no shared operator `OPENAI_API_KEY`
fallback on those production paths; see the setup guide below.

The MCP server also requires a server-only `MCP_ALLOWED_CLIENT_IDS` value: a
comma-separated UUID allow-list of explicitly approved OAuth clients. Do not
prefix it with `VITE_` or expose it to browser code. Custodian provider
execution remains disabled; any future activation additionally requires a
server-only, versioned `CUSTODIAN_MODEL_PRICING_JSON` configuration and a
database-backed per-run provider-call reservation so concurrent invocations
cannot spend the same remaining budget.

## Accounts and bring-your-own OpenAI key

Anyone can create an account. A new account is an empty private archive and
needs no AI provider key. Provider-backed Custodian work, Conversation
Excavation, and File Excavation all run on the owner's own OpenAI API key,
encrypted server-side and never readable again, with the model chosen from a
fixed six-model list in Settings. See
[Public readiness](./docs/public-readiness.md) for the architecture, required
secrets and Auth settings, export/deletion scope, and remaining hosted steps.

## Detailed setup and verification

- [Public readiness](./docs/public-readiness.md) — signup, empty accounts,
  bring-your-own OpenAI key, and the release-time checklist. Nothing there is
  deployed by source alone.

- [Custodian program](./docs/custodian-program.md) — the canonical long-lived
  product, architecture, authority, and implementation program for The Custodian;
  it distinguishes verified current behavior from blocked and future capabilities.
- [First-run readiness](./docs/custodian-first-run-readiness.md) — source map
  and remaining live-proof blockers for the first bounded read-only Custodian
  run. It does not authorize provider activation.
- [Supabase setup](./docs/supabase-setup.md) — migrations, owner-account
  bootstrap, secrets, and explicit Edge Function deployment. Hosted CI does not
  deploy Supabase.
- [Diagnostics migration reconcile](./docs/migration-reconcile-diagnostics.md) —
  operator-only ledger repair for hosted `20260923113236` vs source
  `20260923120000` (no hosted apply from this doc alone).
- [Supabase verification checklist](./docs/supabase-verification.md) —
  database, authentication, production, and Conversation Excavation checks.

## License

The Excavatorium is **source-available** under the
[Business Source License 1.1](./LICENSE). That is **not** an OSI open-source
license. The Additional Use Grant covers personal, internal, and academic use;
other commercial use needs a separate license from the licensor. Change license
on the Change Date in `LICENSE` is Apache-2.0.

## Public beta limits

The public beta is an authenticated private archive plus optional owner-funded
AI features. Expect:

- **BYOK only** for Custodian runs and Conversation/File Excavation — your
  OpenAI key and Settings model; no shared operator key pays for those paths.
- **No teams, sharing, billing, or social login** in this beta.
- **MCP Custodian start/cancel** remain unavailable (`RUNTIME_UNAVAILABLE`).
- **Hosted Auth** (signup open/closed, SMTP, CAPTCHA, redirects) and Edge
  deploys lag the Git source until an operator completes the checklist in
  [Public readiness](./docs/public-readiness.md). Source alone does not mean
  every checkbox is live.
- Account JSON export omits private Storage binaries; deletion is owner
  self-serve in source and still needs hosted proof before relying on it in
  production.

## Contributing and security

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`SECURITY.md`](./SECURITY.md).

## Verification status and known limitations

Frontend unit tests are included. Source, database, Edge Function, and
production validation are tracked separately in the verification checklist.

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
