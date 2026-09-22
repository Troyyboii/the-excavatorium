# Supabase setup for The Excavatorium

This project uses one **directly managed** Supabase project. Lovable Cloud is
intentionally not enabled. GitHub `main` is the source of truth for schema,
RLS, RPC, and Edge Function changes. Canonical migrations live in
[`supabase/migrations/`](../supabase/migrations/).

## 1. Required tables

Migration `20260802150000_tables.sql` creates the original four application tables:

- `profiles` — application-read-only mirror of `auth.users`
- `records` — Tools, Repositories, Conversations, Decisions, Documents
- `record_links` — undirected pair between two caller-owned records
- `app_metadata` — one row per user; schema version and seed lifecycle flag

## 2. Migrations

The filenames in `supabase/migrations/` are the deployment ledger and run in
timestamp order. Do not replay the eight manually applied baseline migrations
against production. Before the first operator `supabase db push` against the
directly managed project, reconcile those filenames with the remote
`supabase_migrations.schema_migrations` history using a reviewed
`supabase migration repair` operation. Hosted CI does not apply migrations.

### One-time migration-history reconciliation

The original migrations were manually applied under the legacy versions below
and were later renamed to timestamped files. This is a history repair, not a
schema replay. Do not run `supabase db push` during this procedure.

| Legacy remote version | Canonical repository version |
| --------------------- | ---------------------------- |
| `0001`                | `20260802150000`             |
| `0002`                | `20260802150100`             |
| `0003`                | `20260802150200`             |
| `0004`                | `20260802150300`             |
| `0005`                | `20260802150400`             |
| `0006`                | `20260802150500`             |
| `0007`                | `20260802150600`             |
| `0008`                | `20260802150700`             |
| `0009`                | `20260802153543`             |
| `0010`                | `20260802153559`             |
| `0011`                | `20260809132453`             |
| `0012`                | `20260809132500`             |

An authorized operator should, after verifying that the remote schema already
contains the manually applied changes:

1. Link the local checkout to the existing project and save the read-only
   before-state from `supabase migration list`.
2. For every legacy version that appears in the remote history, mark that
   history row reverted, then mark its canonical timestamp applied:

   ```text
   supabase migration repair <legacy-version> --status reverted
   supabase migration repair <canonical-version> --status applied
   ```

   Run the pairs from `0001` through `0012`, substituting the values in the
   table. These commands update migration bookkeeping only; they do not run
   migration SQL. Stop if the remote schema or history does not match the
   reviewed mapping.

3. Run `supabase migration list` again and retain the output showing the
   canonical timestamped versions in the remote history and no legacy rows.
4. Only then may an authorized operator run `supabase db push` for later
   timestamped migrations. `supabase migration repair` is not a substitute for
   applying missing SQL.

There is no GitHub Actions workflow that deploys this project's schema or Edge
Functions. `.github/workflows/deploy-supabase.yml` was removed. Hosted
[`Validate application`](../.github/workflows/ci.yml) runs frontend, Edge, and
local pgTAP checks only. After CI is green for the intended commit, an
authorized operator links the existing project and applies changes explicitly:

```text
supabase db push --dry-run
supabase db push
supabase functions deploy conversation-extract
supabase functions deploy document-extract
supabase functions deploy document-save
supabase functions deploy document-fetch
supabase functions deploy custodian-run
```

Require aligned local and remote migration history, an empty reviewed dry run
when no schema change is expected, JWT verification left enabled, and retained
output that contains no secrets. Adding or editing a migration file does not
mutate the remote project.

Migration `20260802150700_restore_hardening.sql` enforces the approved canonical
seed-key-to-record-type mapping, validates record data strictly by type,
prevents updates from changing an existing record's type, and preflights
archive restores before deleting current records or links. A failed restore
rolls back and leaves the existing archive intact; `app_metadata` is not
modified.

## 3. Row-level security

Migration `20260802150200_rls_privileges.sql` enables RLS on every application
table and creates only **owner-scoped SELECT** policies. Direct
`INSERT`, `UPDATE`, `DELETE` privileges are revoked from `public`,
`anon`, and `authenticated`. All mutations flow through the
`SECURITY DEFINER` RPCs granted to `authenticated`.

## 4. Approved redirect URLs

In Authentication → URL Configuration, add:

- the current Lovable preview URL, e.g.
  `https://id-preview--<uuid>.lovable.app`
- `http://localhost:8080`
- `https://the-excavatorium.lovable.app`

Do not use production wildcards.

## 5. Owner login setup

1. Create the owner account in Authentication → Users.
2. Use password login as the primary login method.
3. Keep magic-link login available as the fallback method.
4. Authentication → Providers → Email → **disable "Enable new user
   signups"**.
5. Leave the Email provider enabled so magic-link OTPs remain available
   for the existing owner.

## 6. Signup disabling

The frontend always calls:

```ts
supabase.auth.signInWithOtp({
  email,
  options: {
    shouldCreateUser: false,
    emailRedirectTo,
  },
});
```

`shouldCreateUser: false` prevents the client from creating new
accounts. Disabling public signups in the Supabase dashboard is the
second, authoritative gate.

## 7. Protected RPC functions

All exposed lifecycle and write functions have privileges equivalent to:

