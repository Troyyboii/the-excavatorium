-- Wave 2: owner account export + purge boundaries (hardened for RESTRICT graphs).
begin;

select plan(12);

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

-- Populated Custodian graph that previously broke cases-first purge (D1):
-- analysis findings RESTRICT runs/steps; runs RESTRICT tool_policies.
insert into public.tool_policies (
  id, owner_id, case_id, policy_name, status, allowed_model_tiers, allowed_tools,
  per_run_token_budget, per_run_cost_usd, per_run_latency_ms,
  created_by, updated_by
) values (
  'aaaaaaaa-1111-4111-8111-111111111111', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'Owner A policy', 'active',
  array['luna', 'terra']::text[], array['safe_read']::text[],
  100, 1, 1000,
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
);

insert into public.agent_runs (
  id, owner_id, case_id, tool_policy_id, idempotency_key, request_hash, objective,
  input_snapshot, input_snapshot_hash, prompt_version, model_tier, status,
  created_by, updated_by
) values (
  'bbbbbbbb-1111-4111-8111-111111111111', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'aaaaaaaa-1111-4111-8111-111111111111',
  'portability-restrict', repeat('a', 32), 'Populated purge fixture',
  '{}', repeat('b', 32), 'portability-v1', 'luna', 'completed',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
);

insert into public.agent_steps (
  id, owner_id, case_id, run_id, sequence_no, step_kind, status, idempotency_key,
  model_tier, prompt_version, input_payload, output_payload, completed_at,
  created_by, updated_by
) values (
  'cccccccc-1111-4111-8111-111111111111', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'bbbbbbbb-1111-4111-8111-111111111111',
  1, 'synthesize', 'completed', 'portability-restrict-step',
  'luna', 'portability-v1', '{}'::jsonb, '{"summary":"fixture"}'::jsonb, now(),
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
);

insert into public.custodian_findings (
  id, owner_id, case_id, analysis_mode, title, finding, origin_kind,
  analysis_outcome, origin_run_id, origin_step_id, candidate_index, analysis_result_hash,
  created_by, updated_by
) values (
  'dddddddd-1111-4111-8111-111111111111', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', 'synthesis', 'Restrict fixture finding',
  'Analysis finding that RESTRICTs run/step deletion.', 'analysis',
  'finding', 'bbbbbbbb-1111-4111-8111-111111111111', 'cccccccc-1111-4111-8111-111111111111',
  0, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
);

select has_function(
  'public',
  'export_user_account_snapshot',
  array[]::text[],
  'export_user_account_snapshot exists'
);

select has_function(
  'public',
  'purge_owner_account_data',
  array['uuid']::text[],
  'purge_owner_account_data(runtime_owner_id) exists'
);

select hasnt_function(
  'public',
  'purge_owner_account_data',
  array[]::text[],
  'zero-arg purge_owner_account_data must not exist (no authenticated intermediate)'
);

select ok(
  not pg_catalog.has_function_privilege('anon', 'public.export_user_account_snapshot()', 'EXECUTE')
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.export_user_account_snapshot()', 'EXECUTE'
  ),
  'account export is authenticated-only'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.purge_owner_account_data(uuid)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.purge_owner_account_data(uuid)', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.purge_owner_account_data(uuid)', 'EXECUTE'
  )
  and (
    select p.prosecdef
      and exists (
        select 1
          from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(value)
         where cfg.value like 'search_path=%'
      )
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'purge_owner_account_data'
     and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'runtime_owner_id uuid'
  ),
  'account purge is service_role-only with security definer and empty search_path'
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

-- D3: authenticated must not be able to call the destructive purge RPC.
select throws_ok(
  $$select public.purge_owner_account_data('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1')$$,
  '42501',
  null,
  'authenticated cannot invoke purge_owner_account_data'
);

-- D1 + D3: trusted path purges a populated RESTRICT graph for owner A only.
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select ok(
  (public.purge_owner_account_data('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1') ->> 'purged')::boolean,
  'service_role purge succeeds for a populated analysis+policy account'
);

set local role postgres;

select ok(
  not exists (
    select 1 from public.cases where owner_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  )
  and not exists (
    select 1 from public.records where user_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  )
  and not exists (
    select 1 from public.owner_provider_settings
     where owner_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  )
  and not exists (
    select 1 from public.custodian_findings
     where owner_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  )
  and not exists (
    select 1 from public.agent_runs
     where owner_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  )
  and not exists (
    select 1 from public.tool_policies
     where owner_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  )
  and exists (
    select 1 from public.cases where owner_id = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
  )
  and exists (
    select 1 from public.records where user_id = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
  ),
  'purge removes only the target owner rows including RESTRICT graph'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  jsonb_array_length(public.export_user_account_snapshot() -> 'cases') = 1,
  'owner B remains intact after owner A purge'
);

-- Cross-owner guard: service_role cannot invent a missing owner id without failing closed.
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select throws_ok(
  $$select public.purge_owner_account_data('99999999-9999-4999-8999-999999999999')$$,
  'P0002',
  'owner does not exist',
  'purge fails closed for unknown owner ids'
);

select * from finish();
rollback;
