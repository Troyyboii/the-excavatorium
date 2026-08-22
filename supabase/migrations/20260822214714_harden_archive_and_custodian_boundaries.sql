-- Harden archive export and Custodian execution boundaries. This migration is
-- intentionally fail-closed: the new approval/hash and pricing contracts are
-- not inferred from existing runtime rows.
do $$
begin
  if pg_catalog.to_regprocedure('public.export_user_archive_snapshot()') is not null then
    raise exception 'export_user_archive_snapshot already exists; refusing to replace an unreviewed definition';
  end if;
  if pg_catalog.to_regprocedure('public.custodian_create_agent_run(jsonb,text)') is null
     or pg_catalog.to_regprocedure('public.custodian_record_agent_step(uuid,jsonb,text)') is null
     or pg_catalog.to_regprocedure('public.custodian_append_tool_event(uuid,jsonb,text)') is null then
    raise exception 'required Custodian RPC definitions are missing';
  end if;
  if exists (select 1 from public.agent_runs where tool_policy_id is null) then
    raise exception 'agent_runs with no tool policy cannot be safely hardened';
  end if;
  if exists (
    select 1
      from public.agent_runs r
      left join public.tool_policies p
        on p.owner_id = r.owner_id and p.id = r.tool_policy_id
     where p.id is null
        or p.case_id is distinct from r.case_id
        or p.status <> 'active'
        or p.lifecycle_status <> 'active'
        or p.kill_switch
        or not (r.model_tier = any(p.allowed_model_tiers))
        or not (r.tool_allowlist <@ p.allowed_tools)
        or r.budget_tokens > p.per_run_token_budget
        or r.budget_cost_usd > p.per_run_cost_usd
        or r.budget_latency_ms > p.per_run_latency_ms
        -- Existing policies receive the new default tool-event cap below.
        or r.budget_tool_events > 50
  ) then
    raise exception 'agent_runs conflict with the active exact-case tool policy boundary';
  end if;
  if exists (select 1 from public.agent_runs where cost_usd > 0) then
    raise exception 'costed agent_runs without priced step provenance cannot be safely hardened';
  end if;
  if exists (select 1 from public.agent_steps where cost_usd > 0) then
    raise exception 'costed agent_steps without a pricing version cannot be safely hardened';
  end if;
  if exists (
    select 1
      from public.agent_steps s
      join public.agent_runs r
        on r.owner_id = s.owner_id and r.case_id = s.case_id and r.id = s.run_id
      join public.tool_policies p
        on p.owner_id = r.owner_id and p.id = r.tool_policy_id and p.case_id = r.case_id
     where not (s.model_tier = any(p.allowed_model_tiers))
        or s.prompt_version is distinct from r.prompt_version
  ) then
    raise exception 'agent_steps conflict with the bound model or prompt policy';
  end if;
  if exists (select 1 from public.tool_events) then
    raise exception 'existing tool_events cannot be safely backfilled with an exact approval hash';
  end if;
end;
$$;

-- Server-side exports preserve stable IDs and use only the authenticated
-- caller's archive rows. SECURITY INVOKER keeps the existing RLS boundary in
-- force; the function never accepts a user ID.
create function public.export_user_archive_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  records_value jsonb;
  links_value jsonb;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'user_id', r.user_id,
        'record_type', r.record_type,
        'title', r.title,
        'summary', r.summary,
        'tags', r.tags,
        'record_data', r.record_data,
        'is_example', r.is_example,
        'seed_key', r.seed_key,
        'created_at', r.created_at,
        'updated_at', r.updated_at
      ) order by r.id
    ),
    '[]'::jsonb
  ) into records_value
  from public.records r
  where r.user_id = caller_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'user_id', l.user_id,
        'source_record_id', l.source_record_id,
        'target_record_id', l.target_record_id,
        'seed_key', l.seed_key,
        'created_at', l.created_at
      ) order by l.id
    ),
    '[]'::jsonb
  ) into links_value
  from public.record_links l
  where l.user_id = caller_id;

  return jsonb_build_object('records', records_value, 'links', links_value);
