-- Custodian M4A: a provider budget hold is an encumbrance, not a bill.
--
-- Recorded tokens and cost stay on agent_steps and agent_runs, and only after
-- parsed provider usage is settled. Unknown usage leaves those columns
-- unchanged and keeps the conservative maximum on this table. This migration
-- does not call a provider, open a provider gate, or create evidence items.

create or replace function public.custodian_provider_require_integer(
  payload jsonb,
  field_name text,
  minimum_value integer,
  maximum_value integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  raw numeric;
begin
  if payload is null or pg_catalog.jsonb_typeof(payload -> field_name) is distinct from 'number' then
    raise exception '% is required', field_name using errcode = '22023';
  end if;
  raw := (payload ->> field_name)::numeric;
  if raw <> trunc(raw) or raw < minimum_value or raw > maximum_value then
    raise exception '% is outside its allowed range', field_name using errcode = '22023';
  end if;
  return raw::integer;
end;
$$;

create or replace function public.custodian_provider_require_positive_cost(
  payload jsonb,
  field_name text
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  raw numeric;
begin
  if payload is null or pg_catalog.jsonb_typeof(payload -> field_name) is distinct from 'number' then
    raise exception '% is required', field_name using errcode = '22023';
  end if;
  raw := (payload ->> field_name)::numeric;
  if raw <= 0 or raw >= 100000000 then
    raise exception '% must be a positive cost within the policy column', field_name using errcode = '22023';
  end if;
  return raw;
end;
$$;

create or replace function public.custodian_provider_require_hold_cost(
  payload jsonb,
  field_name text
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  raw numeric;
begin
  if payload is null or pg_catalog.jsonb_typeof(payload -> field_name) is distinct from 'number' then
    raise exception '% is required', field_name using errcode = '22023';
  end if;
  raw := (payload ->> field_name)::numeric(12, 4);
  if raw < 0 or raw >= 100000000 then
    raise exception '% must be a non-negative hold within the cost column', field_name using errcode = '22023';
  end if;
  return raw;
end;
$$;

revoke execute on function public.custodian_provider_require_integer(jsonb, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.custodian_provider_require_positive_cost(jsonb, text)
  from public, anon, authenticated;
revoke execute on function public.custodian_provider_require_hold_cost(jsonb, text)
  from public, anon, authenticated;

create table if not exists public.agent_provider_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  run_id uuid not null,
  stage text not null,
  idempotency_key text not null,
  pricing_version text not null,
  model_name text not null,
  hold_tokens integer not null,
  hold_cost_usd numeric(12, 4) not null,
  actual_tokens integer,
  actual_cost_usd numeric(12, 4),
  usage_knowledge text not null,
  status text not null,
  failure_code text,
  in_flight_until timestamptz not null,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_provider_reservations_run_fk
    foreign key (owner_id, case_id, run_id)
    references public.agent_runs (owner_id, case_id, id) on delete cascade,
  constraint agent_provider_reservations_stage_ck check (stage = 'synthesize'),
  constraint agent_provider_reservations_key_ck check (
    btrim(idempotency_key) <> '' and char_length(idempotency_key) <= 300
  ),
  constraint agent_provider_reservations_pricing_ck check (
    btrim(pricing_version) <> '' and char_length(pricing_version) <= 200
  ),
  constraint agent_provider_reservations_model_ck check (
    model_name in ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-pro')
  ),
  constraint agent_provider_reservations_hold_ck check (
    hold_tokens >= 0 and hold_cost_usd >= 0 and (hold_tokens > 0 or hold_cost_usd > 0)
  ),
  constraint agent_provider_reservations_usage_state_ck check (
    (
      status = 'held'
      and usage_knowledge = 'unknown'
      and actual_tokens is null
      and actual_cost_usd is null
    )
    or (
      status = 'settled_known'
      and usage_knowledge = 'known'
      and actual_tokens is not null
      and actual_cost_usd is not null
      and actual_tokens >= 0
      and actual_cost_usd >= 0
    )
    or (
      status = 'released_uncontacted'
      and usage_knowledge = 'none'
      and actual_tokens is null
      and actual_cost_usd is null
    )
  ),
  constraint agent_provider_reservations_failure_ck check (
    failure_code is null or (
      btrim(failure_code) <> '' and char_length(failure_code) <= 200
    )
  ),
  constraint agent_provider_reservations_owner_run_key_unique
    unique (owner_id, run_id, idempotency_key)
);

create unique index if not exists agent_provider_reservations_one_held_idx
  on public.agent_provider_reservations (owner_id, run_id)
  where status = 'held';

create index if not exists agent_provider_reservations_owner_status_idx
  on public.agent_provider_reservations (owner_id, status, run_id);

drop trigger if exists agent_provider_reservations_set_updated_at
  on public.agent_provider_reservations;
create trigger agent_provider_reservations_set_updated_at
  before update on public.agent_provider_reservations
  for each row execute function public.set_updated_at();

alter table public.agent_provider_reservations enable row level security;
drop policy if exists agent_provider_reservations_select_own
  on public.agent_provider_reservations;
create policy agent_provider_reservations_select_own
  on public.agent_provider_reservations
  for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all privileges on public.agent_provider_reservations from public, anon, authenticated;
grant select on public.agent_provider_reservations to authenticated;

create or replace function public.custodian_build_readonly_analysis_snapshot(
  caller_id uuid,
  case_id_value uuid,
  objective_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.cases;
  scope jsonb;
  record_id_text text;
  record_row public.records;
  admitted jsonb := '[]'::jsonb;
  excluded jsonb := '[]'::jsonb;
  evidence_ids jsonb := '[]'::jsonb;
  snapshot jsonb;
  summary_value text;
  stripped jsonb;
  item jsonb;
  last_index integer;
  last_record jsonb;
  snapshot_limit integer := 80000;
  record_index integer;
begin
  select * into case_row
    from public.cases
   where owner_id = caller_id and id = case_id_value;
  if not found then
    raise exception 'case is not owned by the authenticated user' using errcode = 'P0002';
  end if;
  scope := case_row.archive_scope;

  for record_id_text in
    select value
      from pg_catalog.jsonb_array_elements_text(scope -> 'record_ids') as item(value)
  loop
    select * into record_row
      from public.records
     where user_id = caller_id and id = record_id_text::uuid;
    if not found then
      excluded := excluded || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('record_id', record_id_text, 'reason', 'unavailable')
      );
    else
      summary_value := pg_catalog.left(coalesce(record_row.summary, ''), 2000);
      admitted := admitted || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'record_id', record_row.id,
          'record_type', record_row.record_type,
          'title', record_row.title,
          'summary', summary_value,
          'summary_truncated', pg_catalog.char_length(coalesce(record_row.summary, '')) > 2000
        )
      );
    end if;
  end loop;

  select coalesce(pg_catalog.jsonb_agg(evidence.id order by evidence.id), '[]'::jsonb)
    into evidence_ids
    from public.evidence_items evidence
   where evidence.owner_id = caller_id
     and evidence.case_id = case_id_value
     and evidence.source_record_id is not null
     and exists (
       select 1
         from pg_catalog.jsonb_array_elements(admitted) admitted_row
        where admitted_row ->> 'record_id' = evidence.source_record_id::text
     );

  snapshot := pg_catalog.jsonb_build_object(
    'kind', 'readonly_analysis_snapshot',
    'case_id', case_id_value,
    'objective', objective_value,
    'case_question', case_row.current_question,
    'owner_context', scope ->> 'free_text_context',
    'admitted_records', admitted,
    'excluded_records', excluded,
    'citable_evidence_ids', evidence_ids,
    'truncated', false
  );

  if pg_catalog.char_length(snapshot::text) > snapshot_limit then
    stripped := '[]'::jsonb;
    for record_index in 0 .. pg_catalog.jsonb_array_length(admitted) - 1 loop
      item := admitted -> record_index;
      if coalesce(item ->> 'summary', '') <> '' then
        item := item || pg_catalog.jsonb_build_object('summary', '', 'summary_truncated', true);
      end if;
      stripped := stripped || pg_catalog.jsonb_build_array(item);
    end loop;
    admitted := stripped;
    snapshot := snapshot || pg_catalog.jsonb_build_object(
      'admitted_records', admitted,
      'truncated', true
    );
  end if;

  while pg_catalog.char_length(snapshot::text) > snapshot_limit
    and pg_catalog.jsonb_array_length(admitted) > 0
  loop
    last_index := pg_catalog.jsonb_array_length(admitted) - 1;
    last_record := admitted -> last_index;
    stripped := '[]'::jsonb;
    for record_index in 0 .. last_index - 1 loop
      stripped := stripped || pg_catalog.jsonb_build_array(admitted -> record_index);
    end loop;
    admitted := stripped;
    excluded := excluded || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'record_id', last_record ->> 'record_id',
        'reason', 'reading_limit'
      )
    );
    select coalesce(pg_catalog.jsonb_agg(evidence.id order by evidence.id), '[]'::jsonb)
      into evidence_ids
      from public.evidence_items evidence
     where evidence.owner_id = caller_id
       and evidence.case_id = case_id_value
       and evidence.source_record_id is not null
       and exists (
         select 1
           from pg_catalog.jsonb_array_elements(admitted) admitted_row
          where admitted_row ->> 'record_id' = evidence.source_record_id::text
       );
    snapshot := pg_catalog.jsonb_build_object(
      'kind', 'readonly_analysis_snapshot',
      'case_id', case_id_value,
      'objective', objective_value,
      'case_question', case_row.current_question,
      'owner_context', scope ->> 'free_text_context',
      'admitted_records', admitted,
      'excluded_records', excluded,
      'citable_evidence_ids', evidence_ids,
      'truncated', true
    );
  end loop;

  if pg_catalog.char_length(snapshot::text) > snapshot_limit then
    raise exception 'readonly analysis snapshot exceeds the runtime bound' using errcode = '22023';
  end if;
  return snapshot;
