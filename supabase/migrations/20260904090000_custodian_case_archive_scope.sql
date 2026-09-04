-- Milestone A: owner-selected canonical archive scope for Custodian Cases.
-- The legacy default_working_set remains readable for compatibility, but is
-- deliberately not part of the Case Reading contract.

alter table public.cases
  add column if not exists archive_scope jsonb not null
  default '{"record_ids":[],"free_text_context":""}'::jsonb;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.cases'::regclass
       and conname = 'cases_archive_scope_shape_ck'
  ) then
    alter table public.cases
      add constraint cases_archive_scope_shape_ck check (
        pg_catalog.jsonb_typeof(archive_scope) = 'object'
        and pg_catalog.jsonb_typeof(archive_scope -> 'record_ids') = 'array'
        and case
          when pg_catalog.jsonb_typeof(archive_scope -> 'record_ids') = 'array'
            then pg_catalog.jsonb_array_length(archive_scope -> 'record_ids') <= 50
          else false
        end
        and pg_catalog.jsonb_typeof(archive_scope -> 'free_text_context') = 'string'
        and case
          when pg_catalog.jsonb_typeof(archive_scope -> 'free_text_context') = 'string'
            then pg_catalog.char_length(archive_scope ->> 'free_text_context') <= 10000
          else false
        end
      );
  end if;
end;
$$;

create or replace function public.custodian_validate_archive_scope(
  scope_value jsonb,
  caller_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_ids_value jsonb;
  context_value text;
  record_id_text text;
  record_id_value uuid;
  normalized_record_ids jsonb := '[]'::jsonb;
begin
  if caller_id is null then
    raise exception 'authenticated owner is required' using errcode = '28000';
  end if;
  if scope_value is null or pg_catalog.jsonb_typeof(scope_value) <> 'object' then
    raise exception 'archive_scope must be a JSON object' using errcode = '22023';
  end if;

  record_ids_value := scope_value -> 'record_ids';
  if pg_catalog.jsonb_typeof(record_ids_value) is distinct from 'array' then
    raise exception 'archive_scope.record_ids must be an array of at most 50 records'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(record_ids_value) > 50 then
    raise exception 'archive_scope.record_ids must be an array of at most 50 records'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(scope_value -> 'free_text_context') is distinct from 'string' then
    raise exception 'archive_scope.free_text_context must be text' using errcode = '22023';
  end if;
  context_value := scope_value ->> 'free_text_context';
  if pg_catalog.char_length(context_value) > 10000 then
    raise exception 'archive_scope.free_text_context exceeds 10000 characters'
      using errcode = '22023';
  end if;

  for record_id_text in
    select value from pg_catalog.jsonb_array_elements_text(record_ids_value) as item(value)
  loop
    if record_id_text is null
       or record_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'archive_scope.record_ids must contain UUID strings'
        using errcode = '22023';
    end if;
    record_id_value := record_id_text::uuid;
    if normalized_record_ids @> pg_catalog.jsonb_build_array(record_id_value::text) then
      raise exception 'archive_scope.record_ids must not contain duplicates'
        using errcode = '22023';
    end if;
    if not exists (
      select 1
        from public.records r
       where r.id = record_id_value
         and r.user_id = caller_id
    ) then
      raise exception 'one or more selected archive records are unavailable to the authenticated owner'
        using errcode = 'P0002';
    end if;
    normalized_record_ids :=
      normalized_record_ids || pg_catalog.jsonb_build_array(record_id_value::text);
  end loop;

  return pg_catalog.jsonb_build_object(
    'record_ids', normalized_record_ids,
    'free_text_context', context_value
  );
end;
$$;

revoke execute on function public.custodian_validate_archive_scope(jsonb, uuid)
  from public, anon, authenticated;

create or replace function public.custodian_create_case(case_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  new_case public.cases;
  title_value text;
  objective_value text;
  question_value text;
  default_working_set_value jsonb;
  archive_scope_value jsonb;
begin
  if case_payload is null or pg_catalog.jsonb_typeof(case_payload) <> 'object' then
    raise exception 'case_payload must be a JSON object' using errcode = '22023';
  end if;
  perform public.custodian_reject_owner_keys(case_payload);
  perform public.custodian_lock(caller_id);

  title_value := public.custodian_require_text(case_payload ->> 'title', 'title', 300);
  objective_value := public.custodian_require_text(case_payload ->> 'objective', 'objective', 10000, false);
  question_value := public.custodian_require_text(case_payload ->> 'current_question', 'current_question', 10000, false);
  default_working_set_value := coalesce(case_payload -> 'default_working_set', '[]'::jsonb);
  if pg_catalog.jsonb_typeof(default_working_set_value) <> 'array'
     or pg_catalog.jsonb_array_length(default_working_set_value) > 500 then
    raise exception 'default_working_set must be an array of at most 500 items' using errcode = '22023';
  end if;
  archive_scope_value := case
    when case_payload ? 'archive_scope'
      then public.custodian_validate_archive_scope(case_payload -> 'archive_scope', caller_id)
    else '{"record_ids":[],"free_text_context":""}'::jsonb
  end;

  insert into public.cases (
    owner_id, title, objective, current_question, default_working_set, archive_scope,
    status, created_by, updated_by
  ) values (
    caller_id, title_value, objective_value, question_value, default_working_set_value, archive_scope_value,
    'open', caller_id, caller_id
  ) returning * into new_case;

  return pg_catalog.to_jsonb(new_case);
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
  title_value text;
  objective_value text;
  question_value text;
  default_working_set_value jsonb;
  archive_scope_value jsonb;
  status_value text;
  closed_at_value timestamptz;
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

  title_value := public.custodian_require_text(coalesce(case_payload ->> 'title', current_case.title), 'title', 300);
  objective_value := public.custodian_require_text(coalesce(case_payload ->> 'objective', current_case.objective), 'objective', 10000, false);
  question_value := public.custodian_require_text(coalesce(case_payload ->> 'current_question', current_case.current_question), 'current_question', 10000, false);
  default_working_set_value := coalesce(case_payload -> 'default_working_set', current_case.default_working_set);
  if pg_catalog.jsonb_typeof(default_working_set_value) <> 'array'
     or pg_catalog.jsonb_array_length(default_working_set_value) > 500 then
    raise exception 'default_working_set must be an array of at most 500 items' using errcode = '22023';
  end if;
  archive_scope_value := case
    when case_payload ? 'archive_scope'
      then public.custodian_validate_archive_scope(case_payload -> 'archive_scope', caller_id)
    else current_case.archive_scope
  end;
  status_value := coalesce(case_payload ->> 'status', current_case.status);
  if status_value not in ('open', 'paused', 'closed', 'archived') then
    raise exception 'invalid case status' using errcode = '22023';
  end if;
  closed_at_value := case
    when status_value = 'closed'
      then coalesce(
        nullif(case_payload ->> 'closed_at', '')::timestamptz,
        current_case.closed_at,
        pg_catalog.now()
      )
    else null
  end;

  update public.cases
     set title = title_value,
         objective = objective_value,
         current_question = question_value,
         default_working_set = default_working_set_value,
         archive_scope = archive_scope_value,
         status = status_value,
         closed_at = closed_at_value,
         updated_by = caller_id
   where id = case_id and owner_id = caller_id
   returning * into updated_case;

  return pg_catalog.to_jsonb(updated_case);
end;
$$;

grant execute on function public.custodian_create_case(jsonb) to authenticated;
grant execute on function public.custodian_update_case(uuid, jsonb) to authenticated;
