# Supabase verification checklist

Read-only checks to confirm the deployed application and its Phase B
foundation are correctly installed in the directly-managed Supabase project.
Every item is
recorded as exactly one of:

```
Implemented in source | Migration created | Migration applied |
Manually configured | Verified | Blocked | Not tested
```

Do not treat these as interchangeable.

Run the SQL below in the Supabase SQL editor while signed in as an
admin. Compare output to the "Expected" column.

## 1. Tables exist

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles','records','record_links','app_metadata')
order by table_name;
```

Expected: exactly the four rows above.

## 2. RLS enabled on every application table

```sql
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('profiles','records','record_links','app_metadata');
```

Expected: `relrowsecurity = true` for all four.

## 3. Direct mutation privileges revoked

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('profiles','records','record_links','app_metadata')
  and grantee in ('anon','authenticated','public')
order by table_name, grantee, privilege_type;
```

Expected: only `SELECT` for `authenticated`; no privileges for `anon` or
`public`.

## 4. Function execution privileges

```sql
select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'),('authenticated')) r(rolname)
where n.nspname = 'public'
  and p.proname in (
    'initialize_user_archive','save_record_with_links','delete_record_safely',
    'remove_example_data','restore_missing_examples','reset_user_archive',
    'restore_user_archive','assert_record_data_valid',
    'install_canonical_seeds','set_updated_at','handle_new_auth_user'
  )
order by p.proname, r.rolname;
```

Expected: `can_exec = true` for `authenticated` on the seven exposed
RPCs; `false` for `anon` on every function; `false` for `authenticated`
on internal helpers (`assert_record_data_valid`,
`install_canonical_seeds`, `set_updated_at`, `handle_new_auth_user`).

## 5. Safe function search paths

```sql
select p.proname,
       (select array_agg(cfg) from unnest(p.proconfig) cfg where cfg like 'search_path=%') as search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';
```

Expected: every function shows `search_path=` (empty) or an equivalent
explicitly safe setting.

## 6. Composite link ownership FKs

```sql
select conname, pg_get_constraintdef(c.oid)
from pg_constraint c
join pg_class t on t.oid = c.conrelid
where t.relname = 'record_links' and c.contype = 'f';
```

Expected: both FK definitions reference `records(user_id, id)`, not
`records(id)` alone.

## 7. Seed identity constraints

```sql
select conname, pg_get_constraintdef(c.oid)
from pg_constraint c
join pg_class t on t.oid = c.conrelid
where t.relname = 'records'
  and conname in ('records_example_identity_ck','records_seed_key_allowed_ck');
```

Expected: both check constraints present; `records_seed_key_allowed_ck`
lists the 13 approved record seed keys.

## 8. Restore hardening (migration 0008)

Migration `20260802150700_restore_hardening.sql` covers four database protections:

- canonical seed keys are constrained to their approved record types;
- record data is validated strictly by record type, including required
  nullable keys and canonical seed relationships;
- an existing record's stored `record_type` cannot be changed by an update;
- archive restore payloads are fully preflighted before current records or
  links are deleted, with failed restores rolled back and `app_metadata`
  preserved.

Expected: the migration is applied, `restore_user_archive` rejects malformed,
inconsistent, duplicate, cross-user, self-linked, or non-resolving payloads
without deleting the current archive, and valid restores replace only the
caller's records and links.

## 9. Owner-only reads

Sign in as the owner, then in the browser console:

```js
const { data, error } = await window.supabase.from("records").select("id, user_id").limit(5);
console.log({ data, error });
```

Expected: rows returned only for `user_id = auth.uid()`; unauthenticated
requests return `[]` or an RLS-enforced empty response.

## 10. Second-user isolation

If a second test account is available, sign in as that user and repeat
the query above. Expected: none of the first user's rows appear.

## 11. Absence of frontend secrets

```
grep -RIn "SERVICE_ROLE\|service_role\|SUPABASE_JWT_SECRET\|SMTP_\|DATABASE_URL" src .env.example
```

Expected: no matches.

## 11. Migration ledger reconciliation gate

