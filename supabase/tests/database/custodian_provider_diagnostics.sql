-- Deterministic Custodian provider-diagnostic fixtures. No provider is
-- contacted. Diagnostics are owner-readable metadata written only by the
-- service-role runtime, and they never touch reservation accounting.
begin;

select plan(21);

set local role postgres;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'authenticated', 'authenticated', 'diag-owner-a@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
  ('d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 'authenticated', 'authenticated', 'diag-owner-b@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

insert into public.records (id, user_id, record_type, title, summary, record_data) values
  ('d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'tool', 'Diagnostic admitted source', 'bounded summary', '{}'::jsonb);

insert into public.cases (
  id, owner_id, title, current_question, archive_scope, created_by, updated_by
) values (
  'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4',
  'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
  'Diagnostic owner A case',
  'What does the admitted record support?',
  '{"record_ids":["d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3"],"free_text_context":"owner note only"}'::jsonb,
  'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
  'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'
);

select ok(
  to_regclass('public.agent_provider_diagnostics') is not null
  and (select relrowsecurity from pg_catalog.pg_class where oid = 'public.agent_provider_diagnostics'::regclass)
  and pg_catalog.has_table_privilege('authenticated', 'public.agent_provider_diagnostics', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.agent_provider_diagnostics', 'INSERT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.agent_provider_diagnostics', 'UPDATE')
  and not pg_catalog.has_table_privilege('authenticated', 'public.agent_provider_diagnostics', 'DELETE')
  and not pg_catalog.has_table_privilege('anon', 'public.agent_provider_diagnostics', 'SELECT')
  and not pg_catalog.has_table_privilege('anon', 'public.agent_provider_diagnostics', 'INSERT'),
  'provider diagnostics are RLS protected, owner-readable, and not browser-writable'
);

select ok(
  pg_catalog.has_function_privilege('service_role', 'public.custodian_record_provider_diagnostic(uuid,uuid,text,jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'public.custodian_record_provider_diagnostic(uuid,uuid,text,jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.custodian_record_provider_diagnostic(uuid,uuid,text,jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'public.custodian_reject_provider_diagnostic_update()', 'EXECUTE'),
  'only the service-role runtime can record a provider diagnostic'
);

select is(
  (
    select count(*)::integer
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'agent_provider_diagnostics'
       and column_name in (
         'message', 'error_message', 'body', 'raw_body', 'request_body', 'response_body',
         'prompt', 'system_prompt', 'evidence', 'output', 'headers', 'authorization', 'api_key'
       )
  ),
  0,
  'provider diagnostics have no column that can hold provider text, prompts, bodies, or credentials'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', true);

do $$
declare
  policy_id uuid;
begin
  policy_id := (
    public.custodian_ensure_readonly_analysis_policy(
      'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4',
      jsonb_build_object(
        'policy_name', 'diag-fixture-policy',
        'allowed_model_tiers', jsonb_build_array('luna'),
        'per_run_token_budget', 100000,
        'per_run_cost_usd', 1,
        'per_run_latency_ms', 5000,
        'per_run_tool_event_budget', 4,
        'daily_token_budget', 100000,
        'monthly_token_budget', 100000,
        'daily_cost_usd', 1,
        'monthly_cost_usd', 4
      )
    ) #>> '{policy,id}'
  )::uuid;
  perform public.custodian_create_readonly_analysis_run(
    'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4',
    'diag-run-a',
    jsonb_build_object(
      'model_tier', 'luna',
      'prompt_version', 'diag-fixture-v1',
      'objective', 'Read the admitted record only.',
      'tool_policy_id', policy_id
    )
  );
end;
$$;

set local role postgres;

insert into public.agent_provider_reservations (
  owner_id, case_id, run_id, stage, idempotency_key, pricing_version, model_name,
  hold_tokens, hold_cost_usd, usage_knowledge, status, in_flight_until, created_by, updated_by
)
select r.owner_id, r.case_id, r.id, 'synthesize', 'provider-attempt:' || r.id || ':synthesize',
       'diag-price', 'gpt-5.6-luna', 7970, 0.0057, 'unknown', 'held', now() + interval '90 seconds',
       r.owner_id, r.owner_id
  from public.agent_runs r
 where r.idempotency_key = 'diag-run-a';

set local role anon;

do $$
begin
  perform public.custodian_record_provider_diagnostic(
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5',
    'provider-attempt',
    '{}'::jsonb
  );
  raise exception 'anon recorded a provider diagnostic';
exception
  when insufficient_privilege then null;
end;
$$;

select ok(true, 'anon cannot record a provider diagnostic');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', true);

do $$
declare
  target_run uuid := (select id from public.agent_runs where idempotency_key = 'diag-run-a');
begin
  perform public.custodian_record_provider_diagnostic(
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    target_run,
    'provider-attempt:' || target_run || ':synthesize',
    jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'openai_request_rejected', 'http_status', 400)
  );
  raise exception 'an authenticated owner recorded a provider diagnostic';
exception
  when insufficient_privilege then null;
end;
$$;

select ok(true, 'an authenticated owner cannot call the diagnostic writer');

do $$
declare
  target_run uuid := (select id from public.agent_runs where idempotency_key = 'diag-run-a');
  target_reservation uuid := (select id from public.agent_provider_reservations where run_id = target_run);
begin
  insert into public.agent_provider_diagnostics (
    owner_id, case_id, run_id, reservation_id, attempt_key, provider, contact_state, classification, http_status
  ) values (
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4', target_run,
    target_reservation, 'provider-attempt:' || target_run || ':synthesize', 'openai', 'contacted',
    'openai_completed', 200
  );
  raise exception 'an authenticated owner inserted a provider diagnostic directly';
exception
  when insufficient_privilege then null;
end;
$$;

select ok(true, 'an authenticated owner cannot insert a provider diagnostic directly');

set local role postgres;
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  target_run uuid := (select id from public.agent_runs where idempotency_key = 'diag-run-a');
begin
  perform public.custodian_record_provider_diagnostic(
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    target_run,
    'provider-attempt:' || target_run || ':synthesize',
    jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'openai_request_rejected', 'http_status', 400)
  );
  raise exception 'a non-service role entered the diagnostic writer';
exception
  when insufficient_privilege then
    if sqlerrm not like '%trusted runtime producer is required%' then raise; end if;
end;
$$;

select ok(true, 'a non-service claim cannot enter the diagnostic writer');

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);

do $$
declare
  target_run uuid := (select id from public.agent_runs where idempotency_key = 'diag-run-a');
  attempt text := 'provider-attempt:' || target_run || ':synthesize';
begin
  execute 'set local role service_role';
  begin
    perform public.custodian_record_provider_diagnostic(
      'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
      jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'openai_request_rejected', 'http_status', 400, 'message', 'free text from the provider')
    );
    raise exception 'a free-text message field was accepted';
  exception
    when invalid_parameter_value then
      if sqlerrm not like '%allowlisted metadata fields%' then raise; end if;
  end;
  begin
    perform public.custodian_record_provider_diagnostic(
      'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
      jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'openai_request_rejected', 'http_status', 400, 'owner_id', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2')
    );
    raise exception 'an owner override was accepted';
  exception
    when invalid_parameter_value then
      if sqlerrm not like '%owner is derived%' then raise; end if;
  end;
end;
$$;

select ok(true, 'the diagnostic writer rejects free-text and owner-override fields');

do $$
declare
  target_run uuid := (select id from public.agent_runs where idempotency_key = 'diag-run-a');
  attempt text := 'provider-attempt:' || target_run || ':synthesize';
begin
  execute 'set local role service_role';
  begin
    perform public.custodian_record_provider_diagnostic(
      'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
      jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'openai_request_rejected', 'http_status', 400, 'error_param', 'Bearer sk-test key')
    );
    raise exception 'an unsafe error_param was stored';
  exception
    when check_violation then null;
  end;
  begin
    perform public.custodian_record_provider_diagnostic(
      'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
      jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'openai_request_rejected', 'http_status', 400, 'error_code', 'Invalid Code With Spaces')
    );
    raise exception 'an unsafe error_code was stored';
  exception
    when check_violation then null;
  end;
  begin
    perform public.custodian_record_provider_diagnostic(
      'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
      jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'openai_request_rejected', 'http_status', 400, 'request_id', 'req_' || repeat('a', 200))
    );
    raise exception 'an oversized request_id was stored';
  exception
    when check_violation then null;
  end;
  begin
    perform public.custodian_record_provider_diagnostic(
      'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
      jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'unlisted_classification', 'http_status', 400)
    );
    raise exception 'an unlisted classification was stored';
  exception
    when check_violation then null;
  end;
  begin
    perform public.custodian_record_provider_diagnostic(
      'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
      jsonb_build_object('provider', 'openai', 'contact_state', 'contact_uncertain', 'classification', 'openai_timeout', 'http_status', 400)
    );
    raise exception 'an uncertain contact carried an HTTP status';
  exception
    when check_violation then null;
  end;
  begin
    perform public.custodian_record_provider_diagnostic(
      'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
      jsonb_build_object('provider', 'openai', 'contact_state', 'contact_uncertain', 'classification', 'openai_completed')
    );
    raise exception 'a completed response without contact was stored';
  exception
    when check_violation then null;
  end;
  begin
    perform public.custodian_record_provider_diagnostic(
      'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
      jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'openai_request_rejected', 'http_status', 400, 'error_type', 42)
    );
    raise exception 'a non-text error_type was accepted';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;

