# Operator procedure: diagnostics migration ledger (`113236` ↔ `120000`)

**Audience:** authorized operators of the directly managed Supabase project.
**This document does not apply anything.** Coding agents and casual PRs must not
run these commands against production.

## Why this exists

Hosted history (verified earlier against the live project) recorded provider
diagnostics as version **`20260923113236`**. The repository file is named
**`20260923120000_custodian_provider_diagnostics.sql`**. The SQL intent is the
same diagnostics surface (`agent_provider_diagnostics` and related grants);
only the **version string in `supabase_migrations.schema_migrations`** differs
from the filename in Git.

If you `supabase db push` without reconciling, the CLI may try to apply
`20260923120000` as “new” SQL on top of an already-applied diagnostics schema,
or leave the ledger inconsistent before the `202609241*` beta migrations.

## Preconditions

1. You are linked to the **existing** directly managed project (not a new one).
2. You have a read-only before-state: `supabase migration list` output saved
   somewhere private (no secrets in chat).
3. You have confirmed the hosted schema already contains the diagnostics objects
   from the applied `113236` era (table/policies/RPCs present). Do **not**
   re-run the diagnostics DDL blindly.
4. Migrations `20260924100000` / `110000` / `120000` / `130000` are **not**
   applied yet, or you have a separate reviewed plan for them.

## Recommended procedure (bookkeeping only)

These steps update migration **history rows**. They do not execute migration
SQL.

1. Record current remote versions:

   ```text
   supabase migration list
   ```

2. If remote shows `20260923113236` applied and does **not** show
   `20260923120000`:

   ```text
   supabase migration repair 20260923113236 --status reverted
   supabase migration repair 20260923120000 --status applied
   ```

   Rationale: treat the hosted apply as equivalent to the canonical repo
   filename so later pushes line up with Git.

3. Re-run `supabase migration list` and confirm:
   - `20260923120000` is listed as applied
   - `20260923113236` is not left as an active applied row
   - no unexpected pending versions appear before `202609241*`

4. Only then consider dry-run / push for beta migrations:

   ```text
   supabase db push --dry-run
   # review SQL; then, with explicit authorization:
   supabase db push
   ```

## Stop conditions

- Remote schema **lacks** diagnostics objects but history claims `113236`
  applied → investigate; do not mark `120000` applied.
- Remote already has **both** version strings, or `120000` applied with
  divergent objects → stop and review manually; do not repair twice.
- Any uncertainty about equivalence → stop. Prefer a staging project over
  guessing on production.

## Out of scope

- Renaming or deleting the repo file `20260923120000_*.sql`
- Force-pushing Git history
- Setting `OPENAI_API_KEY`, wrapping keys, or deploying Edge Functions (separate
  checklist in [`public-readiness.md`](./public-readiness.md))
- Applying this from CI

## Related

- [`public-readiness.md`](./public-readiness.md) §8 release checklist
- [`supabase-setup.md`](./supabase-setup.md) §2 (legacy `0001`–`0012` repair is
  a different, earlier ledger event)