The repository's timestamped migration filenames are the deployment ledger.
Before the first automated deployment, an authorized operator must verify the
remote `supabase_migrations.schema_migrations` rows and perform the documented
one-time legacy-to-timestamp history repair. `supabase migration repair` only
changes migration bookkeeping; it must not be used to hide a missing schema
change.

Record the before and after output from:

```text
supabase migration list
```

For each legacy row that represents an already-applied migration, use the
reviewed mapping in [`supabase-setup.md`](./supabase-setup.md):

```text
supabase migration repair <legacy-version> --status reverted
supabase migration repair <canonical-version> --status applied
```

The deploy workflow remains fail-closed until an authorized operator sets the
GitHub Actions repository variable `SUPABASE_MIGRATION_RECONCILIATION_COMPLETE`
to `true`. Until then the deploy job is skipped. The variable is not a
substitute for the retained `migration list` evidence.

## Gate record

| Item                                        | Status              |
| ------------------------------------------- | ------------------- |
| migrations created                          | Migration created   |
| migrations actually applied                 | Migration applied   |
| owner account created                       | Manually configured |
| owner password login works                  | Verified            |
| magic-link fallback production login        | Not tested          |
| `shouldCreateUser: false` works             | Verified            |
| public signup disabled                      | Manually configured |
| redirect URLs configured                    | Manually configured |
| RLS inspected                               | Verified            |
| RPC privileges inspected                    | Verified            |
| second-user isolation tested where possible | Not tested          |
| no Lovable Cloud backend exists             | Verified            |
| GitHub main synchronized to Lovable         | Verified            |
| production deployment succeeded             | Verified            |
| desktop production use succeeded            | Verified            |
| Windows standalone app installation         | Verified            |
| iPhone production use succeeded             | Verified            |
| iPhone Home Screen installation             | Verified            |
| TypeScript passed                           | Verified            |
| production build passed twice               | Verified            |
| lint passed                                 | Verified            |
| `git diff --check` passed                   | Verified            |

## Build Week Conversation Excavation deployment checks

The following checks require a deployed `conversation-extract` Edge Function,
an `OPENAI_API_KEY` Supabase secret, and a signed-in test user. They are not
covered by the source-only verification above.

| Scenario                                    | Expected result                                                                    | Status     |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ---------- |
| signed-out request                          | `401`; no OpenAI call or persisted data                                            | Not tested |
| missing `OPENAI_API_KEY` secret             | sanitized `503`; no key detail returned                                            | Not tested |
| malformed request                           | sanitized `400`; no OpenAI call                                                    | Not tested |
| oversized transcript                        | client blocks it; function rejects it if bypassed                                  | Not tested |
| OpenAI timeout or invalid structured output | sanitized retryable `502`/`504`; no persisted data                                 | Not tested |
| Cancel or discard                           | request is aborted or draft removed; form values stay unchanged                    | Not tested |
| edited extraction save                      | only the ordinary `save_record_with_links` RPC persists edited fields              | Not tested |
| suggested-link removal                      | removed IDs are absent from the later RPC request                                  | Not tested |
| ordinary manual Conversation creation       | unchanged form and RPC workflow succeeds without an extraction                     | Not tested |
| allowed browser origins                     | production, configured preview, and localhost succeed; other origins receive `403` | Not tested |

## Conversation Excavation guardrails

Migration `20260802153543_conversation_extraction_guardrails.sql` and the Edge Function
source are required together. It is correct only when the migration has been
applied before the function version that calls
`consume_conversation_extraction_quota()` is deployed.

| Scenario                                             | Expected result                              | Status     |
| ---------------------------------------------------- | -------------------------------------------- | ---------- |
| oversized body without `Content-Length`              | `413`; body is cancelled before JSON parsing | Not tested |
| forged small `Content-Length` with an oversized body | `413`; actual bytes control the limit        | Not tested |
| valid request inside quota                           | admitted, then one OpenAI request            | Not tested |
| second valid request within 30 seconds               | `429` with `Retry-After`; no OpenAI request  | Not tested |
| eleventh valid request in the rolling hour           | `429` with `Retry-After`; no OpenAI request  | Not tested |
| User B reading or consuming User A's quota           | denied by RLS / owner scope                  | Not tested |