end;
$$;

revoke execute on function public.export_user_archive_snapshot() from public;
revoke execute on function public.export_user_archive_snapshot() from anon;
grant execute on function public.export_user_archive_snapshot() to authenticated;

-- Repair the existing helper before the hardened RPCs invoke it. NULLIF is a
-- SQL expression and cannot be schema-qualified as a pg_catalog function.
create or replace function public.custodian_runtime_require_idempotency(value text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized text := nullif(pg_catalog.btrim(value), '');
begin
  if normalized is null or pg_catalog.char_length(normalized) > 300 then
    raise exception 'idempotency_key is required and must be at most 300 characters' using errcode = '22023';
  end if;
  return normalized;
end;
$$;

-- A case-scoped policy owns every runtime cap. Requests may choose a smaller
-- cap or a subset of tools, never broaden that active owner/case policy.
alter table public.tool_policies
  add column per_run_tool_event_budget integer not null default 50;

alter table public.tool_policies
  add constraint tool_policies_run_tool_events_ck
  check (per_run_tool_event_budget between 1 and 10000);

alter table public.agent_runs
  alter column tool_policy_id set not null;

-- The original foreign key used ON DELETE SET NULL. That action is no longer
-- compatible with mandatory policy binding, so policies with run history must
-- be retained rather than silently detaching their runs.
alter table public.agent_runs
  drop constraint agent_runs_policy_fk;

alter table public.agent_runs
  add constraint agent_runs_policy_fk
  foreign key (owner_id, tool_policy_id)
  references public.tool_policies (owner_id, id)
  on delete restrict;

alter table public.agent_steps
  add column pricing_version text;

alter table public.agent_steps
  add constraint agent_steps_pricing_version_ck
  check (pricing_version is null or (btrim(pricing_version) <> '' and char_length(pricing_version) <= 200));

alter table public.agent_steps
  add constraint agent_steps_cost_pricing_ck
  check (cost_usd = 0 or pricing_version is not null);

-- Run cost is derived only from persisted, version-priced steps. This closes
-- the older transition RPC's generic cost_delta path without weakening its
-- state-transition and non-cost usage responsibilities.
create function public.custodian_enforce_priced_run_cost()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  priced_step_cost numeric;
begin
  if new.cost_usd is distinct from old.cost_usd then
    select coalesce(sum(s.cost_usd), 0)
      into priced_step_cost
      from public.agent_steps s
     where s.owner_id = new.owner_id
       and s.case_id = new.case_id
       and s.run_id = new.id;
    if new.cost_usd is distinct from priced_step_cost then
      raise exception 'agent run cost must equal version-priced persisted steps'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.custodian_enforce_priced_run_cost() from public;
revoke execute on function public.custodian_enforce_priced_run_cost() from anon;
revoke execute on function public.custodian_enforce_priced_run_cost() from authenticated;

create trigger agent_runs_priced_cost_guard
before update of cost_usd on public.agent_runs
for each row execute function public.custodian_enforce_priced_run_cost();

-- An approval has a stable same-run/hash identity. Tool events retain that
-- exact hash, so an approved action cannot be replayed against another run.
alter table public.approval_requests
  add constraint approval_requests_owner_case_run_hash_unique
  unique (owner_id, case_id, run_id, id, exact_action_hash);

alter table public.tool_events
  add column exact_action_hash text;

alter table public.tool_events
  add constraint tool_events_approval_hash_ck
  check (
    (approval_request_id is null and exact_action_hash is null)
    or (
      approval_request_id is not null
      and exact_action_hash ~ '^[0-9a-fA-F]{32}$'
    )
  );

alter table public.tool_events
  drop constraint tool_events_approval_fk;

alter table public.tool_events
  add constraint tool_events_approval_run_hash_fk
  foreign key (owner_id, case_id, run_id, approval_request_id, exact_action_hash)
  references public.approval_requests (owner_id, case_id, run_id, id, exact_action_hash)
  on delete cascade;

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
  policy_value := public.custodian_runtime_uuid(payload ->> 'tool_policy_id', 'tool_policy_id');
  if policy_value is null then
    raise exception 'tool_policy_id is required for every agent run' using errcode = '42501';
  end if;
  select * into policy_row
    from public.tool_policies
   where owner_id = caller_id and id = policy_value
   for update;
  if not found
     or policy_row.status <> 'active'
     or policy_row.lifecycle_status <> 'active'
     or policy_row.kill_switch then
    raise exception 'tool policy is not active for the authenticated owner' using errcode = 'P0002';
  end if;
  if policy_row.case_id is distinct from case_value then
    raise exception 'tool policy must be scoped to this exact case' using errcode = '42501';
  end if;

  objective_value := public.custodian_require_text(payload ->> 'objective', 'objective', 20000);
  input_value := coalesce(payload -> 'input_snapshot', '{}'::jsonb);
  graph_value := coalesce(payload -> 'agent_graph', '{}'::jsonb);
  config_value := coalesce(payload -> 'agent_config', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(input_value) <> 'object'
     or pg_catalog.jsonb_typeof(graph_value) <> 'object'
     or pg_catalog.jsonb_typeof(config_value) <> 'object' then
    raise exception 'input_snapshot, agent_graph, and agent_config must be JSON objects' using errcode = '22023';
  end if;

  tool_json := case
    when payload ? 'tool_allowlist' then payload -> 'tool_allowlist'
    else pg_catalog.to_jsonb(policy_row.allowed_tools)
  end;
  if pg_catalog.jsonb_typeof(tool_json) <> 'array' or pg_catalog.jsonb_array_length(tool_json) > 200 then
    raise exception 'tool_allowlist must be an array of at most 200 items' using errcode = '22023';
  end if;
  tool_list := array(
    select distinct value
      from pg_catalog.jsonb_array_elements_text(tool_json) as elements(value)
     order by value
  );
  if pg_catalog.array_position(tool_list, null) is not null
     or exists (
       select 1 from pg_catalog.unnest(tool_list) as tools(value)
        where pg_catalog.btrim(value) = '' or pg_catalog.char_length(value) > 300
     ) then
    raise exception 'tool_allowlist must contain bounded nonblank tool names' using errcode = '22023';
  end if;
  if not (tool_list <@ policy_row.allowed_tools) then
    raise exception 'tool_allowlist may only narrow the selected policy' using errcode = '42501';
  end if;

  model_value := coalesce(payload ->> 'model_tier', 'terra');
  if model_value not in ('luna', 'terra', 'sol', 'pro') then
    raise exception 'model_tier is not allowed' using errcode = '22023';
  end if;
  if not (model_value = any(policy_row.allowed_model_tiers)) then
    raise exception 'model tier is not permitted by the selected owner policy' using errcode = '42501';
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

  budget_tokens_value := case when payload ? 'budget_tokens'
    then (payload ->> 'budget_tokens')::integer else policy_row.per_run_token_budget end;
  budget_cost_value := case when payload ? 'budget_cost_usd'
    then (payload ->> 'budget_cost_usd')::numeric else policy_row.per_run_cost_usd end;
  budget_latency_value := case when payload ? 'budget_latency_ms'
    then (payload ->> 'budget_latency_ms')::integer else policy_row.per_run_latency_ms end;
  budget_tools_value := case when payload ? 'budget_tool_events'
    then (payload ->> 'budget_tool_events')::integer else policy_row.per_run_tool_event_budget end;
  if budget_tokens_value > policy_row.per_run_token_budget
     or budget_cost_value > policy_row.per_run_cost_usd
     or budget_latency_value > policy_row.per_run_latency_ms
     or budget_tools_value > policy_row.per_run_tool_event_budget then
    raise exception 'requested run budget may only narrow the selected policy' using errcode = '42501';
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
  policy_row public.tool_policies;
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
  pricing_value text;
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
  select * into policy_row
    from public.tool_policies
   where owner_id = caller_id
     and id = run_row.tool_policy_id
     and case_id = run_row.case_id
     and status = 'active'
     and lifecycle_status = 'active'
     and not kill_switch;
  if not found then
    raise exception 'the run tool policy is not active for this case' using errcode = '42501';
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
  if not (model_value = any(policy_row.allowed_model_tiers))
     or prompt_value <> run_row.prompt_version then
    raise exception 'step model tier and prompt version must match the bound run policy'
      using errcode = '42501';
  end if;
  input_value := coalesce(payload -> 'input_payload', '{}'::jsonb);
  output_value := coalesce(payload -> 'output_payload', '{}'::jsonb);
  provenance_value := coalesce(payload -> 'provenance', '{}'::jsonb);
  pricing_value := nullif(pg_catalog.btrim(payload ->> 'pricing_version'), '');
  if pg_catalog.jsonb_typeof(input_value) <> 'object'
     or pg_catalog.jsonb_typeof(output_value) <> 'object'
     or pg_catalog.jsonb_typeof(provenance_value) <> 'object' then
    raise exception 'step payloads and provenance must be JSON objects' using errcode = '22023';
  end if;
  if pricing_value is not null and pg_catalog.char_length(pricing_value) > 200 then
    raise exception 'pricing_version must be at most 200 characters' using errcode = '22023';
  end if;
  tokens_value := coalesce((payload ->> 'tokens_used')::integer, 0);
  cost_value := coalesce((payload ->> 'cost_usd')::numeric, 0);
  latency_value := coalesce((payload ->> 'latency_ms')::integer, 0);
  if tokens_value < 0 or cost_value < 0 or latency_value < 0 then
    raise exception 'step usage cannot be negative' using errcode = '22023';
  end if;
  if cost_value > 0 and pricing_value is null then
    raise exception 'pricing_version is required when cost_usd is positive' using errcode = '22023';
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
    tokens_used, cost_usd, latency_ms, pricing_version, failure_code, failure_message,
    provenance, completed_at, created_by, updated_by
  ) values (
    caller_id, run_row.case_id, run_row.id, sequence_value, step_kind_value, step_status_value,
    request_key, model_value, prompt_value, input_value, output_value,
    tokens_value, cost_value, latency_value, pricing_value,
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
  exact_hash_value text;
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
  exact_hash_value := nullif(pg_catalog.btrim(payload ->> 'exact_action_hash'), '');
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
    if approval_value is null or exact_hash_value is null or exact_hash_value !~ '^[0-9a-fA-F]{32}$' then
      raise exception 'write-capable tool events require an exact approved action hash' using errcode = '42501';
    end if;
    select * into approval_row from public.approval_requests
     where owner_id = caller_id
       and case_id = run_row.case_id
       and run_id = run_row.id
       and id = approval_value
       and exact_action_hash = exact_hash_value;
    if not found then
      raise exception 'approval request is not bound to this run and exact action' using errcode = 'P0002';
    end if;
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
  else
    if approval_value is not null or exact_hash_value is not null then
      raise exception 'read-only tool events cannot carry an approval action hash' using errcode = '22023';
    end if;
    if run_row.status not in ('retrieving', 'synthesizing', 'executing', 'verifying') then
      raise exception 'read-only tool events are not valid in the current run state' using errcode = '42501';
    end if;
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
    owner_id, case_id, run_id, agent_step_id, approval_request_id, exact_action_hash,
    idempotency_key, tool_name, event_kind, operation_class,
    input_payload, output_payload, external_target, provenance,
    created_by, updated_by
  ) values (
    caller_id, run_row.case_id, run_row.id, step_value, approval_value, exact_hash_value,
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

revoke execute on function public.custodian_create_agent_run(jsonb, text) from public, anon;
grant execute on function public.custodian_create_agent_run(jsonb, text) to authenticated;
revoke execute on function public.custodian_record_agent_step(uuid, jsonb, text) from public, anon;
grant execute on function public.custodian_record_agent_step(uuid, jsonb, text) to authenticated;
revoke execute on function public.custodian_append_tool_event(uuid, jsonb, text) from public, anon;
grant execute on function public.custodian_append_tool_event(uuid, jsonb, text) to authenticated;
