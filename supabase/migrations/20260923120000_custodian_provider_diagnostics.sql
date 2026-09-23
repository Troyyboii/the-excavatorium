-- Custodian provider diagnostics: one bounded, owner-readable metadata row per
-- provider attempt. It records only allowlisted structural facts about the
-- provider outcome (status, classification, validated error tokens, request
-- id). It never stores prompts, evidence, request or response bodies, provider
-- free-text messages, headers, or credentials. Diagnostics do not change
-- reservation, settlement, or budget accounting. Only the service-role Edge
-- runtime can write a row; the owner can read their own rows.

create table if not exists public.agent_provider_diagnostics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  run_id uuid not null,
  reservation_id uuid not null,
  attempt_key text not null,
  provider text not null,
  contact_state text not null,
  classification text not null,
  http_status integer,
  request_id text,
  error_type text,
  error_code text,
  error_param text,
  incomplete_reason text,
  created_at timestamptz not null default now(),
  constraint agent_provider_diagnostics_run_fk
    foreign key (owner_id, case_id, run_id)
    references public.agent_runs (owner_id, case_id, id) on delete cascade,
  constraint agent_provider_diagnostics_attempt_fk
    foreign key (owner_id, run_id, attempt_key)
    references public.agent_provider_reservations (owner_id, run_id, idempotency_key)
    on delete cascade,
  constraint agent_provider_diagnostics_reservation_fk
    foreign key (reservation_id)
    references public.agent_provider_reservations (id) on delete cascade,
  constraint agent_provider_diagnostics_one_per_attempt
    unique (owner_id, reservation_id),
  constraint agent_provider_diagnostics_provider_ck check (provider = 'openai'),
  constraint agent_provider_diagnostics_contact_ck
    check (contact_state in ('contacted', 'contact_uncertain')),
  constraint agent_provider_diagnostics_classification_ck check (classification in (
    'openai_completed',
    'openai_refusal',
    'openai_incomplete',
    'openai_invalid_output',
    'openai_invalid_response',
    'openai_usage_missing',
    'openai_authentication_failed',
    'openai_permission_denied',
    'openai_quota_exceeded',
    'openai_rate_limited',
    'openai_model_unavailable',
    'openai_request_rejected',
    'openai_server_error',
    'openai_timeout',
    'openai_unavailable'
  )),
  constraint agent_provider_diagnostics_http_status_ck
    check (http_status is null or http_status between 100 and 599),
  constraint agent_provider_diagnostics_request_id_ck
    check (request_id is null or request_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  constraint agent_provider_diagnostics_error_type_ck
    check (error_type is null or error_type ~ '^[a-z0-9_]{1,80}$'),
  constraint agent_provider_diagnostics_error_code_ck
    check (error_code is null or error_code ~ '^[a-z0-9_]{1,80}$'),
  constraint agent_provider_diagnostics_error_param_ck
    check (error_param is null or error_param ~ '^[A-Za-z0-9_.\[\]-]{1,200}$'),
  constraint agent_provider_diagnostics_incomplete_reason_ck
    check (incomplete_reason is null or incomplete_reason ~ '^[a-z0-9_]{1,80}$'),
  constraint agent_provider_diagnostics_contact_status_ck check (
    (contact_state = 'contacted' and http_status is not null)
    or (contact_state = 'contact_uncertain' and http_status is null)
  )
);

create index if not exists agent_provider_diagnostics_owner_run_idx
  on public.agent_provider_diagnostics (owner_id, run_id);

create or replace function public.custodian_reject_provider_diagnostic_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'provider diagnostics are append-only' using errcode = '42501';
end;
$$;

revoke execute on function public.custodian_reject_provider_diagnostic_update()
  from public, anon, authenticated;
drop trigger if exists agent_provider_diagnostics_reject_update
  on public.agent_provider_diagnostics;
create trigger agent_provider_diagnostics_reject_update
  before update on public.agent_provider_diagnostics
  for each row execute function public.custodian_reject_provider_diagnostic_update();

