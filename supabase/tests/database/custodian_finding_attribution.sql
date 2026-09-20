-- Deterministic Custodian M2 fixtures. No provider call is made: completed
-- synthesis steps are inserted as persisted fixture output and passed through
-- the protected Finding materialization RPC.
begin;

select plan(23);

set local role postgres;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'm2-owner-a@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'm2-owner-b@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

insert into public.records (id, user_id, record_type, title, record_data) values
  ('01010101-0101-4101-8101-010101010101', '11111111-1111-4111-8111-111111111111', 'tool', 'M2 canonical source', '{"before":"unchanged"}'::jsonb),
  ('02020202-0202-4202-8202-020202020202', '22222222-2222-4222-8222-222222222222', 'tool', 'M2 foreign source', '{}'::jsonb);

insert into public.cases (id, owner_id, title, created_by, updated_by) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'M2 owner A case', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'M2 owner B case', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

insert into public.evidence_items (
  id, owner_id, case_id, title, content, content_hash, source_classification, source_uri, created_by, updated_by
) values
  ('e1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Supporting evidence', '{"text":"supports"}', md5('supports'), 'primary', 'fixture://supporting', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('e2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Contrary evidence', '{"text":"contrary"}', md5('contrary'), 'secondary', 'fixture://contrary', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('e3333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Foreign evidence', '{"text":"foreign"}', md5('foreign'), 'primary', 'fixture://foreign', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

insert into public.tool_policies (
  id, owner_id, case_id, policy_name, status, allowed_model_tiers, allowed_tools,
  per_run_token_budget, per_run_cost_usd, per_run_latency_ms,
  created_by, updated_by
) values
  ('c1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'M2 A policy', 'active', array['luna', 'terra']::text[], array['safe_read']::text[], 100, 1, 1000, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('c2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'M2 B policy', 'active', array['luna', 'terra']::text[], array['safe_read']::text[], 100, 1, 1000, '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

insert into public.agent_runs (
  id, owner_id, case_id, tool_policy_id, idempotency_key, request_hash, objective,
  input_snapshot, input_snapshot_hash, prompt_version, model_tier, status,
  created_by, updated_by
) values
  ('d1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm2-valid', repeat('a', 32), 'Valid M2 fixture', '{}', repeat('b', 32), 'm2-fixture-v1', 'luna', 'completed', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm2-unresolved', repeat('c', 32), 'Unresolved M2 fixture', '{}', repeat('d', 32), 'm2-fixture-v1', 'luna', 'completed', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d3333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm2-refusal', repeat('e', 32), 'Refusal M2 fixture', '{}', repeat('f', 32), 'm2-fixture-v1', 'luna', 'completed', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d4444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm2-no-finding', repeat('1', 32), 'No Finding M2 fixture', '{}', repeat('2', 32), 'm2-fixture-v1', 'luna', 'completed', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d5555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm2-malformed', repeat('3', 32), 'Malformed M2 fixture', '{}', repeat('4', 32), 'm2-fixture-v1', 'luna', 'completed', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d6666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1111111-1111-4111-8111-111111111111', 'm2-generic', repeat('5', 32), 'Generic M2 fixture', '{}', repeat('6', 32), 'm2-fixture-v1', 'luna', 'completed', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('d7777777-7777-4777-8777-777777777777', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'c2222222-2222-4222-8222-222222222222', 'm2-foreign', repeat('7', 32), 'Foreign M2 fixture', '{}', repeat('8', 32), 'm2-fixture-v1', 'luna', 'completed', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

insert into public.agent_steps (
  id, owner_id, case_id, run_id, sequence_no, step_kind, status, idempotency_key,
  model_tier, prompt_version, input_payload, output_payload, completed_at, created_by, updated_by
) values
  ('f1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1111111-1111-4111-8111-111111111111', 1, 'synthesize', 'completed', 'm2-valid-step', 'luna', 'm2-fixture-v1', '{}', jsonb_build_object('summary', 'fixture', 'findings', jsonb_build_array(jsonb_build_object('outcome', 'finding', 'title', 'Supported conclusion', 'conclusion', 'The evidence supports the conclusion.', 'analysis_mode', 'synthesis', 'confidence', 80, 'supporting_evidence_ids', jsonb_build_array('e1111111-1111-4111-8111-111111111111'), 'contrary_evidence_ids', jsonb_build_array('e2222222-2222-4222-8222-222222222222'), 'uncertainties', jsonb_build_array('Fixture only.'), 'assumptions', jsonb_build_array('Only bounded evidence was reviewed.'), 'scope_limits', jsonb_build_array('No archive mutation was permitted.'), 'evidence_gaps', jsonb_build_array(), 'what_would_change_mind', 'A newer primary record.', 'revisit_condition', 'When Case scope changes.'))), now(), '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('f2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd2222222-2222-4222-8222-222222222222', 1, 'synthesize', 'completed', 'm2-unresolved-step', 'luna', 'm2-fixture-v1', '{}', jsonb_build_object('summary', 'fixture', 'findings', jsonb_build_array(jsonb_build_object('outcome', 'unresolved', 'title', 'Unresolved conclusion', 'conclusion', 'The bounded evidence is insufficient.', 'analysis_mode', 'evidence_gap', 'confidence', 20, 'supporting_evidence_ids', jsonb_build_array(), 'contrary_evidence_ids', jsonb_build_array(), 'uncertainties', jsonb_build_array('The primary record is absent.'), 'assumptions', jsonb_build_array(), 'scope_limits', jsonb_build_array('Only selected evidence was reviewed.'), 'evidence_gaps', jsonb_build_array('Need a primary confirmation.'), 'what_would_change_mind', 'A primary confirmation.', 'revisit_condition', 'When the evidence gap closes.'))), now(), '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('f3333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd3333333-3333-4333-8333-333333333333', 1, 'synthesize', 'completed', 'm2-refusal-step', 'luna', 'm2-fixture-v1', '{}', jsonb_build_object('summary', 'fixture', 'findings', jsonb_build_array(jsonb_build_object('outcome', 'refusal', 'title', 'Refused analysis', 'conclusion', 'The requested analysis was refused.', 'analysis_mode', 'synthesis', 'confidence', 0, 'supporting_evidence_ids', jsonb_build_array(), 'contrary_evidence_ids', jsonb_build_array(), 'uncertainties', jsonb_build_array('The request is outside the bounded contract.'), 'assumptions', jsonb_build_array(), 'scope_limits', jsonb_build_array(), 'evidence_gaps', jsonb_build_array(), 'what_would_change_mind', '', 'revisit_condition', 'Never without a new bounded request.'))), now(), '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('f4444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd4444444-4444-4444-8444-444444444444', 1, 'synthesize', 'completed', 'm2-no-finding-step', 'luna', 'm2-fixture-v1', '{}', jsonb_build_object('summary', 'fixture', 'findings', jsonb_build_array(jsonb_build_object('outcome', 'no_finding', 'title', 'No Finding', 'conclusion', 'No attributable conclusion is warranted.', 'analysis_mode', 'synthesis', 'confidence', 0, 'supporting_evidence_ids', jsonb_build_array(), 'contrary_evidence_ids', jsonb_build_array(), 'uncertainties', jsonb_build_array('The evidence does not support a conclusion.'), 'assumptions', jsonb_build_array(), 'scope_limits', jsonb_build_array(), 'evidence_gaps', jsonb_build_array(), 'what_would_change_mind', '', 'revisit_condition', 'When new evidence arrives.'))), now(), '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('f5555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd5555555-5555-4555-8555-555555555555', 1, 'synthesize', 'completed', 'm2-malformed-step', 'luna', 'm2-fixture-v1', '{}', '{"findings":[{"outcome":"finding"}]}'::jsonb, now(), '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('f6666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd6666666-6666-4666-8666-666666666666', 1, 'synthesize', 'completed', 'm2-generic-step', 'luna', 'm2-fixture-v1', '{}', '{"findings":["generic step text"]}'::jsonb, now(), '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('f7777777-7777-4777-8777-777777777777', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'd7777777-7777-4777-8777-777777777777', 1, 'synthesize', 'completed', 'm2-foreign-step', 'luna', 'm2-fixture-v1', '{}', '{"findings":[]}'::jsonb, now(), '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222');

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'custodian_findings' and column_name = 'origin_step_id')
  and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'custodian_finding_evidence')
  and to_regprocedure('public.custodian_materialize_finding(uuid,integer)') is not null
  and to_regprocedure('public.custodian_materialize_runtime_findings(uuid,uuid)') is not null,
  'M2 attribution columns, relation table, and trusted materialization RPCs exist'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare
  response_value jsonb;
  materialized_finding_id uuid;
begin
  response_value := public.custodian_materialize_finding('f1111111-1111-4111-8111-111111111111', 0);
  materialized_finding_id := (response_value ->> 'id')::uuid;
  if response_value ->> 'origin_kind' <> 'analysis'
     or response_value ->> 'origin_run_id' <> 'd1111111-1111-4111-8111-111111111111'
     or response_value ->> 'origin_step_id' <> 'f1111111-1111-4111-8111-111111111111'
     or (select count(*) from public.custodian_finding_evidence where custodian_finding_evidence.finding_id = materialized_finding_id) <> 2
     or (select count(*) from public.custodian_finding_evidence where custodian_finding_evidence.finding_id = materialized_finding_id and relationship_kind = 'supporting') <> 1
     or (select count(*) from public.custodian_finding_evidence where custodian_finding_evidence.finding_id = materialized_finding_id and relationship_kind = 'contrary') <> 1 then
    raise exception 'valid Finding did not persist full attribution and relationships';
  end if;
end;
$$;
select ok(true, 'valid Finding persists Case, run, step, result identity, support, and contrary evidence');

do $$
declare response_value jsonb;
begin
  response_value := public.custodian_materialize_finding('f2222222-2222-4222-8222-222222222222', 0);
  if response_value ->> 'origin_kind' <> 'analysis'
     or response_value ->> 'analysis_outcome' <> 'unresolved'
     or response_value -> 'evidence_gaps' <> jsonb_build_array('Need a primary confirmation.') then
    raise exception 'unresolved Finding did not preserve its caveats';
  end if;
end;
$$;
select ok(true, 'unresolved analysis materializes with uncertainty and evidence gaps');

do $$
declare response_value jsonb;
begin
  response_value := public.custodian_materialize_finding('f3333333-3333-4333-8333-333333333333', 0);
  if coalesce((response_value ->> 'materialized')::boolean, true) then raise exception 'refusal created a Finding'; end if;
  if exists (select 1 from public.custodian_findings where origin_step_id = 'f3333333-3333-4333-8333-333333333333') then raise exception 'refusal persisted a Finding row'; end if;
end;
$$;
select ok(true, 'refusal remains a step outcome and creates no Finding');

do $$
declare response_value jsonb;
begin
  response_value := public.custodian_materialize_finding('f4444444-4444-4444-8444-444444444444', 0);
  if coalesce((response_value ->> 'materialized')::boolean, true) then raise exception 'no_finding created a Finding'; end if;
end;
$$;
select ok(true, 'no_finding remains a step outcome and creates no Finding');

do $$
begin
  begin
    perform public.custodian_materialize_finding('f5555555-5555-4555-8555-555555555555', 0);
    raise exception 'malformed candidate was accepted';
  exception when invalid_parameter_value then null; end;
end;
$$;
select ok(true, 'malformed candidate is rejected before Finding creation');

set local role postgres;
update public.agent_steps
   set output_payload = jsonb_build_object('findings', jsonb_build_array(jsonb_build_object(
     'outcome', 'finding', 'title', 'Missing evidence', 'conclusion', 'Invalid', 'analysis_mode', 'synthesis', 'confidence', 50,
     'supporting_evidence_ids', jsonb_build_array('e9999999-9999-4999-8999-999999999999'), 'contrary_evidence_ids', jsonb_build_array(),
     'uncertainties', jsonb_build_array(), 'assumptions', jsonb_build_array(), 'scope_limits', jsonb_build_array(), 'evidence_gaps', jsonb_build_array(),
     'what_would_change_mind', '', 'revisit_condition', '')))
 where id = 'f5555555-5555-4555-8555-555555555555';
set local role authenticated;
do $$
begin
  begin
    perform public.custodian_materialize_finding('f5555555-5555-4555-8555-555555555555', 0);
    raise exception 'missing evidence was accepted';
  exception when no_data_found then null; end;
end;
$$;
select ok(true, 'missing evidence reference is rejected');

set local role postgres;
update public.agent_steps
   set output_payload = jsonb_set(output_payload, '{findings,0,supporting_evidence_ids}', jsonb_build_array('e3333333-3333-4333-8333-333333333333'))
 where id = 'f5555555-5555-4555-8555-555555555555';
set local role authenticated;
do $$
begin
  begin
    perform public.custodian_materialize_finding('f5555555-5555-4555-8555-555555555555', 0);
    raise exception 'cross-owner evidence was accepted';
  exception when no_data_found then null; end;
end;
$$;
select ok(true, 'cross-owner evidence reference is rejected');

do $$
declare first_value jsonb; second_value jsonb;
begin
  first_value := public.custodian_materialize_finding('f1111111-1111-4111-8111-111111111111', 0);
  second_value := public.custodian_materialize_finding('f1111111-1111-4111-8111-111111111111', 0);
  if (second_value ->> 'id') <> (first_value ->> 'id') or (second_value ->> 'idempotent') <> 'true' then raise exception 'retry duplicated the Finding'; end if;
end;
$$;
select ok(true, 'deterministic retry returns the existing Finding');

do $$
declare
  original_finding text;
  materialized_id uuid;
begin
  select id, finding into materialized_id, original_finding
    from public.custodian_findings
   where origin_step_id = 'f1111111-1111-4111-8111-111111111111';
  begin
    perform public.custodian_upsert_finding(jsonb_build_object(
      'id', materialized_id,
      'case_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'analysis_mode', 'synthesis',
      'title', 'Tampered conclusion',
      'finding', 'This must not replace the materialized result',
      'confidence', 1
    ));
    raise exception 'owner-authored upsert rewrote an analysis Finding';
  exception when insufficient_privilege then null; end;
  if (select finding from public.custodian_findings where id = materialized_id) is distinct from original_finding then
    raise exception 'analysis Finding content changed through owner-authored upsert';
  end if;
end;
$$;
select ok(true, 'analysis-derived Findings cannot be rewritten by the owner-authored path');

set local role postgres;
update public.agent_steps
   set output_payload = jsonb_set(output_payload, '{summary}', '"changed"')
 where id = 'f1111111-1111-4111-8111-111111111111';
set local role authenticated;
do $$
begin
  begin
    perform public.custodian_materialize_finding('f1111111-1111-4111-8111-111111111111', 0);
    raise exception 'conflicting materialization identity was accepted';
  exception when unique_violation then null; end;
end;
$$;
select ok(true, 'conflicting result hash for one materialization identity fails');

do $$
begin
  begin
    perform public.custodian_materialize_finding('f6666666-6666-4666-8666-666666666666', 0);
    raise exception 'generic agent step output was accepted';
  exception when invalid_parameter_value then null; end;
end;
$$;
select ok(true, 'generic agent-step output cannot masquerade as a Finding');

set local role postgres;
update public.agent_runs
   set status = 'synthesizing', last_step_number = 1
 where id = 'd6666666-6666-4666-8666-666666666666';
set local role authenticated;
do $$
begin
  begin
    perform public.custodian_record_agent_step(
      'd6666666-6666-4666-8666-666666666666',
      jsonb_build_object(
        'step_kind', 'synthesize',
        'status', 'completed',
        'sequence_no', 2,
        'output_payload', jsonb_build_object('findings', jsonb_build_array('forged'))
      ),
      'm2-public-synthesis-forgery'
    );
    raise exception 'authenticated runtime step RPC accepted completed synthesis output';
  exception when insufficient_privilege then null; end;
  if exists (
    select 1 from public.agent_steps
     where run_id = 'd6666666-6666-4666-8666-666666666666'
       and idempotency_key = 'm2-public-synthesis-forgery'
  ) then
    raise exception 'forged completed synthesis step was persisted';
  end if;
end;
$$;
select ok(true, 'authenticated runtime step RPC cannot persist untrusted completed synthesis');

do $$
begin
  begin
    perform public.custodian_materialize_finding('f7777777-7777-4777-8777-777777777777', 0);
    raise exception 'cross-owner step was accepted';
  exception when no_data_found then null; end;
end;
$$;
select ok(true, 'cross-owner run and synthesis step references are rejected');

do $$
declare response_value jsonb;
begin
  response_value := public.custodian_upsert_finding(jsonb_build_object(
    'case_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'analysis_mode', 'plan', 'title', 'Owner authored', 'finding', 'Manual conclusion'
  ));
  if response_value ->> 'origin_kind' <> 'owner_authored' then raise exception 'owner-authored Finding was not distinguished'; end if;
end;
$$;
select ok(true, 'owner-authored Findings remain distinguishable from analysis Findings');

set local role postgres;
insert into public.custodian_findings (id, owner_id, case_id, analysis_mode, title, finding, origin_kind, created_by, updated_by)
values ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'plan', 'Legacy Finding', 'Legacy text', 'legacy', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');
set local role authenticated;
do $$
begin
  if (select origin_kind from public.custodian_findings where id = 'a1111111-1111-4111-8111-111111111111') <> 'legacy' then raise exception 'legacy Finding was falsely attributed'; end if;
end;
$$;
select ok(true, 'legacy Findings remain explicitly legacy');

set local role postgres;
insert into public.automation_rules (id, owner_id, case_id, rule_name, trigger_type, status, output_kinds, created_by, updated_by)
values ('a2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'M2 brief guard', 'manual', 'active', array['brief']::text[], '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');
insert into public.automation_runs (id, owner_id, case_id, rule_id, idempotency_key, status, created_by, updated_by)
values ('a3333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a2222222-2222-4222-8222-222222222222', 'm2-brief', 'running', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');
set local role authenticated;
do $$
begin
  begin
    perform public.custodian_automation_emit_output('a3333333-3333-4333-8333-333333333333', 'brief', '{"title":"generic","finding":"generic"}'::jsonb, 'brief-output');
    raise exception 'generic automation brief bypassed the materialization boundary';
  exception when insufficient_privilege then null; end;
end;
$$;
select ok(true, 'generic automation brief output fails closed');

do $$
begin
  if (select record_data from public.records where id = '01010101-0101-4101-8101-010101010101') <> '{"before":"unchanged"}'::jsonb then raise exception 'M2 mutated canonical records'; end if;
end;
$$;
select ok(true, 'canonical archive records remain unchanged');

do $$
begin
  begin
    insert into public.custodian_findings (owner_id, case_id, analysis_mode, title, finding, created_by, updated_by)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'plan', 'Direct write', 'must fail', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');
    raise exception 'authenticated direct Finding insert was accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
select ok(true, 'direct Finding table mutation remains protected');

do $$
declare
  materialized_id uuid;
begin
  select id into materialized_id
    from public.custodian_findings
   where origin_step_id = 'f1111111-1111-4111-8111-111111111111';
  begin
    insert into public.custodian_finding_evidence (
      owner_id, case_id, finding_id, evidence_id, relationship_kind, created_by, updated_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      materialized_id,
      'e1111111-1111-4111-8111-111111111111',
      'supporting',
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111'
    );
    raise exception 'authenticated direct Finding evidence insert was accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
select ok(true, 'direct Finding evidence relation mutation remains protected');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is((select count(*)::integer from public.custodian_findings where owner_id = '11111111-1111-4111-8111-111111111111'), 0, 'RLS hides another owner Findings');
select is((select count(*)::integer from public.custodian_finding_evidence where owner_id = '11111111-1111-4111-8111-111111111111'), 0, 'RLS hides another owner Finding evidence');

set local role postgres;
select ok(pg_catalog.pg_get_functiondef('public.custodian_automation_emit_output(uuid,text,jsonb,text)'::regprocedure) like '%generic automation brief output cannot create a Finding%', 'automation guard is installed in the live function definition');
select * from finish();
rollback;
