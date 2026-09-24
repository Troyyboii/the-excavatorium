-- BYO OpenAI key storage and owner model preference. Only opaque CIPHERTEXT
-- (never a real key) is used in these fixtures, and no provider is contacted.
-- Proves: nothing secret is reachable from the browser roles, only the trusted
-- runtime can store or read ciphertext, owners are isolated from each other,
-- plaintext-shaped values are rejected, and the model list is enforced.
begin;

select plan(31);

set local role postgres;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'authenticated', 'authenticated', 'byok-owner-a@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
  ('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'authenticated', 'authenticated', 'byok-owner-b@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

-- Structure -----------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.owner_provider_credentials'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class where oid = 'public.owner_provider_credential_events'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class where oid = 'public.owner_provider_settings'::regclass),
  'all three BYOK tables have row level security enabled'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.owner_provider_credentials', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.owner_provider_credentials', 'INSERT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.owner_provider_credentials', 'UPDATE')
  and not pg_catalog.has_table_privilege('authenticated', 'public.owner_provider_credentials', 'DELETE')
  and not pg_catalog.has_table_privilege('anon', 'public.owner_provider_credentials', 'SELECT')
  and not pg_catalog.has_table_privilege('service_role', 'public.owner_provider_credentials', 'SELECT')
  and not pg_catalog.has_table_privilege('service_role', 'public.owner_provider_credentials', 'INSERT'),
  'the ciphertext table has no direct privileges for anon, authenticated, or even service_role'
);

