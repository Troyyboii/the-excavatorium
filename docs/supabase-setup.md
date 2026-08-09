# Supabase setup for The Excavatorium

This project uses a **directly-managed** Supabase project. Lovable Cloud
is intentionally not enabled. All schema, RLS, and RPC changes come from
the numbered SQL files in [`docs/migrations/`](./migrations/) and are
applied through the Supabase SQL editor or the Supabase CLI.

## 1. Required tables

Migration `0001_tables.sql` creates exactly four application tables:

- `profiles` — application-read-only mirror of `auth.users`
- `records` — Tools, Repositories, Conversations, Decisions, Documents
- `record_links` — undirected pair between two caller-owned records
- `app_metadata` — one row per user; schema version and seed lifecycle flag

## 2. Migrations

Apply the migrations in order:

```
docs/migrations/0001_tables.sql
docs/migrations/0002_indexes_triggers.sql
docs/migrations/0003_rls_privileges.sql
docs/migrations/0004_profile_trigger.sql
docs/migrations/0005_validation_helpers.sql
docs/migrations/0006_write_rpcs.sql
docs/migrations/0007_seed_lifecycle.sql
docs/migrations/0008_restore_hardening.sql
docs/migrations/0009_conversation_extraction_guardrails.sql
docs/migrations/0010_rls_and_fk_advisor_cleanup.sql
docs/migrations/0011_document_records.sql
```

Two supported paths:

**SQL editor.** Paste each file, in order, into the Supabase SQL editor
and run it. Each file is idempotent (`create ... if not exists`,
`create or replace function`, `drop trigger if exists ... create ...`)
so re-running a file is safe.

**Supabase CLI.**

```
supabase db execute --file docs/migrations/0001_tables.sql
supabase db execute --file docs/migrations/0002_indexes_triggers.sql
supabase db execute --file docs/migrations/0003_rls_privileges.sql
supabase db execute --file docs/migrations/0004_profile_trigger.sql
supabase db execute --file docs/migrations/0005_validation_helpers.sql
supabase db execute --file docs/migrations/0006_write_rpcs.sql
supabase db execute --file docs/migrations/0007_seed_lifecycle.sql
supabase db execute --file docs/migrations/0008_restore_hardening.sql
supabase db execute --file docs/migrations/0009_conversation_extraction_guardrails.sql
supabase db execute --file docs/migrations/0010_rls_and_fk_advisor_cleanup.sql
supabase db execute --file docs/migrations/0011_document_records.sql
```

Migration `0008_restore_hardening.sql` enforces the approved canonical
seed-key-to-record-type mapping, validates record data strictly by type,
prevents updates from changing an existing record's type, and preflights
archive restores before deleting current records or links. A failed restore
rolls back and leaves the existing archive intact; `app_metadata` is not
modified.

## 3. Row-level security

Migration `0003_rls_privileges.sql` enables RLS on every application
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

Migration `0009_conversation_extraction_guardrails.sql` creates an
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
`0010_rls_and_fk_advisor_cleanup.sql` keeps the existing owner-only read
semantics while removing per-row `auth.uid()` evaluation and adds indexes that
cover the two composite record-link foreign keys.

## 11. Document records and File Excavation

Migration `0011_document_records.sql` adds `document` to the existing record
contract, extends the protected Save and restore RPCs, and creates the private
`document-files` Storage bucket with owner-scoped policies. It must be applied
after `0010`; creating the file in this repository does not apply it to the
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
excavation request, then performs at most sixteen chunk calls plus one
synthesis call. The server never stores the full extracted body in
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
