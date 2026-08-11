-- Custodian Release 1: authenticated, owner-derived write surface.
-- Every public mutation takes its owner from auth.uid(), obtains one
-- transaction-scoped owner lock, validates bounded inputs, and returns a
-- row-shaped JSON object. No function in this file writes public.records.

create or replace function public.custodian_current_owner()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'authenticated owner is required' using errcode = '28000';
  end if;
  return caller_id;
end;
$$;

create or replace function public.custodian_reject_owner_keys(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if payload ? 'owner_id' or payload ? 'user_id' then
    raise exception 'owner is derived from auth.uid()' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.custodian_require_text(value text, field_name text, max_length integer, required_value boolean default true)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if value is null then
    if required_value then
      raise exception '% is required', field_name using errcode = '22023';
    end if;
    return '';
  end if;
  if required_value and pg_catalog.btrim(value) = '' then
    raise exception '% must not be blank', field_name using errcode = '22023';
  end if;
  if pg_catalog.char_length(value) > max_length then
    raise exception '% exceeds maximum length', field_name using errcode = '22023';
  end if;
  return value;
end;
$$;

create or replace function public.custodian_lock(caller_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('custodian:owner:' || caller_id::text, 0)
  );
end;
$$;

revoke execute on function public.custodian_current_owner() from public, anon;
revoke execute on function public.custodian_reject_owner_keys(jsonb) from public, anon, authenticated;
revoke execute on function public.custodian_require_text(text, text, integer, boolean) from public, anon, authenticated;
revoke execute on function public.custodian_lock(uuid) from public, anon, authenticated;

create or replace function public.custodian_create_case(case_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  new_case public.cases;
  v_title text;
  v_objective text;
  v_question text;
  v_default_working_set jsonb;
begin
  if case_payload is null or pg_catalog.jsonb_typeof(case_payload) <> 'object' then
    raise exception 'case_payload must be a JSON object' using errcode = '22023';
  end if;
  perform public.custodian_reject_owner_keys(case_payload);
  perform public.custodian_lock(caller_id);

  v_title := public.custodian_require_text(case_payload ->> 'title', 'title', 300);
  v_objective := public.custodian_require_text(case_payload ->> 'objective', 'objective', 10000, false);
  v_question := public.custodian_require_text(case_payload ->> 'current_question', 'current_question', 10000, false);
  v_default_working_set := coalesce(case_payload -> 'default_working_set', '[]'::jsonb);
  if pg_catalog.jsonb_typeof(v_default_working_set) <> 'array'
     or pg_catalog.jsonb_array_length(v_default_working_set) > 500 then
    raise exception 'default_working_set must be an array of at most 500 items' using errcode = '22023';
  end if;

  insert into public.cases (
    owner_id, title, objective, current_question, default_working_set,
    status, created_by, updated_by
  ) values (
    caller_id, v_title, v_objective, v_question, v_default_working_set,
    'open', caller_id, caller_id
  ) returning * into new_case;

  return to_jsonb(new_case);
end;
$$;

create or replace function public.custodian_update_case(case_id uuid, case_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  current_case public.cases;
  updated_case public.cases;
  v_title text;
  v_objective text;
  v_question text;
  v_default_working_set jsonb;
  v_status text;
  v_closed_at timestamptz;
begin
  if case_payload is null or pg_catalog.jsonb_typeof(case_payload) <> 'object' then
    raise exception 'case_payload must be a JSON object' using errcode = '22023';
  end if;
  perform public.custodian_reject_owner_keys(case_payload);
  perform public.custodian_lock(caller_id);

  select * into current_case
    from public.cases
   where id = case_id and owner_id = caller_id
   for update;
  if not found then
    raise exception 'case not found for authenticated owner' using errcode = 'P0002';
  end if;

  v_title := public.custodian_require_text(coalesce(case_payload ->> 'title', current_case.title), 'title', 300);
  v_objective := public.custodian_require_text(coalesce(case_payload ->> 'objective', current_case.objective), 'objective', 10000, false);
  v_question := public.custodian_require_text(coalesce(case_payload ->> 'current_question', current_case.current_question), 'current_question', 10000, false);
  v_default_working_set := coalesce(case_payload -> 'default_working_set', current_case.default_working_set);
  if pg_catalog.jsonb_typeof(v_default_working_set) <> 'array'
     or pg_catalog.jsonb_array_length(v_default_working_set) > 500 then
    raise exception 'default_working_set must be an array of at most 500 items' using errcode = '22023';
  end if;
  v_status := coalesce(case_payload ->> 'status', current_case.status);
  if v_status not in ('open', 'paused', 'closed', 'archived') then
    raise exception 'invalid case status' using errcode = '22023';
  end if;
  v_closed_at := case
    when v_status = 'closed' then coalesce(nullif(case_payload ->> 'closed_at', '')::timestamptz, current_case.closed_at, now())
    else null
  end;

  update public.cases
     set title = v_title,
         objective = v_objective,
         current_question = v_question,
         default_working_set = v_default_working_set,
         status = v_status,
         closed_at = v_closed_at,
         updated_by = caller_id
   where id = case_id and owner_id = caller_id
   returning * into updated_case;

  return to_jsonb(updated_case);
end;
$$;

create or replace function public.custodian_create_inbox_item(item_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  new_item public.inbox_items;
  v_kind text;
  v_raw_content text;
  v_title text;
  v_source_label text;
  v_candidate jsonb;
begin
  if item_payload is null or pg_catalog.jsonb_typeof(item_payload) <> 'object' then
    raise exception 'item_payload must be a JSON object' using errcode = '22023';
  end if;
  perform public.custodian_reject_owner_keys(item_payload);
  perform public.custodian_lock(caller_id);
  v_kind := item_payload ->> 'kind';
  if v_kind not in ('thought', 'conversation', 'document', 'url', 'github', 'context7', 'record', 'clipboard', 'mobile_share') then
    raise exception 'invalid inbox kind' using errcode = '22023';
  end if;
  v_raw_content := public.custodian_require_text(item_payload ->> 'raw_content', 'raw_content', 200000);
  v_title := public.custodian_require_text(item_payload ->> 'title', 'title', 300, false);
  v_source_label := public.custodian_require_text(item_payload ->> 'source_label', 'source_label', 500, false);
  v_candidate := coalesce(item_payload -> 'candidate', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(v_candidate) <> 'object' or pg_column_size(v_candidate) > 1048576 then
    raise exception 'candidate must be a JSON object no larger than 1 MiB' using errcode = '22023';
  end if;

  insert into public.inbox_items (
    owner_id, kind, raw_content, title, candidate, source_label, created_by, updated_by
  ) values (
    caller_id, v_kind, v_raw_content, v_title, v_candidate, v_source_label, caller_id, caller_id
  ) returning * into new_item;

  return to_jsonb(new_item);
end;
$$;

create or replace function public.custodian_triage_inbox_item(item_id uuid, triage_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  current_item public.inbox_items;
  updated_item public.inbox_items;
  v_status text;
  v_candidate jsonb;
begin
  if triage_payload is null or pg_catalog.jsonb_typeof(triage_payload) <> 'object' then
    raise exception 'triage_payload must be a JSON object' using errcode = '22023';
  end if;
  perform public.custodian_reject_owner_keys(triage_payload);
  perform public.custodian_lock(caller_id);
  select * into current_item from public.inbox_items
   where id = item_id and owner_id = caller_id for update;
  if not found then
    raise exception 'inbox item not found for authenticated owner' using errcode = 'P0002';
  end if;
  if current_item.status in ('promoted', 'archived') then
    raise exception 'inbox item lifecycle cannot be triaged again' using errcode = '22023';
  end if;
  v_status := coalesce(triage_payload ->> 'status', 'triaged');
  if v_status not in ('triaged', 'dismissed', 'archived') then
    raise exception 'invalid inbox triage status' using errcode = '22023';
  end if;
  v_candidate := coalesce(triage_payload -> 'candidate', current_item.candidate);
  if pg_catalog.jsonb_typeof(v_candidate) <> 'object' or pg_column_size(v_candidate) > 1048576 then
    raise exception 'candidate must be a JSON object no larger than 1 MiB' using errcode = '22023';
  end if;

  update public.inbox_items
     set status = v_status,
         candidate = v_candidate,
         triaged_at = now(),
         updated_by = caller_id
   where id = item_id and owner_id = caller_id
   returning * into updated_item;
  return to_jsonb(updated_item);
end;
$$;

create or replace function public.custodian_upsert_claim(claim_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  current_claim public.claims;
  returned_claim public.claims;
  v_id uuid;
  v_case_id uuid;
  v_statement text;
  v_status text;
  v_confidence integer;
  v_change_mind text;
  v_revisit text;
  v_source_record_id uuid;
  v_lifecycle text;
begin
  if claim_payload is null or pg_catalog.jsonb_typeof(claim_payload) <> 'object' then
    raise exception 'claim_payload must be a JSON object' using errcode = '22023';
  end if;
  perform public.custodian_reject_owner_keys(claim_payload);
  perform public.custodian_lock(caller_id);
  v_id := nullif(claim_payload ->> 'id', '')::uuid;
  if v_id is not null then
    select * into current_claim from public.claims where id = v_id and owner_id = caller_id for update;
    if not found then raise exception 'claim not found for authenticated owner' using errcode = 'P0002'; end if;
    v_case_id := current_claim.case_id;
  else
    v_case_id := nullif(claim_payload ->> 'case_id', '')::uuid;
    if v_case_id is null then raise exception 'case_id is required for a new claim' using errcode = '22023'; end if;
  end if;
  if not exists (select 1 from public.cases c where c.owner_id = caller_id and c.id = v_case_id) then
    raise exception 'case not found for authenticated owner' using errcode = 'P0002';
  end if;
  v_statement := public.custodian_require_text(coalesce(claim_payload ->> 'statement', current_claim.statement), 'statement', 20000);
  v_status := coalesce(claim_payload ->> 'status', coalesce(current_claim.status, 'observed'));
  if v_status not in ('observed', 'reported', 'inferred', 'disputed', 'falsified', 'unresolved') then raise exception 'invalid claim status' using errcode = '22023'; end if;
  v_confidence := coalesce((claim_payload ->> 'confidence')::integer, coalesce(current_claim.confidence, 0));
  if v_confidence not between 0 and 100 then raise exception 'confidence must be between 0 and 100' using errcode = '22023'; end if;
  v_change_mind := public.custodian_require_text(coalesce(claim_payload ->> 'what_would_change_mind', current_claim.what_would_change_mind), 'what_would_change_mind', 10000, false);
  v_revisit := public.custodian_require_text(coalesce(claim_payload ->> 'revisit_condition', current_claim.revisit_condition), 'revisit_condition', 10000, false);
  v_source_record_id := nullif(coalesce(claim_payload ->> 'source_record_id', current_claim.source_record_id::text), '')::uuid;
  v_lifecycle := coalesce(claim_payload ->> 'lifecycle_status', coalesce(current_claim.lifecycle_status, 'active'));
  if v_lifecycle not in ('active', 'superseded', 'archived') then raise exception 'invalid claim lifecycle status' using errcode = '22023'; end if;

  if v_id is null then
    insert into public.claims (owner_id, case_id, statement, status, confidence, what_would_change_mind, revisit_condition, source_record_id, lifecycle_status, created_by, updated_by)
    values (caller_id, v_case_id, v_statement, v_status, v_confidence, v_change_mind, v_revisit, v_source_record_id, v_lifecycle, caller_id, caller_id)
    returning * into returned_claim;
  else
    update public.claims set statement = v_statement, status = v_status, confidence = v_confidence, what_would_change_mind = v_change_mind, revisit_condition = v_revisit, source_record_id = v_source_record_id, lifecycle_status = v_lifecycle, updated_by = caller_id
     where id = v_id and owner_id = caller_id returning * into returned_claim;
  end if;
  return to_jsonb(returned_claim);
end;
$$;

create or replace function public.custodian_upsert_evidence(evidence_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  current_evidence public.evidence_items;
  returned_evidence public.evidence_items;
  v_id uuid;
  v_case_id uuid;
  v_title text;
  v_content jsonb;
  v_hash text;
  v_classification text;
  v_source_uri text;
  v_source_record_id uuid;
  v_provenance jsonb;
  v_lifecycle text;
  v_supersedes_id uuid;
begin
  if evidence_payload is null or pg_catalog.jsonb_typeof(evidence_payload) <> 'object' then raise exception 'evidence_payload must be a JSON object' using errcode = '22023'; end if;
  perform public.custodian_reject_owner_keys(evidence_payload);
  perform public.custodian_lock(caller_id);
  v_id := nullif(evidence_payload ->> 'id', '')::uuid;
  if v_id is not null then
    select * into current_evidence from public.evidence_items where id = v_id and owner_id = caller_id for update;
    if not found then raise exception 'evidence item not found for authenticated owner' using errcode = 'P0002'; end if;
    v_case_id := current_evidence.case_id;
  else
    v_case_id := nullif(evidence_payload ->> 'case_id', '')::uuid;
    if v_case_id is null then raise exception 'case_id is required for new evidence' using errcode = '22023'; end if;
  end if;
  if not exists (select 1 from public.cases c where c.owner_id = caller_id and c.id = v_case_id) then raise exception 'case not found for authenticated owner' using errcode = 'P0002'; end if;
  v_title := public.custodian_require_text(coalesce(evidence_payload ->> 'title', coalesce(current_evidence.title, '')), 'title', 500, false);
  v_content := coalesce(evidence_payload -> 'content', current_evidence.content, '{}'::jsonb);
  v_hash := coalesce(evidence_payload ->> 'content_hash', current_evidence.content_hash);
  v_classification := coalesce(evidence_payload ->> 'source_classification', current_evidence.source_classification);
  v_source_uri := public.custodian_require_text(coalesce(evidence_payload ->> 'source_uri', coalesce(current_evidence.source_uri, '')), 'source_uri', 4000, false);
  v_source_record_id := nullif(coalesce(evidence_payload ->> 'source_record_id', current_evidence.source_record_id::text), '')::uuid;
  v_provenance := coalesce(evidence_payload -> 'provenance', current_evidence.provenance, '{}'::jsonb);
  v_lifecycle := coalesce(evidence_payload ->> 'lifecycle_status', coalesce(current_evidence.lifecycle_status, 'active'));
  v_supersedes_id := nullif(coalesce(evidence_payload ->> 'supersedes_id', current_evidence.supersedes_id::text), '')::uuid;
  if v_hash is null or v_hash !~ '^[0-9a-fA-F]{16,128}$' then raise exception 'content_hash must be a hexadecimal digest' using errcode = '22023'; end if;
  if v_classification not in ('primary', 'secondary', 'tertiary', 'self_report', 'inference', 'unknown') then raise exception 'invalid evidence source classification' using errcode = '22023'; end if;
  if pg_catalog.jsonb_typeof(v_provenance) <> 'object' then raise exception 'provenance must be a JSON object' using errcode = '22023'; end if;
  if v_lifecycle not in ('active', 'superseded', 'rejected', 'archived') then raise exception 'invalid evidence lifecycle status' using errcode = '22023'; end if;
  if v_id is not null and (
    (evidence_payload ? 'content' and v_content is distinct from current_evidence.content)
    or (evidence_payload ? 'content_hash' and v_hash is distinct from current_evidence.content_hash)
    or (evidence_payload ? 'source_classification' and v_classification is distinct from current_evidence.source_classification)
    or (evidence_payload ? 'source_uri' and v_source_uri is distinct from current_evidence.source_uri)
    or (evidence_payload ? 'source_record_id' and v_source_record_id is distinct from current_evidence.source_record_id)
    or (evidence_payload ? 'provenance' and v_provenance is distinct from current_evidence.provenance)
  ) then
    raise exception 'immutable evidence provenance cannot be changed' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.evidence_items (owner_id, case_id, title, content, content_hash, source_classification, source_uri, source_record_id, provenance, lifecycle_status, supersedes_id, created_by, updated_by)
    values (caller_id, v_case_id, v_title, v_content, v_hash, v_classification, v_source_uri, v_source_record_id, v_provenance, v_lifecycle, v_supersedes_id, caller_id, caller_id)
    returning * into returned_evidence;
  else
    update public.evidence_items set title = v_title, lifecycle_status = v_lifecycle, supersedes_id = v_supersedes_id, updated_by = caller_id
     where id = v_id and owner_id = caller_id returning * into returned_evidence;
  end if;
  return to_jsonb(returned_evidence);
end;
$$;

create or replace function public.custodian_upsert_action(action_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  current_action public.actions;
  returned_action public.actions;
  v_id uuid;
  v_case_id uuid;
  v_title text;
  v_description text;
  v_status text;
  v_priority integer;
  v_due_at timestamptz;
  v_source_record_id uuid;
  v_lifecycle text;
begin
  if action_payload is null or pg_catalog.jsonb_typeof(action_payload) <> 'object' then raise exception 'action_payload must be a JSON object' using errcode = '22023'; end if;
  perform public.custodian_reject_owner_keys(action_payload);
  perform public.custodian_lock(caller_id);
  v_id := nullif(action_payload ->> 'id', '')::uuid;
  if v_id is not null then
    select * into current_action from public.actions where id = v_id and owner_id = caller_id for update;
    if not found then raise exception 'action not found for authenticated owner' using errcode = 'P0002'; end if;
    v_case_id := current_action.case_id;
  else
    v_case_id := nullif(action_payload ->> 'case_id', '')::uuid;
    if v_case_id is null then raise exception 'case_id is required for a new action' using errcode = '22023'; end if;
  end if;
  if not exists (select 1 from public.cases c where c.owner_id = caller_id and c.id = v_case_id) then raise exception 'case not found for authenticated owner' using errcode = 'P0002'; end if;
  v_title := public.custodian_require_text(coalesce(action_payload ->> 'title', current_action.title), 'title', 500);
  v_description := public.custodian_require_text(coalesce(action_payload ->> 'description', coalesce(current_action.description, '')), 'description', 20000, false);
  v_status := coalesce(action_payload ->> 'status', coalesce(current_action.status, 'proposed'));
  if v_status not in ('proposed', 'ready', 'in_progress', 'blocked', 'completed', 'cancelled', 'deferred') then raise exception 'invalid action status' using errcode = '22023'; end if;
  v_priority := coalesce((action_payload ->> 'priority')::integer, coalesce(current_action.priority, 50));
  if v_priority not between 0 and 100 then raise exception 'priority must be between 0 and 100' using errcode = '22023'; end if;
  v_due_at := nullif(coalesce(action_payload ->> 'due_at', current_action.due_at::text), '')::timestamptz;
  v_source_record_id := nullif(coalesce(action_payload ->> 'source_record_id', current_action.source_record_id::text), '')::uuid;
  v_lifecycle := coalesce(action_payload ->> 'lifecycle_status', coalesce(current_action.lifecycle_status, 'active'));
  if v_lifecycle not in ('active', 'archived') then raise exception 'invalid action lifecycle status' using errcode = '22023'; end if;

  if v_id is null then
    insert into public.actions (owner_id, case_id, title, description, status, priority, due_at, source_record_id, lifecycle_status, created_by, updated_by)
    values (caller_id, v_case_id, v_title, v_description, v_status, v_priority, v_due_at, v_source_record_id, v_lifecycle, caller_id, caller_id)
    returning * into returned_action;
  else
    update public.actions set title = v_title, description = v_description, status = v_status, priority = v_priority, due_at = v_due_at, source_record_id = v_source_record_id, lifecycle_status = v_lifecycle, updated_by = caller_id
     where id = v_id and owner_id = caller_id returning * into returned_action;
  end if;
  return to_jsonb(returned_action);
end;
$$;

create or replace function public.custodian_upsert_finding(finding_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  current_finding public.custodian_findings;
  returned_finding public.custodian_findings;
  v_id uuid;
  v_case_id uuid;
  v_mode text;
  v_title text;
  v_finding text;
  v_confidence integer;
  v_change_mind text;
  v_revisit text;
  v_source_record_id uuid;
  v_status text;
  v_lifecycle text;
begin
  if finding_payload is null or pg_catalog.jsonb_typeof(finding_payload) <> 'object' then raise exception 'finding_payload must be a JSON object' using errcode = '22023'; end if;
  perform public.custodian_reject_owner_keys(finding_payload);
  perform public.custodian_lock(caller_id);
  v_id := nullif(finding_payload ->> 'id', '')::uuid;
  if v_id is not null then
    select * into current_finding from public.custodian_findings where id = v_id and owner_id = caller_id for update;
    if not found then raise exception 'finding not found for authenticated owner' using errcode = 'P0002'; end if;
    v_case_id := current_finding.case_id;
  else
    v_case_id := nullif(finding_payload ->> 'case_id', '')::uuid;
    if v_case_id is null then raise exception 'case_id is required for a new finding' using errcode = '22023'; end if;
  end if;
  if not exists (select 1 from public.cases c where c.owner_id = caller_id and c.id = v_case_id) then raise exception 'case not found for authenticated owner' using errcode = 'P0002'; end if;
  v_mode := coalesce(finding_payload ->> 'analysis_mode', coalesce(current_finding.analysis_mode, 'plan'));
  if v_mode not in ('plan', 'claim_review', 'evidence_gap', 'contradiction', 'timeline', 'causal', 'risk', 'decision', 'synthesis') then raise exception 'invalid finding analysis mode' using errcode = '22023'; end if;
  v_title := public.custodian_require_text(coalesce(finding_payload ->> 'title', current_finding.title), 'title', 500);
  v_finding := public.custodian_require_text(coalesce(finding_payload ->> 'finding', current_finding.finding), 'finding', 30000);
  v_confidence := coalesce((finding_payload ->> 'confidence')::integer, coalesce(current_finding.confidence, 0));
  if v_confidence not between 0 and 100 then raise exception 'confidence must be between 0 and 100' using errcode = '22023'; end if;
  v_change_mind := public.custodian_require_text(coalesce(finding_payload ->> 'what_would_change_mind', current_finding.what_would_change_mind), 'what_would_change_mind', 10000, false);
  v_revisit := public.custodian_require_text(coalesce(finding_payload ->> 'revisit_condition', current_finding.revisit_condition), 'revisit_condition', 10000, false);
  v_source_record_id := nullif(coalesce(finding_payload ->> 'source_record_id', current_finding.source_record_id::text), '')::uuid;
  v_status := coalesce(finding_payload ->> 'status', coalesce(current_finding.status, 'draft'));
  v_lifecycle := coalesce(finding_payload ->> 'lifecycle_status', coalesce(current_finding.lifecycle_status, 'active'));
  if v_status not in ('draft', 'open', 'resolved', 'superseded', 'archived') then raise exception 'invalid finding status' using errcode = '22023'; end if;
  if v_lifecycle not in ('active', 'archived') then raise exception 'invalid finding lifecycle status' using errcode = '22023'; end if;

  if v_id is null then
    insert into public.custodian_findings (owner_id, case_id, analysis_mode, title, finding, confidence, what_would_change_mind, revisit_condition, source_record_id, status, lifecycle_status, created_by, updated_by)
    values (caller_id, v_case_id, v_mode, v_title, v_finding, v_confidence, v_change_mind, v_revisit, v_source_record_id, v_status, v_lifecycle, caller_id, caller_id)
    returning * into returned_finding;
  else
    update public.custodian_findings set analysis_mode = v_mode, title = v_title, finding = v_finding, confidence = v_confidence, what_would_change_mind = v_change_mind, revisit_condition = v_revisit, source_record_id = v_source_record_id, status = v_status, lifecycle_status = v_lifecycle, updated_by = caller_id
     where id = v_id and owner_id = caller_id returning * into returned_finding;
  end if;
  return to_jsonb(returned_finding);
end;
$$;

create or replace function public.custodian_link_claim_evidence(claim_id uuid, evidence_id uuid, relationship_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  claim_row public.claims;
  evidence_row public.evidence_items;
  returned_link public.claim_evidence;
begin
  perform public.custodian_lock(caller_id);
  select * into claim_row from public.claims where id = claim_id and owner_id = caller_id for update;
  if not found then raise exception 'claim not found for authenticated owner' using errcode = 'P0002'; end if;
  select * into evidence_row from public.evidence_items where id = evidence_id and owner_id = caller_id for update;
  if not found then raise exception 'evidence item not found for authenticated owner' using errcode = 'P0002'; end if;
  if claim_row.case_id <> evidence_row.case_id then raise exception 'claim and evidence must belong to the same case' using errcode = '23514'; end if;
  relationship_note := public.custodian_require_text(relationship_note, 'relationship_note', 10000, false);

  insert into public.claim_evidence (owner_id, case_id, claim_id, evidence_id, relationship_note, created_by, updated_by)
  values (caller_id, claim_row.case_id, claim_id, evidence_id, relationship_note, caller_id, caller_id)
  on conflict (owner_id, case_id, claim_id, evidence_id) do update
    set relationship_note = excluded.relationship_note,
        lifecycle_status = 'active',
        updated_by = caller_id
  returning * into returned_link;
  return to_jsonb(returned_link);
end;
$$;

create or replace function public.custodian_promote_inbox_item(item_id uuid, target_kind text, target_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  item_row public.inbox_items;
  current_claim public.claims;
  current_evidence public.evidence_items;
  current_action public.actions;
  current_finding public.custodian_findings;
  promoted_id uuid;
  promoted_row jsonb;
  v_candidate jsonb;
  v_content jsonb;
  v_hash text;
  v_status text;
  v_confidence integer;
begin
  perform public.custodian_lock(caller_id);
  if target_kind not in ('claim', 'evidence_item', 'action', 'custodian_finding') then raise exception 'invalid promotion target' using errcode = '22023'; end if;
  if not exists (select 1 from public.cases c where c.owner_id = caller_id and c.id = target_case_id) then raise exception 'case not found for authenticated owner' using errcode = 'P0002'; end if;
  select * into item_row from public.inbox_items where id = item_id and owner_id = caller_id for update;
  if not found then raise exception 'inbox item not found for authenticated owner' using errcode = 'P0002'; end if;
  if item_row.status in ('promoted', 'dismissed', 'archived') then raise exception 'inbox item cannot be promoted from its current lifecycle' using errcode = '22023'; end if;
  v_candidate := item_row.candidate;

  if target_kind = 'claim' then
    v_status := coalesce(v_candidate ->> 'status', 'observed');
    v_confidence := coalesce((v_candidate ->> 'confidence')::integer, 0);
    if v_status not in ('observed', 'reported', 'inferred', 'disputed', 'falsified', 'unresolved') or v_confidence not between 0 and 100 then raise exception 'candidate claim has invalid status or confidence' using errcode = '22023'; end if;
    insert into public.claims (owner_id, case_id, statement, status, confidence, what_would_change_mind, revisit_condition, source_record_id, created_by, updated_by)
    values (caller_id, target_case_id, public.custodian_require_text(coalesce(v_candidate ->> 'statement', item_row.raw_content), 'statement', 20000), v_status, v_confidence, public.custodian_require_text(v_candidate ->> 'what_would_change_mind', 'what_would_change_mind', 10000, false), public.custodian_require_text(v_candidate ->> 'revisit_condition', 'revisit_condition', 10000, false), nullif(v_candidate ->> 'source_record_id', '')::uuid, caller_id, caller_id)
    returning * into current_claim;
    promoted_id := current_claim.id;
    promoted_row := to_jsonb(current_claim);
  elsif target_kind = 'evidence_item' then
    v_content := coalesce(v_candidate -> 'content', jsonb_build_object('text', item_row.raw_content));
    v_hash := coalesce(v_candidate ->> 'content_hash', pg_catalog.md5(item_row.raw_content));
    if v_hash !~ '^[0-9a-fA-F]{16,128}$' then raise exception 'candidate evidence has invalid content_hash' using errcode = '22023'; end if;
    insert into public.evidence_items (owner_id, case_id, title, content, content_hash, source_classification, source_uri, provenance, created_by, updated_by)
    values (caller_id, target_case_id, public.custodian_require_text(coalesce(v_candidate ->> 'title', item_row.title), 'title', 500, false), v_content, v_hash, coalesce(v_candidate ->> 'source_classification', 'unknown'), public.custodian_require_text(coalesce(v_candidate ->> 'source_uri', ''), 'source_uri', 4000, false), coalesce(v_candidate -> 'provenance', jsonb_build_object('inbox_item_id', item_row.id)), caller_id, caller_id)
    returning * into current_evidence;
    promoted_id := current_evidence.id;
    promoted_row := to_jsonb(current_evidence);
  elsif target_kind = 'action' then
    insert into public.actions (owner_id, case_id, title, description, status, priority, source_record_id, created_by, updated_by)
    values (caller_id, target_case_id, public.custodian_require_text(coalesce(v_candidate ->> 'title', item_row.title, item_row.raw_content), 'title', 500), public.custodian_require_text(coalesce(v_candidate ->> 'description', item_row.raw_content), 'description', 20000, false), coalesce(v_candidate ->> 'status', 'proposed'), coalesce((v_candidate ->> 'priority')::integer, 50), nullif(v_candidate ->> 'source_record_id', '')::uuid, caller_id, caller_id)
    returning * into current_action;
    promoted_id := current_action.id;
    promoted_row := to_jsonb(current_action);
  else
    insert into public.custodian_findings (owner_id, case_id, analysis_mode, title, finding, confidence, what_would_change_mind, revisit_condition, source_record_id, created_by, updated_by)
    values (caller_id, target_case_id, coalesce(v_candidate ->> 'analysis_mode', 'plan'), public.custodian_require_text(coalesce(v_candidate ->> 'title', item_row.title, 'Promoted finding'), 'title', 500), public.custodian_require_text(coalesce(v_candidate ->> 'finding', item_row.raw_content), 'finding', 30000), coalesce((v_candidate ->> 'confidence')::integer, 0), public.custodian_require_text(v_candidate ->> 'what_would_change_mind', 'what_would_change_mind', 10000, false), public.custodian_require_text(v_candidate ->> 'revisit_condition', 'revisit_condition', 10000, false), nullif(v_candidate ->> 'source_record_id', '')::uuid, caller_id, caller_id)
    returning * into current_finding;
    promoted_id := current_finding.id;
    promoted_row := to_jsonb(current_finding);
  end if;

  update public.inbox_items
     set status = 'promoted', promoted_kind = target_kind, promoted_id = promoted_id, triaged_at = coalesce(triaged_at, now()), updated_by = caller_id
   where id = item_id and owner_id = caller_id;
  return jsonb_build_object('inbox_item', to_jsonb(item_row) || jsonb_build_object('status', 'promoted', 'promoted_kind', target_kind, 'promoted_id', promoted_id), 'promoted', promoted_row);
end;
$$;

-- Public RPCs are callable only by authenticated clients. Direct table writes
-- remain revoked by the preceding migration. Internal helpers stay private.
revoke execute on function public.custodian_create_case(jsonb) from public, anon;
revoke execute on function public.custodian_update_case(uuid, jsonb) from public, anon;
revoke execute on function public.custodian_create_inbox_item(jsonb) from public, anon;
revoke execute on function public.custodian_triage_inbox_item(uuid, jsonb) from public, anon;
revoke execute on function public.custodian_upsert_claim(jsonb) from public, anon;
revoke execute on function public.custodian_upsert_evidence(jsonb) from public, anon;
revoke execute on function public.custodian_upsert_action(jsonb) from public, anon;
revoke execute on function public.custodian_upsert_finding(jsonb) from public, anon;
revoke execute on function public.custodian_link_claim_evidence(uuid, uuid, text) from public, anon;
revoke execute on function public.custodian_promote_inbox_item(uuid, text, uuid) from public, anon;

grant execute on function public.custodian_create_case(jsonb) to authenticated;
grant execute on function public.custodian_update_case(uuid, jsonb) to authenticated;
grant execute on function public.custodian_create_inbox_item(jsonb) to authenticated;
grant execute on function public.custodian_triage_inbox_item(uuid, jsonb) to authenticated;
grant execute on function public.custodian_upsert_claim(jsonb) to authenticated;
grant execute on function public.custodian_upsert_evidence(jsonb) to authenticated;
grant execute on function public.custodian_upsert_action(jsonb) to authenticated;
grant execute on function public.custodian_upsert_finding(jsonb) to authenticated;
grant execute on function public.custodian_link_claim_evidence(uuid, uuid, text) to authenticated;
grant execute on function public.custodian_promote_inbox_item(uuid, text, uuid) to authenticated;