alter table public.agent_provider_diagnostics enable row level security;
drop policy if exists agent_provider_diagnostics_select_own
  on public.agent_provider_diagnostics;
create policy agent_provider_diagnostics_select_own
  on public.agent_provider_diagnostics
  for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all privileges on public.agent_provider_diagnostics from public, anon, authenticated;
grant select on public.agent_provider_diagnostics to authenticated;

-- Service-role Edge runtime only, matching custodian_settle_provider_reservation.
-- The diagnostic binds to an existing reservation for the owner, run, and
-- server-owned attempt key. A replay for the same attempt returns the first row.
create or replace function public.custodian_record_provider_diagnostic(
  runtime_owner_id uuid,
  run_id uuid,
  idempotency_key text,
  diagnostic jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  request_key text;
  target_run uuid := run_id;
  reservation public.agent_provider_reservations;
  recorded public.agent_provider_diagnostics;
  field text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trusted runtime producer is required' using errcode = '42501';
  end if;
  if runtime_owner_id is null then
    raise exception 'runtime owner is required' using errcode = '22023';
  end if;
  payload := public.custodian_runtime_require_object(diagnostic, 'diagnostic');
  request_key := public.custodian_runtime_require_idempotency(idempotency_key);
  perform public.custodian_reject_owner_keys(payload);
  if exists (
    select 1
      from pg_catalog.jsonb_object_keys(payload) as keys(key)
     where keys.key not in (
       'provider', 'contact_state', 'classification', 'http_status', 'request_id',
       'error_type', 'error_code', 'error_param', 'incomplete_reason'
     )
  ) then
    raise exception 'provider diagnostic accepts only allowlisted metadata fields'
      using errcode = '22023';
  end if;
  foreach field in array array['provider', 'contact_state', 'classification'] loop
    if pg_catalog.jsonb_typeof(payload -> field) is distinct from 'string' then
      raise exception '% is required', field using errcode = '22023';
    end if;
  end loop;
  foreach field in array array['request_id', 'error_type', 'error_code', 'error_param', 'incomplete_reason'] loop
    if payload ? field
       and pg_catalog.jsonb_typeof(payload -> field) not in ('string', 'null') then
      raise exception '% must be text or null', field using errcode = '22023';
    end if;
  end loop;
  if payload ? 'http_status'
     and pg_catalog.jsonb_typeof(payload -> 'http_status') not in ('number', 'null') then
    raise exception 'http_status must be an integer or null' using errcode = '22023';
  end if;

  select * into reservation
    from public.agent_provider_reservations h
   where h.owner_id = runtime_owner_id
     and h.run_id = target_run
     and h.idempotency_key = request_key;
  if not found then
    raise exception 'provider reservation not found' using errcode = 'P0002';
  end if;

  insert into public.agent_provider_diagnostics (
    owner_id, case_id, run_id, reservation_id, attempt_key, provider, contact_state,
    classification, http_status, request_id, error_type, error_code, error_param,
    incomplete_reason
  ) values (
    reservation.owner_id,
    reservation.case_id,
    reservation.run_id,
    reservation.id,
    reservation.idempotency_key,
    payload ->> 'provider',
    payload ->> 'contact_state',
    payload ->> 'classification',
    (payload ->> 'http_status')::integer,
    payload ->> 'request_id',
    payload ->> 'error_type',
    payload ->> 'error_code',
    payload ->> 'error_param',
    payload ->> 'incomplete_reason'
  )
  on conflict on constraint agent_provider_diagnostics_one_per_attempt do nothing
  returning * into recorded;
  if recorded.id is null then
    select * into recorded
      from public.agent_provider_diagnostics d
     where d.owner_id = reservation.owner_id and d.reservation_id = reservation.id;
    return pg_catalog.jsonb_build_object('diagnostic', to_jsonb(recorded), 'idempotent', true);
  end if;
  return pg_catalog.jsonb_build_object('diagnostic', to_jsonb(recorded), 'idempotent', false);
end;
$$;

revoke execute on function public.custodian_record_provider_diagnostic(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.custodian_record_provider_diagnostic(uuid, uuid, text, jsonb)
  to service_role;
