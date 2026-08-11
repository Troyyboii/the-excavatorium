-- 0006_write_rpcs.sql
-- Protected write RPCs: save_record_with_links, delete_record_safely.
-- Every RPC:
--   * derives caller_id from auth.uid() and rejects a null caller
--   * never accepts a target user UUID
--   * uses schema-qualified names and an empty search_path
--   * acquires the per-user advisory lock before mutation
--   * runs SECURITY DEFINER
--   * lets exceptions abort the transaction (no swallowing)
--   * is granted EXECUTE only to authenticated

-- --------------------------------------------------------------
-- save_record_with_links(record_payload jsonb, selected_target_ids uuid[])
-- --------------------------------------------------------------
create or replace function public.save_record_with_links(
  record_payload jsonb,
  selected_target_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  incoming_id uuid;
  final_id uuid;
  rec_type text;
  rec_title text;
  rec_summary text;
  rec_tags text[];
  rec_data jsonb;
  existing_is_example boolean;
  existing_seed_key text;
  is_new boolean := true;
  t uuid;
  ref_val text;
  ref_uuid uuid;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  if record_payload is null or pg_catalog.jsonb_typeof(record_payload) <> 'object' then
    raise exception 'record_payload must be a JSON object' using errcode = '22023';
  end if;

  rec_type := record_payload ->> 'recordType';
  rec_title := pg_catalog.btrim(coalesce(record_payload ->> 'title', ''));
  rec_summary := coalesce(record_payload ->> 'summary', '');
  rec_data := coalesce(record_payload -> 'recordData', '{}'::jsonb);
  if record_payload ? 'tags' then
    select coalesce(array_agg(x), '{}')
      into rec_tags
      from (
        select distinct pg_catalog.btrim(value) as x
        from pg_catalog.jsonb_array_elements_text(record_payload -> 'tags')
        where pg_catalog.btrim(value) <> ''
      ) t;
  else
    rec_tags := '{}';
  end if;

  if rec_type not in ('tool','repository','conversation','decision') then
    raise exception 'invalid recordType: %', coalesce(rec_type,'(null)') using errcode = '22023';
  end if;
  if rec_title = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;

  perform public.assert_record_data_valid(rec_type, rec_data);

  -- Tool replacement + Decision supersession reference checks: must be
  -- caller-owned, of matching type, and never the current record.
  incoming_id := nullif(record_payload ->> 'id', '')::uuid;

  if rec_type = 'tool' then
    ref_val := rec_data ->> 'replacementToolId';
    if ref_val is not null then
      ref_uuid := ref_val::uuid;
      if incoming_id is not null and ref_uuid = incoming_id then
        raise exception 'tool.replacementToolId cannot reference the current record' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.records
        where id = ref_uuid and user_id = caller_id and record_type = 'tool'
      ) then
        raise exception 'tool.replacementToolId must reference a caller-owned Tool' using errcode = '22023';
      end if;
    end if;
  elsif rec_type = 'decision' then
    ref_val := rec_data ->> 'supersedesDecisionId';
    if ref_val is not null then
      ref_uuid := ref_val::uuid;
      if incoming_id is not null and ref_uuid = incoming_id then
        raise exception 'decision.supersedesDecisionId cannot reference the current record' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.records
        where id = ref_uuid and user_id = caller_id and record_type = 'decision'
      ) then
        raise exception 'decision.supersedesDecisionId must reference a caller-owned Decision' using errcode = '22023';
      end if;
    end if;
  end if;

  -- Determine new-vs-update while preserving stored example identity.
  if incoming_id is not null then
    select is_example, seed_key into existing_is_example, existing_seed_key
      from public.records where id = incoming_id and user_id = caller_id;
    if found then
      is_new := false;
    end if;
  end if;

  if is_new then
    final_id := coalesce(incoming_id, pg_catalog.gen_random_uuid());
    insert into public.records (
      id, user_id, record_type, title, summary, tags, record_data,
      is_example, seed_key
    )
    values (
      final_id, caller_id, rec_type, rec_title, rec_summary, rec_tags, rec_data,
      false, null
    );
  else
    final_id := incoming_id;
    update public.records
       set title = rec_title,
           summary = rec_summary,
           tags = rec_tags,
           record_data = rec_data,
           record_type = rec_type,
           -- preserve stored example identity regardless of client input
           is_example = existing_is_example,
           seed_key = existing_seed_key,
           updated_at = now()
     where id = final_id and user_id = caller_id;
  end if;

  -- Reconcile generic links touching this record.
  -- 1. delete existing links between this record and any target not in
  --    the new selection.
  delete from public.record_links l
   where l.user_id = caller_id
     and (l.source_record_id = final_id or l.target_record_id = final_id)
     and (
       selected_target_ids is null
       or not (
         case when l.source_record_id = final_id then l.target_record_id else l.source_record_id end
         = any(selected_target_ids)
       )
     );

  -- 2. insert missing pairs; reject self, verify ownership. Reciprocal
  --    duplicates are blocked by the (user_id, record_low_id, record_high_id)
  --    unique index.
  if selected_target_ids is not null then
    foreach t in array selected_target_ids loop
      if t = final_id then
        raise exception 'self-links are not allowed' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.records
         where id = t and user_id = caller_id
      ) then
        raise exception 'link target % is not caller-owned', t using errcode = '42501';
      end if;
      if not exists (
        select 1 from public.record_links
         where user_id = caller_id
           and record_low_id = least(final_id, t)
           and record_high_id = greatest(final_id, t)
      ) then
        insert into public.record_links (user_id, source_record_id, target_record_id, seed_key)
        values (caller_id, final_id, t, null);
      end if;
    end loop;
  end if;

  return jsonb_build_object('id', final_id, 'isNew', is_new);