end;
$$;

revoke execute on function public.custodian_build_readonly_analysis_snapshot(uuid, uuid, text)
  from public, anon, authenticated;

drop function if exists public.custodian_ensure_readonly_analysis_policy(uuid, jsonb);
create or replace function public.custodian_ensure_readonly_analysis_policy(
  case_id_value uuid,
  policy_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(policy_payload, 'policy_payload');
  policy_row public.tool_policies;
  inserted_policy public.tool_policies;
  policy_name_value text;
  tiers text[];
  stored_tiers text[];
  per_run_tokens integer;
  per_run_cost numeric;
  per_run_latency integer;
  per_run_tools integer;
  daily_tokens integer;
  monthly_tokens integer;
  daily_cost numeric;
  monthly_cost numeric;
  tier_count integer;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  perform public.custodian_runtime_assert_case(caller_id, case_id_value);
  if exists (
    select 1
      from pg_catalog.jsonb_object_keys(payload) as keys(key)
     where keys.key not in (
       'policy_name', 'allowed_model_tiers', 'per_run_token_budget', 'per_run_cost_usd',
       'per_run_latency_ms', 'per_run_tool_event_budget', 'daily_token_budget',
       'monthly_token_budget', 'daily_cost_usd', 'monthly_cost_usd'
     )
  ) then
    raise exception 'readonly analysis policy accepts only explicit ceilings and model tiers'
      using errcode = '22023';
  end if;

  policy_name_value := public.custodian_require_text(payload ->> 'policy_name', 'policy_name', 300);
  if pg_catalog.jsonb_typeof(payload -> 'allowed_model_tiers') is distinct from 'array' then
    raise exception 'allowed_model_tiers is required' using errcode = '22023';
  end if;
  select coalesce(array_agg(tier order by tier), '{}'::text[]), count(*)
    into tiers, tier_count
    from (
      select distinct value as tier
        from pg_catalog.jsonb_array_elements_text(payload -> 'allowed_model_tiers') as element(value)
    ) distinct_tiers;
  if tier_count < 1 or tier_count > 4 or tiers is null then
    raise exception 'allowed_model_tiers must name one to four tiers' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(tiers) as tier(value)
     where tier.value not in ('luna', 'terra', 'sol', 'pro')
  ) then
    raise exception 'allowed_model_tiers must stay inside the source model list' using errcode = '22023';
  end if;

  per_run_tokens := public.custodian_provider_require_integer(payload, 'per_run_token_budget', 1, 10000000);
  per_run_cost := public.custodian_provider_require_positive_cost(payload, 'per_run_cost_usd');
  per_run_latency := public.custodian_provider_require_integer(payload, 'per_run_latency_ms', 1000, 3600000);
  per_run_tools := public.custodian_provider_require_integer(payload, 'per_run_tool_event_budget', 1, 10000);
  daily_tokens := public.custodian_provider_require_integer(payload, 'daily_token_budget', 1, 100000000);
  monthly_tokens := public.custodian_provider_require_integer(payload, 'monthly_token_budget', 1, 1000000000);
  daily_cost := public.custodian_provider_require_positive_cost(payload, 'daily_cost_usd');
  monthly_cost := public.custodian_provider_require_positive_cost(payload, 'monthly_cost_usd');

  select * into policy_row
    from public.tool_policies
   where owner_id = caller_id
     and tool_policies.case_id = case_id_value
     and policy_name = policy_name_value
   for update;
  if found then
    stored_tiers := array(select unnest(policy_row.allowed_model_tiers) order by 1);
    if policy_row.status = 'active'
       and policy_row.lifecycle_status = 'active'
       and not policy_row.kill_switch
       and policy_row.allowed_tools = '{}'::text[]
       and stored_tiers = tiers
       and policy_row.per_run_token_budget = per_run_tokens
       and policy_row.per_run_cost_usd = per_run_cost
       and policy_row.per_run_latency_ms = per_run_latency
       and policy_row.per_run_tool_event_budget = per_run_tools
       and policy_row.daily_token_budget = daily_tokens
       and policy_row.monthly_token_budget = monthly_tokens
       and policy_row.daily_cost_usd = daily_cost
       and policy_row.monthly_cost_usd = monthly_cost then
      return pg_catalog.jsonb_build_object('policy', to_jsonb(policy_row), 'idempotent', true);
    end if;
    raise exception 'readonly analysis policy already exists with different explicit parameters'
      using errcode = '23505';
  end if;

  insert into public.tool_policies (
    owner_id, case_id, policy_name, status, allowed_model_tiers, allowed_tools,
    per_run_token_budget, daily_token_budget, monthly_token_budget,
    per_run_cost_usd, daily_cost_usd, monthly_cost_usd,
    per_run_latency_ms, per_run_tool_event_budget, kill_switch,
    external_writes_require_approval, provenance, lifecycle_status,
    created_by, updated_by
  ) values (
    caller_id, case_id_value, policy_name_value, 'active', tiers, '{}'::text[],
    per_run_tokens, daily_tokens, monthly_tokens,
    per_run_cost, daily_cost, monthly_cost,
    per_run_latency, per_run_tools, false,
    true, pg_catalog.jsonb_build_object('source', 'custodian_ensure_readonly_analysis_policy'), 'active',
    caller_id, caller_id
  ) returning * into inserted_policy;

  perform public.custodian_runtime_write_audit(
    caller_id, case_id_value, null, 'created', 'ensure_readonly_analysis_policy',
    'tool_policy', inserted_policy.id,
    pg_catalog.jsonb_build_object('allowed_model_tiers', to_jsonb(tiers))
  );
  return pg_catalog.jsonb_build_object('policy', to_jsonb(inserted_policy), 'idempotent', false);
