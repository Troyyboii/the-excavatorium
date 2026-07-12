# The Excavatorium

A private, single-user technical judgment archive. Records AI tools,
GitHub repositories, long AI conversations, and technical decisions —
what attracted you, what was promised, what actually happened, and the
final verdict.

**Status: Phase B is implemented.** Password login with a magic-link
fallback, the product interface, and the GitHub connection are available.
The project is not yet published.

## Stack

- React + TypeScript
- Tailwind CSS + shadcn/ui (kept from the template)
- TanStack Start / Router
- Direct Supabase for authentication and PostgreSQL storage
- **No Lovable Cloud.** **No second backend.**
- **No deployment.**

## Local development

```
bun install
bun run dev
```

The app runs on `http://localhost:8080`.

## Required public environment variables

Only public Supabase configuration belongs in browser code. Copy
`.env.example` to `.env.local` and set:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

If these variables are unset, the client falls back to the values
compiled into `src/lib/supabase.ts` (also public). Never place a
service-role key, database password, JWT signing secret, SMTP
credentials, OAuth secrets, private API keys, or GitHub tokens in
browser code or committed files.

## Supabase migrations

Ordered SQL lives under [`docs/migrations/`](./docs/migrations/):

| File                          | Purpose                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `0001_tables.sql`             | `profiles`, `records`, `record_links`, `app_metadata`; constraints; composite ownership keys; approved seed-key lists      |
| `0002_indexes_triggers.sql`   | Useful indexes; reusable `updated_at` trigger                                                                              |
| `0003_rls_privileges.sql`     | RLS enable + owner-only `SELECT` policies; revoke direct mutations; grant `SELECT` to `authenticated`                      |
| `0004_profile_trigger.sql`    | Auto-create `profiles` row on `auth.users` insert                                                                          |
| `0005_validation_helpers.sql` | Internal four-branch `assert_record_data_valid`                                                                            |
| `0006_write_rpcs.sql`         | `save_record_with_links`, `delete_record_safely`                                                                           |
| `0007_seed_lifecycle.sql`     | `initialize_user_archive`, `remove_example_data`, `restore_missing_examples`, `reset_user_archive`, `restore_user_archive` |

Apply them in numeric order via the Supabase SQL editor or the Supabase
CLI (`supabase db execute`). They have not been applied automatically
by this repository.

## Owner-account bootstrap

1. In the Supabase dashboard for the directly-managed project, create
   the owner account (Authentication → Users → Add user, or invite by
   email).
2. From the login page in this app, submit the owner email and confirm
   the magic link is delivered.
3. In Authentication → Providers → Email, **disable "Enable new user
   signups"**. This makes public signup impossible; the existing owner
   continues to receive magic links because `shouldCreateUser: false`
   only rejects new addresses.
4. In Authentication → URL Configuration, add the approved redirect
   URLs: the current Lovable preview URL, `http://localhost:8080`, and
   the future hosted URL when configured.

## Build and test commands

```
bun install
bun run dev         # local development
bun run build       # production build
```

There are no automated tests in this repository.