select ok(
  pg_catalog.has_table_privilege('authenticated', 'public.owner_provider_settings', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.owner_provider_settings', 'INSERT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.owner_provider_settings', 'UPDATE')
  and not pg_catalog.has_table_privilege('anon', 'public.owner_provider_settings', 'SELECT')
  and pg_catalog.has_table_privilege('authenticated', 'public.owner_provider_credential_events', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.owner_provider_credential_events', 'INSERT'),
  'preferences and the event log are owner-readable and only writable through RPCs'
);

select ok(
  pg_catalog.has_function_privilege('service_role', 'public.custodian_store_provider_credential(uuid,text,smallint,text)', 'EXECUTE')
  and pg_catalog.has_function_privilege('service_role', 'public.custodian_get_provider_credential(uuid)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'public.custodian_store_provider_credential(uuid,text,smallint,text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'public.custodian_get_provider_credential(uuid)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_store_provider_credential(uuid,text,smallint,text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_get_provider_credential(uuid)', 'EXECUTE'),
  'only the trusted runtime can store or read a credential'
);

select ok(
  pg_catalog.has_function_privilege('authenticated', 'public.custodian_provider_key_status()', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.custodian_remove_provider_credential()', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.custodian_set_model_preference(text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_provider_key_status()', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_remove_provider_credential()', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_set_model_preference(text)', 'EXECUTE'),
  'owner RPCs are for signed-in users only'
);

select is(
  (
    select count(*)::integer
      from information_schema.columns
     where table_schema = 'public'
       and table_name in ('owner_provider_credentials', 'owner_provider_credential_events', 'owner_provider_settings')
       and column_name in ('api_key', 'key', 'secret', 'plaintext', 'token', 'authorization')
  ),
  0,
  'no BYOK table has a column that could hold a plaintext key'
);

select ok(
  not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name ~* '(key|secret|token)'
  ),
  'profiles never holds provider material'
);

-- Plaintext-shaped values are refused by the table itself -------------------

select throws_ok(
  $$insert into public.owner_provider_credentials (owner_id, ciphertext, key_version, key_last4)
    values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'sk-proj-looksLikeAPlaintextKey', 1, 'abcd')$$,
  '23514',
  null,
  'a value shaped like a plaintext OpenAI key cannot be stored as ciphertext'
);

-- Anonymous -----------------------------------------------------------------

set local role anon;

select throws_ok(
  $$select public.custodian_provider_key_status()$$,
  '42501',
  null,
  'anon cannot read key status'
);

select throws_ok(
  $$select * from public.owner_provider_credentials$$,
  '42501',
  null,
  'anon cannot read the ciphertext table'
);

-- Owner A: browser cannot touch ciphertext or the trusted RPCs --------------

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', true);

select is(
  public.custodian_provider_key_status() ->> 'configured',
  'false',
  'a new owner has no key configured'
);

select throws_ok(
  $$select * from public.owner_provider_credentials$$,
  '42501',
  null,
  'an owner cannot select the ciphertext table'
);

select throws_ok(
  $$select public.custodian_store_provider_credential('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'Y2lwaGVy', 1::smallint, 'abcd')$$,
  '42501',
  null,
  'an owner cannot call the trusted store function'
);

select throws_ok(
  $$select public.custodian_get_provider_credential('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1')$$,
  '42501',
  null,
  'an owner cannot read ciphertext through the trusted read function'
);

-- Trusted runtime stores ciphertext for A and B ------------------------------

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (public.custodian_store_provider_credential('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'QUNJUEhFUlRFWFQ=', 1::smallint, '1234') ->> 'configured'),
  'true',
  'the runtime stores ciphertext for owner A'
);

select is(
  (public.custodian_get_provider_credential('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1') ->> 'ciphertext'),
  'QUNJUEhFUlRFWFQ=',
  'the runtime reads back exactly owner A ciphertext for owner A'
);

select is(
  public.custodian_get_provider_credential('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2'),
  null::jsonb,
  'owner B has no ciphertext, so A key is never served for B'
);

select public.custodian_store_provider_credential('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'QkNJUEhFUg==', 2::smallint, 'wxyz');

select throws_ok(
  $$select public.custodian_store_provider_credential('00000000-0000-4000-8000-000000000000', 'Q0lQSA==', 1::smallint, 'abcd')$$,
  'P0002',
  null,
  'the runtime cannot store a credential for an owner that does not exist'
);

-- Owner A sees only masked, own status --------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', true);

select is(
  public.custodian_provider_key_status() - 'updated_at',
  '{"configured": true, "last4": "1234", "key_version": 1}'::jsonb,
  'owner A sees configured, last four, and version only'
);

select ok(
  public.custodian_provider_key_status()::text !~ 'QUNJUEhFUlRFWFQ',
  'the status never contains ciphertext'
);

select is(
  (select count(*)::integer from public.owner_provider_credential_events),
  1,
  'owner A sees only owner A events'
);

select is(
  (select event from public.owner_provider_credential_events),
  'stored',
  'the event log records that a key was stored'
);

-- Owner B is isolated ---------------------------------------------------------

select set_config('request.jwt.claim.sub', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', true);

select is(
  public.custodian_provider_key_status() ->> 'last4',
  'wxyz',
  'owner B sees B status, not A'
);

select is(
  public.custodian_remove_provider_credential() ->> 'removed',
  'true',
  'owner B can remove their own key'
);

select set_config('request.jwt.claim.sub', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', true);

select is(
  public.custodian_provider_key_status() ->> 'configured',
  'true',
  'removing B key leaves A key untouched'
);

-- Model preference ------------------------------------------------------------

select throws_ok(
  $$select public.custodian_set_model_preference('gpt-5.6-pro')$$,
  '22023',
  null,
  'a retired or unlisted model cannot be chosen'
);

select throws_ok(
  $$insert into public.owner_provider_settings (owner_id, model_name) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'gpt-6-astra')$$,
  '42501',
  null,
  'preferences cannot be written directly'
);

select is(
  public.custodian_set_model_preference('gpt-6-astra') ->> 'model_tier',
  'pro',
  'owner A chooses gpt-6-astra, which maps to the pro policy tier'
);

select set_config('request.jwt.claim.sub', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', true);

select is(
  (select count(*)::integer from public.owner_provider_settings),
  0,
  'owner B cannot see owner A model choice'
);

select is(
  (
    select array_agg(distinct public.custodian_openai_model_tier(m) order by public.custodian_openai_model_tier(m))
      from unnest(array['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra']) as m
  ),
  array['luna', 'pro', 'sol', 'terra'],
  'the six catalog models map onto the four policy tiers'
);

select ok(
  public.custodian_openai_model_tier('gpt-5.6-pro') is null
  and public.custodian_openai_model_tier('gpt-4o') is null,
  'anything off the catalog has no tier'
);

select * from finish();
rollback;