end;
$$;

revoke execute on function public.custodian_ensure_readonly_analysis_policy(uuid, jsonb)
  from public, anon;
grant execute on function public.custodian_ensure_readonly_analysis_policy(uuid, jsonb)
  to authenticated;

drop function if exists public.custodian_create_readonly_analysis_run(uuid, text, jsonb);
create or replace function public.custodian_create_readonly_analysis_run(
  case_id_value uuid,
  idempotency_key text,
  run_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(run_payload, 'run_payload');
  policy_row public.tool_policies;
  policy_id uuid;
  model_value text;
  prompt_value text;
  objective_value text;
  snapshot jsonb;
  evidence_count integer;
  record_count integer;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  perform public.custodian_runtime_assert_case(caller_id, case_id_value);
  if exists (
    select 1
      from pg_catalog.jsonb_object_keys(payload) as keys(key)
     where keys.key not in ('model_tier', 'prompt_version', 'objective', 'tool_policy_id')
  ) then
    raise exception 'readonly analysis run accepts only model_tier, prompt_version, objective, and tool_policy_id'
      using errcode = '22023';
  end if;

  policy_id := public.custodian_runtime_uuid(payload ->> 'tool_policy_id', 'tool_policy_id');
  if policy_id is null then
    raise exception 'tool_policy_id is required' using errcode = '22023';
  end if;
  model_value := public.custodian_require_text(payload ->> 'model_tier', 'model_tier', 20);
  prompt_value := public.custodian_require_text(payload ->> 'prompt_version', 'prompt_version', 200);
  objective_value := public.custodian_require_text(payload ->> 'objective', 'objective', 20000);
  if model_value not in ('luna', 'terra', 'sol', 'pro') then
    raise exception 'model_tier is not allowed' using errcode = '22023';
  end if;

  select * into policy_row
    from public.tool_policies
   where owner_id = caller_id
     and id = policy_id
     and tool_policies.case_id = case_id_value
   for update;
  if not found
     or policy_row.status <> 'active'
     or policy_row.lifecycle_status <> 'active'
     or policy_row.kill_switch then
    raise exception 'readonly analysis policy is not active for this case' using errcode = '42501';
  end if;
  if policy_row.allowed_tools <> '{}'::text[] then
    raise exception 'readonly analysis requires an empty tool allowlist' using errcode = '42501';
  end if;
  if policy_row.daily_cost_usd is null or policy_row.monthly_cost_usd is null then
    raise exception 'readonly analysis requires explicit daily and monthly cost ceilings'
      using errcode = '42501';
  end if;
  if not (model_value = any(policy_row.allowed_model_tiers)) then
    raise exception 'model tier is not permitted by the selected owner policy' using errcode = '42501';
  end if;

  select count(*) into evidence_count from public.evidence_items where owner_id = caller_id;
  select count(*) into record_count from public.records where user_id = caller_id;
  snapshot := public.custodian_build_readonly_analysis_snapshot(caller_id, case_id_value, objective_value);
  if (select count(*) from public.evidence_items where owner_id = caller_id) <> evidence_count
     or (select count(*) from public.records where user_id = caller_id) <> record_count then
    raise exception 'readonly analysis snapshot mutated archive or evidence rows' using errcode = '42501';
  end if;

  return public.custodian_create_agent_run(
    pg_catalog.jsonb_build_object(
      'case_id', case_id_value,
      'tool_policy_id', policy_id,
      'objective', objective_value,
      'model_tier', model_value,
      'prompt_version', prompt_value,
      'input_snapshot', snapshot,
      'tool_allowlist', '[]'::jsonb,
      'agent_config', '{}'::jsonb,
      'agent_graph', '{}'::jsonb
    ),
    idempotency_key
  );
end;
$$;

revoke execute on function public.custodian_create_readonly_analysis_run(uuid, text, jsonb)
  from public, anon;
grant execute on function public.custodian_create_readonly_analysis_run(uuid, text, jsonb)
  to authenticated;

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
  daily_hold_tokens numeric := 0;
  monthly_hold_tokens numeric := 0;
  daily_hold_cost numeric := 0;
  monthly_hold_cost numeric := 0;
  hold_tokens integer := 0;
  hold_cost numeric := 0;
  allowed_value boolean := true;
  reason_value text := 'allowed';
  daily_token_remaining numeric;
  monthly_token_remaining numeric;
  daily_cost_remaining numeric;
  monthly_cost_remaining numeric;
begin
  select * into run_row
    from public.agent_runs
   where agent_runs.owner_id = caller_id and agent_runs.id = custodian_run_budget_status.run_id;
  if not found then
    raise exception 'agent run not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(h.hold_tokens), 0)::integer, coalesce(sum(h.hold_cost_usd), 0)
    into hold_tokens, hold_cost
    from public.agent_provider_reservations h
   where h.owner_id = caller_id
     and h.run_id = run_row.id
     and h.status = 'held';

  if run_row.cancel_requested_at is not null then
    allowed_value := false;
    reason_value := 'cancel_requested';
  elsif public.custodian_runtime_is_terminal(run_row.status) then
    allowed_value := false;
    reason_value := run_row.status;
  end if;

  select * into policy_row
    from public.tool_policies
   where owner_id = caller_id and id = run_row.tool_policy_id;
  if not found or policy_row.lifecycle_status is distinct from 'active' then
    allowed_value := false;
    if reason_value = 'allowed' then
      reason_value := 'policy_unavailable';
    end if;
  elsif policy_row.status <> 'active' or policy_row.kill_switch then
    allowed_value := false;
    if reason_value = 'allowed' then
      reason_value := 'policy_kill_switch';
    end if;
  end if;

  select coalesce(sum(r.tokens_used), 0), coalesce(sum(r.cost_usd), 0)
    into daily_tokens, daily_cost
    from public.agent_runs r
   where r.owner_id = caller_id
     and r.created_at >= pg_catalog.date_trunc('day', pg_catalog.now());
  select coalesce(sum(h.hold_tokens), 0), coalesce(sum(h.hold_cost_usd), 0)
    into daily_hold_tokens, daily_hold_cost
    from public.agent_provider_reservations h
    join public.agent_runs r
      on r.owner_id = h.owner_id and r.id = h.run_id
   where h.owner_id = caller_id
     and h.status = 'held'
     and r.created_at >= pg_catalog.date_trunc('day', pg_catalog.now());
  daily_tokens := daily_tokens + daily_hold_tokens;
  daily_cost := daily_cost + daily_hold_cost;

  select coalesce(sum(r.tokens_used), 0), coalesce(sum(r.cost_usd), 0)
    into monthly_tokens, monthly_cost
    from public.agent_runs r
   where r.owner_id = caller_id
     and r.created_at >= pg_catalog.date_trunc('month', pg_catalog.now());
  select coalesce(sum(h.hold_tokens), 0), coalesce(sum(h.hold_cost_usd), 0)
    into monthly_hold_tokens, monthly_hold_cost
    from public.agent_provider_reservations h
    join public.agent_runs r
      on r.owner_id = h.owner_id and r.id = h.run_id
   where h.owner_id = caller_id
     and h.status = 'held'
     and r.created_at >= pg_catalog.date_trunc('month', pg_catalog.now());
  monthly_tokens := monthly_tokens + monthly_hold_tokens;
  monthly_cost := monthly_cost + monthly_hold_cost;

  if run_row.tokens_used + hold_tokens >= run_row.budget_tokens and allowed_value then
    allowed_value := false;
    reason_value := 'per_run_tokens';
  elsif run_row.cost_usd + hold_cost >= run_row.budget_cost_usd and allowed_value then
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
    daily_token_remaining := case
      when policy_row.daily_token_budget is null then null
      else greatest(policy_row.daily_token_budget - daily_tokens, 0)
    end;
    monthly_token_remaining := case
      when policy_row.monthly_token_budget is null then null
      else greatest(policy_row.monthly_token_budget - monthly_tokens, 0)
    end;
    daily_cost_remaining := case
      when policy_row.daily_cost_usd is null then null
      else greatest(policy_row.daily_cost_usd - daily_cost, 0)
    end;
    monthly_cost_remaining := case
      when policy_row.monthly_cost_usd is null then null
      else greatest(policy_row.monthly_cost_usd - monthly_cost, 0)
    end;
    if policy_row.daily_token_budget is not null
       and daily_tokens >= policy_row.daily_token_budget
       and allowed_value then
      allowed_value := false;
      reason_value := 'daily_tokens';
    elsif policy_row.monthly_token_budget is not null
       and monthly_tokens >= policy_row.monthly_token_budget
       and allowed_value then
      allowed_value := false;
      reason_value := 'monthly_tokens';
    elsif policy_row.daily_cost_usd is not null
       and daily_cost >= policy_row.daily_cost_usd
       and allowed_value then
      allowed_value := false;
      reason_value := 'daily_cost';
    elsif policy_row.monthly_cost_usd is not null
       and monthly_cost >= policy_row.monthly_cost_usd
       and allowed_value then
      allowed_value := false;
      reason_value := 'monthly_cost';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'allowed', allowed_value,
    'reason', reason_value,
    'run_tokens_remaining', greatest(run_row.budget_tokens - run_row.tokens_used - hold_tokens, 0),
    'run_cost_remaining', greatest(run_row.budget_cost_usd - run_row.cost_usd - hold_cost, 0),
    'run_latency_remaining', greatest(run_row.budget_latency_ms - run_row.latency_ms, 0),
    'run_tool_events_remaining', greatest(run_row.budget_tool_events - run_row.tool_events_count, 0),
    'run_hold_tokens', hold_tokens,
    'run_hold_cost_usd', hold_cost,
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

drop function if exists public.custodian_reserve_provider_call(uuid, text, jsonb);
create or replace function public.custodian_reserve_provider_call(
  run_id_value uuid,
  idempotency_key text,
  reservation_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(reservation_payload, 'reservation_payload');
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  target_run uuid := run_id_value;
  run_row public.agent_runs;
  policy_row public.tool_policies;
  existing_reservation public.agent_provider_reservations;
  inserted_reservation public.agent_provider_reservations;
  model_tier_value text;
  model_name_value text;
  pricing_value text;
  hold_tokens integer;
  hold_cost numeric;
  existing_hold_tokens integer := 0;
  existing_hold_cost numeric := 0;
  daily_tokens numeric := 0;
  monthly_tokens numeric := 0;
  daily_cost numeric := 0;
  monthly_cost numeric := 0;
  daily_hold_tokens numeric := 0;
  monthly_hold_tokens numeric := 0;
  daily_hold_cost numeric := 0;
  monthly_hold_cost numeric := 0;
  projected_tokens numeric;
  projected_cost numeric;
  projected_daily_tokens numeric;
  projected_monthly_tokens numeric;
  projected_daily_cost numeric;
  projected_monthly_cost numeric;
  denial_reason text;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  if exists (
    select 1
      from pg_catalog.jsonb_object_keys(payload) as keys(key)
     where keys.key not in (
       'stage', 'pricing_version', 'model_name', 'model_tier', 'hold_tokens', 'hold_cost_usd'
     )
  ) then
    raise exception 'provider reservation accepts only stage, pricing, model, and hold fields'
      using errcode = '22023';
  end if;
  if payload ->> 'stage' is distinct from 'synthesize' then
    raise exception 'provider reservation stage must be synthesize' using errcode = '22023';
  end if;
  pricing_value := public.custodian_require_text(payload ->> 'pricing_version', 'pricing_version', 200);
  model_name_value := public.custodian_require_text(payload ->> 'model_name', 'model_name', 100);
  model_tier_value := public.custodian_require_text(payload ->> 'model_tier', 'model_tier', 20);
  hold_tokens := public.custodian_provider_require_integer(payload, 'hold_tokens', 0, 10000000);
  hold_cost := public.custodian_provider_require_hold_cost(payload, 'hold_cost_usd');
  if hold_tokens = 0 and hold_cost = 0 then
    raise exception 'provider hold must encumber tokens or cost' using errcode = '22023';
  end if;
  if model_tier_value not in ('luna', 'terra', 'sol', 'pro')
     or (model_tier_value = 'luna' and model_name_value <> 'gpt-5.6-luna')
     or (model_tier_value = 'terra' and model_name_value <> 'gpt-5.6-terra')
     or (model_tier_value = 'sol' and model_name_value <> 'gpt-5.6-sol')
     or (model_tier_value = 'pro' and model_name_value <> 'gpt-5.6-pro') then
    raise exception 'provider reservation model does not match the source allowlist'
      using errcode = '22023';
  end if;

  select * into run_row
    from public.agent_runs
   where owner_id = caller_id and id = target_run
   for update;
  if not found then
    raise exception 'agent run not found' using errcode = 'P0002';
  end if;
  if model_tier_value <> run_row.model_tier then
    raise exception 'reservation model tier must match the run' using errcode = '42501';
  end if;

  select * into existing_reservation
    from public.agent_provider_reservations h
   where h.owner_id = caller_id
     and h.run_id = run_row.id
     and h.idempotency_key = request_key
   for update;
  if found then
    return pg_catalog.jsonb_build_object(
      'reserved', false,
      'replay', true,
      'reason', case
        when existing_reservation.status = 'held'
         and existing_reservation.in_flight_until > pg_catalog.now() then 'provider_attempt_in_progress'
        when existing_reservation.status = 'held' then 'provider_hold_unsettled'
        else 'replay'
      end,
      'reservation', to_jsonb(existing_reservation)
    );
  end if;

  select * into existing_reservation
    from public.agent_provider_reservations h
   where h.owner_id = caller_id
     and h.run_id = run_row.id
     and h.status = 'held'
   for update;
  if found then
    return pg_catalog.jsonb_build_object(
      'reserved', false,
      'replay', false,
      'reason', case
        when existing_reservation.in_flight_until > pg_catalog.now() then 'provider_attempt_in_progress'
        else 'provider_hold_unsettled'
      end,
      'reservation', to_jsonb(existing_reservation)
    );
  end if;

  if run_row.cancel_requested_at is not null then
    return pg_catalog.jsonb_build_object(
      'reserved', false, 'replay', false, 'reason', 'cancel_requested', 'reservation', null
    );
  end if;
  if run_row.status <> 'synthesizing' then
    return pg_catalog.jsonb_build_object(
      'reserved', false, 'replay', false, 'reason', 'run_not_synthesizing', 'reservation', null
    );
  end if;

  select * into policy_row
    from public.tool_policies
   where owner_id = caller_id
     and id = run_row.tool_policy_id
     and case_id = run_row.case_id
   for update;
  if not found
     or policy_row.status <> 'active'
     or policy_row.lifecycle_status <> 'active'
     or policy_row.kill_switch then
    return pg_catalog.jsonb_build_object(
      'reserved', false, 'replay', false, 'reason', 'policy_unavailable', 'reservation', null
    );
  end if;
  if not (model_tier_value = any(policy_row.allowed_model_tiers)) then
    return pg_catalog.jsonb_build_object(
      'reserved', false, 'replay', false, 'reason', 'model_tier_not_allowed', 'reservation', null
    );
  end if;
  if policy_row.daily_cost_usd is null or policy_row.monthly_cost_usd is null then
    return pg_catalog.jsonb_build_object(
      'reserved', false, 'replay', false, 'reason', 'aggregate_cost_ceiling_required', 'reservation', null
    );
  end if;

  select coalesce(sum(h.hold_tokens), 0)::integer, coalesce(sum(h.hold_cost_usd), 0)
    into existing_hold_tokens, existing_hold_cost
    from public.agent_provider_reservations h
   where h.owner_id = caller_id and h.run_id = run_row.id and h.status = 'held';

  select coalesce(sum(r.tokens_used), 0), coalesce(sum(r.cost_usd), 0)
    into daily_tokens, daily_cost
    from public.agent_runs r
   where r.owner_id = caller_id
     and r.created_at >= pg_catalog.date_trunc('day', pg_catalog.now());
  select coalesce(sum(h.hold_tokens), 0), coalesce(sum(h.hold_cost_usd), 0)
    into daily_hold_tokens, daily_hold_cost
    from public.agent_provider_reservations h
    join public.agent_runs r on r.owner_id = h.owner_id and r.id = h.run_id
   where h.owner_id = caller_id
     and h.status = 'held'
     and r.created_at >= pg_catalog.date_trunc('day', pg_catalog.now());

  select coalesce(sum(r.tokens_used), 0), coalesce(sum(r.cost_usd), 0)
    into monthly_tokens, monthly_cost
    from public.agent_runs r
   where r.owner_id = caller_id
     and r.created_at >= pg_catalog.date_trunc('month', pg_catalog.now());
  select coalesce(sum(h.hold_tokens), 0), coalesce(sum(h.hold_cost_usd), 0)
    into monthly_hold_tokens, monthly_hold_cost
    from public.agent_provider_reservations h
    join public.agent_runs r on r.owner_id = h.owner_id and r.id = h.run_id
   where h.owner_id = caller_id
     and h.status = 'held'
     and r.created_at >= pg_catalog.date_trunc('month', pg_catalog.now());

  projected_tokens := run_row.tokens_used + existing_hold_tokens + hold_tokens;
  projected_cost := run_row.cost_usd + existing_hold_cost + hold_cost;
  projected_daily_tokens := daily_tokens + daily_hold_tokens;
  projected_daily_cost := daily_cost + daily_hold_cost;
  projected_monthly_tokens := monthly_tokens + monthly_hold_tokens;
  projected_monthly_cost := monthly_cost + monthly_hold_cost;
  if run_row.created_at >= pg_catalog.date_trunc('day', pg_catalog.now()) then
    projected_daily_tokens := projected_daily_tokens + hold_tokens;
    projected_daily_cost := projected_daily_cost + hold_cost;
  end if;
  if run_row.created_at >= pg_catalog.date_trunc('month', pg_catalog.now()) then
    projected_monthly_tokens := projected_monthly_tokens + hold_tokens;
    projected_monthly_cost := projected_monthly_cost + hold_cost;
  end if;

  denial_reason := null;
  if projected_tokens > run_row.budget_tokens then
    denial_reason := 'per_run_tokens';
  elsif projected_cost > run_row.budget_cost_usd then
    denial_reason := 'per_run_cost';
  elsif policy_row.daily_token_budget is not null
     and projected_daily_tokens > policy_row.daily_token_budget then
    denial_reason := 'daily_tokens';
  elsif policy_row.monthly_token_budget is not null
     and projected_monthly_tokens > policy_row.monthly_token_budget then
    denial_reason := 'monthly_tokens';
  elsif projected_daily_cost > policy_row.daily_cost_usd then
    denial_reason := 'daily_cost';
  elsif projected_monthly_cost > policy_row.monthly_cost_usd then
    denial_reason := 'monthly_cost';
  end if;
  if denial_reason is not null then
    return pg_catalog.jsonb_build_object(
      'reserved', false, 'replay', false, 'reason', denial_reason, 'reservation', null
    );
  end if;

  insert into public.agent_provider_reservations (
    owner_id, case_id, run_id, stage, idempotency_key, pricing_version, model_name,
    hold_tokens, hold_cost_usd, actual_tokens, actual_cost_usd, usage_knowledge, status,
    in_flight_until, created_by, updated_by
  ) values (
    caller_id, run_row.case_id, run_row.id, 'synthesize', request_key, pricing_value, model_name_value,
    hold_tokens, hold_cost, null, null, 'unknown', 'held',
    pg_catalog.now() + interval '90 seconds', caller_id, caller_id
  ) returning * into inserted_reservation;

  perform public.custodian_runtime_write_audit(
    caller_id, run_row.case_id, run_row.id, 'created', 'reserve_provider_call',
    'agent_provider_reservation', inserted_reservation.id,
    pg_catalog.jsonb_build_object(
      'usage_knowledge', 'unknown',
      'hold_tokens', hold_tokens,
      'hold_cost_usd', hold_cost
    )
  );
  return pg_catalog.jsonb_build_object(
    'reserved', true,
    'replay', false,
    'reason', 'reserved',
    'reservation', to_jsonb(inserted_reservation)
  );
end;
$$;

revoke execute on function public.custodian_reserve_provider_call(uuid, text, jsonb)
  from public, anon;
grant execute on function public.custodian_reserve_provider_call(uuid, text, jsonb)
  to authenticated;

drop function if exists public.custodian_settle_provider_reservation(uuid, text, jsonb);
create or replace function public.custodian_settle_provider_reservation(
  run_id_value uuid,
  idempotency_key text,
  settlement jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(settlement, 'settlement');
  request_key text := public.custodian_runtime_require_idempotency(idempotency_key);
  target_run uuid := run_id_value;
  run_row public.agent_runs;
  reservation public.agent_provider_reservations;
  knowledge text;
  parsed_tokens integer;
  parsed_cost numeric;
  step_status text;
  input_payload jsonb;
  output_payload jsonb;
  latency_value integer;
  failure_code_value text;
  failure_message_value text;
  record_failure boolean;
  step_count_before integer;
  step_count_after integer;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  knowledge := payload ->> 'usage_knowledge';
  if knowledge not in ('known', 'unknown', 'none') then
    raise exception 'usage_knowledge must be known, unknown, or none' using errcode = '22023';
  end if;

  select * into run_row
    from public.agent_runs
   where owner_id = caller_id and id = target_run
   for update;
  if not found then
    raise exception 'agent run not found' using errcode = 'P0002';
  end if;
  select * into reservation
    from public.agent_provider_reservations h
   where h.owner_id = caller_id
     and h.run_id = run_row.id
     and h.idempotency_key = request_key
   for update;
  if not found then
    raise exception 'provider reservation not found' using errcode = 'P0002';
  end if;

  if reservation.status = 'settled_known' then
    if knowledge <> 'known' then
      raise exception 'settled provider usage cannot be rewritten' using errcode = '23505';
    end if;
    parsed_tokens := public.custodian_provider_require_integer(payload, 'actual_tokens', 0, 10000000);
    parsed_cost := public.custodian_provider_require_hold_cost(payload, 'actual_cost_usd');
    if reservation.actual_tokens is distinct from parsed_tokens
       or reservation.actual_cost_usd is distinct from parsed_cost then
      raise exception 'known provider usage conflicts with the settled reservation' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'reservation', to_jsonb(reservation),
      'run', to_jsonb(run_row),
      'idempotent', true,
      'usage_knowledge', 'known'
    );
  end if;
  if reservation.status = 'released_uncontacted' then
    if knowledge <> 'none' then
      raise exception 'a released provider hold cannot be settled' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'reservation', to_jsonb(reservation),
      'run', to_jsonb(run_row),
      'idempotent', true,
      'usage_knowledge', 'none'
    );
  end if;

  if knowledge = 'none' then
    if payload ? 'actual_tokens' or payload ? 'actual_cost_usd' then
      raise exception 'an uncontacted release cannot include actual usage' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.agent_steps s
       where s.owner_id = caller_id
         and s.run_id = run_row.id
         and s.idempotency_key = request_key
    ) then
      raise exception 'a provider hold with a recorded step cannot be released as uncontacted'
        using errcode = '42501';
    end if;
    update public.agent_provider_reservations
       set status = 'released_uncontacted',
           usage_knowledge = 'none',
           actual_tokens = null,
           actual_cost_usd = null,
           failure_code = null,
           updated_by = caller_id
     where id = reservation.id
     returning * into reservation;
    return pg_catalog.jsonb_build_object(
      'reservation', to_jsonb(reservation),
      'run', to_jsonb(run_row),
      'idempotent', false,
      'usage_knowledge', 'none'
    );
  end if;

  if knowledge = 'unknown' then
    if payload ? 'actual_tokens' or payload ? 'actual_cost_usd' then
      raise exception 'unknown provider usage cannot include actual tokens or cost' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(payload -> 'record_failure_step') is distinct from 'boolean' then
      raise exception 'record_failure_step is required' using errcode = '22023';
    end if;
    record_failure := (payload ->> 'record_failure_step')::boolean;
    failure_code_value := nullif(pg_catalog.btrim(payload ->> 'failure_code'), '');
    failure_message_value := nullif(pg_catalog.btrim(payload ->> 'failure_message'), '');
    if failure_code_value is not null and pg_catalog.char_length(failure_code_value) > 200 then
      raise exception 'failure_code must be at most 200 characters' using errcode = '22023';
    end if;
    if failure_message_value is not null and pg_catalog.char_length(failure_message_value) > 5000 then
      raise exception 'failure_message must be at most 5000 characters' using errcode = '22023';
    end if;
    update public.agent_provider_reservations
       set failure_code = coalesce(failure_code_value, failure_code),
           updated_by = caller_id
     where agent_provider_reservations.id = reservation.id
       and agent_provider_reservations.status = 'held'
       and agent_provider_reservations.actual_tokens is null
       and agent_provider_reservations.actual_cost_usd is null
     returning * into reservation;
    if record_failure then
      if run_row.status <> 'synthesizing' then
        raise exception 'unknown provider usage can record a step only while synthesizing'
          using errcode = '42501';
      end if;
      select count(*) into step_count_before
        from public.agent_steps s
       where s.owner_id = caller_id and s.run_id = run_row.id and s.idempotency_key = request_key;
      perform public.custodian_record_agent_step(
        run_row.id,
        pg_catalog.jsonb_build_object(
          'sequence_no', run_row.last_step_number + 1,
          'step_kind', 'synthesize',
          'status', 'failed',
          'model_tier', run_row.model_tier,
          'prompt_version', run_row.prompt_version,
          'input_payload', '{}'::jsonb,
          'output_payload', pg_catalog.jsonb_build_object(
            'usage_knowledge', 'unknown',
            'errorCode', coalesce(failure_code_value, 'provider_usage_unknown'),
            'hold_tokens', reservation.hold_tokens,
            'hold_cost_usd', reservation.hold_cost_usd
          ),
          'tokens_used', 0,
          'cost_usd', 0,
          'latency_ms', 0,
          'pricing_version', reservation.pricing_version,
          'provenance', pg_catalog.jsonb_build_object(
            'runtime', 'custodian-provider-hold',
            'usage_knowledge', 'unknown'
          )
        ),
        request_key
      );
      select count(*) into step_count_after
        from public.agent_steps s
       where s.owner_id = caller_id and s.run_id = run_row.id and s.idempotency_key = request_key;
    end if;
    select * into run_row from public.agent_runs where owner_id = caller_id and id = target_run;
    select * into reservation from public.agent_provider_reservations where id = reservation.id;
    return pg_catalog.jsonb_build_object(
      'reservation', to_jsonb(reservation),
      'run', to_jsonb(run_row),
      'idempotent', record_failure and step_count_before = step_count_after,
      'usage_knowledge', 'unknown'
    );
  end if;

  parsed_tokens := public.custodian_provider_require_integer(payload, 'actual_tokens', 0, 10000000);
  parsed_cost := public.custodian_provider_require_hold_cost(payload, 'actual_cost_usd');
  if parsed_cost > 0 and pg_catalog.btrim(reservation.pricing_version) = '' then
    raise exception 'pricing_version is required when actual cost is positive' using errcode = '22023';
  end if;
  step_status := payload ->> 'step_status';
  if step_status not in ('completed', 'failed') then
    raise exception 'step_status must be completed or failed' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(payload -> 'input_payload') is distinct from 'object'
     or pg_catalog.jsonb_typeof(payload -> 'output_payload') is distinct from 'object' then
    raise exception 'known provider usage requires input_payload and output_payload objects'
      using errcode = '22023';
  end if;
  input_payload := payload -> 'input_payload';
  output_payload := payload -> 'output_payload';
  latency_value := public.custodian_provider_require_integer(payload, 'latency_ms', 0, 3600000);
  if run_row.status <> 'synthesizing' then
    raise exception 'known provider usage can be settled only while synthesizing' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.agent_steps s
     where s.owner_id = caller_id
       and s.run_id = run_row.id
       and s.idempotency_key = request_key
       and (s.tokens_used is distinct from parsed_tokens or s.cost_usd is distinct from parsed_cost)
  ) then
    raise exception 'known provider usage conflicts with the recorded step' using errcode = '23505';
  end if;

  perform pg_catalog.set_config('custodian.trusted_runtime', 'true', true);
  perform public.custodian_record_agent_step(
    run_row.id,
    pg_catalog.jsonb_build_object(
      'sequence_no', run_row.last_step_number + 1,
      'step_kind', 'synthesize',
      'status', step_status,
      'model_tier', run_row.model_tier,
      'prompt_version', run_row.prompt_version,
      'input_payload', input_payload,
      'output_payload', output_payload,
      'tokens_used', parsed_tokens,
      'cost_usd', parsed_cost,
      'latency_ms', latency_value,
      'pricing_version', reservation.pricing_version,
      'provenance', pg_catalog.jsonb_build_object(
        'runtime', 'custodian-provider-hold',
        'usage_knowledge', 'known'
      )
    ),
    request_key
  );
  perform pg_catalog.set_config('custodian.trusted_runtime', '', true);
  update public.agent_provider_reservations
     set status = 'settled_known',
         usage_knowledge = 'known',
         actual_tokens = parsed_tokens,
         actual_cost_usd = parsed_cost,
         updated_by = caller_id
   where id = reservation.id
   returning * into reservation;
  select * into run_row from public.agent_runs where owner_id = caller_id and id = target_run;
  perform public.custodian_runtime_write_audit(
    caller_id, run_row.case_id, run_row.id, 'updated', 'settle_provider_reservation',
    'agent_provider_reservation', reservation.id,
    pg_catalog.jsonb_build_object(
      'usage_knowledge', 'known',
      'actual_tokens', parsed_tokens,
      'actual_cost_usd', parsed_cost
    )
  );
  return pg_catalog.jsonb_build_object(
    'reservation', to_jsonb(reservation),
    'run', to_jsonb(run_row),
    'idempotent', false,
    'usage_knowledge', 'known'
  );
