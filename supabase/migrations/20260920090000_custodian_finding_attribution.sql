-- Custodian M2: Findings are explicit, attributable interpretations. Generic
-- agent_steps.output_payload remains runtime data and is never a Finding by
-- itself. Analysis-derived Findings can only be created by the protected
-- materialization RPC below.

create or replace function public.custodian_finding_string_array_valid(
  value jsonb,
  max_items integer,
  max_item_length integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if value is null or pg_catalog.jsonb_typeof(value) <> 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_array_length(value) > max_items then
    return false;
  end if;
  return not exists (
    select 1
      from pg_catalog.jsonb_array_elements(value) item
     where pg_catalog.jsonb_typeof(item) <> 'string'
        or pg_catalog.btrim(item #>> '{}') = ''
        or pg_catalog.char_length(item #>> '{}') > max_item_length
  );
end;
$$;

revoke execute on function public.custodian_finding_string_array_valid(jsonb, integer, integer)
  from public, anon, authenticated;

alter table public.custodian_findings
  add column if not exists origin_kind text,
  add column if not exists analysis_outcome text,
  add column if not exists origin_run_id uuid,
  add column if not exists origin_step_id uuid,
  add column if not exists candidate_index integer,
  add column if not exists analysis_result_hash text,
  add column if not exists uncertainties jsonb,
  add column if not exists assumptions jsonb,
  add column if not exists scope_limits jsonb,
  add column if not exists evidence_gaps jsonb;

update public.custodian_findings
   set origin_kind = 'legacy'
 where origin_kind is null;

update public.custodian_findings
   set uncertainties = '[]'::jsonb,
       assumptions = '[]'::jsonb,
       scope_limits = '[]'::jsonb,
       evidence_gaps = '[]'::jsonb
 where uncertainties is null
    or assumptions is null
    or scope_limits is null
    or evidence_gaps is null;

alter table public.custodian_findings
  alter column origin_kind set default 'owner_authored',
  alter column origin_kind set not null,
  alter column uncertainties set default '[]'::jsonb,
  alter column uncertainties set not null,
  alter column assumptions set default '[]'::jsonb,
  alter column assumptions set not null,
  alter column scope_limits set default '[]'::jsonb,
  alter column scope_limits set not null,
  alter column evidence_gaps set default '[]'::jsonb,
  alter column evidence_gaps set not null;

alter table public.custodian_findings
  add constraint custodian_findings_origin_kind_ck check (
    origin_kind in ('legacy', 'owner_authored', 'analysis')
  ),
  add constraint custodian_findings_analysis_outcome_ck check (
    analysis_outcome is null or analysis_outcome in ('finding', 'unresolved')
  ),
  add constraint custodian_findings_candidate_index_ck check (
    candidate_index is null or candidate_index between 0 and 63
  ),
  add constraint custodian_findings_result_hash_ck check (
    analysis_result_hash is null or analysis_result_hash ~ '^[0-9a-fA-F]{32}$'
  ),
  add constraint custodian_findings_origin_pair_ck check (
    (origin_kind = 'analysis'
      and origin_run_id is not null
      and origin_step_id is not null
      and candidate_index is not null
      and analysis_result_hash is not null
      and analysis_outcome is not null)
    or (origin_kind in ('legacy', 'owner_authored')
      and analysis_outcome is null
      and origin_run_id is null
      and origin_step_id is null
      and candidate_index is null
      and analysis_result_hash is null)
  ),
  add constraint custodian_findings_uncertainties_ck check (
    public.custodian_finding_string_array_valid(uncertainties, 32, 1000)
  ),
  add constraint custodian_findings_assumptions_ck check (
    public.custodian_finding_string_array_valid(assumptions, 32, 1000)
  ),
  add constraint custodian_findings_scope_limits_ck check (
    public.custodian_finding_string_array_valid(scope_limits, 32, 1000)
  ),
  add constraint custodian_findings_evidence_gaps_ck check (
    public.custodian_finding_string_array_valid(evidence_gaps, 32, 1000)
  ),
  add constraint custodian_findings_origin_run_fk foreign key (owner_id, case_id, origin_run_id)
    references public.agent_runs (owner_id, case_id, id) on delete restrict,
  add constraint custodian_findings_origin_step_fk foreign key (owner_id, case_id, origin_step_id)
    references public.agent_steps (owner_id, case_id, id) on delete restrict;

create or replace function public.custodian_reject_untrusted_completed_synthesis()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.step_kind = 'synthesize'
     and new.status = 'completed'
     and auth.uid() is not null then
    raise exception 'completed synthesis steps require a trusted runtime producer'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.custodian_reject_untrusted_completed_synthesis() from public, anon, authenticated;
drop trigger if exists agent_steps_reject_untrusted_completed_synthesis on public.agent_steps;
create trigger agent_steps_reject_untrusted_completed_synthesis
  before insert or update of step_kind, status on public.agent_steps
  for each row execute function public.custodian_reject_untrusted_completed_synthesis();

create or replace function public.custodian_reject_analysis_finding_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.origin_kind = 'analysis' and auth.uid() is not null then
    raise exception 'analysis-derived Findings are immutable through the owner-authored path'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.custodian_reject_analysis_finding_update() from public, anon, authenticated;
drop trigger if exists custodian_findings_reject_analysis_update on public.custodian_findings;
create trigger custodian_findings_reject_analysis_update
  before update on public.custodian_findings
  for each row execute function public.custodian_reject_analysis_finding_update();

create unique index if not exists custodian_findings_analysis_identity_idx
  on public.custodian_findings (owner_id, origin_step_id, candidate_index)
 where origin_kind = 'analysis';

create table if not exists public.custodian_finding_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  finding_id uuid not null,
  evidence_id uuid not null,
  relationship_kind text not null,
  relationship_note text not null default '',
  lifecycle_status text not null default 'active',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custodian_finding_evidence_finding_fk foreign key (owner_id, case_id, finding_id)
    references public.custodian_findings (owner_id, case_id, id) on delete cascade,
  constraint custodian_finding_evidence_evidence_fk foreign key (owner_id, case_id, evidence_id)
    references public.evidence_items (owner_id, case_id, id) on delete cascade,
  constraint custodian_finding_evidence_kind_ck check (relationship_kind in ('supporting', 'contrary')),
  constraint custodian_finding_evidence_note_ck check (char_length(relationship_note) <= 1000),
  constraint custodian_finding_evidence_lifecycle_ck check (lifecycle_status in ('active', 'archived')),
  constraint custodian_finding_evidence_pair_unique unique (owner_id, case_id, finding_id, evidence_id)
);

create index if not exists custodian_finding_evidence_owner_finding_idx
  on public.custodian_finding_evidence (owner_id, case_id, finding_id, relationship_kind);

drop trigger if exists custodian_finding_evidence_set_updated_at on public.custodian_finding_evidence;
create trigger custodian_finding_evidence_set_updated_at
  before update on public.custodian_finding_evidence
  for each row execute function public.set_updated_at();

alter table public.custodian_finding_evidence enable row level security;
drop policy if exists custodian_finding_evidence_select_own on public.custodian_finding_evidence;
create policy custodian_finding_evidence_select_own on public.custodian_finding_evidence
  for select to authenticated using ((select auth.uid()) = owner_id);

revoke all privileges on public.custodian_finding_evidence from public, anon, authenticated;
grant select on public.custodian_finding_evidence to authenticated;

create or replace function public.custodian_materialize_finding(
  agent_step_id uuid,
  candidate_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  step_row public.agent_steps;
  run_row public.agent_runs;
  candidate jsonb;
  findings jsonb;
  outcome_value text;
  analysis_mode_value text;
  title_value text;
  conclusion_value text;
  confidence_value integer;
  change_mind_value text;
  revisit_value text;
  uncertainties_value jsonb;
  assumptions_value jsonb;
  scope_limits_value jsonb;
  evidence_gaps_value jsonb;
  supporting_ids jsonb;
  contrary_ids jsonb;
  evidence_value text;
  evidence_uuid uuid;
  existing_finding public.custodian_findings;
  inserted_finding public.custodian_findings;
  result_hash_value text;
begin
  perform public.custodian_lock(caller_id);
  if candidate_index is null or candidate_index < 0 or candidate_index > 63 then
    raise exception 'candidate_index must be between 0 and 63' using errcode = '22023';
  end if;

  select * into step_row
    from public.agent_steps
   where owner_id = caller_id and id = agent_step_id
   for update;
  if not found then
    raise exception 'synthesis step not found for authenticated owner' using errcode = 'P0002';
  end if;
  if step_row.step_kind <> 'synthesize' or step_row.status <> 'completed' then
    raise exception 'Finding materialization requires a completed synthesize step' using errcode = '42501';
  end if;

  select * into run_row
    from public.agent_runs
   where owner_id = caller_id and case_id = step_row.case_id and id = step_row.run_id
   for update;
  if not found then
    raise exception 'originating run is not owner-scoped' using errcode = 'P0002';
  end if;

  result_hash_value := pg_catalog.md5(step_row.output_payload::text);
  select * into existing_finding
    from public.custodian_findings
   where owner_id = caller_id
     and origin_step_id = step_row.id
     and candidate_index = custodian_materialize_finding.candidate_index
   for update;
  if found then
    if existing_finding.analysis_result_hash <> result_hash_value then
      raise exception 'conflicting synthesis result for Finding materialization identity' using errcode = '23505';
    end if;
    return to_jsonb(existing_finding) || jsonb_build_object('outcome', existing_finding.analysis_outcome, 'materialized', true, 'idempotent', true);
  end if;

  if pg_catalog.jsonb_typeof(step_row.output_payload) <> 'object'
     or pg_catalog.jsonb_typeof(step_row.output_payload -> 'findings') <> 'array'
     or pg_catalog.jsonb_array_length(step_row.output_payload -> 'findings') > 64 then
    raise exception 'synthesis output does not match the structured Finding contract' using errcode = '22023';
  end if;
  findings := step_row.output_payload -> 'findings';
  candidate := findings -> custodian_materialize_finding.candidate_index;
  if candidate is null or pg_catalog.jsonb_typeof(candidate) <> 'object' then
    raise exception 'requested Finding candidate is missing or malformed' using errcode = '22023';
  end if;

  outcome_value := candidate ->> 'outcome';
  if outcome_value not in ('finding', 'unresolved', 'refusal', 'no_finding') then
    raise exception 'invalid Finding outcome' using errcode = '22023';
  end if;
  analysis_mode_value := candidate ->> 'analysis_mode';
  if analysis_mode_value not in ('plan', 'claim_review', 'evidence_gap', 'contradiction', 'timeline', 'causal', 'risk', 'decision', 'synthesis') then
    raise exception 'invalid Finding analysis mode' using errcode = '22023';
  end if;
  title_value := public.custodian_require_text(candidate ->> 'title', 'title', 500);
  conclusion_value := public.custodian_require_text(candidate ->> 'conclusion', 'conclusion', 30000);
  confidence_value := (candidate ->> 'confidence')::integer;
  if confidence_value not between 0 and 100 then
    raise exception 'confidence must be between 0 and 100' using errcode = '22023';
  end if;
  change_mind_value := public.custodian_require_text(candidate ->> 'what_would_change_mind', 'what_would_change_mind', 10000, false);
  revisit_value := public.custodian_require_text(candidate ->> 'revisit_condition', 'revisit_condition', 10000, false);

  uncertainties_value := candidate -> 'uncertainties';
  assumptions_value := candidate -> 'assumptions';
  scope_limits_value := candidate -> 'scope_limits';
  evidence_gaps_value := candidate -> 'evidence_gaps';
  if not public.custodian_finding_string_array_valid(uncertainties_value, 32, 1000)
     or not public.custodian_finding_string_array_valid(assumptions_value, 32, 1000)
     or not public.custodian_finding_string_array_valid(scope_limits_value, 32, 1000)
     or not public.custodian_finding_string_array_valid(evidence_gaps_value, 32, 1000) then
    raise exception 'Finding caveats must be bounded non-empty string arrays' using errcode = '22023';
  end if;

  supporting_ids := candidate -> 'supporting_evidence_ids';
  contrary_ids := candidate -> 'contrary_evidence_ids';
  if supporting_ids is null or contrary_ids is null
     or pg_catalog.jsonb_typeof(supporting_ids) <> 'array'
     or pg_catalog.jsonb_typeof(contrary_ids) <> 'array'
     or pg_catalog.jsonb_array_length(supporting_ids) > 32
     or pg_catalog.jsonb_array_length(contrary_ids) > 32
     or not public.custodian_finding_string_array_valid(supporting_ids, 32, 100)
     or not public.custodian_finding_string_array_valid(contrary_ids, 32, 100) then
    raise exception 'Finding evidence references must be bounded non-empty UUID string arrays' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements_text(supporting_ids) value
    group by value having count(*) > 1
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements_text(contrary_ids) value
    group by value having count(*) > 1
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements_text(supporting_ids) supporting(value)
      join pg_catalog.jsonb_array_elements_text(contrary_ids) contrary(value)
        on supporting.value = contrary.value
  ) then
    raise exception 'Finding evidence references must be non-duplicated' using errcode = '22023';
  end if;
  if outcome_value = 'finding' and pg_catalog.jsonb_array_length(supporting_ids) = 0 then
    raise exception 'a conclusive Finding requires supporting evidence' using errcode = '22023';
  end if;
  if outcome_value = 'unresolved'
     and pg_catalog.jsonb_array_length(uncertainties_value) = 0
     and pg_catalog.jsonb_array_length(evidence_gaps_value) = 0 then
    raise exception 'an unresolved result requires uncertainty or evidence gaps' using errcode = '22023';
  end if;

  if outcome_value in ('refusal', 'no_finding') then
    return jsonb_build_object('materialized', false, 'outcome', outcome_value, 'idempotent', false);
  end if;

  for evidence_value in select value from pg_catalog.jsonb_array_elements_text(supporting_ids)
  loop
    begin
      evidence_uuid := evidence_value::uuid;
    exception when invalid_text_representation then
      raise exception 'Finding evidence reference is not a UUID' using errcode = '22023';
    end;
    if not exists (
      select 1 from public.evidence_items
       where owner_id = caller_id and case_id = step_row.case_id and id = evidence_uuid
    ) then
      raise exception 'supporting evidence is missing or outside the Case' using errcode = 'P0002';
    end if;
  end loop;
  for evidence_value in select value from pg_catalog.jsonb_array_elements_text(contrary_ids)
  loop
    begin
      evidence_uuid := evidence_value::uuid;
    exception when invalid_text_representation then
      raise exception 'Finding evidence reference is not a UUID' using errcode = '22023';
    end;
    if not exists (
      select 1 from public.evidence_items
       where owner_id = caller_id and case_id = step_row.case_id and id = evidence_uuid
    ) then
      raise exception 'contrary evidence is missing or outside the Case' using errcode = 'P0002';
    end if;
  end loop;

  insert into public.custodian_findings (
    owner_id, case_id, analysis_mode, title, finding, confidence,
    what_would_change_mind, revisit_condition, status, lifecycle_status,
    origin_kind, analysis_outcome, origin_run_id, origin_step_id, candidate_index, analysis_result_hash,
    uncertainties, assumptions, scope_limits, evidence_gaps, created_by, updated_by
  ) values (
    caller_id, step_row.case_id, analysis_mode_value, title_value, conclusion_value, confidence_value,
    change_mind_value, revisit_value, 'open', 'active', 'analysis', outcome_value, run_row.id, step_row.id,
    custodian_materialize_finding.candidate_index, result_hash_value,
    uncertainties_value, assumptions_value, scope_limits_value, evidence_gaps_value, caller_id, caller_id
  ) returning * into inserted_finding;

  for evidence_value in select value from pg_catalog.jsonb_array_elements_text(supporting_ids)
  loop
    evidence_uuid := evidence_value::uuid;
    insert into public.custodian_finding_evidence (
      owner_id, case_id, finding_id, evidence_id, relationship_kind, created_by, updated_by
    ) values (caller_id, step_row.case_id, inserted_finding.id, evidence_uuid, 'supporting', caller_id, caller_id);
  end loop;
  for evidence_value in select value from pg_catalog.jsonb_array_elements_text(contrary_ids)
  loop
    evidence_uuid := evidence_value::uuid;
    insert into public.custodian_finding_evidence (
      owner_id, case_id, finding_id, evidence_id, relationship_kind, created_by, updated_by
    ) values (caller_id, step_row.case_id, inserted_finding.id, evidence_uuid, 'contrary', caller_id, caller_id);
  end loop;

  return to_jsonb(inserted_finding) || jsonb_build_object('outcome', outcome_value, 'materialized', true, 'idempotent', false);
end;
$$;

revoke execute on function public.custodian_materialize_finding(uuid, integer) from public, anon;
grant execute on function public.custodian_materialize_finding(uuid, integer) to authenticated;

-- The old automation brief branch writes generic text directly to Findings.
-- Fail closed until automation can submit the same reviewed structured result.
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
  if output_kind = 'brief' then
    raise exception 'generic automation brief output cannot create a Finding' using errcode = '42501';
  elsif output_kind = 'evidence' then
    title_value := public.custodian_require_text(payload ->> 'title', 'title', 500);
    content_value := coalesce(payload -> 'content', payload);
    source_record_value := public.custodian_runtime_uuid(payload ->> 'source_record_id', 'source_record_id');
    if source_record_value is not null and not exists (
      select 1 from public.records where user_id = caller_id and id = source_record_value
    ) then raise exception 'automation evidence source record is not owner-scoped' using errcode = 'P0002'; end if;
    insert into public.evidence_items (
      owner_id, case_id, title, content, content_hash, source_classification,
      source_uri, source_record_id, provenance, immutable, created_by, updated_by
    ) values (
      caller_id, run_row.case_id, title_value, content_value, pg_catalog.md5(content_value::text),
      'inference', public.custodian_require_text(payload ->> 'source_uri', 'source_uri', 4000, false),
      source_record_value, coalesce(payload -> 'provenance', '{}'::jsonb), true, caller_id, caller_id
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
     set status = 'completed', output_kind = output_kind, output_artifact_id = artifact_id,
         output_idempotency_key = output_key, completed_at = pg_catalog.now(), updated_by = caller_id
   where owner_id = caller_id and id = run_row.id
   returning * into run_row;
  perform public.custodian_runtime_write_audit(
    caller_id, run_row.case_id, run_row.agent_run_id, 'created', 'automation_emit_output',
    output_kind, artifact_id, jsonb_build_object('automation_run_id', run_row.id)
  );
  return jsonb_build_object('automation_run', to_jsonb(run_row), 'artifact_id', artifact_id, 'idempotent', false);
end;
$$;

revoke execute on function public.custodian_automation_emit_output(uuid, text, jsonb, text) from public, anon;
grant execute on function public.custodian_automation_emit_output(uuid, text, jsonb, text) to authenticated;
