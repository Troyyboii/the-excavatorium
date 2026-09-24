-- The provider reservation records the EXACT model the owner chose, from the
-- central six-model catalog, and refuses anything off the catalog or in a
-- different policy tier than the run. No provider is contacted.
begin;

select plan(10);

set local role postgres;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'authenticated', 'authenticated', 'catalog-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

insert into public.records (id, user_id, record_type, title, summary, record_data) values
  ('e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'tool', 'Catalog admitted source', 'bounded summary', '{}'::jsonb);

insert into public.cases (
  id, owner_id, title, current_question, archive_scope, created_by, updated_by
) values (
  'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4',
  'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
  'Catalog case',
  'What does the admitted record support?',
  '{"record_ids":["e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3"],"free_text_context":"owner note only"}'::jsonb,
  'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
  'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(oid)
      from pg_catalog.pg_constraint
     where conname = 'agent_provider_reservations_model_ck'
  ) ~ 'gpt-6-astra'
  and (
    select pg_catalog.pg_get_constraintdef(oid)
      from pg_catalog.pg_constraint
     where conname = 'agent_provider_reservations_model_ck'
  ) ~ 'gpt-5.6-pro',
  'the reservation table accepts the six catalog models and still tolerates historical gpt-5.6-pro rows'
);

create or replace function pg_temp.reserve(run_key text, attempt text, model text, tier text)
returns jsonb
language sql
as $$
  select public.custodian_reserve_provider_call(
    (select id from public.agent_runs where idempotency_key = run_key),
    attempt,
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'catalog-price',
      'model_name', model,
      'model_tier', tier,
      'hold_tokens', 100,
      'hold_cost_usd', 0.10
    )
  )
$$;
grant execute on function pg_temp.reserve(text, text, text, text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', true);

do $$
declare
  policy_id uuid;
  run_id uuid;
  tier text;
begin
  policy_id := (
    public.custodian_ensure_readonly_analysis_policy(
      'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4',
      jsonb_build_object(
        'policy_name', 'catalog-fixture-policy',
        'allowed_model_tiers', jsonb_build_array('luna', 'terra', 'sol', 'pro'),
        'per_run_token_budget', 100000,
        'per_run_cost_usd', 5,
        'per_run_latency_ms', 5000,
        'per_run_tool_event_budget', 4,
        'daily_token_budget', 1000000,
        'monthly_token_budget', 1000000,
        'daily_cost_usd', 50,
        'monthly_cost_usd', 100
      )
    ) #>> '{policy,id}'
  )::uuid;
  foreach tier in array array['luna', 'pro', 'sol'] loop
    perform public.custodian_create_readonly_analysis_run(
      'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4',
      'catalog-run-' || tier,
      jsonb_build_object(
        'model_tier', tier,
        'prompt_version', 'catalog-fixture-v1',
        'objective', 'Read the admitted record only.',
        'tool_policy_id', policy_id
      )
    );
    select id into run_id from public.agent_runs where idempotency_key = 'catalog-run-' || tier;
    perform public.custodian_transition_agent_run(run_id, 'queued', 'retrieving', 'catalog-' || tier || '-r', '{}'::jsonb);
    perform public.custodian_transition_agent_run(run_id, 'retrieving', 'synthesizing', 'catalog-' || tier || '-s', '{}'::jsonb);
  end loop;
end;
$$;

select is(
  pg_temp.reserve('catalog-run-pro', 'catalog-hold-astra', 'gpt-6-astra', 'pro') ->> 'reserved',
  'true',
  'gpt-6-astra reserves under the pro tier'
);

select is(
  (select model_name from public.agent_provider_reservations where idempotency_key = 'catalog-hold-astra'),
  'gpt-6-astra',
  'the reservation records the exact model the owner chose'
);

select is(
  pg_temp.reserve('catalog-run-luna', 'catalog-hold-luna', 'gpt-6-luna', 'luna') ->> 'reserved',
  'true',
  'gpt-6-luna reserves under the luna tier'
);

select is(
  pg_temp.reserve('catalog-run-sol', 'catalog-hold-sol', 'gpt-6-sol', 'sol') ->> 'reserved',
  'true',
  'gpt-6-sol reserves under the sol tier'
);

select throws_ok(
  $$select pg_temp.reserve('catalog-run-luna', 'catalog-hold-cross', 'gpt-6-astra', 'luna')$$,
  '22023',
  'provider reservation model does not match the source allowlist',
  'a model from another tier is refused; nothing is substituted'
);

select throws_ok(
  $$select pg_temp.reserve('catalog-run-pro', 'catalog-hold-retired', 'gpt-5.6-pro', 'pro')$$,
  '22023',
  'provider reservation model does not match the source allowlist',
  'the retired gpt-5.6-pro can no longer be reserved'
);

select throws_ok(
  $$select pg_temp.reserve('catalog-run-luna', 'catalog-hold-foreign', 'gpt-4o', 'luna')$$,
  '22023',
  'provider reservation model does not match the source allowlist',
  'a model outside the catalog is refused'
);

select throws_ok(
  $$select pg_temp.reserve('catalog-run-sol', 'catalog-hold-tiermismatch', 'gpt-6-luna', 'luna')$$,
  '42501',
  'reservation model tier must match the run',
  'a reservation tier that differs from the run is refused'
);

select is(
  (select count(*)::integer from public.agent_provider_reservations where idempotency_key like 'catalog-hold-%'),
  3,
  'refused reservations left no hold behind'
);

select * from finish();
rollback;