select ok(true, 'unsafe, oversized, or incoherent provider metadata is refused by the database bounds');

do $$
declare
  target_run uuid := (select id from public.agent_runs where idempotency_key = 'diag-run-a');
  target_reservation uuid := (select id from public.agent_provider_reservations where run_id = target_run);
begin
  execute 'set local role service_role';
  insert into public.agent_provider_diagnostics (
    owner_id, case_id, run_id, reservation_id, attempt_key, provider, contact_state, classification, http_status
  ) values (
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4', target_run,
    target_reservation, 'forged-attempt', 'openai', 'contacted', 'openai_completed', 200
  );
  raise exception 'the service role inserted a diagnostic outside the writer RPC';
exception
  when insufficient_privilege then null;
end;
$$;

select ok(true, 'the service role cannot write diagnostics except through the writer RPC');

do $$
declare
  target_run uuid := (select id from public.agent_runs where idempotency_key = 'diag-run-a');
  attempt text := 'provider-attempt:' || target_run || ':synthesize';
begin
  execute 'set local role service_role';
  begin
    perform public.custodian_record_provider_diagnostic(
      'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', target_run, attempt,
      jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'openai_request_rejected', 'http_status', 400)
    );
    raise exception 'a mismatched owner recorded a diagnostic';
  exception
    when no_data_found then null;
  end;
  begin
    perform public.custodian_record_provider_diagnostic(
      'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, 'provider-attempt:other',
      jsonb_build_object('provider', 'openai', 'contact_state', 'contacted', 'classification', 'openai_request_rejected', 'http_status', 400)
    );
    raise exception 'an unknown attempt key recorded a diagnostic';
  exception
    when no_data_found then null;
  end;