end;
$$;

revoke execute on function public.custodian_settle_provider_reservation(uuid, text, jsonb)
  from public, anon;
grant execute on function public.custodian_settle_provider_reservation(uuid, text, jsonb)
  to authenticated;

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
  held_reservation public.agent_provider_reservations;
  already_requested boolean;
begin
  perform public.custodian_lock(caller_id);
  select * into run_row
    from public.agent_runs
   where agent_runs.owner_id = caller_id and agent_runs.id = custodian_request_cancel_agent_run.run_id
   for update;
  if not found then raise exception 'agent run not found' using errcode = 'P0002'; end if;
  if run_row.last_idempotency_key = request_key and run_row.status = 'cancelled' then
    return pg_catalog.jsonb_build_object('run', to_jsonb(run_row), 'idempotent', true);
  end if;
  if public.custodian_runtime_is_terminal(run_row.status) then
    return pg_catalog.jsonb_build_object('run', to_jsonb(run_row), 'idempotent', false);
  end if;

  select * into held_reservation
    from public.agent_provider_reservations h
   where h.owner_id = caller_id
     and h.run_id = run_row.id
     and h.status = 'held'
     and h.in_flight_until > pg_catalog.now()
   for update;
  if found then
    already_requested := run_row.cancel_requested_at is not null;
    update public.agent_runs
       set cancel_requested_at = coalesce(cancel_requested_at, pg_catalog.now()),
           cancel_requested_by = caller_id,
           updated_by = caller_id
     where owner_id = caller_id and id = run_row.id
     returning * into run_row;
    return pg_catalog.jsonb_build_object(
      'run', to_jsonb(run_row),
      'cancellation', 'deferred_in_flight_hold',
      'idempotent', already_requested
    );
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
   where owner_id = caller_id
     and approval_requests.case_id = run_row.case_id
     and approval_requests.run_id = run_row.id
     and status = 'pending';
  return public.custodian_transition_agent_run(
    run_row.id, run_row.status, 'cancelled', request_key,
    pg_catalog.jsonb_build_object(
      'failure_code', 'cancelled',
      'failure_message', 'The owner requested cancellation.'
    )
  );
end;
$$;