```
REVOKE EXECUTE ON FUNCTION <sig> FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION <sig> FROM anon;
GRANT  EXECUTE ON FUNCTION <sig> TO authenticated;
```

Exposed signatures:

- `initialize_user_archive(local_date date) returns jsonb`
- `save_record_with_links(record_payload jsonb, selected_target_ids uuid[]) returns jsonb`
- `delete_record_safely(record_id uuid) returns jsonb`
- `remove_example_data() returns jsonb`
- `restore_missing_examples(local_date date) returns jsonb`
- `reset_user_archive() returns jsonb`
- `restore_user_archive(archive_payload jsonb) returns jsonb`

Internal helpers (`assert_record_data_valid`, `install_canonical_seeds`,
`set_updated_at`, `handle_new_auth_user`) have every client execution
grant revoked.

## 8. Backup distinction

Application JSON backups (Phase B) contain only caller-owned records
and links. They exclude the Supabase project reference, user IDs,
`app_metadata`, authentication tokens, and any secret. Supabase's own
project-level backups (base backups, PITR) are a separate concern
handled at the platform level and are not touched by this application.

## 9. No service-role key in frontend

The frontend uses only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never place a service-role key, database password, JWT signing secret,
SMTP credentials, OAuth secrets, or GitHub tokens in browser code.

## 10. Conversation excavation Edge Function

The optional Build Week Conversation Excavation feature lives in
`supabase/functions/conversation-extract/index.ts`. It is not a migration and
does not write to the database. Deploy it only after configuring the OpenAI key
as a Supabase project secret:

```
supabase secrets set OPENAI_API_KEY=...
supabase functions deploy conversation-extract
```

Set `LOVABLE_PREVIEW_ORIGIN` to the exact current HTTPS Lovable preview origin
when preview use is required. The function otherwise permits only
`https://the-excavatorium.lovable.app` and `http://localhost:8080`; unsupported
browser origins receive a sanitized rejection.

The browser invokes the function only after the user explicitly chooses
**“Excavate with GPT-5.6”**. The function validates the Supabase bearer token
server-side with `auth.getUser()`, never accepts a browser-provided user ID,
and uses `gpt-5.6-terra` via the OpenAI Responses API with strict JSON-schema
output. It rejects malformed and oversized requests, caps model output and
upstream wait time, does not log transcripts, output, headers, secrets, or raw
upstream errors, and does not persist extraction output in The Excavatorium or
the Edge Function. The OpenAI request explicitly uses `store: false`; standard
OpenAI API abuse-monitoring retention policies may still apply.

`OPENAI_API_KEY` must exist only in Supabase Edge Function secrets. Do not put
it in a `VITE_*` variable, `.env.example`, frontend source, Git, logs, or error
messages. Suggested record IDs are untrusted draft values; the existing
`save_record_with_links` RPC remains authoritative for ownership validation at
save time.

Migration `20260802153543_conversation_extraction_guardrails.sql` creates an
RLS-protected rate-limit table in the non-public `private` schema and one
authenticated RPC, `consume_conversation_extraction_quota()`. It admits at
most ten valid requests in a rolling hour and enforces a 30-second cooldown.
The function consumes quota only after authentication and full input
validation, immediately before the OpenAI request. It keeps the
`Content-Length` check as a cheap early rejection but also stream-reads and
counts the actual request bytes, so a missing or forged header cannot bypass
the 110 KB limit.

`supabase/config.toml` records that this function requires a verified JWT;
deployments must preserve that setting. Migration
`20260802153559_rls_and_fk_advisor_cleanup.sql` keeps the existing owner-only read
semantics while removing per-row `auth.uid()` evaluation and adds indexes that
cover the two composite record-link foreign keys.

## 11. Document records and File Excavation

Migration `20260809132453_document_records.sql` adds `document` to the existing record
contract, extends the protected Save and restore RPCs, and creates the private
`document-files` Storage bucket with owner-scoped policies. It must be applied
after the advisor cleanup migration; creating the file in this repository does not apply it to the
Supabase project. The normalized object stores a bounded provenance manifest
in Storage metadata; the record validator checks that the saved source
reference IDs and content hash match that manifest.

Deploy the two new functions only after the migration and the existing
`OPENAI_API_KEY` Edge Function secret are configured:

```
supabase functions deploy document-extract
supabase functions deploy document-save
```

`document-extract` accepts only PDF, Markdown, and UTF-8 text within its
bounded request, file, page, extracted-text, chunk, synthesis-input, and
output limits. It uses the existing authenticated quota RPC once per explicit
excavation request, then performs at most 24 chunk calls, with no more than
four running concurrently, plus one synthesis call. The server never stores the full extracted body in
`records.record_data`.

The original and normalized representation are written to private Storage
only during an explicit ordinary Save. File Excavation itself stores no
archive row or Storage object. OpenAI File uploads are not used; Responses
requests set `store: false`. OpenAI standard abuse-monitoring or organization
retention controls may still apply. Storage objects are owner-scoped and
opened through short-lived signed URLs; no public file URLs are created.

JSON backups preserve Document metadata, conclusions, and links, but they do
not contain private Storage objects. The backup builder clears document Storage
paths and content hashes so a restore creates a valid detached Document rather
than a record pointing at missing files.
