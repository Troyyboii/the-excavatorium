-- Deterministic Custodian M4A fixtures. No provider is contacted, no evidence
-- item is created, and no product-default model tier or cost ceiling is used.
begin;

select plan(52);

set local role postgres;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('14141414-1414-4414-8414-141414141414', 'authenticated', 'authenticated', 'm4a-owner-a@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
  ('15151515-1515-4515-8515-151515151515', 'authenticated', 'authenticated', 'm4a-owner-b@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

insert into public.records (id, user_id, record_type, title, summary, record_data) values
  ('34343434-3434-4434-8434-343434343434', '14141414-1414-4414-8414-141414141414', 'tool', 'M4A admitted source', 'bounded summary', '{"secret":"do-not-copy"}'::jsonb),
  ('64646464-6464-4464-8464-646464646464', '14141414-1414-4414-8414-141414141414', 'tool', 'M4A out of scope', 'not admitted', '{"secret":"also-hidden"}'::jsonb);

insert into public.cases (
  id, owner_id, title, current_question, archive_scope, created_by, updated_by
) values (
  '24242424-2424-4424-8424-242424242424',
  '14141414-1414-4414-8414-141414141414',
  'M4A owner A case',
  'What does the admitted record support?',
  '{"record_ids":["34343434-3434-4434-8434-343434343434","44444444-4444-4444-8444-444444444444"],"free_text_context":"owner note only"}'::jsonb,
  '14141414-1414-4414-8414-141414141414',
  '14141414-1414-4414-8414-141414141414'
);

insert into public.evidence_items (
  id, owner_id, case_id, title, content, content_hash, source_classification, source_record_id, created_by, updated_by
) values
  ('54545454-5454-4454-8454-545454545454', '14141414-1414-4414-8414-141414141414', '24242424-2424-4424-8424-242424242424', 'Citable evidence', '{"text":"citable body"}', md5('citable'), 'primary', '34343434-3434-4434-8434-343434343434', '14141414-1414-4414-8414-141414141414', '14141414-1414-4414-8414-141414141414'),
  ('74747474-7474-4474-8474-747474747474', '14141414-1414-4414-8414-141414141414', '24242424-2424-4424-8424-242424242424', 'Out of scope evidence', '{"text":"other body"}', md5('other'), 'secondary', '64646464-6464-4464-8464-646464646464', '14141414-1414-4414-8414-141414141414', '14141414-1414-4414-8414-141414141414'),
  ('84848484-8484-4484-8484-848484848484', '14141414-1414-4414-8414-141414141414', '24242424-2424-4424-8424-242424242424', 'Unlinked evidence', '{"text":"unlinked body"}', md5('unlinked'), 'unknown', null, '14141414-1414-4414-8414-141414141414', '14141414-1414-4414-8414-141414141414');

insert into public.tool_policies (
  id, owner_id, case_id, policy_name, status, allowed_model_tiers, allowed_tools,
  per_run_token_budget, per_run_cost_usd, per_run_latency_ms,
  daily_token_budget, monthly_token_budget, daily_cost_usd, monthly_cost_usd,
  created_by, updated_by
) values (
  '96969696-9696-4696-8696-969696969696',
  '14141414-1414-4414-8414-141414141414',
  '24242424-2424-4424-8424-242424242424',
  'm4a-legacy-null-ceiling',
  'active',
  array['terra']::text[],
  '{}'::text[],
  100000, 1, 5000,
  100000, 100000, null, null,
  '14141414-1414-4414-8414-141414141414',
  '14141414-1414-4414-8414-141414141414'
);

select ok(
  to_regclass('public.agent_provider_reservations') is not null
  and exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    where c.relname = 'agent_provider_reservations_one_held_idx'
  )
  and pg_catalog.has_function_privilege('authenticated', 'public.custodian_ensure_readonly_analysis_policy(uuid,jsonb)', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.custodian_create_readonly_analysis_run(uuid,text,jsonb)', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.custodian_reserve_provider_call(uuid,text,jsonb)', 'EXECUTE')
  and to_regprocedure('public.custodian_settle_provider_reservation(uuid,text,jsonb)') is null
  and not pg_catalog.has_function_privilege('authenticated', 'public.custodian_settle_provider_reservation(uuid,uuid,text,jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_settle_provider_reservation(uuid,uuid,text,jsonb)', 'EXECUTE')
  and pg_catalog.has_function_privilege('service_role', 'public.custodian_settle_provider_reservation(uuid,uuid,text,jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_ensure_readonly_analysis_policy(uuid,jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_create_readonly_analysis_run(uuid,text,jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_reserve_provider_call(uuid,text,jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'public.custodian_build_readonly_analysis_snapshot(uuid,uuid,text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_build_readonly_analysis_snapshot(uuid,uuid,text)', 'EXECUTE')
  and pg_catalog.has_table_privilege('authenticated', 'public.agent_provider_reservations', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.agent_provider_reservations', 'INSERT')
  and to_regprocedure('public.custodian_materialize_finding(uuid,integer)') is not null,
  'M4A hold storage is owner-readable, reserve stays owner-scoped, and settlement is service-role only'
);

set local role anon;

do $$
begin
  perform public.custodian_reserve_provider_call(
    '24242424-2424-4424-8424-242424242424',
    'm4a-anon',
    '{}'::jsonb
  );
  raise exception 'anon executed a provider reservation';
exception
  when insufficient_privilege then null;
end;
$$;

select ok(true, 'anon cannot reserve a provider call');

set local role authenticated;
select set_config('request.jwt.claim.sub', '14141414-1414-4414-8414-141414141414', true);

do $$
begin
  insert into public.agent_provider_reservations (
    owner_id, case_id, run_id, stage, idempotency_key, pricing_version, model_name,
    hold_tokens, hold_cost_usd, usage_knowledge, status, in_flight_until, created_by, updated_by
  ) values (
    '14141414-1414-4414-8414-141414141414',
    '24242424-2424-4424-8424-242424242424',
    '24242424-2424-4424-8424-242424242424',
    'synthesize', 'direct-insert', 'price', 'gpt-5.6-terra',
    1, 0.1, 'unknown', 'held', now() + interval '90 seconds',
    '14141414-1414-4414-8414-141414141414',
    '14141414-1414-4414-8414-141414141414'
  );
  raise exception 'authenticated insert into provider reservations succeeded';
exception
  when insufficient_privilege then null;
end;
$$;

select ok(true, 'authenticated owners cannot insert a provider reservation directly');

do $$
begin
  begin
    perform public.custodian_ensure_readonly_analysis_policy(
      '24242424-2424-4424-8424-242424242424',
      jsonb_build_object('policy_name', 'm4a-missing-tiers', 'per_run_token_budget', 1000)
    );
    raise exception 'missing model tiers were accepted';
  exception
    when invalid_parameter_value then
      if sqlerrm not like '%allowed_model_tiers is required%' then raise; end if;
  end;
  begin
    perform public.custodian_ensure_readonly_analysis_policy(
      '24242424-2424-4424-8424-242424242424',
      jsonb_build_object(
        'policy_name', 'm4a-missing-cost',
        'allowed_model_tiers', jsonb_build_array('terra'),
        'per_run_token_budget', 100000,
        'per_run_latency_ms', 5000,
        'per_run_tool_event_budget', 4,
        'daily_token_budget', 100000,
        'monthly_token_budget', 100000,
        'daily_cost_usd', 1,
        'monthly_cost_usd', 4
      )
    );
    raise exception 'omitted cost ceiling was accepted';
  exception
    when invalid_parameter_value then
      if sqlerrm not like '%per_run_cost_usd is required%' then raise; end if;
  end;
end;
$$;

select ok(true, 'readonly policy bootstrap requires explicit tiers and ceilings');

do $$
declare
  created_policy jsonb;
begin
  created_policy := public.custodian_ensure_readonly_analysis_policy(
    '24242424-2424-4424-8424-242424242424',
    jsonb_build_object(
      'policy_name', 'm4a-fixture-policy',
      'allowed_model_tiers', jsonb_build_array('terra'),
      'per_run_token_budget', 100000,
      'per_run_cost_usd', 1,
      'per_run_latency_ms', 5000,
      'per_run_tool_event_budget', 4,
      'daily_token_budget', 100000,
      'monthly_token_budget', 100000,
      'daily_cost_usd', 1,
      'monthly_cost_usd', 4
    )
  );
  if coalesce((created_policy ->> 'idempotent')::boolean, true)
     or created_policy #> '{policy,allowed_tools}' is distinct from '[]'::jsonb
     or created_policy #>> '{policy,policy_name}' <> 'm4a-fixture-policy' then
    raise exception 'explicit policy was not created with an empty tool allowlist';
  end if;
end;
$$;

select ok(true, 'explicit owner policy is stored with an empty tool allowlist');

select is(
  (
    public.custodian_ensure_readonly_analysis_policy(
      '24242424-2424-4424-8424-242424242424',
      jsonb_build_object(
        'policy_name', 'm4a-fixture-policy',
        'allowed_model_tiers', jsonb_build_array('terra'),
        'per_run_token_budget', 100000,
        'per_run_cost_usd', 1,
        'per_run_latency_ms', 5000,
        'per_run_tool_event_budget', 4,
        'daily_token_budget', 100000,
        'monthly_token_budget', 100000,
        'daily_cost_usd', 1,
        'monthly_cost_usd', 4
      )
    ) ->> 'idempotent'
  )::boolean,
  true,
  'the same explicit policy replays without a second row'
);

do $$
begin
  perform public.custodian_ensure_readonly_analysis_policy(
    '24242424-2424-4424-8424-242424242424',
    jsonb_build_object(
      'policy_name', 'm4a-fixture-policy',
      'allowed_model_tiers', jsonb_build_array('terra'),
      'per_run_token_budget', 100000,
      'per_run_cost_usd', 2,
      'per_run_latency_ms', 5000,
      'per_run_tool_event_budget', 4,
      'daily_token_budget', 100000,
      'monthly_token_budget', 100000,
      'daily_cost_usd', 1,
      'monthly_cost_usd', 4
    )
  );
  raise exception 'different explicit policy parameters were accepted';
exception
  when unique_violation then
    if sqlerrm not like '%different explicit parameters%' then raise; end if;
end;
$$;

select is(
  (select count(*)::integer from public.tool_policies where owner_id = '14141414-1414-4414-8414-141414141414' and policy_name = 'm4a-fixture-policy'),
  1,
  'a conflicting policy payload does not overwrite the stored ceilings'
);
select is(
  (select per_run_cost_usd from public.tool_policies where policy_name = 'm4a-fixture-policy'),
  1.0000,
  'the original explicit per-run cost remains stored'
);

do $$
declare
  created_run jsonb;
  snapshot jsonb;
  policy_id uuid;
begin
  select id into policy_id
    from public.tool_policies
   where owner_id = '14141414-1414-4414-8414-141414141414'
     and policy_name = 'm4a-fixture-policy';
  created_run := public.custodian_create_readonly_analysis_run(
    '24242424-2424-4424-8424-242424242424',
    'm4a-run-a',
    jsonb_build_object(
      'model_tier', 'terra',
      'prompt_version', 'm4a-fixture-v1',
      'objective', 'Read the admitted record only.',
      'tool_policy_id', policy_id
    )
  );
  snapshot := created_run #> '{run,input_snapshot}';
  if snapshot ->> 'kind' <> 'readonly_analysis_snapshot'
     or snapshot ->> 'owner_context' <> 'owner note only'
     or snapshot ->> 'case_question' <> 'What does the admitted record support?'
     or created_run #> '{run,tool_allowlist}' is distinct from '[]'::jsonb
     or created_run #>> '{run,retention_class}' <> 'standard'
     or snapshot::text like '%do-not-copy%'
     or snapshot::text like '%citable body%'
     or snapshot::text like '%other body%'
     or not exists (
       select 1 from jsonb_array_elements(snapshot -> 'admitted_records') admitted
        where admitted ->> 'record_id' = '34343434-3434-4434-8434-343434343434'
          and admitted ->> 'summary' = 'bounded summary'
     )
     or exists (
       select 1 from jsonb_array_elements(snapshot -> 'admitted_records') admitted
        where admitted ->> 'record_id' = '64646464-6464-4464-8464-646464646464'
     )
     or not exists (
       select 1 from jsonb_array_elements(snapshot -> 'excluded_records') excluded
        where excluded ->> 'record_id' = '44444444-4444-4444-8444-444444444444'
          and excluded ->> 'reason' = 'unavailable'
     )
     or not exists (
       select 1 from jsonb_array_elements_text(snapshot -> 'citable_evidence_ids') evidence_id
        where evidence_id = '54545454-5454-4454-8454-545454545454'
     )
     or exists (
       select 1 from jsonb_array_elements_text(snapshot -> 'citable_evidence_ids') evidence_id
        where evidence_id in (
          '74747474-7474-4474-8474-747474747474',
          '84848484-8484-4484-8484-848484848484'
        )
     ) then
    raise exception 'readonly analysis snapshot was not built from the owner scope';
  end if;
end;
$$;

select ok(true, 'the server-built snapshot admits in-scope records and cites only in-scope evidence');

do $$
declare
  policy_id uuid;
begin
  select id into policy_id
    from public.tool_policies
   where policy_name = 'm4a-fixture-policy';
  perform public.custodian_create_readonly_analysis_run(
    '24242424-2424-4424-8424-242424242424',
    'm4a-client-snapshot',
    jsonb_build_object(
      'model_tier', 'terra',
      'prompt_version', 'm4a-fixture-v1',
      'objective', 'Read the admitted record only.',
      'tool_policy_id', policy_id,
      'input_snapshot', '{"kind":"client"}'::jsonb
    )
  );
  raise exception 'client input snapshot was accepted';
exception
  when invalid_parameter_value then
    if sqlerrm not like '%only model_tier, prompt_version, objective, and tool_policy_id%' then
      raise;
    end if;
end;
$$;

select ok(true, 'a client input snapshot is rejected');
select is(
  (select count(*)::integer from public.evidence_items where owner_id = '14141414-1414-4414-8414-141414141414'),
  3,
  'readonly run bootstrap does not create evidence items'
);
select is(
  (select record_data from public.records where id = '34343434-3434-4434-8434-343434343434'),
  '{"secret":"do-not-copy"}'::jsonb,
  'readonly run bootstrap does not change archive record data'
);

do $$
declare
  run_id uuid;
  policy_id uuid;
  reserved jsonb;
  other jsonb;
begin
  select id into run_id from public.agent_runs where idempotency_key = 'm4a-run-a';
  perform public.custodian_transition_agent_run(run_id, 'queued', 'retrieving', 'm4a-run-a-retrieve', '{}'::jsonb);
  perform public.custodian_transition_agent_run(run_id, 'retrieving', 'synthesizing', 'm4a-run-a-synthesize', '{}'::jsonb);
  reserved := public.custodian_reserve_provider_call(
    run_id,
    'm4a-hold-a',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 100,
      'hold_cost_usd', 0.60
    )
  );
  if coalesce((reserved ->> 'reserved')::boolean, false) is not true
     or (reserved ->> 'reason') <> 'reserved'
     or (reserved #>> '{reservation,status}') <> 'held'
     or (reserved #>> '{reservation,usage_knowledge}') <> 'unknown'
     or (reserved #> '{reservation,actual_tokens}') <> 'null'::jsonb
     or (reserved #> '{reservation,actual_cost_usd}') <> 'null'::jsonb then
    raise exception 'provider hold was not stored as unknown usage';
  end if;
  other := public.custodian_reserve_provider_call(
    run_id,
    'm4a-hold-a',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 100,
      'hold_cost_usd', 0.60
    )
  );
  if coalesce((other ->> 'reserved')::boolean, true)
     or coalesce((other ->> 'replay')::boolean, false) is not true
     or (other ->> 'reason') <> 'provider_attempt_in_progress' then
    raise exception 'in-flight reservation replay was not refused';
  end if;
  other := public.custodian_reserve_provider_call(
    run_id,
    'm4a-hold-a-other',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 10,
      'hold_cost_usd', 0.10
    )
  );
  if coalesce((other ->> 'reserved')::boolean, true)
     or coalesce((other ->> 'replay')::boolean, true)
     or (other ->> 'reason') <> 'provider_attempt_in_progress' then
    raise exception 'a second in-flight hold was accepted';
  end if;
  select id into policy_id from public.tool_policies where policy_name = 'm4a-fixture-policy';
  perform public.custodian_create_readonly_analysis_run(
    '24242424-2424-4424-8424-242424242424',
    'm4a-run-b',
    jsonb_build_object(
      'model_tier', 'terra',
      'prompt_version', 'm4a-fixture-v1',
      'objective', 'A second read that must not share the remaining daily ceiling.',
      'tool_policy_id', policy_id
    )
  );
  select id into run_id from public.agent_runs where idempotency_key = 'm4a-run-b';
  perform public.custodian_transition_agent_run(run_id, 'queued', 'retrieving', 'm4a-run-b-retrieve', '{}'::jsonb);
  perform public.custodian_transition_agent_run(run_id, 'retrieving', 'synthesizing', 'm4a-run-b-synthesize', '{}'::jsonb);
  other := public.custodian_reserve_provider_call(
    run_id,
    'm4a-hold-b',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 10,
      'hold_cost_usd', 0.50
    )
  );
  if coalesce((other ->> 'reserved')::boolean, true)
     or (other ->> 'reason') <> 'daily_cost'
     or other -> 'reservation' <> 'null'::jsonb then
    raise exception 'daily ceiling did not refuse the second hold';
  end if;
end;
$$;

select is(
  (select cost_usd from public.agent_runs where idempotency_key = 'm4a-run-a'),
  0.0000,
  'a budget hold does not write run cost'
);
select is(
  (select tokens_used from public.agent_runs where idempotency_key = 'm4a-run-a'),
  0,
  'a budget hold does not write run tokens'
);
select is(
  (select status from public.agent_provider_reservations where idempotency_key = 'm4a-hold-a'),
  'held',
  'the reserved row stays held'
);
select is(
  (select count(*)::integer from public.agent_provider_reservations where run_id = (select id from public.agent_runs where idempotency_key = 'm4a-run-a')),
  1,
  'an in-flight replay does not create a second reservation'
);
select is(
  (select count(*)::integer from public.agent_provider_reservations where run_id = (select id from public.agent_runs where idempotency_key = 'm4a-run-b')),
  0,
  'a denied daily hold writes no reservation'
);
select is(
  (select cost_usd from public.agent_runs where idempotency_key = 'm4a-run-b'),
  0.0000,
  'a denied hold does not bill the run'
);
select is(
  (public.custodian_run_budget_status((select id from public.agent_runs where idempotency_key = 'm4a-run-a')) ->> 'run_hold_cost_usd')::numeric,
  0.6000,
  'budget status reports the hold separately from recorded cost'
);

do $$
declare
  cancelled jsonb;
begin
  cancelled := public.custodian_request_cancel_agent_run(
    (select id from public.agent_runs where idempotency_key = 'm4a-run-a'),
    'm4a-cancel-a'
  );
  if (cancelled ->> 'cancellation') <> 'deferred_in_flight_hold'
     or (cancelled #>> '{run,status}') <> 'synthesizing'
     or (cancelled #>> '{run,cancel_requested_at}') is null then
    raise exception 'in-flight cancellation was not deferred';
  end if;
end;
$$;

select is(
  (select status from public.agent_runs where idempotency_key = 'm4a-run-a'),
  'synthesizing',
  'an in-flight hold keeps the run synthesizing after cancellation is requested'
);

do $$
declare
  run_id uuid;
  knowledge text;
begin
  select id into run_id from public.agent_runs where idempotency_key = 'm4a-run-a';
  foreach knowledge in array (array['unknown', 'known', 'none']::text[])
  loop
    begin
      perform public.custodian_settle_provider_reservation(
        '14141414-1414-4414-8414-141414141414',
        run_id,
        'm4a-hold-a',
        case knowledge
          when 'unknown' then jsonb_build_object('usage_knowledge', 'unknown', 'record_failure_step', true)
          when 'known' then jsonb_build_object(
            'usage_knowledge', 'known',
            'actual_tokens', 12,
            'actual_cost_usd', 0.20,
            'step_status', 'completed',
            'latency_ms', 10,
            'input_payload', jsonb_build_object('forged', true),
            'output_payload', jsonb_build_object('forged', true)
          )
          else jsonb_build_object('usage_knowledge', 'none')
        end
      );
      raise exception 'authenticated % settlement was accepted', knowledge;
    exception
      when insufficient_privilege then
        if sqlerrm like '%trusted runtime producer is required%'
           or sqlerrm like '%runtime owner and run do not match%'
           or sqlerrm like '%completed synthesis%' then
          raise;
        end if;
    end;
  end loop;
end;
$$;

select ok(true, 'authenticated cannot settle, release, or supply provider usage');
select is(
  (select status from public.agent_provider_reservations where idempotency_key = 'm4a-hold-a'),
  'held',
  'an authenticated settlement attempt leaves the hold in place'
);
select is(
  (select actual_tokens is null and actual_cost_usd is null from public.agent_provider_reservations where idempotency_key = 'm4a-hold-a'),
  true,
  'an authenticated settlement attempt does not write actual usage'
);
select is(
  (select count(*)::integer from public.agent_steps where idempotency_key = 'm4a-hold-a'),
  0,
  'an authenticated settlement attempt writes no step'
);

do $$
declare
  run_id uuid;
  knowledge text;
begin
  select id into run_id from public.agent_runs where idempotency_key = 'm4a-run-a';
  execute 'set local role anon';
  foreach knowledge in array (array['unknown', 'known', 'none']::text[])
  loop
    begin
      perform public.custodian_settle_provider_reservation(
        '14141414-1414-4414-8414-141414141414',
        run_id,
        'm4a-hold-a',
        jsonb_build_object('usage_knowledge', knowledge, 'record_failure_step', false)
      );
      raise exception 'anon % settlement was accepted', knowledge;
    exception
      when insufficient_privilege then
        if sqlerrm like '%trusted runtime producer is required%' then
          raise;
        end if;
    end;
  end loop;
end;
$$;

select ok(true, 'anon cannot settle or release a provider hold');

set local role postgres;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '14141414-1414-4414-8414-141414141414', true);

do $$
begin
  perform public.custodian_settle_provider_reservation(
    '14141414-1414-4414-8414-141414141414',
    (select id from public.agent_runs where idempotency_key = 'm4a-run-a'),
    'm4a-hold-a',
    jsonb_build_object('usage_knowledge', 'none')
  );
  raise exception 'a non-service role entered provider settlement';
exception
  when insufficient_privilege then
    if sqlerrm not like '%trusted runtime producer is required%' then raise; end if;
end;
$$;

select ok(true, 'a non-service role cannot enter provider settlement');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '14141414-1414-4414-8414-141414141414', true);

do $$
begin
  perform public.custodian_record_agent_step(
    (select id from public.agent_runs where idempotency_key = 'm4a-run-a'),
    jsonb_build_object(
      'sequence_no', 1,
      'step_kind', 'synthesize',
      'status', 'completed',
      'model_tier', 'terra',
      'prompt_version', 'm4a-fixture-v1',
      'input_payload', jsonb_build_object('forged', true),
      'output_payload', jsonb_build_object('forged', true),
      'tokens_used', 9,
      'cost_usd', 0.25,
      'latency_ms', 10,
      'pricing_version', 'm4a-forged-price',
      'provenance', jsonb_build_object('runtime', 'forged')
    ),
    'm4a-forged-complete'
  );
  raise exception 'authenticated caller manufactured a completed synthesize step';
exception
  when insufficient_privilege then
    if sqlerrm not like '%completed synthesis steps require a trusted runtime producer%' then raise; end if;
end;
$$;

select ok(true, 'an authenticated caller cannot manufacture a completed synthesize step');
select is(
  (select count(*)::integer from public.agent_steps where step_kind = 'synthesize' and status = 'completed'),
  0,
  'no completed synthesize step was stored for the authenticated caller'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);

do $$
declare
  run_id uuid := (select id from public.agent_runs where idempotency_key = 'm4a-run-a');
  claim_before text := current_setting('request.jwt.claim.sub', true);
begin
  execute 'set local role service_role';
  begin
    perform public.custodian_settle_provider_reservation(
      null,
      run_id,
      'm4a-hold-a',
      jsonb_build_object('usage_knowledge', 'none')
    );
    raise exception 'null runtime owner was accepted';
  exception
    when invalid_parameter_value then
      if sqlerrm not like '%runtime owner is required%' then raise; end if;
  end;
  begin
    perform public.custodian_settle_provider_reservation(
      '15151515-1515-4515-8515-151515151515',
      run_id,
      'm4a-hold-a',
      jsonb_build_object('usage_knowledge', 'none')
    );
    raise exception 'mismatched runtime owner settled the hold';
  exception
    when insufficient_privilege then
      if sqlerrm not like '%runtime owner and run do not match%' then raise; end if;
  end;
  if current_setting('request.jwt.claim.sub', true) is distinct from claim_before then
    raise exception 'settlement rewrote the request claim before identity matched';
  end if;
end;
$$;

select ok(true, 'service_role settlement validates owner, run, and reservation before rewriting the request claim');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '14141414-1414-4414-8414-141414141414', true);

select is(
  (select status from public.agent_provider_reservations where idempotency_key = 'm4a-hold-a'),
  'held',
  'rejected settlement does not release the hold'
);

do $$
declare
  settled jsonb;
  run_id uuid;
begin
  select id into run_id from public.agent_runs where idempotency_key = 'm4a-run-a';
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
  execute 'set local role service_role';
  settled := public.custodian_settle_provider_reservation(
    '14141414-1414-4414-8414-141414141414',
    run_id,
    'm4a-hold-a',
    jsonb_build_object(
      'usage_knowledge', 'unknown',
      'record_failure_step', true,
      'failure_code', 'provider_usage_unknown',
      'failure_message', 'Parsed usage was not available.'
    )
  );
  if (settled ->> 'usage_knowledge') <> 'unknown'
     or coalesce((settled ->> 'idempotent')::boolean, true)
     or (settled #>> '{reservation,status}') <> 'held'
     or (settled #> '{reservation,actual_tokens}') <> 'null'::jsonb
     or (settled #>> '{run,cost_usd}')::numeric <> 0 then
    raise exception 'unknown usage was written as a known bill';
  end if;
  settled := public.custodian_settle_provider_reservation(
    '14141414-1414-4414-8414-141414141414',
    run_id,
    'm4a-hold-a',
    jsonb_build_object(
      'usage_knowledge', 'unknown',
      'record_failure_step', true,
      'failure_code', 'provider_usage_unknown',
      'failure_message', 'Parsed usage was not available.'
    )
  );
  if coalesce((settled ->> 'idempotent')::boolean, false) is not true then
    raise exception 'unknown settlement replay was not idempotent';
  end if;
  begin
    perform public.custodian_settle_provider_reservation(
      '14141414-1414-4414-8414-141414141414',
      run_id,
      'm4a-hold-a',
      jsonb_build_object(
        'usage_knowledge', 'unknown',
        'record_failure_step', false,
        'actual_tokens', 1,
        'actual_cost_usd', 0.01
      )
    );
    raise exception 'unknown usage accepted actual tokens';
  exception
    when invalid_parameter_value then
      if sqlerrm not like '%cannot include actual tokens or cost%' then raise; end if;
  end;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '14141414-1414-4414-8414-141414141414', true);
end;
$$;

select is(
  (select cost_usd from public.agent_steps where idempotency_key = 'm4a-hold-a'),
  0.0000,
  'unknown usage records a zero-cost failure step'
);
select is(
  (select tokens_used from public.agent_steps where idempotency_key = 'm4a-hold-a'),
  0,
  'unknown usage records zero tokens'
);
select is(
  (select output_payload ->> 'usage_knowledge' from public.agent_steps where idempotency_key = 'm4a-hold-a'),
  'unknown',
  'the failure step says usage is unknown'
);
select is(
  (select count(*)::integer from public.agent_steps where idempotency_key = 'm4a-hold-a'),
  1,
  'replaying unknown settlement does not add a step'
);
select is(
  (select hold_cost_usd from public.agent_provider_reservations where idempotency_key = 'm4a-hold-a'),
  0.6000,
  'unknown settlement keeps the conservative hold'
);
select is(
  (select cost_usd from public.agent_runs where idempotency_key = 'm4a-run-a'),
  0.0000,
  'unknown settlement does not change recorded run cost'
);

do $$
declare
  run_id uuid;
  reserved jsonb;
  known_policy jsonb;
  known_run jsonb;
  released jsonb;
  settled jsonb;
  budget jsonb;
begin
  perform public.custodian_create_agent_run(
    jsonb_build_object(
      'case_id', '24242424-2424-4424-8424-242424242424',
      'tool_policy_id', '96969696-9696-4696-8696-969696969696',
      'objective', 'Legacy null aggregate ceiling.',
      'model_tier', 'terra',
      'prompt_version', 'm4a-fixture-v1',
      'input_snapshot', '{}'::jsonb,
      'tool_allowlist', '[]'::jsonb
    ),
    'm4a-run-legacy'
  );
  select id into run_id from public.agent_runs where idempotency_key = 'm4a-run-legacy';
  perform public.custodian_transition_agent_run(run_id, 'queued', 'retrieving', 'm4a-run-legacy-retrieve', '{}'::jsonb);
  perform public.custodian_transition_agent_run(run_id, 'retrieving', 'synthesizing', 'm4a-run-legacy-synthesize', '{}'::jsonb);
  reserved := public.custodian_reserve_provider_call(
    run_id,
    'm4a-hold-legacy',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 1,
      'hold_cost_usd', 0.01
    )
  );
  if (reserved ->> 'reason') <> 'aggregate_cost_ceiling_required'
     or reserved -> 'reservation' <> 'null'::jsonb then
    raise exception 'null aggregate ceilings were reservable';
  end if;
  budget := public.custodian_run_budget_status(run_id);
  if coalesce((budget ->> 'allowed')::boolean, false) is not true
     or (budget ->> 'reason') <> 'allowed'
     or budget -> 'daily_cost_remaining' <> 'null'::jsonb
     or budget -> 'monthly_cost_remaining' <> 'null'::jsonb then
    raise exception 'legacy null ceilings changed budget status into a denial';
  end if;
  begin
    perform public.custodian_create_readonly_analysis_run(
      '24242424-2424-4424-8424-242424242424',
      'm4a-run-legacy-readonly',
      jsonb_build_object(
        'model_tier', 'terra',
        'prompt_version', 'm4a-fixture-v1',
        'objective', 'Readonly path must refuse null ceilings.',
        'tool_policy_id', '96969696-9696-4696-8696-969696969696'
      )
    );
    raise exception 'readonly run accepted a null aggregate ceiling';
  exception
    when insufficient_privilege then
      if sqlerrm not like '%explicit daily and monthly cost ceilings%' then raise; end if;
  end;

  known_policy := public.custodian_ensure_readonly_analysis_policy(
    '24242424-2424-4424-8424-242424242424',
    jsonb_build_object(
      'policy_name', 'm4a-known-policy',
      'allowed_model_tiers', jsonb_build_array('terra'),
      'per_run_token_budget', 100000,
      'per_run_cost_usd', 2,
      'per_run_latency_ms', 5000,
      'per_run_tool_event_budget', 4,
      'daily_token_budget', 100000,
      'monthly_token_budget', 100000,
      'daily_cost_usd', 10,
      'monthly_cost_usd', 10
    )
  );
  known_run := public.custodian_create_readonly_analysis_run(
    '24242424-2424-4424-8424-242424242424',
    'm4a-run-release',
    jsonb_build_object(
      'model_tier', 'terra',
      'prompt_version', 'm4a-fixture-v1',
      'objective', 'Release only if the provider was not contacted.',
      'tool_policy_id', known_policy #>> '{policy,id}'
    )
  );
  run_id := (known_run #>> '{run,id}')::uuid;
  perform public.custodian_transition_agent_run(run_id, 'queued', 'retrieving', 'm4a-run-release-retrieve', '{}'::jsonb);
  perform public.custodian_transition_agent_run(run_id, 'retrieving', 'synthesizing', 'm4a-run-release-synthesize', '{}'::jsonb);
  perform public.custodian_reserve_provider_call(
    run_id,
    'm4a-hold-release',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 5,
      'hold_cost_usd', 0.10
    )
  );
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
  execute 'set local role service_role';
  released := public.custodian_settle_provider_reservation(
    '14141414-1414-4414-8414-141414141414',
    run_id,
    'm4a-hold-release',
    jsonb_build_object('usage_knowledge', 'none')
  );
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '14141414-1414-4414-8414-141414141414', true);
  if (released #>> '{reservation,status}') <> 'released_uncontacted'
     or (released #>> '{reservation,usage_knowledge}') <> 'none'
     or (released #> '{reservation,actual_cost_usd}') <> 'null'::jsonb
     or (released #>> '{run,cost_usd}')::numeric <> 0 then
    raise exception 'uncontacted release wrote usage';
  end if;

  known_run := public.custodian_create_readonly_analysis_run(
    '24242424-2424-4424-8424-242424242424',
    'm4a-run-known',
    jsonb_build_object(
      'model_tier', 'terra',
      'prompt_version', 'm4a-fixture-v1',
      'objective', 'Settle only parsed usage.',
      'tool_policy_id', known_policy #>> '{policy,id}'
    )
  );
  run_id := (known_run #>> '{run,id}')::uuid;
  perform public.custodian_transition_agent_run(run_id, 'queued', 'retrieving', 'm4a-run-known-retrieve', '{}'::jsonb);
  perform public.custodian_transition_agent_run(run_id, 'retrieving', 'synthesizing', 'm4a-run-known-synthesize', '{}'::jsonb);
  perform public.custodian_reserve_provider_call(
    run_id,
    'm4a-hold-known',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 20,
      'hold_cost_usd', 0.50
    )
  );
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
  execute 'set local role service_role';
  settled := public.custodian_settle_provider_reservation(
    '14141414-1414-4414-8414-141414141414',
    run_id,
    'm4a-hold-known',
    jsonb_build_object(
      'usage_knowledge', 'known',
      'actual_tokens', 12,
      'actual_cost_usd', 0.20,
      'step_status', 'completed',
      'latency_ms', 10,
      'input_payload', jsonb_build_object('bounded', true),
      'output_payload', jsonb_build_object('kind', 'fixture')
    )
  );
  if (settled #>> '{reservation,status}') <> 'settled_known'
     or (settled #>> '{reservation,usage_knowledge}') <> 'known'
     or (settled #>> '{reservation,actual_tokens}')::integer <> 12
     or (settled #>> '{reservation,actual_cost_usd}')::numeric <> 0.20
     or (settled #>> '{run,cost_usd}')::numeric <> 0.20
     or (settled #>> '{run,tokens_used}')::integer <> 12 then
    raise exception 'known usage was not settled onto the run';
  end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '14141414-1414-4414-8414-141414141414', true);
  budget := public.custodian_run_budget_status(run_id);
  if (budget ->> 'run_hold_cost_usd')::numeric <> 0
     or (budget ->> 'run_cost_remaining')::numeric <> 1.80
     or (budget ->> 'daily_cost')::numeric <> 0.80
     or (budget ->> 'daily_tokens')::numeric <> 112 then
    raise exception 'settled usage was double-counted with its former hold: %', budget;
  end if;
end;
$$;

select is(
  (select count(*)::integer from public.agent_provider_reservations where idempotency_key = 'm4a-hold-legacy'),
  0,
  'a null aggregate ceiling reserves nothing'
);
select is(
  (select status from public.agent_provider_reservations where idempotency_key = 'm4a-hold-release'),
  'released_uncontacted',
  'an uncontacted hold is released instead of billed'
);
select is(
  (select count(*)::integer from public.agent_steps where idempotency_key = 'm4a-hold-release'),
  0,
  'an uncontacted release writes no step'
);
select is(
  (select cost_usd from public.agent_runs where idempotency_key = 'm4a-run-known'),
  0.2000,
  'known settlement records the parsed cost'
);
select is(
  (select cost_usd from public.agent_steps where idempotency_key = 'm4a-hold-known'),
  0.2000,
  'known run cost comes from the priced step'
);
select is(
  (select actual_cost_usd from public.agent_provider_reservations where idempotency_key = 'm4a-hold-known'),
  0.2000,
  'the settled reservation stores the parsed cost and stops encumbering the hold'
);
select ok(
  (public.custodian_run_budget_status((select id from public.agent_runs where idempotency_key = 'm4a-run-known')) ->> 'daily_cost')::numeric = 0.8000
  and (public.custodian_run_budget_status((select id from public.agent_runs where idempotency_key = 'm4a-run-known')) ->> 'daily_tokens')::numeric = 112
  and (public.custodian_run_budget_status((select id from public.agent_runs where idempotency_key = 'm4a-run-known')) ->> 'run_hold_cost_usd')::numeric = 0
  and (public.custodian_run_budget_status((select id from public.agent_runs where idempotency_key = 'm4a-run-a')) ->> 'run_hold_cost_usd')::numeric = 0.6000,
  'settled known usage is not double-counted with its former hold'
);

do $$
declare
  policy_id uuid;
  created_run jsonb;
  run_id uuid;
  reserved jsonb;
  budget jsonb;
begin
  select id into policy_id
    from public.tool_policies
   where owner_id = '14141414-1414-4414-8414-141414141414'
     and policy_name = 'm4a-known-policy';
  created_run := public.custodian_create_readonly_analysis_run(
    '24242424-2424-4424-8424-242424242424',
    'm4a-run-yesterday',
    jsonb_build_object(
      'model_tier', 'terra',
      'prompt_version', 'm4a-fixture-v1',
      'objective', 'Count a new hold on the reservation day.',
      'tool_policy_id', policy_id
    )
  );
  run_id := (created_run #>> '{run,id}')::uuid;
  perform public.custodian_transition_agent_run(run_id, 'queued', 'retrieving', 'm4a-run-yesterday-retrieve', '{}'::jsonb);
  perform public.custodian_transition_agent_run(run_id, 'retrieving', 'synthesizing', 'm4a-run-yesterday-synthesize', '{}'::jsonb);
  execute 'set local role postgres';
  update public.agent_runs
     set created_at = date_trunc('day', now()) - interval '1 day'
   where id = run_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '14141414-1414-4414-8414-141414141414', true);
  reserved := public.custodian_reserve_provider_call(
    run_id,
    'm4a-hold-yesterday',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 3,
      'hold_cost_usd', 0.05
    )
  );
  if coalesce((reserved ->> 'reserved')::boolean, false) is not true then
    raise exception 'yesterday run reservation was denied: %', reserved ->> 'reason';
  end if;
  budget := public.custodian_run_budget_status(run_id);
  if (select created_at >= date_trunc('day', now()) from public.agent_runs where id = run_id)
     or (select created_at < date_trunc('day', now()) from public.agent_provider_reservations where idempotency_key = 'm4a-hold-yesterday')
     or (budget ->> 'daily_cost')::numeric <> 0.85
     or (budget ->> 'daily_cost_remaining')::numeric <> 9.15 then
    raise exception 'today reservation on a yesterday run missed the daily ceiling: %', budget;
  end if;

  created_run := public.custodian_create_readonly_analysis_run(
    '24242424-2424-4424-8424-242424242424',
    'm4a-run-prior-month',
    jsonb_build_object(
      'model_tier', 'terra',
      'prompt_version', 'm4a-fixture-v1',
      'objective', 'Count a new hold on the reservation month.',
      'tool_policy_id', policy_id
    )
  );
  run_id := (created_run #>> '{run,id}')::uuid;
  perform public.custodian_transition_agent_run(run_id, 'queued', 'retrieving', 'm4a-run-prior-month-retrieve', '{}'::jsonb);
  perform public.custodian_transition_agent_run(run_id, 'retrieving', 'synthesizing', 'm4a-run-prior-month-synthesize', '{}'::jsonb);
  execute 'set local role postgres';
  update public.agent_runs
     set created_at = date_trunc('month', now()) - interval '1 day'
   where id = run_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '14141414-1414-4414-8414-141414141414', true);
  reserved := public.custodian_reserve_provider_call(
    run_id,
    'm4a-hold-prior-month',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 4,
      'hold_cost_usd', 0.07
    )
  );
  if coalesce((reserved ->> 'reserved')::boolean, false) is not true then
    raise exception 'prior-month run reservation was denied: %', reserved ->> 'reason';
  end if;
  budget := public.custodian_run_budget_status(run_id);
  if (select created_at >= date_trunc('month', now()) from public.agent_runs where id = run_id)
     or (select created_at < date_trunc('month', now()) from public.agent_provider_reservations where idempotency_key = 'm4a-hold-prior-month')
     or (budget ->> 'monthly_cost')::numeric <> 0.92
     or (budget ->> 'monthly_cost_remaining')::numeric <> 9.08
     or (budget ->> 'daily_cost')::numeric <> 0.92 then
    raise exception 'this-month reservation on a prior-month run missed the monthly ceiling: %', budget;
  end if;
end;
$$;

select ok(true, 'a reservation today counts against today even when its run was created yesterday');
select ok(true, 'a reservation this month counts against this month even when its run was created earlier');

set local role postgres;
update public.agent_provider_reservations
   set in_flight_until = now() - interval '1 second'
 where idempotency_key = 'm4a-hold-a';
set local role authenticated;
select set_config('request.jwt.claim.sub', '14141414-1414-4414-8414-141414141414', true);

do $$
declare
  run_id uuid;
  replay jsonb;
  cancelled jsonb;
begin
  select id into run_id from public.agent_runs where idempotency_key = 'm4a-run-a';
  replay := public.custodian_reserve_provider_call(
    run_id,
    'm4a-hold-a',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 100,
      'hold_cost_usd', 0.60
    )
  );
  if (replay ->> 'reason') <> 'provider_hold_unsettled'
     or coalesce((replay ->> 'replay')::boolean, false) is not true then
    raise exception 'an expired unsettled hold was treated as a new reservation';
  end if;
  cancelled := public.custodian_request_cancel_agent_run(run_id, 'm4a-cancel-a-after-window');
  if (cancelled #>> '{run,status}') <> 'cancelled'
     or (cancelled #>> '{run,cost_usd}')::numeric <> 0
     or (cancelled #>> '{run,tokens_used}')::integer <> 0 then
    raise exception 'post-window cancellation wrote usage';
  end if;
end;
$$;

select is(
  (select status from public.agent_runs where idempotency_key = 'm4a-run-a'),
  'cancelled',
  'cancellation proceeds after the in-flight window'
);
select is(
  (select status from public.agent_provider_reservations where idempotency_key = 'm4a-hold-a'),
  'held',
  'cancellation does not convert an unsettled hold into usage'
);
select is(
  (select actual_tokens is null and actual_cost_usd is null from public.agent_provider_reservations where idempotency_key = 'm4a-hold-a'),
  true,
  'the cancelled hold keeps unknown actual usage'
);
select is(
  (select count(*)::integer from public.tool_events where owner_id = '14141414-1414-4414-8414-141414141414'),
  0,
  'M4A writes no tool events'
);
select is(
  (select count(*)::integer from public.custodian_findings where owner_id = '14141414-1414-4414-8414-141414141414'),
  0,
  'M4A writes no findings'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '15151515-1515-4515-8515-151515151515', true);

do $$
begin
  perform public.custodian_reserve_provider_call(
    (select id from public.agent_runs where idempotency_key = 'm4a-run-known'),
    'm4a-hold-foreign',
    jsonb_build_object(
      'stage', 'synthesize',
      'pricing_version', 'm4a-fixture-price',
      'model_name', 'gpt-5.6-terra',
      'model_tier', 'terra',
      'hold_tokens', 1,
      'hold_cost_usd', 0.01
    )
  );
  raise exception 'another owner reserved the run';
exception
  when sqlstate 'P0002' then null;
end;
$$;

select ok(true, 'another owner cannot reserve this run');
select is(
  (select count(*)::integer from public.agent_provider_reservations),
  0,
  'reservation rows stay hidden from another owner'
);

select * from finish();
rollback;
