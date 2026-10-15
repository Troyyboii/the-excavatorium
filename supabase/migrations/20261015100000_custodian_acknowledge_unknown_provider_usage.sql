alter table public.agent_provider_reservations
  add column owner_acknowledged_unknown_at timestamptz;

alter table public.agent_provider_reservations
  add constraint agent_provider_reservations_owner_ack_ck check (
    owner_acknowledged_unknown_at is null
    or (
      status = 'held'
      and usage_knowledge = 'unknown'
      and actual_tokens is null
      and actual_cost_usd is null
    )
  );

comment on column public.agent_provider_reservations.owner_acknowledged_unknown_at is
  'When the owner acknowledged that provider usage remains unknown; the reservation stays held and counted against budgets.';

create or replace function public.custodian_acknowledge_unknown_provider_reservation(
  reservation_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  reservation public.agent_provider_reservations;
  run_row public.agent_runs;
  already_acknowledged boolean;
begin
  if caller_id is null then
    raise exception 'authenticated owner is required' using errcode = '42501';
  end if;

  perform public.custodian_lock(caller_id);
  select * into reservation
    from public.agent_provider_reservations h
   where h.owner_id = caller_id and h.id = reservation_id_value
   for update;
  if not found then
    raise exception 'provider reservation not found' using errcode = 'P0002';
  end if;

  select * into run_row
    from public.agent_runs r
   where r.owner_id = caller_id and r.id = reservation.run_id
   for update;
  if not found then
    raise exception 'provider reservation run not found' using errcode = 'P0002';
  end if;
  if not public.custodian_runtime_is_terminal(run_row.status) then
    raise exception 'provider usage can be acknowledged only after the run stops' using errcode = '42501';
  end if;
  if reservation.status <> 'held'
     or reservation.usage_knowledge <> 'unknown'
     or reservation.actual_tokens is not null
     or reservation.actual_cost_usd is not null then
    raise exception 'provider reservation is not an unresolved unknown usage hold' using errcode = '23505';
  end if;

  already_acknowledged := reservation.owner_acknowledged_unknown_at is not null;
  if not already_acknowledged then
    update public.agent_provider_reservations
       set owner_acknowledged_unknown_at = pg_catalog.now(), updated_by = caller_id
     where id = reservation.id
     returning * into reservation;
    perform public.custodian_runtime_write_audit(
      caller_id, run_row.case_id, run_row.id, 'updated', 'acknowledge_unknown_provider_usage',
      'agent_provider_reservation', reservation.id,
      pg_catalog.jsonb_build_object(
        'status', reservation.status,
        'usage_knowledge', reservation.usage_knowledge,
        'hold_tokens', reservation.hold_tokens,
        'hold_cost_usd', reservation.hold_cost_usd,
        'actual_tokens', null,
        'actual_cost_usd', null,
        'owner_acknowledged_unknown_at', reservation.owner_acknowledged_unknown_at
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'status', reservation.status,
    'usage_knowledge', reservation.usage_knowledge,
    'hold_tokens', reservation.hold_tokens,
    'hold_cost_usd', reservation.hold_cost_usd,
    'owner_acknowledged_unknown_at', reservation.owner_acknowledged_unknown_at,
    'idempotent', already_acknowledged
  );
end;
$$;

revoke execute on function public.custodian_acknowledge_unknown_provider_reservation(uuid)
  from public, anon;
grant execute on function public.custodian_acknowledge_unknown_provider_reservation(uuid)
  to authenticated;