end;
$$;

select ok(true, 'a diagnostic binds only to the owner, run, and existing attempt reservation');

select is(
  (select count(*)::integer from public.agent_provider_diagnostics),
  0,
  'refused diagnostic writes stored nothing'
);

set local role postgres;

create temporary table diag_results (label text primary key, result jsonb) on commit drop;
grant all on diag_results to service_role, authenticated;

do $$
declare
  target_run uuid := (select id from public.agent_runs where idempotency_key = 'diag-run-a');
  attempt text := 'provider-attempt:' || target_run || ':synthesize';
  first_result jsonb;
  replay_result jsonb;
begin
  execute 'set local role service_role';
  first_result := public.custodian_record_provider_diagnostic(
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
    jsonb_build_object(
      'provider', 'openai',
      'contact_state', 'contacted',
      'classification', 'openai_request_rejected',
      'http_status', 400,
      'request_id', 'req_0123456789abcdef',
      'error_type', 'invalid_request_error',
      'error_code', 'invalid_json_schema',
      'error_param', 'text.format.schema',
      'incomplete_reason', null
    )
  );
  replay_result := public.custodian_record_provider_diagnostic(
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', target_run, attempt,
    jsonb_build_object(
      'provider', 'openai',
      'contact_state', 'contacted',
      'classification', 'openai_server_error',
      'http_status', 500
    )
  );
  insert into diag_results values ('first', first_result), ('replay', replay_result);
