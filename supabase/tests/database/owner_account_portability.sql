-- Wave 2: owner account export + purge boundaries.
begin;

select plan(8);

set local role postgres;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  (
    'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'authenticated', 'authenticated',
    'export-owner-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'authenticated', 'authenticated',
    'export-owner-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  );

insert into public.records (id, user_id, record_type, title, record_data) values
  (
    'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    'tool', 'Owner A tool', '{}'::jsonb
  ),
  (
    'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2',
    'tool', 'Owner B tool', '{}'::jsonb
  );

insert into public.cases (id, owner_id, title, created_by, updated_by) values
  (
    'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    'Owner A case', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  ),
  (
    'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2',
    'Owner B case', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
  );

insert into public.evidence_items (
  id, owner_id, case_id, title, content, content_hash, source_classification,
  created_by, updated_by
) values (
  '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'A evidence', '{"text":"note"}'::jsonb,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'primary',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
);

insert into public.owner_provider_settings (owner_id, provider, model_name) values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'openai', 'gpt-5.6-sol');

select has_function(
  'public',
  'export_user_account_snapshot',
  array[]::text[],
  'export_user_account_snapshot exists'
);

select has_function(
  'public',
  'purge_owner_account_data',
  array[]::text[],
  'purge_owner_account_data exists'
);

select ok(
  not pg_catalog.has_function_privilege('anon', 'public.export_user_account_snapshot()', 'EXECUTE')
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.export_user_account_snapshot()', 'EXECUTE'
  ),
  'account export is authenticated-only'
);

select ok(
  not pg_catalog.has_function_privilege('anon', 'public.purge_owner_account_data()', 'EXECUTE')
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.purge_owner_account_data()', 'EXECUTE'
  ),
  'account purge is authenticated-only'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  jsonb_array_length(public.export_user_account_snapshot() -> 'cases') = 1
  and public.export_user_account_snapshot() #>> '{cases,0,id}' = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5'
  and jsonb_array_length(public.export_user_account_snapshot() -> 'evidence') = 1
  and jsonb_array_length(public.export_user_account_snapshot() -> 'provider_settings') = 1
  and public.export_user_account_snapshot() #>> '{provider_settings,0,model_name}' = 'gpt-5.6-sol'
  and public.export_user_account_snapshot() -> 'archive' -> 'records' is not null
  and (public.export_user_account_snapshot()::text !~* 'ciphertext')
  and (public.export_user_account_snapshot()::text !~* 'sk-'),
  'owner A account export includes own structured data and never ciphertext'
);

select set_config('request.jwt.claim.sub', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', true);

select ok(
  jsonb_array_length(public.export_user_account_snapshot() -> 'cases') = 1
  and public.export_user_account_snapshot() #>> '{cases,0,id}' = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6'
  and jsonb_array_length(public.export_user_account_snapshot() -> 'evidence') = 0
  and jsonb_array_length(public.export_user_account_snapshot() -> 'provider_settings') = 0,
  'owner B cannot see owner A cases, evidence, or preferences via export'
);

select set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', true);

select ok(
  (public.purge_owner_account_data() ->> 'purged')::boolean
  and not exists (
    select 1 from public.cases where owner_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  )
  and not exists (
    select 1 from public.records where user_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  )
  and not exists (
    select 1 from public.owner_provider_settings
     where owner_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  )
  and exists (
    select 1 from public.cases where owner_id = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
  )
  and exists (
    select 1 from public.records where user_id = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
  ),
  'purge removes only the caller owner rows'
);

select set_config('request.jwt.claim.sub', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', true);

select ok(
  jsonb_array_length(public.export_user_account_snapshot() -> 'cases') = 1,
  'owner B remains intact after owner A purge'
);

select * from finish();
rollback;
