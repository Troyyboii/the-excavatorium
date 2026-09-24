# Lovable project knowledge

Use this as the durable project context when working on The Excavatorium in Lovable.

## Source of truth and synchronization

- The repository is owned and maintained directly through GitHub and the local checkout.
- Lovable is connected to the repository's `main` branch. A pushed commit can appear in Lovable, so every pushed commit must leave the app in a working state.
- Never force-push, rebase, amend, squash, or otherwise rewrite history that has already been pushed. Rewritten Git history can break Lovable's project history.
- Codex work should happen on a `codex/...` feature branch. Commit, push, pull request, merge, and Lovable publication are separate approval gates.

## Supabase ownership

- This is a directly managed Supabase project. Lovable must not create a replacement backend, change project ownership, or introduce a second data store.
- Canonical database history lives under `supabase/migrations/`. Hosted CI validates source; it does not push schema or deploy Edge Functions. After the one-time remote history repair is explicitly approved and verified, an authorized operator applies the exact validated SHA with the Supabase CLI.
- Authentication, row-level security, owner validation, and the protected record-and-link RPCs are authoritative. Client code must not bypass or duplicate those checks.
- Authenticated `SECURITY DEFINER` RPCs are intentional, documented exceptions. Do not convert or suppress them without reviewing their explicit role grants, empty `search_path`, and caller-ownership checks.

## Private data and offline behavior

- Archive records and relationships are private, authenticated, and online-only.
- The PWA may cache the static application shell and offline document only. It must never cache Supabase Auth, REST, Edge Function, OpenAI, or archive payload responses.
- Offline mode is read-only navigation guidance. Extraction and writes stay disabled until connectivity returns; there is no queued-write system.

## Secrets and extraction

- Never copy service-role keys, wrapping keys (`PROVIDER_KEY_*`), owner API keys, SMTP/OAuth secrets, or real credentials into Lovable knowledge, prompts, client `VITE_*` variables, browser code, GitHub, logs, or screenshots.
- Custodian, Conversation Excavation, and File Excavation use **owner BYOK** (encrypted server-side). Do not set a shared operator `OPENAI_API_KEY` to fund those production paths for registered users.
- Conversation extraction runs only in the Supabase Edge Function, uses the existing authenticated and rate-limited contract, and returns an editable draft. It never auto-saves.
- Saving remains exclusively through the protected existing record-and-links RPC.

## Delivery boundaries

- Local implementation does not authorize a commit, push, pull request, merge, deployment, Supabase setting change, secret change, or Lovable mutation.
- Preserve `supabase/.temp/`; those local linked-project files are not implementation debris and must not be staged or deleted.