end;
$$;

select is(
  (select (result ->> 'idempotent')::boolean from diag_results where label = 'first'),
  false,
  'the first diagnostic for an attempt is recorded'
);

select is(
  (select result #>> '{diagnostic,classification}' from diag_results where label = 'replay'),
  'openai_request_rejected',
  'a replay for the same attempt returns the first diagnostic instead of rewriting it'
);

select is(
  (select count(*)::integer from public.agent_provider_diagnostics),
  1,
  'exactly one diagnostic exists for the attempt'
);

select is(
  (
    select jsonb_build_object(
      'status', status, 'usage_knowledge', usage_knowledge,
      'actual_tokens', actual_tokens, 'actual_cost_usd', actual_cost_usd,
      'hold_tokens', hold_tokens, 'hold_cost_usd', hold_cost_usd
    )
      from public.agent_provider_reservations
     where run_id = (select id from public.agent_runs where idempotency_key = 'diag-run-a')
  ),
  jsonb_build_object(
    'status', 'held', 'usage_knowledge', 'unknown',
    'actual_tokens', null, 'actual_cost_usd', null,
    'hold_tokens', 7970, 'hold_cost_usd', 0.0057
  ),
  'recording a diagnostic leaves the held reservation accounting unchanged'
);

set local role postgres;

do $$
begin
  update public.agent_provider_diagnostics set error_code = 'rewritten';
  raise exception 'a provider diagnostic was rewritten';
exception
  when insufficient_privilege then
    if sqlerrm not like '%append-only%' then raise; end if;
end;
$$;

select ok(true, 'the append-only trigger rejects updates even for the table owner');

set local role service_role;

do $$
begin
  delete from public.agent_provider_diagnostics;
  raise exception 'the service role deleted a provider diagnostic';
exception
  when insufficient_privilege then null;
end;
$$;

select ok(true, 'the service role cannot delete or rewrite provider diagnostics');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', true);

select is(
  (
    select jsonb_build_object(
      'provider', provider, 'http_status', http_status, 'request_id', request_id,
      'error_type', error_type, 'error_code', error_code, 'error_param', error_param,
      'classification', classification, 'contact_state', contact_state
    )
      from public.agent_provider_diagnostics
  ),
  jsonb_build_object(
    'provider', 'openai', 'http_status', 400, 'request_id', 'req_0123456789abcdef',
    'error_type', 'invalid_request_error', 'error_code', 'invalid_json_schema',
    'error_param', 'text.format.schema', 'classification', 'openai_request_rejected',
    'contact_state', 'contacted'
  ),
  'the owner can read the safe diagnostic metadata'
);

do $$
begin
  delete from public.agent_provider_diagnostics;
  raise exception 'an owner deleted a provider diagnostic';
exception
  when insufficient_privilege then null;
end;
$$;

select ok(true, 'an owner cannot delete a provider diagnostic');

select set_config('request.jwt.claim.sub', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', true);

select is(
  (select count(*)::integer from public.agent_provider_diagnostics),
  0,
  'another owner cannot read the diagnostic'
);

select * from finish();
rollback;
