# Supabase setup for The Excavatorium

This project uses a **directly-managed** Supabase project. Lovable Cloud
is intentionally not enabled. All schema, RLS, and RPC changes come from
the numbered SQL files in [`docs/migrations/`](./migrations/) and are
applied through the Supabase SQL editor or the Supabase CLI.

## 1. Required tables

Migration `0001_tables.sql` creates exactly four application tables:

- `profiles` — application-read-only mirror of `auth.users`
- `records` — Tools, Repositories, Conversations, Decisions
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
