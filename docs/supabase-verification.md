# Supabase verification checklist

Read-only checks to confirm the Phase A foundation is correctly
installed in the directly-managed Supabase project. Every item is
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

## 8. Owner-only reads

Sign in as the owner, then in the browser console:

```js
const { data, error } = await window.supabase.from("records").select("id, user_id").limit(5);
console.log({ data, error });
```

Expected: rows returned only for `user_id = auth.uid()`; unauthenticated
requests return `[]` or an RLS-enforced empty response.

## 9. Second-user isolation

If a second test account is available, sign in as that user and repeat
the query above. Expected: none of the first user's rows appear.

## 10. Absence of frontend secrets

```
grep -RIn "SERVICE_ROLE\|service_role\|SUPABASE_JWT_SECRET\|SMTP_\|DATABASE_URL" src .env.example
```

Expected: no matches.

## Gate record

| Item                                        | Status              |
| ------------------------------------------- | ------------------- |
| migrations created                          | Migration created   |
| migrations actually applied                 | Migration applied   |
| owner account created                       | Manually configured |
| owner magic-link delivery works             | Verified            |
| `shouldCreateUser: false` works             | Verified            |
| public signup disabled                      | Manually configured |
| redirect URLs configured                    | Manually configured |
| RLS inspected                               | Verified            |
| RPC privileges inspected                    | Verified            |
| second-user isolation tested where possible | Not tested          |
| no Lovable Cloud backend exists             | Verified            |

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
