-- Central OpenAI model catalog for the Custodian, and BYOK model choice.
--
-- The owner may choose one of six OpenAI model IDs. Each ID maps to a policy
-- TIER, which stays the identity used by tool policies, runs and steps
-- (their CHECK constraints are unchanged). The exact model NAME is what the
-- provider reservation records, so attribution stays exact:
--
--   gpt-5.6-luna, gpt-6-luna  -> luna   (efficient / lower cost)
--   gpt-5.6-terra             -> terra
--   gpt-5.6-sol,  gpt-6-sol   -> sol    (balanced / strong)
--   gpt-6-astra               -> pro    (highest capability)
--
-- Update this list in ONE place per layer: supabase/functions/_shared/
-- openai-models.ts (Edge), src/lib/openai-models.ts (browser), and
-- custodian_openai_model_tier() below. A Bun test asserts the first two agree
-- and a pgTAP test asserts the SQL list agrees with the Edge list.
--
-- Historical rows may carry model_name = 'gpt-5.6-pro'; the table CHECK keeps
-- accepting it, but no new reservation can use it.

create or replace function public.custodian_openai_model_tier(model_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case model_name
    when 'gpt-5.6-luna' then 'luna'
    when 'gpt-5.6-terra' then 'terra'
    when 'gpt-5.6-sol' then 'sol'
    when 'gpt-6-luna' then 'luna'
    when 'gpt-6-sol' then 'sol'
    when 'gpt-6-astra' then 'pro'
    else null
  end;
$$;

revoke execute on function public.custodian_openai_model_tier(text) from public, anon;
grant execute on function public.custodian_openai_model_tier(text) to authenticated, service_role;

alter table public.agent_provider_reservations
  drop constraint if exists agent_provider_reservations_model_ck;
alter table public.agent_provider_reservations
  add constraint agent_provider_reservations_model_ck check (
    model_name in (
      'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol',
      'gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra',
      'gpt-5.6-pro'
    )
  );

-- custodian_reserve_provider_call: identical to the 20260921180000 definition
-- except the fixed tier<->model equality block, which now consults
-- custodian_openai_model_tier(). Reservation-before-contact, holds, budgets,
-- idempotency and replay behavior are unchanged.
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
  -- The model must be on the central catalog and belong to the policy tier the
  -- run was created under. The tier stays the policy/gating identity; the exact
  -- model name is what is recorded and attributed.
  if public.custodian_openai_model_tier(model_name_value) is distinct from model_tier_value then
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

  select coalesce(sum(s.tokens_used), 0), coalesce(sum(s.cost_usd), 0)
    into daily_tokens, daily_cost
    from public.agent_steps s
   where s.owner_id = caller_id
     and s.created_at >= pg_catalog.date_trunc('day', pg_catalog.now());
  select coalesce(sum(h.hold_tokens), 0), coalesce(sum(h.hold_cost_usd), 0)
    into daily_hold_tokens, daily_hold_cost
    from public.agent_provider_reservations h
   where h.owner_id = caller_id
     and h.status = 'held';

  select coalesce(sum(s.tokens_used), 0), coalesce(sum(s.cost_usd), 0)
    into monthly_tokens, monthly_cost
    from public.agent_steps s
   where s.owner_id = caller_id
     and s.created_at >= pg_catalog.date_trunc('month', pg_catalog.now());
  select coalesce(sum(h.hold_tokens), 0), coalesce(sum(h.hold_cost_usd), 0)
    into monthly_hold_tokens, monthly_hold_cost
    from public.agent_provider_reservations h
   where h.owner_id = caller_id
     and h.status = 'held';

  projected_tokens := run_row.tokens_used + existing_hold_tokens + hold_tokens;
  projected_cost := run_row.cost_usd + existing_hold_cost + hold_cost;
  projected_daily_tokens := daily_tokens + daily_hold_tokens + hold_tokens;
  projected_daily_cost := daily_cost + daily_hold_cost + hold_cost;
  projected_monthly_tokens := monthly_tokens + monthly_hold_tokens + hold_tokens;
  projected_monthly_cost := monthly_cost + monthly_hold_cost + hold_cost;

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
