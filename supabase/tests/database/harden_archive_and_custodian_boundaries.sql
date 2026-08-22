-- Run against a local Supabase database after all migrations. The enclosing
-- transaction makes the fixture users and runtime rows self-cleaning.
begin;

select plan(12);

set local role postgres;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  (
    '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
    'boundary-owner-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
    'boundary-owner-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  );

insert into public.records (id, user_id, record_type, title, record_data) values
  ('01010101-0101-4101-8101-010101010101', '11111111-1111-4111-8111-111111111111', 'tool', 'A first', '{}'::jsonb),
  ('02020202-0202-4202-8202-020202020202', '11111111-1111-4111-8111-111111111111', 'repository', 'A second', '{}'::jsonb),
  ('03030303-0303-4303-8303-030303030303', '22222222-2222-4222-8222-222222222222', 'conversation', 'B only', '{}'::jsonb);

insert into public.record_links (id, user_id, source_record_id, target_record_id) values
  (
    '04040404-0404-4404-8404-040404040404', '11111111-1111-4111-8111-111111111111',
    '01010101-0101-4101-8101-010101010101', '02020202-0202-4202-8202-020202020202'
  );

insert into public.cases (id, owner_id, title, created_by, updated_by) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
    'Boundary test case', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- The export is transactional, stable-ID preserving, and cannot see another
-- authenticated owner's archive rows through its SECURITY INVOKER RLS path.
do $$
declare
  snapshot_value jsonb;
begin
  if not exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'export_user_archive_snapshot'
       and p.provolatile = 's'
  ) then
    raise exception 'archive snapshot function must use one stable transaction snapshot';
  end if;
  snapshot_value := public.export_user_archive_snapshot();
  if jsonb_array_length(snapshot_value -> 'records') <> 2
     or jsonb_array_length(snapshot_value -> 'links') <> 1
     or snapshot_value #>> '{records,0,id}' <> '01010101-0101-4101-8101-010101010101'
     or snapshot_value #>> '{records,1,id}' <> '02020202-0202-4202-8202-020202020202'
     or snapshot_value #>> '{links,0,id}' <> '04040404-0404-4404-8404-040404040404'
     or snapshot_value #>> '{records,0,user_id}' <> '11111111-1111-4111-8111-111111111111'
     or snapshot_value #>> '{records,0,record_type}' <> 'tool'
     or snapshot_value #>> '{links,0,source_record_id}' <> '01010101-0101-4101-8101-010101010101' then
    raise exception 'archive snapshot did not preserve owner-scoped stable IDs';
  end if;
end;
$$;

select ok(true, 'archive snapshot preserves stable IDs and the owner boundary');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $$
declare
  snapshot_value jsonb;
begin
  snapshot_value := public.export_user_archive_snapshot();
  if jsonb_array_length(snapshot_value -> 'records') <> 1
     or jsonb_array_length(snapshot_value -> 'links') <> 0
     or snapshot_value #>> '{records,0,id}' <> '03030303-0303-4303-8303-030303030303' then
    raise exception 'archive snapshot crossed an authenticated owner boundary';
  end if;
end;
$$;

select ok(true, 'archive snapshot isolates a second authenticated owner');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- A run cannot exist through the RPC without a policy, even when the caller
-- owns the target case.
do $$
begin
  begin
    perform public.custodian_create_agent_run(
      jsonb_build_object(
        'case_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'objective', 'must fail without policy'
      ),
      'boundary-missing-policy'
    );
    raise exception 'missing tool policy was accepted';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select ok(true, 'agent run creation rejects a missing tool policy');

set local role postgres;

