-- Custodian M3: owner-gate decisions remain exact-action scoped. Defer is a
-- pause, not execution. expected_action_hash is mandatory; omitting it, or
-- passing null/blank, cannot authorize a decision. A changed action hash
-- cannot reuse the current gate. This migration does not authorize provider,
-- external, or canonical execution.

alter table public.approval_requests
  drop constraint if exists approval_requests_status_ck;

alter table public.approval_requests
  add constraint approval_requests_status_ck
  check (status in ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'deferred'));

alter table public.audit_events
  drop constraint if exists audit_events_event_type_ck;

alter table public.audit_events
  add constraint audit_events_event_type_ck
  check (event_type in (
    'created', 'updated', 'transitioned', 'approved', 'rejected', 'read',
    'tool_called', 'budget_stopped', 'cancelled', 'schema_changed', 'error',
    'expired', 'deferred'
  ));

drop function if exists public.custodian_respond_approval(uuid, text, text, text);
drop function if exists public.custodian_respond_approval(uuid, text, text, text, text);

create function public.custodian_respond_approval(
  approval_request_id uuid,
  decision text,
  response_note text,
  idempotency_key text,
  expected_action_hash text
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
  expected_hash_value text := nullif(pg_catalog.btrim(coalesce(expected_action_hash, '')), '');
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
  if expected_hash_value is null then
    raise exception 'expected_action_hash is required' using errcode = '22023';
  end if;
  if expected_hash_value !~ '^[0-9a-fA-F]{32}$' then
    raise exception 'expected_action_hash is invalid' using errcode = '22023';
  end if;
  if expected_hash_value is distinct from approval_row.exact_action_hash then
    raise exception 'approval exact action hash does not match the inspected action' using errcode = '22023';
  end if;
  if approval_row.response_idempotency_key = request_key then
    return jsonb_build_object('approval', to_jsonb(approval_row), 'idempotent', true);
  end if;
  if approval_row.status not in ('pending', 'deferred') then
    raise exception 'approval request has already been answered' using errcode = '40001';
  end if;
  if approval_row.status = 'deferred' and decision_value = 'deferred' then
    raise exception 'approval request has already been answered' using errcode = '40001';
  end if;
  if decision_value not in ('approved', 'rejected', 'expired', 'cancelled', 'deferred') then
    raise exception 'approval decision is not allowed' using errcode = '22023';
  end if;
  if pg_catalog.char_length(note_value) > 10000 then
    raise exception 'response_note exceeds the maximum length' using errcode = '22023';
  end if;
  if decision_value in ('approved', 'deferred')
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
    jsonb_build_object('status', decision_value, 'execution', 'unavailable')
  );
  return jsonb_build_object(
    'approval', to_jsonb(updated_approval),
    'run', case when updated_approval.run_id is null then null else to_jsonb(run_row) end,
    'idempotent', false,
    'execution_available', false
  );
end;
$$;

revoke execute on function public.custodian_respond_approval(uuid, text, text, text, text) from public, anon;
grant execute on function public.custodian_respond_approval(uuid, text, text, text, text) to authenticated;
