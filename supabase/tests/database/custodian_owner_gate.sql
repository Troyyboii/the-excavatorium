-- Deterministic Custodian M3 owner-gate fixtures. No provider, external, or
-- canonical execution is performed. Approval records a decision only.
begin;

select plan(16);

set local role postgres;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'm3-owner-a@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'm3-owner-b@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

insert into public.records (id, user_id, record_type, title, record_data) values
  ('01010101-0101-4101-8101-010101010101', '11111111-1111-4111-8111-111111111111', 'tool', 'M3 canonical source', '{"before":"unchanged"}'::jsonb);

insert into public.cases (id, owner_id, title, created_by, updated_by) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'M3 owner A case', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'M3 owner B case', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

insert into public.tool_policies (
  id, owner_id, case_id, policy_name, status, allowed_model_tiers, allowed_tools,
  per_run_token_budget, per_run_cost_usd, per_run_latency_ms,
  created_by, updated_by
) values
  ('c1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'M3 A policy', 'active', array['luna', 'terra']::text[], array['write_tool']::text[], 100, 1, 1000, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('c2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'M3 B policy', 'active', array['luna', 'terra']::text[], array['write_tool']::text[], 100, 1, 1000, '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

insert into public.agent_runs (
  id, owner_id, case_id, tool_policy_id, idempotency_key, request_hash, objective,
  input_snapshot, input_snapshot_hash, prompt_version, tool_allowlist, model_tier, status,
  created_by, updated_by
) values
  ('d1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm3-approve', repeat('a', 32), 'Approve fixture', '{}', repeat('b', 32), 'm3-fixture-v1', array['write_tool']::text[], 'luna', 'awaiting_approval', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm3-reject', repeat('c', 32), 'Reject fixture', '{}', repeat('d', 32), 'm3-fixture-v1', array['write_tool']::text[], 'luna', 'awaiting_approval', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d3333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm3-defer', repeat('e', 32), 'Defer fixture', '{}', repeat('f', 32), 'm3-fixture-v1', array['write_tool']::text[], 'luna', 'awaiting_approval', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d4444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm3-expire', repeat('1', 32), 'Expire fixture', '{}', repeat('2', 32), 'm3-fixture-v1', array['write_tool']::text[], 'luna', 'awaiting_approval', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d5555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm3-hash', repeat('3', 32), 'Hash fixture', '{}', repeat('4', 32), 'm3-fixture-v1', array['write_tool']::text[], 'luna', 'awaiting_approval', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d7777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm3-required-hash', repeat('5', 32), 'Required hash fixture', '{}', repeat('6', 32), 'm3-fixture-v1', array['write_tool']::text[], 'luna', 'awaiting_approval', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d6666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'c2222222-2222-4222-8222-222222222222', 'm3-foreign', repeat('7', 32), 'Foreign fixture', '{}', repeat('8', 32), 'm3-fixture-v1', array['write_tool']::text[], 'luna', 'awaiting_approval', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

insert into public.approval_requests (
  id, owner_id, case_id, run_id, idempotency_key, approval_kind, status,
  title, rationale, proposed_diff, tool_action, exact_action_hash, requested_by, expires_at
) values
  ('e1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1111111-1111-4111-8111-111111111111', 'm3-approve-gate', 'tool_action', 'pending', 'Approve exact action', 'Inspectable', '{"op":"pause"}'::jsonb, '{"tool_name":"write_tool"}'::jsonb, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', now() + interval '1 day'),
  ('e2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd2222222-2222-4222-8222-222222222222', 'm3-reject-gate', 'tool_action', 'pending', 'Reject exact action', 'Inspectable', '{"op":"pause"}'::jsonb, '{"tool_name":"write_tool"}'::jsonb, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', now() + interval '1 day'),
  ('e3333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd3333333-3333-4333-8333-333333333333', 'm3-defer-gate', 'tool_action', 'pending', 'Defer exact action', 'Inspectable', '{"op":"pause"}'::jsonb, '{"tool_name":"write_tool"}'::jsonb, 'cccccccccccccccccccccccccccccccc', '11111111-1111-4111-8111-111111111111', now() + interval '1 day'),
  ('e4444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd4444444-4444-4444-8444-444444444444', 'm3-expire-gate', 'tool_action', 'pending', 'Expire exact action', 'Inspectable', '{"op":"pause"}'::jsonb, '{"tool_name":"write_tool"}'::jsonb, 'dddddddddddddddddddddddddddddddd', '11111111-1111-4111-8111-111111111111', now() - interval '1 hour'),
  ('e5555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd5555555-5555-4555-8555-555555555555', 'm3-hash-gate', 'tool_action', 'pending', 'Hash exact action', 'Inspectable', '{"op":"pause"}'::jsonb, '{"tool_name":"write_tool"}'::jsonb, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', now() + interval '1 day'),
  ('e7777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd7777777-7777-4777-8777-777777777777', 'm3-required-hash-gate', 'tool_action', 'pending', 'Required hash exact action', 'Inspectable', '{"op":"pause"}'::jsonb, '{"tool_name":"write_tool"}'::jsonb, '99999999999999999999999999999999', '11111111-1111-4111-8111-111111111111', now() + interval '1 day'),
  ('e6666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'd6666666-6666-4666-8666-666666666666', 'm3-foreign-gate', 'tool_action', 'pending', 'Foreign exact action', 'Inspectable', '{"op":"pause"}'::jsonb, '{"tool_name":"write_tool"}'::jsonb, 'ffffffffffffffffffffffffffffffff', '22222222-2222-4222-8222-222222222222', now() + interval '1 day');

insert into public.change_proposals (
  id, owner_id, case_id, run_id, approval_request_id, idempotency_key,
  target_type, target_id, operation, before_snapshot, proposed_diff, after_snapshot,
  rationale, created_by, updated_by
) values (
  'f1111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'd1111111-1111-4111-8111-111111111111', 'e1111111-1111-4111-8111-111111111111', 'm3-proposal',
  'evidence_item', null, 'update', '{"status":"open"}'::jsonb, '{"status":"paused"}'::jsonb, '{"status":"paused"}'::jsonb,
  'Pause only after an owner gate.', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.approval_requests'::regclass
       and conname = 'approval_requests_status_ck'
       and pg_get_constraintdef(oid) like '%deferred%'
  )
  and to_regprocedure('public.custodian_respond_approval(uuid,text,text,text,text)') is not null
  and to_regprocedure('public.custodian_respond_approval(uuid,text,text,text)') is null
  and (
    select p.pronargdefaults
      from pg_catalog.pg_proc p
     where p.oid = 'public.custodian_respond_approval(uuid,text,text,text,text)'::regprocedure
  ) = 0
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.custodian_respond_approval(uuid,text,text,text,text)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.custodian_respond_approval(uuid,text,text,text,text)', 'EXECUTE'
  ),
  'M3 deferred status and mandatory exact-hash respond signature are installed'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare
  response_value jsonb;
  record_title text;
begin
  response_value := public.custodian_respond_approval(
    'e1111111-1111-4111-8111-111111111111',
    'approved',
    'Owner inspected the exact action.',
    'owner-gate-approve',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  if response_value #>> '{approval,status}' <> 'approved'
     or response_value #>> '{run,status}' <> 'executing'
     or coalesce((response_value ->> 'execution_available')::boolean, true) is not false then
    raise exception 'approval did not persist the approved unavailable-execution contract';
  end if;
  if exists (
    select 1 from public.tool_events
     where approval_request_id = 'e1111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'approval created a tool event';
  end if;
  select title into record_title from public.records where id = '01010101-0101-4101-8101-010101010101';
  if record_title <> 'M3 canonical source'
     or (select record_data from public.records where id = '01010101-0101-4101-8101-010101010101') <> '{"before":"unchanged"}'::jsonb then
    raise exception 'approval mutated a canonical archive record';
  end if;
end;
$$;

select ok(true, 'approval records the exact decision without mutating archive records or appending tool events');

do $$
declare
  response_value jsonb;
begin
  response_value := public.custodian_respond_approval(
    'e2222222-2222-4222-8222-222222222222',
    'rejected',
    'Not this action.',
    'owner-gate-reject',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );
  if response_value #>> '{approval,status}' <> 'rejected'
     or response_value #>> '{run,status}' <> 'blocked' then
    raise exception 'rejection did not persist a blocked run';
  end if;
  begin
    perform public.custodian_append_tool_event(
      'd2222222-2222-4222-8222-222222222222',
      jsonb_build_object(
        'tool_name', 'write_tool', 'event_kind', 'succeeded', 'operation_class', 'evidence_write',
        'approval_request_id', 'e2222222-2222-4222-8222-222222222222',
        'exact_action_hash', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      ),
      'm3-rejected-write'
    );
    raise exception 'rejected approval was allowed to execute';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select ok(true, 'rejection records no mutation and cannot start a write-capable tool event');

do $$
declare
  response_value jsonb;
begin
  response_value := public.custodian_respond_approval(
    'e3333333-3333-4333-8333-333333333333',
    'deferred',
    'Pause this gate.',
    'owner-gate-defer',
    'cccccccccccccccccccccccccccccccc'
  );
  if response_value #>> '{approval,status}' <> 'deferred'
     or response_value #>> '{run,status}' <> 'awaiting_approval' then
    raise exception 'deferral did not pause the gate';
  end if;
  begin
    perform public.custodian_append_tool_event(
      'd3333333-3333-4333-8333-333333333333',
      jsonb_build_object(
        'tool_name', 'write_tool', 'event_kind', 'succeeded', 'operation_class', 'evidence_write',
        'approval_request_id', 'e3333333-3333-4333-8333-333333333333',
        'exact_action_hash', 'cccccccccccccccccccccccccccccccc'
      ),
      'm3-deferred-write'
    );
    raise exception 'deferred approval was allowed to execute';
  exception
    when insufficient_privilege then null;
  end;
  response_value := public.custodian_respond_approval(
    'e3333333-3333-4333-8333-333333333333',
    'cancelled',
    'Close after deferral.',
    'owner-gate-defer-cancel',
    'cccccccccccccccccccccccccccccccc'
  );
  if response_value #>> '{approval,status}' <> 'cancelled'
     or response_value #>> '{run,status}' <> 'cancelled' then
    raise exception 'deferred gate could not later be cancelled';
  end if;
end;
$$;

select ok(true, 'deferral pauses without execution and remains answerable');

do $$
declare
  response_value jsonb;
begin
  response_value := public.custodian_respond_approval(
    'e4444444-4444-4444-8444-444444444444',
    'approved',
    'Too late.',
    'owner-gate-expire',
    'dddddddddddddddddddddddddddddddd'
  );
  if response_value #>> '{approval,status}' <> 'expired'
     or response_value #>> '{run,status}' <> 'expired' then
    raise exception 'expired approval was treated as a live approval';
  end if;
end;
$$;

select ok(true, 'an expired gate cannot be approved into execution');

do $$
begin
  begin
    perform public.custodian_respond_approval(
      'e5555555-5555-4555-8555-555555555555',
      'approved',
      'Wrong hash.',
      'owner-gate-hash',
      'ffffffffffffffffffffffffffffffff'
    );
    raise exception 'changed action hash was accepted';
  exception
    when invalid_parameter_value then null;
  end;
  if (select status from public.approval_requests where id = 'e5555555-5555-4555-8555-555555555555') <> 'pending' then
    raise exception 'hash mismatch mutated the pending gate';
  end if;
end;
$$;

select ok(true, 'a changed action hash cannot reuse the current owner gate');

do $$
begin
  begin
    execute 'select public.custodian_respond_approval($1::uuid, $2::text, $3::text, $4::text)'
      using 'e7777777-7777-4777-8777-777777777777',
            'approved',
            'Omitted hash.',
            'owner-gate-omit';
    raise exception 'omitted expected_action_hash was accepted';
  exception
    when undefined_function then null;
  end;
  if (select status from public.approval_requests where id = 'e7777777-7777-4777-8777-777777777777') <> 'pending'
     or exists (
       select 1 from public.audit_events
        where target_id = 'e7777777-7777-4777-8777-777777777777'
          and action = 'respond_approval'
     ) then
    raise exception 'omitted expected_action_hash mutated the pending gate';
  end if;
end;
$$;

select ok(true, 'omitting expected_action_hash cannot authorize a decision');

do $$
begin
  begin
    perform public.custodian_respond_approval(
      'e7777777-7777-4777-8777-777777777777',
      'approved',
      'Null hash.',
      'owner-gate-null',
      null
    );
    raise exception 'null expected_action_hash was accepted';
  exception
    when invalid_parameter_value then null;
  end;
  begin
    perform public.custodian_respond_approval(
      'e7777777-7777-4777-8777-777777777777',
      'approved',
      'Blank hash.',
      'owner-gate-blank',
      '   '
    );
    raise exception 'blank expected_action_hash was accepted';
  exception
    when invalid_parameter_value then null;
  end;
  if (select status from public.approval_requests where id = 'e7777777-7777-4777-8777-777777777777') <> 'pending'
     or (select status from public.agent_runs where id = 'd7777777-7777-4777-8777-777777777777') <> 'awaiting_approval'
     or exists (
       select 1 from public.audit_events
        where target_id = 'e7777777-7777-4777-8777-777777777777'
          and action = 'respond_approval'
     ) then
    raise exception 'null or blank expected_action_hash mutated the pending gate';
  end if;
end;
$$;

select ok(true, 'null or blank expected_action_hash cannot authorize a decision');

do $$
declare
  first_value jsonb;
  second_value jsonb;
begin
  first_value := public.custodian_respond_approval(
    'e5555555-5555-4555-8555-555555555555',
    'cancelled',
    'Close the hash fixture.',
    'owner-gate-replay',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  );
  second_value := public.custodian_respond_approval(
    'e5555555-5555-4555-8555-555555555555',
    'cancelled',
    'Close the hash fixture.',
    'owner-gate-replay',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  );
  if coalesce((second_value ->> 'idempotent')::boolean, false) is not true
     or second_value #>> '{approval,status}' <> 'cancelled' then
    raise exception 'duplicate owner decision was not an idempotent replay';
  end if;
  begin
    perform public.custodian_respond_approval(
      'e5555555-5555-4555-8555-555555555555',
      'approved',
      'Different decision.',
      'owner-gate-replay-other',
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
    raise exception 'duplicate different decision was accepted';
  exception
    when serialization_failure then null;
  end;
  if first_value #>> '{approval,id}' <> second_value #>> '{approval,id}' then
    raise exception 'idempotent replay changed approval identity';
  end if;
end;
$$;

select ok(true, 'duplicate decisions replay and a different later decision is rejected');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $$
begin
  begin
    perform public.custodian_respond_approval(
      'e1111111-1111-4111-8111-111111111111',
      'rejected',
      'Cross owner.',
      'owner-gate-cross',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    raise exception 'cross-owner approval response was accepted';
  exception
    when no_data_found then null;
  end;
end;
$$;

select ok(true, 'a second owner cannot decide another owner gate');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select ok(
  exists (
    select 1 from public.change_proposals
     where id = 'f1111111-1111-4111-8111-111111111111'
       and case_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
       and run_id = 'd1111111-1111-4111-8111-111111111111'
       and approval_request_id = 'e1111111-1111-4111-8111-111111111111'
  )
  and exists (
    select 1 from public.approval_requests
     where id = 'e1111111-1111-4111-8111-111111111111'
       and case_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
       and run_id = 'd1111111-1111-4111-8111-111111111111'
  ),
  'proposal, case, run, and approval remain bound after the owner decision'
);

select ok(
  not exists (
    select 1 from public.tool_events
     where owner_id = '11111111-1111-4111-8111-111111111111'
  )
  and (select record_data from public.records where id = '01010101-0101-4101-8101-010101010101') = '{"before":"unchanged"}'::jsonb,
  'rejected, expired, deferred, and approved gates leave canonical records and tool events unmutated'
);

select ok(
  (select status from public.approval_requests where id = 'e2222222-2222-4222-8222-222222222222') = 'rejected'
  and (select status from public.approval_requests where id = 'e3333333-3333-4333-8333-333333333333') = 'cancelled'
  and (select status from public.approval_requests where id = 'e4444444-4444-4444-8444-444444444444') = 'expired',
  'rejected, deferred-then-cancelled, and expired outcomes remain distinct'
);

select ok(
  pg_catalog.has_table_privilege('authenticated', 'public.approval_requests', 'SELECT')
  and not pg_catalog.has_table_privilege('authenticated', 'public.approval_requests', 'UPDATE')
  and not pg_catalog.has_table_privilege('authenticated', 'public.approval_requests', 'INSERT'),
  'owner reads stay on RLS select and cannot bypass the protected respond RPC'
);

select ok(
  exists (
    select 1 from public.audit_events
     where target_type = 'approval_request'
       and target_id = 'e1111111-1111-4111-8111-111111111111'
       and action = 'respond_approval'
       and event_type = 'approved'
  ),
  'owner decisions write an append-only audit event'
);

select ok(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'custodian_findings'
       and column_name = 'origin_kind'
  )
  and to_regprocedure('public.custodian_materialize_finding(uuid,integer)') is not null,
  'M2 Finding attribution contract remains intact'
);

select * from finish();

rollback;
