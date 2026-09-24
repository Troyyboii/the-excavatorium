# The Excavatorium

**The Excavatorium is a private archive for things you want to remember, connect, and investigate later with AI.**

It is currently in **beta**.

[Open The Excavatorium](https://the-excavatorium.lovable.app)

## What you can do

- Save tools, repositories, conversations, decisions, and documents.
- Link related records together and follow backlinks.
- Search your Archive and browse it through connections and timeline views.
- Upload and excavate supported documents into editable drafts.
- Turn long AI conversations into structured records.
- Create **Investigations**, choose evidence from your Archive, and ask the **Custodian** to examine it.
- Keep model Findings separate from your own judgment.
- Export your Archive or your broader account data.
- Connect The Excavatorium to compatible AI clients through MCP.

The basic Archive does not need an AI key.

## Quick start

1. Create an account.
2. Add a few records to your Archive.
3. Link anything that belongs together.
4. If you want AI features, open **Settings**, add your own OpenAI API key, and choose a model.
5. Create an **Investigation**, select the Archive material you want examined, and run the Custodian.
6. Review the Finding and decide what, if anything, you want to do with it.

That is the basic loop:

**The Archive remembers. The Custodian examines. The Owner decides.**

## AI features and BYOK

The Excavatorium itself does not provide a shared OpenAI allowance.

Provider-backed features use **your own OpenAI API key**:

- Custodian Investigations
- Conversation Excavation
- File / Document Excavation

Your key is encrypted server-side. The app does not expose the plaintext key back to the browser, and there is no operator-key fallback for normal user requests.

Everything that does not contact the AI provider remains usable without a key.

## Privacy

Each account has its own private Archive.

Supabase Row Level Security and owner-scoped application boundaries are used to isolate user data. Uploaded document files are stored privately. AI requests use the owner's configured key and send requests with `store: false`.

The app does not automatically turn model output into owner truth. Findings stay attributable to the Investigation, run, model, and evidence that produced them.

## Beta notes

This is a real beta, not a finished commercial product.

Expect rough edges and ongoing changes to the UI, data model, integrations, and workflows. There are currently no teams, billing, social login, or shared Archives.

MCP retrieval is available for owner-scoped Archive access. Some Custodian actions exposed through MCP are intentionally still unavailable while the runtime is tightened further.

If something breaks, open an issue in this repository. For security problems, use the contact method in [SECURITY.md](./SECURITY.md) instead of posting sensitive details publicly.

## MCP

The Excavatorium includes an OAuth-backed MCP integration for compatible clients.

After connecting your Excavatorium account, supported clients can retrieve your own Archive data and use the available tools within the same owner boundary.

See [plugins/the-excavatorium/README.md](./plugins/the-excavatorium/README.md) for the current tool surface and setup details.

## Running locally

Requirements:

- Bun
- Supabase CLI
- a Supabase project or local Supabase stack

Install and run:

```sh
bun install
bun run dev
```

The local app runs on:

```text
http://localhost:8080
```

Browser configuration uses only public Supabase values:

```sh
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never put service-role keys, OpenAI keys, wrapping keys, database passwords, or other secrets in browser environment variables or committed files.

Useful docs:

- [Public beta / production readiness](./docs/public-readiness.md)
- [Supabase setup](./docs/supabase-setup.md)
- [Supabase verification](./docs/supabase-verification.md)
- [Custodian program](./docs/custodian-program.md)

## Contributing

Contributions, bug reports, and useful criticism are welcome.

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## License

The Excavatorium is **source-available** under the [Business Source License 1.1](./LICENSE).

It is not currently OSI open source. See the license for the Additional Use Grant, commercial-use terms, Change Date, and eventual Apache-2.0 change license.