Migration `20260802153559_rls_and_fk_advisor_cleanup.sql` should remove the four
`auth_rls_initplan` notices and the two unindexed composite-FK notices.
The existing write-RPC `SECURITY DEFINER` warnings remain intentional and
must be treated as documented exceptions, not silently removed.

The production acceptance baseline is exactly 32 signed-in
`SECURITY DEFINER` advisories: the 25 authenticated Custodian APIs classified
below plus seven archive lifecycle/write RPCs (`delete_record_safely`,
`initialize_user_archive`, `remove_example_data`, `reset_user_archive`,
`restore_missing_examples`, `restore_user_archive`, and
`save_record_with_links`). Accept that set only after release-time catalog
checks reconfirm function ownership, empty `search_path`, authenticated-only
grants, and caller-owner predicates. `export_user_archive_snapshot` is a
`SECURITY INVOKER` function and must not increase this advisory count.

### Custodian `SECURITY DEFINER` classification

Source review of migrations `20260811190000` through `20260811191200` classifies
29 Custodian `SECURITY DEFINER` functions. Every one sets an empty
`search_path`. This classification explains the database-linter warnings; it
does not replace live privilege inspection or cross-owner tests.

| Class                              | Functions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Required execute state                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Internal trigger and audit helpers | `capture_record_revision`, `custodian_disable_automations_for_account_schema`, `custodian_disable_automations_for_tool_schema`, `custodian_runtime_write_audit`                                                                                                                                                                                                                                                                                                                                                     | Denied to `public`, `anon`, and `authenticated`                      |
| Release 1 owner APIs               | `custodian_create_case`, `custodian_update_case`, `custodian_create_inbox_item`, `custodian_triage_inbox_item`, `custodian_upsert_claim`, `custodian_upsert_evidence`, `custodian_upsert_action`, `custodian_upsert_finding`, `custodian_link_claim_evidence`, `custodian_promote_inbox_item`                                                                                                                                                                                                                       | Denied to `public` and `anon`; explicitly granted to `authenticated` |
| Runtime owner APIs                 | `custodian_create_agent_run`, `custodian_get_agent_run`, `custodian_run_budget_status`, `custodian_transition_agent_run`, `custodian_record_agent_step`, `custodian_create_approval_request`, `custodian_respond_approval`, `custodian_create_change_proposal`, `custodian_append_tool_event`, `custodian_request_cancel_agent_run`, `custodian_append_audit_event`, `custodian_upsert_record_embedding`, `custodian_start_automation_run`, `custodian_complete_automation_run`, `custodian_automation_emit_output` | Denied to `public` and `anon`; explicitly granted to `authenticated` |

The 25 authenticated APIs derive the caller from `auth.uid()` through
`custodian_current_owner()` and repeat owner-qualified checks inside the
privileged function. The four internal helpers have explicit authenticated
revokes. No source-level overexposure was demonstrated, so Phase 2A adds no
grant-changing migration. Reclassify before changing any signature, role grant,
caller derivation, owner predicate, or `search_path`. Current Supabase guidance
also requires explicit function privileges and careful review of every
`SECURITY DEFINER` function:
<https://supabase.com/docs/guides/database/functions>.

## Verification evidence notes

- Auth reachability: reachable
- Authenticated owner session: verified
- `initialize_user_archive` returned `{"status":"installed"}`
- `records` count: 13
- `record_links` count: 9
- `app_metadata` count: 1
- Authenticated table privileges: `SELECT` only
- `anon` and `public` table privileges: none
- Public RPC execution denied to `anon`
- Internal helper execution denied to `authenticated`
- All public functions use an explicit empty `search_path`
- Composite `record_links` ownership foreign keys verified
- Seed identity constraints verified

## Production verification evidence

- GitHub main synchronized to Lovable
- Production deployment succeeded
- Production password login succeeded
- Desktop production use succeeded
- Windows standalone app installation succeeded
- iPhone production use succeeded
- iPhone Home Screen installation succeeded
- TypeScript passed
- Production build passed twice
- Lint passed with 0 errors and 8 existing warnings
- `git diff --check` passed

Second-user isolation and magic-link production login remain Not tested.
