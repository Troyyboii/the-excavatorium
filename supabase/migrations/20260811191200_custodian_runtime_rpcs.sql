-- Custodian Release 2/3: owner-derived protected runtime RPCs.
--
-- The Edge Function calls these RPCs with the caller's bearer token. It never
-- receives a service-role key and never writes runtime tables directly.

create or replace function public.custodian_runtime_require_object(payload jsonb, field_name text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'object' then
    raise exception '% must be a JSON object', field_name using errcode = '22023';
  end if;
  return payload;
end;
$$;

create or replace function public.custodian_runtime_uuid(value text, field_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if value is null or pg_catalog.btrim(value) = '' then
    return null;
  end if;
  return value::uuid;
exception when invalid_text_representation then
  raise exception '% must be a UUID', field_name using errcode = '22023';
end;
$$;

create or replace function public.custodian_runtime_require_idempotency(value text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized text := pg_catalog.nullif(pg_catalog.btrim(value), '');
begin
  if normalized is null or pg_catalog.char_length(normalized) > 300 then
    raise exception 'idempotency_key is required and must be at most 300 characters' using errcode = '22023';
  end if;
  return normalized;
end;
$$;

create or replace function public.custodian_runtime_assert_case(caller_id uuid, case_id_value uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if case_id_value is null
     or not exists (
       select 1 from public.cases
        where owner_id = caller_id and id = case_id_value
     ) then
    raise exception 'case is not owned by the authenticated user' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.custodian_runtime_is_terminal(status_value text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select status_value in ('completed', 'blocked', 'failed', 'expired', 'budget_stopped', 'cancelled');
$$;

create or replace function public.custodian_runtime_transition_allowed(from_status text, to_status text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  return case from_status
    when 'queued' then to_status in ('retrieving', 'blocked', 'failed', 'expired', 'budget_stopped', 'cancelled')
    when 'retrieving' then to_status in ('synthesizing', 'awaiting_approval', 'blocked', 'failed', 'expired', 'budget_stopped', 'cancelled')
    when 'synthesizing' then to_status in ('awaiting_approval', 'verifying', 'blocked', 'failed', 'expired', 'budget_stopped', 'cancelled')
    when 'awaiting_approval' then to_status in ('executing', 'blocked', 'expired', 'cancelled')
    when 'executing' then to_status in ('verifying', 'blocked', 'failed', 'expired', 'budget_stopped', 'cancelled')
    when 'verifying' then to_status in ('completed', 'awaiting_approval', 'blocked', 'failed', 'expired', 'budget_stopped', 'cancelled')
    else false
  end;
end;
$$;

create or replace function public.custodian_runtime_write_audit(
  owner_value uuid,
  case_value uuid,
  run_value uuid,
  event_type_value text,
  action_value text,
  target_type_value text,
  target_id_value uuid,
  details_value jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    owner_id, case_id, run_id, actor_type, event_type, action,
    target_type, target_id, details, provenance, created_by, updated_by
  ) values (
    owner_value, case_value, run_value, 'user', event_type_value, action_value,
    target_type_value, target_id_value, coalesce(details_value, '{}'::jsonb),
    jsonb_build_object('source', 'custodian_runtime_rpc'), owner_value, owner_value
  );
end;
$$;

revoke execute on function public.custodian_runtime_require_object(jsonb, text) from public, anon, authenticated;
revoke execute on function public.custodian_runtime_uuid(text, text) from public, anon, authenticated;
revoke execute on function public.custodian_runtime_require_idempotency(text) from public, anon, authenticated;
revoke execute on function public.custodian_runtime_assert_case(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.custodian_runtime_is_terminal(text) from public, anon, authenticated;
revoke execute on function public.custodian_runtime_transition_allowed(text, text) from public, anon, authenticated;
revoke execute on function public.custodian_runtime_write_audit(uuid, uuid, uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.custodian_create_agent_run(
  run_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(run_payload, 'run_payload');
  current_run public.agent_runs;
  inserted_run public.agent_runs;
  policy_row public.tool_policies;
  case_value uuid;
  policy_value uuid;
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  request_hash_value text := pg_catalog.md5(payload::text);
  input_value jsonb;
  graph_value jsonb;
  config_value jsonb;
  tool_json jsonb;
  tool_list text[];
  model_value text;
  prompt_value text;
  objective_value text;
  provenance_value jsonb;
  retention_value text;
  budget_tokens_value integer;
  budget_cost_value numeric;
  budget_latency_value integer;
  budget_tools_value integer;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);

  case_value := public.custodian_runtime_uuid(payload ->> 'case_id', 'case_id');
  perform public.custodian_runtime_assert_case(caller_id, case_value);
  objective_value := public.custodian_require_text(payload ->> 'objective', 'objective', 20000);
  input_value := coalesce(payload -> 'input_snapshot', '{}'::jsonb);
  graph_value := coalesce(payload -> 'agent_graph', '{}'::jsonb);
  config_value := coalesce(payload -> 'agent_config', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(input_value) <> 'object'
     or pg_catalog.jsonb_typeof(graph_value) <> 'object'
     or pg_catalog.jsonb_typeof(config_value) <> 'object' then
    raise exception 'input_snapshot, agent_graph, and agent_config must be JSON objects' using errcode = '22023';
  end if;

  tool_json := coalesce(payload -> 'tool_allowlist', '[]'::jsonb);
  if pg_catalog.jsonb_typeof(tool_json) <> 'array' or pg_catalog.jsonb_array_length(tool_json) > 200 then
    raise exception 'tool_allowlist must be an array of at most 200 items' using errcode = '22023';
  end if;
  tool_list := array(select pg_catalog.jsonb_array_elements_text(tool_json));
  if pg_catalog.array_position(tool_list, null) is not null then
    raise exception 'tool_allowlist cannot contain null values' using errcode = '22023';
  end if;

  model_value := coalesce(payload ->> 'model_tier', 'terra');
  if model_value not in ('luna', 'terra', 'sol', 'pro') then
    raise exception 'model_tier is not allowed' using errcode = '22023';
  end if;
  prompt_value := public.custodian_require_text(
    coalesce(payload ->> 'prompt_version', 'custodian-runtime-v1'),
    'prompt_version', 200
  );
  retention_value := coalesce(payload ->> 'retention_class', 'standard');
  if retention_value not in ('short', 'standard', 'long', 'legal_hold') then
    raise exception 'retention_class is not allowed' using errcode = '22023';
  end if;
  provenance_value := coalesce(payload -> 'provenance', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(provenance_value) <> 'object' then
    raise exception 'provenance must be a JSON object' using errcode = '22023';
  end if;

  policy_value := public.custodian_runtime_uuid(payload ->> 'tool_policy_id', 'tool_policy_id');
  if policy_value is not null then
    select * into policy_row
      from public.tool_policies
     where owner_id = caller_id and id = policy_value
     for update;
    if not found or policy_row.status <> 'active' or policy_row.lifecycle_status <> 'active' then
      raise exception 'tool policy is not active for the authenticated owner' using errcode = 'P0002';
    end if;
    if policy_row.case_id is not null and policy_row.case_id <> case_value then
      raise exception 'tool policy is not scoped to this case' using errcode = '42501';
    end if;
    if not (model_value = any(policy_row.allowed_model_tiers)) then
      raise exception 'model tier is not permitted by the selected owner policy' using errcode = '42501';
    end if;
  end if;

  select * into current_run
    from public.agent_runs
   where owner_id = caller_id and idempotency_key = request_key
   for update;
  if found then
    if current_run.request_hash <> request_hash_value then
      raise exception 'idempotency_key was already used for a different run request' using errcode = '23505';
    end if;
    return jsonb_build_object('run', to_jsonb(current_run), 'idempotent', true);
  end if;

  budget_tokens_value := coalesce((payload ->> 'budget_tokens')::integer, coalesce(policy_row.per_run_token_budget, 20000));
  budget_cost_value := coalesce((payload ->> 'budget_cost_usd')::numeric, coalesce(policy_row.per_run_cost_usd, 1));
  budget_latency_value := coalesce((payload ->> 'budget_latency_ms')::integer, coalesce(policy_row.per_run_latency_ms, 60000));
  budget_tools_value := coalesce((payload ->> 'budget_tool_events')::integer, 50);

  insert into public.agent_runs (
    owner_id, case_id, tool_policy_id, idempotency_key, request_hash,
    objective, input_snapshot, input_snapshot_hash, agent_graph, agent_config,
    prompt_version, tool_allowlist, model_tier, retention_class,
    budget_tokens, budget_cost_usd, budget_latency_ms, budget_tool_events,
    provenance, created_by, updated_by
  ) values (
    caller_id, case_value, policy_value, request_key, request_hash_value,
    objective_value, input_value, pg_catalog.md5(input_value::text), graph_value, config_value,
    prompt_value, tool_list, model_value, retention_value,
    budget_tokens_value, budget_cost_value, budget_latency_value, budget_tools_value,
    provenance_value, caller_id, caller_id
  ) returning * into inserted_run;

  perform public.custodian_runtime_write_audit(
    caller_id, case_value, inserted_run.id, 'created', 'create_agent_run',
    'agent_run', inserted_run.id, jsonb_build_object('status', inserted_run.status)
  );
  return jsonb_build_object('run', to_jsonb(inserted_run), 'idempotent', false);
end;
$$;

create or replace function public.custodian_get_agent_run(run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  run_row public.agent_runs;
begin
  select * into run_row
    from public.agent_runs
   where owner_id = caller_id and id = run_id;
  if not found then
    raise exception 'agent run not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('run', to_jsonb(run_row));
end;
$$;

create or replace function public.custodian_run_budget_status(run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  run_row public.agent_runs;
  policy_row public.tool_policies;
  daily_tokens numeric := 0;
  monthly_tokens numeric := 0;
  daily_cost numeric := 0;
  monthly_cost numeric := 0;
  allowed_value boolean := true;
  reason_value text := 'allowed';
  daily_token_remaining numeric;
  monthly_token_remaining numeric;
  daily_cost_remaining numeric;
  monthly_cost_remaining numeric;
begin
  select * into run_row from public.agent_runs where owner_id = caller_id and id = run_id;
  if not found then
    raise exception 'agent run not found' using errcode = 'P0002';
  end if;
  if run_row.cancel_requested_at is not null then
    allowed_value := false;
    reason_value := 'cancel_requested';
  elsif public.custodian_runtime_is_terminal(run_row.status) then
    allowed_value := false;
    reason_value := run_row.status;
  end if;

  if run_row.tool_policy_id is not null then
    select * into policy_row
      from public.tool_policies
     where owner_id = caller_id and id = run_row.tool_policy_id;
    if not found or policy_row.status <> 'active' or policy_row.kill_switch then
      allowed_value := false;
      reason_value := 'policy_kill_switch';
    end if;
    select coalesce(sum(tokens_used), 0), coalesce(sum(cost_usd), 0)
      into daily_tokens, daily_cost
      from public.agent_runs
     where owner_id = caller_id
       and created_at >= pg_catalog.date_trunc('day', pg_catalog.now());
    select coalesce(sum(tokens_used), 0), coalesce(sum(cost_usd), 0)
      into monthly_tokens, monthly_cost
      from public.agent_runs
     where owner_id = caller_id
       and created_at >= pg_catalog.date_trunc('month', pg_catalog.now());
  end if;

  if run_row.tokens_used >= run_row.budget_tokens and allowed_value then
    allowed_value := false;
    reason_value := 'per_run_tokens';
  elsif run_row.cost_usd >= run_row.budget_cost_usd and allowed_value then
    allowed_value := false;
    reason_value := 'per_run_cost';
  elsif run_row.latency_ms >= run_row.budget_latency_ms and allowed_value then
    allowed_value := false;
    reason_value := 'per_run_latency';
  elsif run_row.tool_events_count >= run_row.budget_tool_events and allowed_value then
    allowed_value := false;
    reason_value := 'per_run_tool_events';
  end if;

  if policy_row.id is not null then
    daily_token_remaining := case when policy_row.daily_token_budget is null then null else policy_row.daily_token_budget - daily_tokens end;
    monthly_token_remaining := case when policy_row.monthly_token_budget is null then null else policy_row.monthly_token_budget - monthly_tokens end;
    daily_cost_remaining := case when policy_row.daily_cost_usd is null then null else policy_row.daily_cost_usd - daily_cost end;
    monthly_cost_remaining := case when policy_row.monthly_cost_usd is null then null else policy_row.monthly_cost_usd - monthly_cost end;
    if policy_row.daily_token_budget is not null and daily_tokens >= policy_row.daily_token_budget and allowed_value then
      allowed_value := false;
      reason_value := 'daily_tokens';
    elsif policy_row.monthly_token_budget is not null and monthly_tokens >= policy_row.monthly_token_budget and allowed_value then
      allowed_value := false;
      reason_value := 'monthly_tokens';
    elsif policy_row.daily_cost_usd is not null and daily_cost >= policy_row.daily_cost_usd and allowed_value then
      allowed_value := false;
      reason_value := 'daily_cost';
    elsif policy_row.monthly_cost_usd is not null and monthly_cost >= policy_row.monthly_cost_usd and allowed_value then
      allowed_value := false;
      reason_value := 'monthly_cost';
    end if;
  end if;

  return jsonb_build_object(
    'allowed', allowed_value,
    'reason', reason_value,
    'run_tokens_remaining', greatest(run_row.budget_tokens - run_row.tokens_used, 0),
    'run_cost_remaining', greatest(run_row.budget_cost_usd - run_row.cost_usd, 0),
    'run_latency_remaining', greatest(run_row.budget_latency_ms - run_row.latency_ms, 0),
    'run_tool_events_remaining', greatest(run_row.budget_tool_events - run_row.tool_events_count, 0),
    'daily_tokens', daily_tokens,
    'monthly_tokens', monthly_tokens,
    'daily_cost', daily_cost,
    'monthly_cost', monthly_cost,
    'daily_token_remaining', daily_token_remaining,
    'monthly_token_remaining', monthly_token_remaining,
    'daily_cost_remaining', daily_cost_remaining,
    'monthly_cost_remaining', monthly_cost_remaining
  );
end;
$$;

create or replace function public.custodian_transition_agent_run(
  run_id uuid,
  expected_status text,
  next_status text,
  idempotency_key text,
  patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  run_row public.agent_runs;
  updated_run public.agent_runs;
  patch_value jsonb := coalesce(patch, '{}'::jsonb);
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  effective_status text := next_status;
  tokens_delta integer := 0;
  tool_events_delta integer := 0;
  cost_delta numeric := 0;
  latency_delta integer := 0;
  failure_code_value text;
  failure_message_value text;
  completed_value timestamptz;
begin
  perform public.custodian_runtime_require_object(patch_value, 'patch');
  perform public.custodian_reject_owner_keys(patch_value);
  perform public.custodian_lock(caller_id);
  select * into run_row from public.agent_runs where owner_id = caller_id and id = run_id for update;
  if not found then
    raise exception 'agent run not found' using errcode = 'P0002';
  end if;
  if run_row.last_idempotency_key = request_key then
    return jsonb_build_object('run', to_jsonb(run_row), 'idempotent', true);
  end if;
  if run_row.status <> expected_status then
    raise exception 'agent run state changed; expected %, found %', expected_status, run_row.status using errcode = '40001';
  end if;
  if not public.custodian_runtime_transition_allowed(run_row.status, next_status) then
    raise exception 'invalid agent run transition from % to %', run_row.status, next_status using errcode = '22023';
  end if;
  if next_status = 'awaiting_approval'
     and not exists (
       select 1 from public.approval_requests
        where owner_id = caller_id and case_id = run_row.case_id
          and run_id = run_row.id and status = 'pending'
     ) then
    raise exception 'awaiting_approval requires a pending approval request' using errcode = '42501';
  end if;
  if next_status = 'executing'
     and not exists (
       select 1 from public.approval_requests
        where owner_id = caller_id and case_id = run_row.case_id
          and run_id = run_row.id and status = 'approved'
     ) then
    raise exception 'executing requires an approved approval request' using errcode = '42501';
  end if;

  tokens_delta := coalesce((patch_value ->> 'tokens_delta')::integer, 0);
  tool_events_delta := coalesce((patch_value ->> 'tool_events_delta')::integer, 0);
  cost_delta := coalesce((patch_value ->> 'cost_delta')::numeric, 0);
  latency_delta := coalesce((patch_value ->> 'latency_delta')::integer, 0);
  if tokens_delta < 0 or tool_events_delta < 0 or cost_delta < 0 or latency_delta < 0 then
    raise exception 'runtime usage deltas cannot be negative' using errcode = '22023';
  end if;
  failure_code_value := nullif(pg_catalog.btrim(patch_value ->> 'failure_code'), '');
  failure_message_value := nullif(pg_catalog.btrim(patch_value ->> 'failure_message'), '');

  if run_row.tokens_used + tokens_delta > run_row.budget_tokens
     or run_row.cost_usd + cost_delta > run_row.budget_cost_usd
     or run_row.latency_ms + latency_delta > run_row.budget_latency_ms
     or run_row.tool_events_count + tool_events_delta > run_row.budget_tool_events then
    effective_status := 'budget_stopped';
    if not public.custodian_runtime_transition_allowed(run_row.status, effective_status) then
      raise exception 'budget stop is not valid from the current run state' using errcode = '22023';
    end if;
    failure_code_value := 'budget_exceeded';
    failure_message_value := 'The persisted run budget stopped execution.';
  end if;

  completed_value := case when public.custodian_runtime_is_terminal(effective_status) then pg_catalog.now() else run_row.completed_at end;
  update public.agent_runs
     set status = effective_status,
         tokens_used = run_row.tokens_used + tokens_delta,
         cost_usd = run_row.cost_usd + cost_delta,
         latency_ms = run_row.latency_ms + latency_delta,
         tool_events_count = run_row.tool_events_count + tool_events_delta,
         started_at = coalesce(run_row.started_at, pg_catalog.now()),
         completed_at = completed_value,
         failure_code = failure_code_value,
         failure_message = failure_message_value,
         last_idempotency_key = request_key,
         last_transition_from = run_row.status,
         last_transition_to = effective_status,
         last_transition_at = pg_catalog.now(),
         updated_by = caller_id
   where owner_id = caller_id and id = run_row.id
   returning * into updated_run;

  perform public.custodian_runtime_write_audit(
    caller_id, updated_run.case_id, updated_run.id, 'transitioned', 'transition_agent_run',
    'agent_run', updated_run.id,
    jsonb_build_object('from', run_row.status, 'to', updated_run.status)
  );
  return jsonb_build_object('run', to_jsonb(updated_run), 'idempotent', false);
end;
$$;

create or replace function public.custodian_record_agent_step(
  run_id uuid,
  step_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(step_payload, 'step_payload');
  run_row public.agent_runs;
  step_row public.agent_steps;
  inserted_step public.agent_steps;
  sequence_value integer;
  step_kind_value text;
  step_status_value text;
  model_value text;
  prompt_value text;
  input_value jsonb;
  output_value jsonb;
  provenance_value jsonb;
  tokens_value integer;
  cost_value numeric;
  latency_value integer;
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  next_run_status text;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  select * into run_row from public.agent_runs where owner_id = caller_id and id = run_id for update;
  if not found then
    raise exception 'agent run not found' using errcode = 'P0002';
  end if;
  select * into step_row
    from public.agent_steps
   where owner_id = caller_id and case_id = run_row.case_id
     and run_id = run_row.id and idempotency_key = request_key;
  if found then
    return jsonb_build_object('step', to_jsonb(step_row), 'run', to_jsonb(run_row), 'idempotent', true);
  end if;

  step_kind_value := coalesce(payload ->> 'step_kind', 'retrieve');
  if step_kind_value not in ('retrieve', 'extract', 'synthesize', 'approval', 'execute', 'verify') then
    raise exception 'step_kind is not allowed' using errcode = '22023';
  end if;
  if (step_kind_value in ('retrieve', 'extract') and run_row.status <> 'retrieving')
     or (step_kind_value = 'synthesize' and run_row.status <> 'synthesizing')
     or (step_kind_value = 'approval' and run_row.status <> 'awaiting_approval')
     or (step_kind_value = 'execute' and run_row.status <> 'executing')
     or (step_kind_value = 'verify' and run_row.status <> 'verifying') then
    raise exception 'step_kind does not match the current run state' using errcode = '40001';
  end if;
  sequence_value := coalesce((payload ->> 'sequence_no')::integer, run_row.last_step_number + 1);
  if sequence_value <> run_row.last_step_number + 1 then
    raise exception 'sequence_no must advance the run by exactly one' using errcode = '40001';
  end if;
  step_status_value := coalesce(payload ->> 'status', 'completed');
  if step_status_value not in ('running', 'completed', 'failed', 'blocked', 'skipped') then
    raise exception 'step status is not allowed' using errcode = '22023';
  end if;
  model_value := coalesce(payload ->> 'model_tier', run_row.model_tier);
  prompt_value := coalesce(payload ->> 'prompt_version', run_row.prompt_version);
  input_value := coalesce(payload -> 'input_payload', '{}'::jsonb);
  output_value := coalesce(payload -> 'output_payload', '{}'::jsonb);
  provenance_value := coalesce(payload -> 'provenance', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(input_value) <> 'object'
     or pg_catalog.jsonb_typeof(output_value) <> 'object'
     or pg_catalog.jsonb_typeof(provenance_value) <> 'object' then
    raise exception 'step payloads and provenance must be JSON objects' using errcode = '22023';
  end if;
  tokens_value := coalesce((payload ->> 'tokens_used')::integer, 0);
  cost_value := coalesce((payload ->> 'cost_usd')::numeric, 0);
  latency_value := coalesce((payload ->> 'latency_ms')::integer, 0);
  if tokens_value < 0 or cost_value < 0 or latency_value < 0 then
    raise exception 'step usage cannot be negative' using errcode = '22023';
  end if;

  next_run_status := run_row.status;
  if run_row.tokens_used + tokens_value > run_row.budget_tokens
     or run_row.cost_usd + cost_value > run_row.budget_cost_usd
     or run_row.latency_ms + latency_value > run_row.budget_latency_ms then
    next_run_status := 'budget_stopped';
    step_status_value := 'blocked';
  end if;

  insert into public.agent_steps (
    owner_id, case_id, run_id, sequence_no, step_kind, status,
    idempotency_key, model_tier, prompt_version, input_payload, output_payload,
    tokens_used, cost_usd, latency_ms, failure_code, failure_message,
    provenance, completed_at, created_by, updated_by
  ) values (
    caller_id, run_row.case_id, run_row.id, sequence_value, step_kind_value, step_status_value,
    request_key, model_value, prompt_value, input_value, output_value,
    tokens_value, cost_value, latency_value,
    case when next_run_status = 'budget_stopped' then 'budget_exceeded' else null end,
    case when next_run_status = 'budget_stopped' then 'The persisted run budget stopped execution.' else null end,
    provenance_value, case when step_status_value <> 'running' then pg_catalog.now() else null end,
    caller_id, caller_id
  ) returning * into inserted_step;

  update public.agent_runs
     set status = next_run_status,
         tokens_used = tokens_used + tokens_value,
         cost_usd = cost_usd + cost_value,
         latency_ms = latency_ms + latency_value,
         last_step_number = sequence_value,
         started_at = coalesce(started_at, pg_catalog.now()),
         completed_at = case when next_run_status = 'budget_stopped' then pg_catalog.now() else completed_at end,
         failure_code = case when next_run_status = 'budget_stopped' then 'budget_exceeded' else failure_code end,
         failure_message = case when next_run_status = 'budget_stopped' then 'The persisted run budget stopped execution.' else failure_message end,
         updated_by = caller_id
   where owner_id = caller_id and id = run_row.id
   returning * into run_row;

  return jsonb_build_object('step', to_jsonb(inserted_step), 'run', to_jsonb(run_row), 'idempotent', false);
end;
$$;

create or replace function public.custodian_create_approval_request(
  approval_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(approval_payload, 'approval_payload');
  current_approval public.approval_requests;
  inserted_approval public.approval_requests;
  run_row public.agent_runs;
  case_value uuid;
  run_value uuid;
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  kind_value text;
  title_value text;
  rationale_value text;
  diff_value jsonb;
  action_value jsonb;
  provenance_value jsonb;
  expires_value timestamptz;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  case_value := public.custodian_runtime_uuid(payload ->> 'case_id', 'case_id');
  perform public.custodian_runtime_assert_case(caller_id, case_value);
  run_value := public.custodian_runtime_uuid(payload ->> 'run_id', 'run_id');
  if run_value is not null then
    select * into run_row
      from public.agent_runs
     where owner_id = caller_id and case_id = case_value and id = run_value
     for update;
    if not found then
      raise exception 'agent run is not owned by the authenticated case' using errcode = 'P0002';
    end if;
    if run_row.status not in ('retrieving', 'synthesizing', 'verifying', 'awaiting_approval') then
      raise exception 'approval interruption is not valid from the current run state' using errcode = '42501';
    end if;
  end if;

  select * into current_approval
    from public.approval_requests
   where owner_id = caller_id and case_id = case_value and idempotency_key = request_key
   for update;
  if found then
    return jsonb_build_object('approval', to_jsonb(current_approval), 'idempotent', true);
  end if;

  kind_value := coalesce(payload ->> 'approval_kind', 'tool_action');
  if kind_value not in ('tool_action', 'canonical_write', 'external_write', 'archive_change') then
    raise exception 'approval_kind is not allowed' using errcode = '22023';
  end if;
  title_value := public.custodian_require_text(payload ->> 'title', 'title', 500);
  rationale_value := public.custodian_require_text(payload ->> 'rationale', 'rationale', 20000, false);
  diff_value := public.custodian_runtime_require_object(coalesce(payload -> 'proposed_diff', '{}'::jsonb), 'proposed_diff');
  action_value := public.custodian_runtime_require_object(coalesce(payload -> 'tool_action', '{}'::jsonb), 'tool_action');
  provenance_value := coalesce(payload -> 'provenance', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(provenance_value) <> 'object' then
    raise exception 'provenance must be a JSON object' using errcode = '22023';
  end if;
  expires_value := case
    when payload ->> 'expires_at' is null or pg_catalog.btrim(payload ->> 'expires_at') = '' then null
    else (payload ->> 'expires_at')::timestamptz
  end;

  insert into public.approval_requests (
    owner_id, case_id, run_id, idempotency_key, approval_kind, status,
    title, rationale, proposed_diff, tool_action, exact_action_hash,
    requested_by, expires_at, provenance
  ) values (
    caller_id, case_value, run_value, request_key, kind_value, 'pending',
    title_value, rationale_value, diff_value, action_value,
    pg_catalog.md5(diff_value::text || ':' || action_value::text),
    caller_id, expires_value, provenance_value
  ) returning * into inserted_approval;

  if run_value is not null and run_row.status <> 'awaiting_approval' then
    perform public.custodian_transition_agent_run(
      run_value,
      run_row.status,
      'awaiting_approval',
      'approval-interrupt:' || request_key,
      '{}'::jsonb
    );
    select * into run_row from public.agent_runs where owner_id = caller_id and id = run_value;
  end if;

  perform public.custodian_runtime_write_audit(
    caller_id, case_value, run_value, 'created', 'create_approval_request',
    'approval_request', inserted_approval.id,
    jsonb_build_object('approval_kind', kind_value, 'run_status', coalesce(run_row.status, 'standalone'))
  );
  return jsonb_build_object(
    'approval', to_jsonb(inserted_approval),
    'run', case when run_value is null then null else to_jsonb(run_row) end,
    'idempotent', false
  );
end;
$$;

create or replace function public.custodian_respond_approval(
  approval_request_id uuid,
  decision text,
  response_note text,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  approval_row public.approval_requests;
  updated_approval public.approval_requests;
  run_row public.agent_runs;
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  decision_value text := pg_catalog.btrim(decision);
  note_value text := coalesce(response_note, '');
  transition_key text;
begin
  perform public.custodian_lock(caller_id);
  select * into approval_row
    from public.approval_requests
   where owner_id = caller_id and id = approval_request_id
   for update;
  if not found then
    raise exception 'approval request not found' using errcode = 'P0002';
  end if;
  if approval_row.response_idempotency_key = request_key then
    return jsonb_build_object('approval', to_jsonb(approval_row), 'idempotent', true);
  end if;
  if approval_row.status <> 'pending' then
    raise exception 'approval request has already been answered' using errcode = '40001';
  end if;
  if decision_value not in ('approved', 'rejected', 'expired', 'cancelled') then
    raise exception 'approval decision is not allowed' using errcode = '22023';
  end if;
  if pg_catalog.char_length(note_value) > 10000 then
    raise exception 'response_note exceeds the maximum length' using errcode = '22023';
  end if;
  if decision_value = 'approved'
     and approval_row.expires_at is not null
     and approval_row.expires_at <= pg_catalog.now() then
    decision_value := 'expired';
    note_value := 'Approval expired before it was answered.';
  end if;

  if approval_row.run_id is not null then
    select * into run_row
      from public.agent_runs
     where owner_id = caller_id and case_id = approval_row.case_id and id = approval_row.run_id
     for update;
    if not found or run_row.status <> 'awaiting_approval' then
      raise exception 'approval response requires the run to be awaiting approval' using errcode = '42501';
    end if;
  end if;

  update public.approval_requests
     set status = decision_value,
         responded_by = caller_id,
         response_note = note_value,
         response_idempotency_key = request_key,
         responded_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where owner_id = caller_id and id = approval_row.id
   returning * into updated_approval;

  if approval_row.run_id is not null then
    transition_key := 'approval-response:' || approval_row.id::text || ':' || request_key;
    if decision_value = 'approved' then
      perform public.custodian_transition_agent_run(
        approval_row.run_id, 'awaiting_approval', 'executing', transition_key, '{}'::jsonb
      );
    elsif decision_value = 'rejected' then
      perform public.custodian_transition_agent_run(
        approval_row.run_id, 'awaiting_approval', 'blocked', transition_key,
        jsonb_build_object('failure_code', 'approval_rejected', 'failure_message', 'The owner rejected the proposed action.')
      );
    elsif decision_value = 'expired' then
      perform public.custodian_transition_agent_run(
        approval_row.run_id, 'awaiting_approval', 'expired', transition_key,
        jsonb_build_object('failure_code', 'approval_expired', 'failure_message', 'The approval request expired.')
      );
    elsif decision_value = 'cancelled' then
      perform public.custodian_transition_agent_run(
        approval_row.run_id, 'awaiting_approval', 'cancelled', transition_key,
        jsonb_build_object('failure_code', 'approval_cancelled', 'failure_message', 'The approval request was cancelled.')
      );
    end if;
    select * into run_row from public.agent_runs where owner_id = caller_id and id = approval_row.run_id;
  end if;

  perform public.custodian_runtime_write_audit(
    caller_id, updated_approval.case_id, updated_approval.run_id, decision_value,
    'respond_approval', 'approval_request', updated_approval.id,
    jsonb_build_object('status', decision_value)
  );
  return jsonb_build_object(
    'approval', to_jsonb(updated_approval),
    'run', case when updated_approval.run_id is null then null else to_jsonb(run_row) end,
    'idempotent', false
  );
end;
$$;

create or replace function public.custodian_create_change_proposal(
  proposal_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(proposal_payload, 'proposal_payload');
  current_proposal public.change_proposals;
  inserted_proposal public.change_proposals;
  case_value uuid;
  run_value uuid;
  approval_value uuid;
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  target_type_value text;
  operation_value text;
  target_value uuid;
  before_value jsonb;
  diff_value jsonb;
  after_value jsonb;
  rationale_value text;
  provenance_value jsonb;
  run_row public.agent_runs;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  case_value := public.custodian_runtime_uuid(payload ->> 'case_id', 'case_id');
  perform public.custodian_runtime_assert_case(caller_id, case_value);
  run_value := public.custodian_runtime_uuid(payload ->> 'run_id', 'run_id');
  approval_value := public.custodian_runtime_uuid(payload ->> 'approval_request_id', 'approval_request_id');
  if run_value is not null then
    select * into run_row from public.agent_runs
     where owner_id = caller_id and case_id = case_value and id = run_value;
    if not found then raise exception 'agent run not found for proposal' using errcode = 'P0002'; end if;
  end if;
  if approval_value is not null and not exists (
    select 1 from public.approval_requests
     where owner_id = caller_id and case_id = case_value and id = approval_value
  ) then
    raise exception 'approval request not found for proposal' using errcode = 'P0002';
  end if;
  select * into current_proposal from public.change_proposals
   where owner_id = caller_id and case_id = case_value and idempotency_key = request_key for update;
  if found then return jsonb_build_object('proposal', to_jsonb(current_proposal), 'idempotent', true); end if;

  target_type_value := public.custodian_require_text(payload ->> 'target_type', 'target_type', 200);
  operation_value := coalesce(payload ->> 'operation', 'update');
  target_value := public.custodian_runtime_uuid(payload ->> 'target_id', 'target_id');
  before_value := public.custodian_runtime_require_object(coalesce(payload -> 'before_snapshot', '{}'::jsonb), 'before_snapshot');
  diff_value := public.custodian_runtime_require_object(coalesce(payload -> 'proposed_diff', '{}'::jsonb), 'proposed_diff');
  after_value := public.custodian_runtime_require_object(coalesce(payload -> 'after_snapshot', '{}'::jsonb), 'after_snapshot');
  rationale_value := public.custodian_require_text(payload ->> 'rationale', 'rationale', 20000, false);
  provenance_value := coalesce(payload -> 'provenance', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(provenance_value) <> 'object' then
    raise exception 'provenance must be a JSON object' using errcode = '22023';
  end if;

  insert into public.change_proposals (
    owner_id, case_id, run_id, approval_request_id, idempotency_key,
    target_type, target_id, operation, before_snapshot, proposed_diff,
    after_snapshot, rationale, provenance, created_by, updated_by
  ) values (
    caller_id, case_value, run_value, approval_value, request_key,
    target_type_value, target_value, operation_value, before_value, diff_value,
    after_value, rationale_value, provenance_value, caller_id, caller_id
  ) returning * into inserted_proposal;
  perform public.custodian_runtime_write_audit(
    caller_id, case_value, run_value, 'created', 'create_change_proposal',
    'change_proposal', inserted_proposal.id, jsonb_build_object('operation', operation_value)
  );
  return jsonb_build_object('proposal', to_jsonb(inserted_proposal), 'idempotent', false);
end;
$$;

create or replace function public.custodian_append_tool_event(
  run_id uuid,
  event_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(event_payload, 'event_payload');
  run_row public.agent_runs;
  approval_row public.approval_requests;
  current_event public.tool_events;
  inserted_event public.tool_events;
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  approval_value uuid;
  step_value uuid;
  tool_name_value text;
  event_kind_value text;
  operation_value text;
  input_value jsonb;
  output_value jsonb;
  provenance_value jsonb;
  target_value text;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  select * into run_row from public.agent_runs where owner_id = caller_id and id = run_id for update;
  if not found then raise exception 'agent run not found' using errcode = 'P0002'; end if;
  select * into current_event from public.tool_events
   where owner_id = caller_id and case_id = run_row.case_id and run_id = run_row.id
     and idempotency_key = request_key;
  if found then return jsonb_build_object('event', to_jsonb(current_event), 'run', to_jsonb(run_row), 'idempotent', true); end if;

  tool_name_value := public.custodian_require_text(payload ->> 'tool_name', 'tool_name', 300);
  event_kind_value := coalesce(payload ->> 'event_kind', 'requested');
  operation_value := coalesce(payload ->> 'operation_class', 'read_only');
  if event_kind_value not in ('requested', 'started', 'succeeded', 'failed', 'denied', 'skipped', 'approval_required') then
    raise exception 'event_kind is not allowed' using errcode = '22023';
  end if;
  if operation_value not in ('read_only', 'evidence_write', 'canonical_write', 'external_write', 'archive_change') then
    raise exception 'operation_class is not allowed' using errcode = '22023';
  end if;
  if coalesce(pg_catalog.cardinality(run_row.tool_allowlist), 0) = 0
     or not (tool_name_value = any(run_row.tool_allowlist)) then
    raise exception 'tool is not in the immutable run allowlist' using errcode = '42501';
  end if;
  approval_value := public.custodian_runtime_uuid(payload ->> 'approval_request_id', 'approval_request_id');
  step_value := public.custodian_runtime_uuid(payload ->> 'agent_step_id', 'agent_step_id');
  input_value := coalesce(payload -> 'input_payload', '{}'::jsonb);
  output_value := coalesce(payload -> 'output_payload', '{}'::jsonb);
  provenance_value := coalesce(payload -> 'provenance', '{}'::jsonb);
  target_value := coalesce(payload ->> 'external_target', '');
  if pg_catalog.jsonb_typeof(input_value) <> 'object'
     or pg_catalog.jsonb_typeof(output_value) <> 'object'
     or pg_catalog.jsonb_typeof(provenance_value) <> 'object' then
    raise exception 'tool event payloads and provenance must be JSON objects' using errcode = '22023';
  end if;

  if operation_value <> 'read_only' then
    if approval_value is null then
      raise exception 'write-capable tool events require an approval request' using errcode = '42501';
    end if;
    select * into approval_row from public.approval_requests
     where owner_id = caller_id and case_id = run_row.case_id and id = approval_value;
    if not found then raise exception 'approval request not found for tool event' using errcode = 'P0002'; end if;
    if event_kind_value in ('requested', 'approval_required') then
      if approval_row.status <> 'pending' or run_row.status <> 'awaiting_approval' then
        raise exception 'approval-required tool events need a pending approval and awaiting_approval run' using errcode = '42501';
      end if;
    elsif event_kind_value in ('started', 'succeeded', 'failed') then
      if approval_row.status <> 'approved' or run_row.status <> 'executing' then
        raise exception 'write-capable tool events need an approved request and executing run' using errcode = '42501';
      end if;
    elsif event_kind_value in ('denied', 'skipped') then
      if approval_row.status not in ('pending', 'rejected', 'expired', 'cancelled') then
        raise exception 'denied or skipped tool events need a non-executing approval result' using errcode = '42501';
      end if;
    end if;
  elsif run_row.status not in ('retrieving', 'synthesizing', 'executing', 'verifying') then
    raise exception 'read-only tool events are not valid in the current run state' using errcode = '42501';
  end if;

  if run_row.tool_events_count + 1 > run_row.budget_tool_events then
    update public.agent_runs
       set status = 'budget_stopped',
           failure_code = 'budget_exceeded',
           failure_message = 'The persisted tool-event budget stopped execution.',
           completed_at = pg_catalog.now(),
           updated_by = caller_id
     where owner_id = caller_id and id = run_row.id
     returning * into run_row;
    return jsonb_build_object('event', null, 'run', to_jsonb(run_row), 'budget_stopped', true, 'idempotent', false);
  end if;

  insert into public.tool_events (
    owner_id, case_id, run_id, agent_step_id, approval_request_id,
    idempotency_key, tool_name, event_kind, operation_class,
    input_payload, output_payload, external_target, provenance,
    created_by, updated_by
  ) values (
    caller_id, run_row.case_id, run_row.id, step_value, approval_value,
    request_key, tool_name_value, event_kind_value, operation_value,
    input_value, output_value, target_value, provenance_value,
    caller_id, caller_id
  ) returning * into inserted_event;

  update public.agent_runs
     set tool_events_count = tool_events_count + 1,
         updated_by = caller_id
   where owner_id = caller_id and id = run_row.id
   returning * into run_row;
  perform public.custodian_runtime_write_audit(
    caller_id, run_row.case_id, run_row.id, 'tool_called', 'append_tool_event',
    'tool_event', inserted_event.id,
    jsonb_build_object('tool_name', tool_name_value, 'operation_class', operation_value, 'event_kind', event_kind_value)
  );
  return jsonb_build_object('event', to_jsonb(inserted_event), 'run', to_jsonb(run_row), 'idempotent', false);
end;
$$;

create or replace function public.custodian_request_cancel_agent_run(
  run_id uuid,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  run_row public.agent_runs;
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
begin
  perform public.custodian_lock(caller_id);
  select * into run_row from public.agent_runs where owner_id = caller_id and id = run_id for update;
  if not found then raise exception 'agent run not found' using errcode = 'P0002'; end if;
  if run_row.last_idempotency_key = request_key and run_row.status = 'cancelled' then
    return jsonb_build_object('run', to_jsonb(run_row), 'idempotent', true);
  end if;
  if public.custodian_runtime_is_terminal(run_row.status) then
    return jsonb_build_object('run', to_jsonb(run_row), 'idempotent', false);
  end if;
  update public.agent_runs
     set cancel_requested_at = coalesce(cancel_requested_at, pg_catalog.now()),
         cancel_requested_by = caller_id,
         updated_by = caller_id
   where owner_id = caller_id and id = run_row.id;
  update public.approval_requests
     set status = 'cancelled',
         responded_by = caller_id,
         response_note = 'Run cancellation requested.',
         responded_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where owner_id = caller_id and case_id = run_row.case_id and run_id = run_row.id and status = 'pending';
  return public.custodian_transition_agent_run(
    run_row.id, run_row.status, 'cancelled', request_key,
    jsonb_build_object('failure_code', 'cancelled', 'failure_message', 'The owner requested cancellation.')
  );
end;
$$;

create or replace function public.custodian_append_audit_event(audit_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(audit_payload, 'audit_payload');
  case_value uuid;
  run_value uuid;
  target_value uuid;
  event_row public.audit_events;
  details_value jsonb;
  provenance_value jsonb;
  event_type_value text;
  action_value text;
  target_type_value text;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  case_value := public.custodian_runtime_uuid(payload ->> 'case_id', 'case_id');
  if case_value is not null then perform public.custodian_runtime_assert_case(caller_id, case_value); end if;
  run_value := public.custodian_runtime_uuid(payload ->> 'run_id', 'run_id');
  if run_value is not null and not exists (
    select 1 from public.agent_runs where owner_id = caller_id and case_id = case_value and id = run_value
  ) then raise exception 'audit run is not owned by the authenticated case' using errcode = 'P0002'; end if;
  event_type_value := public.custodian_require_text(payload ->> 'event_type', 'event_type', 200);
  action_value := public.custodian_require_text(payload ->> 'action', 'action', 300);
  target_type_value := public.custodian_require_text(payload ->> 'target_type', 'target_type', 200);
  target_value := public.custodian_runtime_uuid(payload ->> 'target_id', 'target_id');
  details_value := coalesce(payload -> 'details', '{}'::jsonb);
  provenance_value := coalesce(payload -> 'provenance', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(details_value) <> 'object' or pg_catalog.jsonb_typeof(provenance_value) <> 'object' then
    raise exception 'audit details and provenance must be JSON objects' using errcode = '22023';
  end if;
  insert into public.audit_events (
    owner_id, case_id, run_id, actor_type, event_type, action, target_type,
    target_id, details, provenance, created_by, updated_by
  ) values (
    caller_id, case_value, run_value, 'user', event_type_value, action_value, target_type_value,
    target_value, details_value, provenance_value, caller_id, caller_id
  ) returning * into event_row;
  return jsonb_build_object('event', to_jsonb(event_row));
end;
$$;

create or replace function public.custodian_upsert_record_embedding(embedding_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(embedding_payload, 'embedding_payload');
  record_value uuid;
  case_value uuid;
  embedding_value jsonb;
  opt_in_value boolean;
  status_value text;
  source_hash_value text;
  model_value text;
  model_version_value text;
  dimension_value integer;
  source_revision_value integer;
  existing_row public.record_embeddings;
  output_row public.record_embeddings;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  record_value := public.custodian_runtime_uuid(payload ->> 'record_id', 'record_id');
  if record_value is null or not exists (
    select 1 from public.records where user_id = caller_id and id = record_value
  ) then raise exception 'record is not owned by the authenticated user' using errcode = 'P0002'; end if;
  case_value := public.custodian_runtime_uuid(payload ->> 'case_id', 'case_id');
  if case_value is not null then perform public.custodian_runtime_assert_case(caller_id, case_value); end if;
  opt_in_value := coalesce((payload ->> 'embedding_opt_in')::boolean, false);
  embedding_value := payload -> 'embedding';
  if embedding_value is null or pg_catalog.jsonb_typeof(embedding_value) = 'null' then embedding_value := null; end if;
  if embedding_value is not null and not opt_in_value then
    raise exception 'embedding requires explicit embedding_opt_in' using errcode = '42501';
  end if;
  status_value := coalesce(payload ->> 'embedding_status', case when embedding_value is null then 'not_opted_in' else 'active' end);
  source_hash_value := public.custodian_require_text(payload ->> 'source_content_hash', 'source_content_hash', 128);
  model_value := nullif(pg_catalog.btrim(payload ->> 'model'), '');
  model_version_value := nullif(pg_catalog.btrim(payload ->> 'model_version'), '');
  dimension_value := (payload ->> 'embedding_dimension')::integer;
  source_revision_value := (payload ->> 'source_revision')::integer;

  select * into existing_row from public.record_embeddings
   where owner_id = caller_id and record_id = record_value
     and source_content_hash = source_hash_value
     and coalesce(model, '') = coalesce(model_value, '')
   for update;
  if found then
    update public.record_embeddings
       set case_id = case_value,
           embedding_status = status_value,
           embedding_opt_in = opt_in_value,
           regenerable = coalesce((payload ->> 'regenerable')::boolean, true),
           embedding = embedding_value,
           embedding_dimension = dimension_value,
           model = model_value,
           model_version = model_version_value,
           source_revision = source_revision_value,
           provenance = coalesce(payload -> 'provenance', '{}'::jsonb),
           updated_by = caller_id
     where owner_id = caller_id and id = existing_row.id
     returning * into output_row;
  else
    insert into public.record_embeddings (
      owner_id, case_id, record_id, embedding_status, embedding_opt_in,
      regenerable, embedding, embedding_dimension, model, model_version,
      source_content_hash, source_revision, provenance, created_by, updated_by
    ) values (
      caller_id, case_value, record_value, status_value, opt_in_value,
      coalesce((payload ->> 'regenerable')::boolean, true), embedding_value, dimension_value,
      model_value, model_version_value, source_hash_value, source_revision_value,
      coalesce(payload -> 'provenance', '{}'::jsonb), caller_id, caller_id
    ) returning * into output_row;
  end if;
  return jsonb_build_object('embedding', to_jsonb(output_row), 'regenerable', output_row.regenerable, 'opted_in', output_row.embedding_opt_in);
end;
$$;

create or replace function public.custodian_start_automation_run(
  automation_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(automation_payload, 'automation_payload');
  rule_row public.automation_rules;
  connector_row public.connector_accounts;
  current_run public.automation_runs;
  inserted_run public.automation_runs;
  case_value uuid;
  rule_value uuid;
  agent_value uuid;
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  trigger_value jsonb;
  input_value jsonb;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  case_value := public.custodian_runtime_uuid(payload ->> 'case_id', 'case_id');
  perform public.custodian_runtime_assert_case(caller_id, case_value);
  rule_value := public.custodian_runtime_uuid(payload ->> 'rule_id', 'rule_id');
  select * into rule_row from public.automation_rules
   where owner_id = caller_id and case_id = case_value and id = rule_value for update;
  if not found or rule_row.status <> 'active' or rule_row.review_required or rule_row.can_mutate_canonical then
    raise exception 'automation rule is not active and reviewed' using errcode = '42501';
  end if;
  if rule_row.connector_account_id is not null then
    select * into connector_row from public.connector_accounts
     where owner_id = caller_id and id = rule_row.connector_account_id;
    if not found or connector_row.status <> 'active'
       or (rule_row.connector_schema_version is not null and rule_row.connector_schema_version <> connector_row.schema_version) then
      raise exception 'connector schema or account requires review before automation can run' using errcode = '42501';
    end if;
  end if;
  agent_value := public.custodian_runtime_uuid(payload ->> 'agent_run_id', 'agent_run_id');
  if agent_value is not null and not exists (
    select 1 from public.agent_runs where owner_id = caller_id and case_id = case_value and id = agent_value
  ) then raise exception 'automation agent run is not owned by the case' using errcode = 'P0002'; end if;
  trigger_value := coalesce(payload -> 'trigger_payload', '{}'::jsonb);
  input_value := coalesce(payload -> 'input_snapshot', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(trigger_value) <> 'object' or pg_catalog.jsonb_typeof(input_value) <> 'object' then
    raise exception 'automation trigger_payload and input_snapshot must be JSON objects' using errcode = '22023';
  end if;
  select * into current_run from public.automation_runs
   where owner_id = caller_id and case_id = case_value and rule_id = rule_value and idempotency_key = request_key for update;
  if found then return jsonb_build_object('automation_run', to_jsonb(current_run), 'idempotent', true); end if;

  insert into public.automation_runs (
    owner_id, case_id, rule_id, agent_run_id, idempotency_key, status,
    trigger_payload, input_snapshot, created_by, updated_by
  ) values (
    caller_id, case_value, rule_value, agent_value, request_key, 'running',
    trigger_value, input_value, caller_id, caller_id
  ) returning * into inserted_run;
  perform public.custodian_runtime_write_audit(
    caller_id, case_value, agent_value, 'created', 'start_automation_run',
    'automation_run', inserted_run.id, jsonb_build_object('rule_id', rule_value)
  );
  return jsonb_build_object('automation_run', to_jsonb(inserted_run), 'idempotent', false);
end;
$$;

create or replace function public.custodian_complete_automation_run(
  automation_run_id uuid,
  completion_status text,
  error_code text,
  error_message text,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  run_row public.automation_runs;
  updated_run public.automation_runs;
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
begin
  perform public.custodian_lock(caller_id);
  select * into run_row from public.automation_runs where owner_id = caller_id and id = automation_run_id for update;
  if not found then raise exception 'automation run not found' using errcode = 'P0002'; end if;
  if run_row.output_idempotency_key = request_key then
    return jsonb_build_object('automation_run', to_jsonb(run_row), 'idempotent', true);
  end if;
  if run_row.status not in ('queued', 'running') then
    raise exception 'automation run is already terminal' using errcode = '40001';
  end if;
  if completion_status not in ('completed', 'failed', 'blocked', 'cancelled', 'budget_stopped') then
    raise exception 'automation completion status is not allowed' using errcode = '22023';
  end if;
  update public.automation_runs
     set status = completion_status,
         error_code = nullif(pg_catalog.btrim(error_code), ''),
         error_message = nullif(pg_catalog.btrim(error_message), ''),
         output_idempotency_key = request_key,
         completed_at = pg_catalog.now(),
         updated_by = caller_id
   where owner_id = caller_id and id = run_row.id
   returning * into updated_run;
  return jsonb_build_object('automation_run', to_jsonb(updated_run), 'idempotent', false);
end;
$$;

create or replace function public.custodian_automation_emit_output(
  automation_run_id uuid,
  output_kind text,
  output_payload jsonb,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  run_row public.automation_runs;
  rule_row public.automation_rules;
  payload jsonb := public.custodian_runtime_require_object(output_payload, 'output_payload');
  approval_result jsonb;
  artifact_id uuid;
  output_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  title_value text;
  content_value jsonb;
  provenance_value jsonb;
  source_record_value uuid;
  source_uri_value text;
  finding_value text;
begin
  perform public.custodian_lock(caller_id);
  select * into run_row from public.automation_runs where owner_id = caller_id and id = automation_run_id for update;
  if not found then raise exception 'automation run not found' using errcode = 'P0002'; end if;
  if run_row.output_idempotency_key = output_key then
    return jsonb_build_object('automation_run', to_jsonb(run_row), 'idempotent', true);
  end if;
  if run_row.status <> 'running' then raise exception 'automation run is not active' using errcode = '42501'; end if;
  select * into rule_row from public.automation_rules
   where owner_id = caller_id and case_id = run_row.case_id and id = run_row.rule_id;
  if not found or rule_row.status <> 'active' or rule_row.review_required or rule_row.can_mutate_canonical then
    raise exception 'automation rule is not active and reviewed' using errcode = '42501';
  end if;
  if output_kind not in ('evidence', 'brief', 'approval') or not (output_kind = any(rule_row.output_kinds)) then
    raise exception 'automation output kind is not allowed by the reviewed rule' using errcode = '42501';
  end if;
  if output_kind = 'evidence' then
    title_value := public.custodian_require_text(payload ->> 'title', 'title', 500);
    content_value := coalesce(payload -> 'content', payload);
    source_record_value := public.custodian_runtime_uuid(payload ->> 'source_record_id', 'source_record_id');
    if source_record_value is not null and not exists (
      select 1 from public.records where user_id = caller_id and id = source_record_value
    ) then raise exception 'automation evidence source record is not owner-scoped' using errcode = 'P0002'; end if;
    source_uri_value := public.custodian_require_text(payload ->> 'source_uri', 'source_uri', 4000, false);
    provenance_value := coalesce(payload -> 'provenance', '{}'::jsonb);
    insert into public.evidence_items (
      owner_id, case_id, title, content, content_hash, source_classification,
      source_uri, source_record_id, provenance, immutable, created_by, updated_by
    ) values (
      caller_id, run_row.case_id, title_value, content_value, pg_catalog.md5(content_value::text),
      'inference', source_uri_value, source_record_value, provenance_value, true, caller_id, caller_id
    ) returning id into artifact_id;
  elsif output_kind = 'brief' then
    title_value := public.custodian_require_text(payload ->> 'title', 'title', 500);
    finding_value := public.custodian_require_text(payload ->> 'finding', 'finding', 30000);
    provenance_value := coalesce(payload -> 'provenance', '{}'::jsonb);
    insert into public.custodian_findings (
      owner_id, case_id, analysis_mode, title, finding, confidence,
      provenance, created_by, updated_by
    ) values (
      caller_id, run_row.case_id, 'synthesis', title_value, finding_value,
      least(greatest(coalesce((payload ->> 'confidence')::integer, 0), 0), 100),
      provenance_value, caller_id, caller_id
    ) returning id into artifact_id;
  else
    approval_result := public.custodian_create_approval_request(
      jsonb_build_object(
        'case_id', run_row.case_id,
        'approval_kind', coalesce(payload ->> 'approval_kind', 'external_write'),
        'title', payload ->> 'title',
        'rationale', coalesce(payload ->> 'rationale', ''),
        'proposed_diff', coalesce(payload -> 'proposed_diff', '{}'::jsonb),
        'tool_action', coalesce(payload -> 'tool_action', '{}'::jsonb),
        'provenance', coalesce(payload -> 'provenance', '{}'::jsonb)
      ),
      'automation-approval:' || output_key
    );
    artifact_id := (approval_result -> 'approval' ->> 'id')::uuid;
  end if;

  update public.automation_runs
     set status = 'completed',
         output_kind = output_kind,
         output_artifact_id = artifact_id,
         output_idempotency_key = output_key,
         completed_at = pg_catalog.now(),
         updated_by = caller_id
   where owner_id = caller_id and id = run_row.id
   returning * into run_row;
  perform public.custodian_runtime_write_audit(
    caller_id, run_row.case_id, run_row.agent_run_id, 'created', 'automation_emit_output',
    output_kind, artifact_id, jsonb_build_object('automation_run_id', run_row.id)
  );
  return jsonb_build_object('automation_run', to_jsonb(run_row), 'artifact_id', artifact_id, 'idempotent', false);
end;
$$;

-- Only these owner-derived RPCs are callable by authenticated clients. The
-- underlying tables remain read-only to that role, and anon/public receive no
-- execution privilege.
revoke execute on function public.custodian_create_agent_run(jsonb, text) from public, anon;
revoke execute on function public.custodian_get_agent_run(uuid) from public, anon;
revoke execute on function public.custodian_run_budget_status(uuid) from public, anon;
revoke execute on function public.custodian_transition_agent_run(uuid, text, text, text, jsonb) from public, anon;
revoke execute on function public.custodian_record_agent_step(uuid, jsonb, text) from public, anon;
revoke execute on function public.custodian_create_approval_request(jsonb, text) from public, anon;
revoke execute on function public.custodian_respond_approval(uuid, text, text, text) from public, anon;
revoke execute on function public.custodian_create_change_proposal(jsonb, text) from public, anon;
revoke execute on function public.custodian_append_tool_event(uuid, jsonb, text) from public, anon;
revoke execute on function public.custodian_request_cancel_agent_run(uuid, text) from public, anon;
revoke execute on function public.custodian_append_audit_event(jsonb) from public, anon;
revoke execute on function public.custodian_upsert_record_embedding(jsonb) from public, anon;
revoke execute on function public.custodian_start_automation_run(jsonb, text) from public, anon;
revoke execute on function public.custodian_complete_automation_run(uuid, text, text, text, text) from public, anon;
revoke execute on function public.custodian_automation_emit_output(uuid, text, jsonb, text) from public, anon;

grant execute on function public.custodian_create_agent_run(jsonb, text) to authenticated;
grant execute on function public.custodian_get_agent_run(uuid) to authenticated;
grant execute on function public.custodian_run_budget_status(uuid) to authenticated;
grant execute on function public.custodian_transition_agent_run(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.custodian_record_agent_step(uuid, jsonb, text) to authenticated;
grant execute on function public.custodian_create_approval_request(jsonb, text) to authenticated;
grant execute on function public.custodian_respond_approval(uuid, text, text, text) to authenticated;
grant execute on function public.custodian_create_change_proposal(jsonb, text) to authenticated;
grant execute on function public.custodian_append_tool_event(uuid, jsonb, text) to authenticated;
grant execute on function public.custodian_request_cancel_agent_run(uuid, text) to authenticated;
grant execute on function public.custodian_append_audit_event(jsonb) to authenticated;
grant execute on function public.custodian_upsert_record_embedding(jsonb) to authenticated;
grant execute on function public.custodian_start_automation_run(jsonb, text) to authenticated;
grant execute on function public.custodian_complete_automation_run(uuid, text, text, text, text) to authenticated;
grant execute on function public.custodian_automation_emit_output(uuid, text, jsonb, text) to authenticated;