end;
$$;

revoke execute on function public.save_record_with_links(jsonb, uuid[]) from public;
revoke execute on function public.save_record_with_links(jsonb, uuid[]) from anon;
grant execute on function public.save_record_with_links(jsonb, uuid[]) to authenticated;

-- --------------------------------------------------------------
-- delete_record_safely(record_id uuid)
-- --------------------------------------------------------------
create or replace function public.delete_record_safely(
  record_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  rec_type text;
  removed_links integer := 0;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if record_id is null then
    raise exception 'record_id is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  select record_type into rec_type
    from public.records where id = record_id and user_id = caller_id;
  if not found then
    raise exception 'record not found' using errcode = '02000';
  end if;

  with deleted as (
    delete from public.record_links
     where user_id = caller_id
       and (source_record_id = record_id or target_record_id = record_id)
     returning 1
  )
  select count(*) into removed_links from deleted;

  -- Clear same-user Tool replacement references pointing to the deleted Tool.
  if rec_type = 'tool' then
    update public.records
       set record_data = pg_catalog.jsonb_set(record_data, '{replacementToolId}', 'null'::jsonb, true),
           updated_at = now()
     where user_id = caller_id
       and record_type = 'tool'
       and (record_data ->> 'replacementToolId') = record_id::text;
  end if;

  -- Clear same-user Decision supersession references pointing to the deleted Decision.
  if rec_type = 'decision' then
    update public.records
       set record_data = pg_catalog.jsonb_set(record_data, '{supersedesDecisionId}', 'null'::jsonb, true),
           updated_at = now()
     where user_id = caller_id
       and record_type = 'decision'
       and (record_data ->> 'supersedesDecisionId') = record_id::text;
  end if;

  delete from public.records where id = record_id and user_id = caller_id;

  return jsonb_build_object('deletedId', record_id, 'removedLinks', removed_links);
end;
$$;

revoke execute on function public.delete_record_safely(uuid) from public;
revoke execute on function public.delete_record_safely(uuid) from anon;
grant execute on function public.delete_record_safely(uuid) to authenticated;