insert into public.tool_policies (
  id, owner_id, case_id, policy_name, status, allowed_model_tiers, allowed_tools,
  per_run_token_budget, per_run_cost_usd, per_run_latency_ms,
  per_run_tool_event_budget, created_by, updated_by
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Boundary policy', 'active', array['luna']::text[], array['safe_read', 'write_tool']::text[],
  100, 1.0000, 2000, 2,
  '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'
), (
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0',
  '11111111-1111-4111-8111-111111111111',
  null,
  'Global policy is insufficient', 'active', array['luna']::text[], array['safe_read']::text[],
  100, 1.0000, 2000, 2,
  '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- Caller-selected values persist only when they narrow the active owner/case
-- policy; the policy's tool-event cap is included in that boundary.
do $$
declare
  response_value jsonb;
begin
  response_value := public.custodian_create_agent_run(
    jsonb_build_object(
      'case_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'tool_policy_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'objective', 'narrow policy values',
      'model_tier', 'luna',
      'tool_allowlist', jsonb_build_array('safe_read'),
      'budget_tokens', 10,
      'budget_cost_usd', 0.1000,
      'budget_latency_ms', 1000,
      'budget_tool_events', 1
    ),
    'boundary-narrow-policy'
  );
  if (response_value #>> '{run,budget_tokens}')::integer <> 10
     or (response_value #>> '{run,budget_cost_usd}')::numeric <> 0.1000
     or (response_value #>> '{run,budget_latency_ms}')::integer <> 1000
     or (response_value #>> '{run,budget_tool_events}')::integer <> 1
     or response_value #>> '{run,tool_policy_id}' <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception 'policy-owned run limits were not persisted exactly';
  end if;
end;
$$;

select ok(true, 'agent run budgets and tools may only narrow an exact-case policy');

do $$
begin
  begin
    perform public.custodian_create_agent_run(
      jsonb_build_object(
        'case_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'tool_policy_id', 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0',
        'objective', 'must reject an unscoped policy',
        'model_tier', 'luna'
      ),
      'boundary-global-policy'
    );
    raise exception 'global policy was accepted for a case-bound run';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.custodian_create_agent_run(
      jsonb_build_object(
        'case_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'tool_policy_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'objective', 'must reject escalated budget',
        'model_tier', 'luna',
        'budget_tokens', 101,
        'budget_tool_events', 3
      ),
      'boundary-budget-escalation'
    );
    raise exception 'policy budget escalation was accepted';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.custodian_create_agent_run(
      jsonb_build_object(
        'case_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'tool_policy_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'objective', 'must reject expanded tool list',
        'model_tier', 'luna',
        'tool_allowlist', jsonb_build_array('not_allowed')
      ),
      'boundary-tool-escalation'
    );
    raise exception 'policy tool-list escalation was accepted';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select ok(true, 'global policies and policy budget or tool escalation are rejected');

set local role postgres;

insert into public.agent_runs (
  id, owner_id, case_id, tool_policy_id, idempotency_key, request_hash,
  objective, input_snapshot, input_snapshot_hash, prompt_version,
  tool_allowlist, model_tier, status,
  budget_tokens, budget_cost_usd, budget_latency_ms, budget_tool_events,
  created_by, updated_by
) values
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'boundary-run-a', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Approved write run', '{}'::jsonb, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'boundary-v1',
    array['write_tool']::text[], 'luna', 'executing',
    100, 1.0000, 2000, 1,
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'boundary-run-b', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'Other write run', '{}'::jsonb, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'boundary-v1',
    array['write_tool']::text[], 'luna', 'executing',
    100, 1.0000, 2000, 2,
    '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'
  );

insert into public.approval_requests (
  id, owner_id, case_id, run_id, idempotency_key, approval_kind, status,
  title, proposed_diff, tool_action, exact_action_hash, requested_by
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'boundary-approval', 'external_write', 'approved',
  'Approved boundary action', '{}'::jsonb, '{}'::jsonb, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- Positive provider cost needs a persisted pricing version; zero-cost local
-- work remains valid without one.
do $$
declare
  response_value jsonb;
begin
  begin
    perform public.custodian_record_agent_step(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      jsonb_build_object('step_kind', 'execute', 'cost_usd', 0.2500),
      'boundary-missing-pricing-version'
    );
    raise exception 'costed step without pricing version was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  response_value := public.custodian_record_agent_step(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    jsonb_build_object(
      'step_kind', 'execute', 'cost_usd', 0.2500,
      'pricing_version', 'boundary-fixture-2026-08'
    ),
    'boundary-priced-step'
  );
  if (response_value #>> '{step,cost_usd}')::numeric <> 0.2500
     or response_value #>> '{step,pricing_version}' <> 'boundary-fixture-2026-08' then
    raise exception 'provider pricing version was not persisted with step cost';
  end if;
end;
$$;

select ok(true, 'provider cost requires and persists a pricing version');

do $$
begin
  begin
    perform public.custodian_record_agent_step(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      jsonb_build_object(
        'step_kind', 'execute',
        'model_tier', 'pro',
        'prompt_version', 'unapproved-override'
      ),
      'boundary-model-policy-override'
    );
    raise exception 'step model or prompt override was accepted';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select ok(true, 'agent steps cannot override the run model tier or prompt version');

-- A same-case approval cannot be replayed on another run, and a same-run
-- approval cannot be used for a different action hash.
do $$
declare
  response_value jsonb;
begin
  begin
    perform public.custodian_append_tool_event(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      jsonb_build_object(
        'tool_name', 'write_tool', 'event_kind', 'succeeded', 'operation_class', 'external_write',
        'approval_request_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'exact_action_hash', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ),
      'boundary-cross-run'
    );
    raise exception 'approval replay across runs was accepted';
  exception
    when no_data_found then null;
  end;

  begin
    perform public.custodian_append_tool_event(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      jsonb_build_object(
        'tool_name', 'write_tool', 'event_kind', 'succeeded', 'operation_class', 'external_write',
        'approval_request_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'exact_action_hash', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      ),
      'boundary-action-mismatch'
    );
    raise exception 'approval action-hash mismatch was accepted';
  exception
    when no_data_found then null;
  end;

  response_value := public.custodian_append_tool_event(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    jsonb_build_object(
      'tool_name', 'write_tool', 'event_kind', 'succeeded', 'operation_class', 'external_write',
      'approval_request_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'exact_action_hash', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    ),
    'boundary-exact-action'
  );
  if response_value #>> '{event,run_id}' <> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     or response_value #>> '{event,approval_request_id}' <> 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     or response_value #>> '{event,exact_action_hash}' <> 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' then
    raise exception 'tool event did not persist the same-run exact approval hash';
  end if;
end;
$$;

select ok(true, 'write tool events remain bound to the approved run and action hash');

do $$
begin
  begin
    perform public.custodian_transition_agent_run(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'executing',
      'blocked',
      'boundary-unpriced-transition-cost',
      jsonb_build_object('cost_delta', 0.1000)
    );
    raise exception 'unpriced transition cost was accepted';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select ok(true, 'run cost cannot bypass priced persisted step accounting');

do $$
declare
  response_value jsonb;
begin
  response_value := public.custodian_append_tool_event(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    jsonb_build_object(
      'tool_name', 'write_tool', 'event_kind', 'succeeded', 'operation_class', 'read_only'
    ),
    'boundary-tool-event-cap'
  );
  if response_value #>> '{run,status}' <> 'budget_stopped'
     or coalesce((response_value ->> 'budget_stopped')::boolean, false) is not true
     or response_value -> 'event' <> 'null'::jsonb then
    raise exception 'policy-owned per-run tool-event cap did not stop execution';
  end if;
end;
$$;

select ok(true, 'policy-owned per-run tool-event cap stops excess events');

set local role postgres;

do $$
begin
  delete from public.agent_runs
   where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if exists (
    select 1 from public.tool_events
     where run_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ) then
    raise exception 'tool event did not cascade with its deleted run';
  end if;
end;
$$;

select ok(true, 'approved tool events do not block run lifecycle deletion');

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.tool_events'::regclass
       and conname = 'tool_events_approval_run_hash_fk'
       and confdeltype = 'c'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'agent_steps'
       and column_name = 'pricing_version'
  ) or pg_catalog.has_function_privilege('anon', 'public.export_user_archive_snapshot()', 'EXECUTE')
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.export_user_archive_snapshot()', 'EXECUTE'
     ) then
    raise exception 'database boundary catalog or grants do not match the release contract';
  end if;
end;
$$;

select ok(true, 'database boundary constraints, columns, and RPC grants are installed');

select * from finish();

rollback;
