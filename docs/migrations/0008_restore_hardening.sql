-- 0008_restore_hardening.sql
-- Server-side hardening for backup restore and record updates.
--
-- Purpose:
--   1. Enforce at the database layer that every approved canonical record
--      seed_key belongs to exactly one record_type. Client validation is a
--      convenience — this is the actual security boundary.
--   2. Prevent save_record_with_links from mutating the stored record_type
--      of an existing row.
--   3. Rewrite restore_user_archive so every semantic check runs BEFORE the
--      caller's current records or links are deleted. Failure at any check
--      raises, the transaction rolls back, and the previous archive is
--      preserved intact.
--
-- Migrations 0001..0007 remain unchanged.

-- ----------------------------------------------------------------------
-- 1. Approved canonical seed_key ↔ record_type constraint on public.records.
--    NULL seed_key is always allowed (non-example rows).
-- ----------------------------------------------------------------------
alter table public.records
  drop constraint if exists records_approved_seed_key_type_ck;

alter table public.records
  add constraint records_approved_seed_key_type_ck
  check (
    seed_key is null
    or (seed_key = 'example-tool-chatgpt'                     and record_type = 'tool')
    or (seed_key = 'example-tool-perplexity'                  and record_type = 'tool')
    or (seed_key = 'example-tool-obsidian'                    and record_type = 'tool')
    or (seed_key = 'example-tool-codex'                       and record_type = 'tool')
    or (seed_key = 'example-tool-grok'                        and record_type = 'tool')
    or (seed_key = 'example-tool-mem0'                        and record_type = 'tool')
    or (seed_key = 'example-repository-mem0'                  and record_type = 'repository')
    or (seed_key = 'example-conversation-excavatorium-origin' and record_type = 'conversation')
    or (seed_key = 'example-decision-chatgpt-primary'         and record_type = 'decision')
    or (seed_key = 'example-decision-perplexity-research'     and record_type = 'decision')
    or (seed_key = 'example-decision-grok-media'              and record_type = 'decision')
    or (seed_key = 'example-decision-no-mem0'                 and record_type = 'decision')
    or (seed_key = 'example-decision-obsidian-vault'          and record_type = 'decision')
  );

-- ----------------------------------------------------------------------
-- 2. save_record_with_links: forbid record_type mutation on update.
--    All other behavior is preserved from 0006.
-- ----------------------------------------------------------------------
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
  existing_record_type text;
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

  if incoming_id is not null then
    select is_example, seed_key, record_type
      into existing_is_example, existing_seed_key, existing_record_type
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
    -- Reject any attempt to change record_type on an existing row.
    if existing_record_type is distinct from rec_type then
      raise exception 'record_type of an existing record cannot be changed (was %, requested %)',
        existing_record_type, rec_type
        using errcode = '22023';
    end if;
    final_id := incoming_id;
    update public.records
       set title = rec_title,
           summary = rec_summary,
           tags = rec_tags,
           record_data = rec_data,
           -- record_type is intentionally NOT reassigned; preserve it.
           is_example = existing_is_example,
           seed_key = existing_seed_key,
           updated_at = now()
     where id = final_id and user_id = caller_id;
  end if;

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

-- ----------------------------------------------------------------------
-- 3. restore_user_archive: preflight-validate every record and link before
--    touching any caller-owned row. Any failure raises, the transaction
--    rolls back, and the previous archive survives untouched.
-- ----------------------------------------------------------------------
create or replace function public.restore_user_archive(
  archive_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  app_name text;
  schema_ver int;
  exported_at text;
  rec jsonb;
  lnk jsonb;
  rec_id_txt text;
  rec_id uuid;
  rec_type text;
  rec_title text;
  rec_seed text;
  rec_is_example boolean;
  rec_created text;
  rec_updated text;
  approved_type text;
  lnk_id_txt text;
  lnk_id uuid;
  src_txt text;
  tgt_txt text;
  src_id uuid;
  tgt_id uuid;
  lnk_seed text;
  lnk_created text;
  approved_src_seed text;
  approved_tgt_seed text;
  approved_src_id uuid;
  approved_tgt_id uuid;
  inserted_records int := 0;
  inserted_links int := 0;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if archive_payload is null or pg_catalog.jsonb_typeof(archive_payload) <> 'object' then
    raise exception 'archive_payload must be a JSON object' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  -- ---- Envelope ------------------------------------------------------
  app_name := archive_payload ->> 'application';
  schema_ver := nullif(archive_payload ->> 'schemaVersion','')::int;
  exported_at := archive_payload ->> 'exportedAt';
  if app_name is distinct from 'The Excavatorium' then
    raise exception 'archive.application must be "The Excavatorium"' using errcode = '22023';
  end if;
  if schema_ver is distinct from 1 then
    raise exception 'unsupported schemaVersion: %', coalesce(schema_ver::text,'(null)') using errcode = '22023';
  end if;
  if exported_at is null or exported_at !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then
    raise exception 'archive.exportedAt must be an ISO-8601 UTC timestamp' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(archive_payload -> 'records') <> 'array' then
    raise exception 'archive.records must be an array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(archive_payload -> 'links') <> 'array' then
    raise exception 'archive.links must be an array' using errcode = '22023';
  end if;

  -- ---- Preflight staging tables (transaction-local) ------------------
  create temporary table _restore_records (
    id uuid primary key,
    record_type text not null,
    title text not null,
    summary text not null,
    tags text[] not null,
    record_data jsonb not null,
    is_example boolean not null,
    seed_key text,
    created_at timestamptz not null,
    updated_at timestamptz not null
  ) on commit drop;

  create temporary table _restore_links (
    id uuid primary key,
    source_id uuid not null,
    target_id uuid not null,
    seed_key text,
    created_at timestamptz not null
  ) on commit drop;

  -- ---- Preflight records --------------------------------------------
  -- Every field is required with an explicit JSON type. Missing or
  -- wrong-typed fields raise; no silent defaults.
  for rec in select * from pg_catalog.jsonb_array_elements(archive_payload -> 'records') loop
    if pg_catalog.jsonb_typeof(rec) <> 'object' then
      raise exception 'records[] entry is not an object' using errcode = '22023';
    end if;

    -- id: required UUID string
    if pg_catalog.jsonb_typeof(rec -> 'id') <> 'string' then
      raise exception 'record.id is required and must be a string' using errcode = '22023';
    end if;
    rec_id_txt := rec ->> 'id';
    if rec_id_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'record.id is not a UUID: %', rec_id_txt using errcode = '22023';
    end if;
    rec_id := rec_id_txt::uuid;

    -- recordType: required approved string
    if pg_catalog.jsonb_typeof(rec -> 'recordType') <> 'string' then
      raise exception 'record.recordType is required and must be a string (id %)', rec_id using errcode = '22023';
    end if;
    rec_type := rec ->> 'recordType';
    if rec_type not in ('tool','repository','conversation','decision') then
      raise exception 'record.recordType invalid: % (id %)', rec_type, rec_id using errcode = '22023';
    end if;

    -- title: required non-empty string
    if pg_catalog.jsonb_typeof(rec -> 'title') <> 'string' then
      raise exception 'record.title is required and must be a string (id %)', rec_id using errcode = '22023';
    end if;
    rec_title := rec ->> 'title';
    if pg_catalog.btrim(rec_title) = '' then
      raise exception 'record.title must be a non-empty string (id %)', rec_id using errcode = '22023';
    end if;

    -- summary: required string (empty string permitted)
    if pg_catalog.jsonb_typeof(rec -> 'summary') <> 'string' then
      raise exception 'record.summary is required and must be a string (id %)', rec_id using errcode = '22023';
    end if;

    -- tags: required JSON array of strings
    if pg_catalog.jsonb_typeof(rec -> 'tags') <> 'array' then
      raise exception 'record.tags is required and must be an array (id %)', rec_id using errcode = '22023';
    end if;
    if exists (
      select 1
        from pg_catalog.jsonb_array_elements(rec -> 'tags') as e(value)
       where pg_catalog.jsonb_typeof(e.value) <> 'string'
    ) then
      raise exception 'record.tags entries must all be strings (id %)', rec_id using errcode = '22023';
    end if;

    -- recordData: required JSON object
    if pg_catalog.jsonb_typeof(rec -> 'recordData') <> 'object' then
      raise exception 'record.recordData is required and must be a JSON object (id %)', rec_id using errcode = '22023';
    end if;

    -- isExample: required JSON boolean (not a string, not a number)
    if pg_catalog.jsonb_typeof(rec -> 'isExample') <> 'boolean' then
      raise exception 'record.isExample is required and must be a JSON boolean (id %)', rec_id using errcode = '22023';
    end if;
    rec_is_example := (rec -> 'isExample')::boolean;

    -- seedKey: required, must be JSON null or JSON string (key MUST be present)
    if not (rec ? 'seedKey') then
      raise exception 'record.seedKey is required (use null when absent) (id %)', rec_id using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(rec -> 'seedKey') not in ('null','string') then
      raise exception 'record.seedKey must be null or a string (id %)', rec_id using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(rec -> 'seedKey') = 'string' then
      rec_seed := rec ->> 'seedKey';
      if rec_seed = '' then
        raise exception 'record.seedKey must be null or a non-empty string (id %)', rec_id using errcode = '22023';
      end if;
    else
      rec_seed := null;
    end if;

    -- Exact isExample/seedKey coupling.
    if rec_is_example and rec_seed is null then
      raise exception 'record.isExample=true requires a seedKey (id %)', rec_id using errcode = '22023';
    end if;
    if (not rec_is_example) and rec_seed is not null then
      raise exception 'record.seedKey requires isExample=true (id %)', rec_id using errcode = '22023';
    end if;

    -- Approved canonical seed key and seed-key-to-recordType mapping.
    if rec_seed is not null then
      approved_type := case rec_seed
        when 'example-tool-chatgpt' then 'tool'
        when 'example-tool-perplexity' then 'tool'
        when 'example-tool-obsidian' then 'tool'
        when 'example-tool-codex' then 'tool'
        when 'example-tool-grok' then 'tool'
        when 'example-tool-mem0' then 'tool'
        when 'example-repository-mem0' then 'repository'
        when 'example-conversation-excavatorium-origin' then 'conversation'
        when 'example-decision-chatgpt-primary' then 'decision'
        when 'example-decision-perplexity-research' then 'decision'
        when 'example-decision-grok-media' then 'decision'
        when 'example-decision-no-mem0' then 'decision'
        when 'example-decision-obsidian-vault' then 'decision'
        else null
      end;
      if approved_type is null then
        raise exception 'record.seedKey % is not an approved canonical seed key', rec_seed using errcode = '22023';
      end if;
      if approved_type <> rec_type then
        raise exception 'record.seedKey % belongs to recordType %, not %', rec_seed, approved_type, rec_type using errcode = '22023';
      end if;
    end if;

    -- createdAt / updatedAt: required UTC ISO-8601 strings
    if pg_catalog.jsonb_typeof(rec -> 'createdAt') <> 'string' then
      raise exception 'record.createdAt is required and must be a string (id %)', rec_id using errcode = '22023';
    end if;
    rec_created := rec ->> 'createdAt';
    if rec_created !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then
      raise exception 'record.createdAt malformed (id %)', rec_id using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(rec -> 'updatedAt') <> 'string' then
      raise exception 'record.updatedAt is required and must be a string (id %)', rec_id using errcode = '22023';
    end if;
    rec_updated := rec ->> 'updatedAt';
    if rec_updated !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then
      raise exception 'record.updatedAt malformed (id %)', rec_id using errcode = '22023';
    end if;

    perform public.assert_record_data_valid(rec_type, rec -> 'recordData');

    -- Cross-user UUID collision (any row not owned by caller).
    if exists (
      select 1 from public.records
       where id = rec_id and user_id <> caller_id
    ) then
      raise exception 'record.id % collides with a row owned by another user', rec_id using errcode = '23505';
    end if;

    begin
      insert into _restore_records
        (id, record_type, title, summary, tags, record_data, is_example, seed_key, created_at, updated_at)
      values (
        rec_id, rec_type, rec_title,
        rec ->> 'summary',
        (select coalesce(array_agg(value), '{}'::text[])
           from pg_catalog.jsonb_array_elements_text(rec -> 'tags')),
        rec -> 'recordData',
        rec_is_example, rec_seed,
        rec_created::timestamptz, rec_updated::timestamptz
      );
    exception when unique_violation then
      raise exception 'record.id % is duplicated in archive.records', rec_id using errcode = '22023';
    end;
  end loop;

  -- Uniqueness of record seed keys within the archive.
  if exists (
    select 1 from _restore_records
     where seed_key is not null
     group by seed_key having count(*) > 1
  ) then
    raise exception 'duplicate record seedKey in archive' using errcode = '22023';
  end if;

  -- Dedicated references must resolve within the archive to the correct type.
  perform 1 from _restore_records r
   where r.record_type = 'tool'
     and (r.record_data ->> 'replacementToolId') is not null
     and not exists (
       select 1 from _restore_records t
        where t.id = (r.record_data ->> 'replacementToolId')::uuid
          and t.record_type = 'tool'
          and t.id <> r.id
     );
  if found then
    raise exception 'tool.replacementToolId must reference another Tool in the archive' using errcode = '22023';
  end if;
  perform 1 from _restore_records r
   where r.record_type = 'decision'
     and (r.record_data ->> 'supersedesDecisionId') is not null
     and not exists (
       select 1 from _restore_records d
        where d.id = (r.record_data ->> 'supersedesDecisionId')::uuid
          and d.record_type = 'decision'
          and d.id <> r.id
     );
  if found then
    raise exception 'decision.supersedesDecisionId must reference another Decision in the archive' using errcode = '22023';
  end if;

  -- ---- Preflight links ----------------------------------------------
  -- Every field is required with an explicit JSON type. Missing seedKey
  -- (i.e. key absent from the object) is rejected rather than defaulted
  -- to null; callers must send JSON null explicitly.
  for lnk in select * from pg_catalog.jsonb_array_elements(archive_payload -> 'links') loop
    if pg_catalog.jsonb_typeof(lnk) <> 'object' then
      raise exception 'links[] entry is not an object' using errcode = '22023';
    end if;

    -- id: required UUID string
    if pg_catalog.jsonb_typeof(lnk -> 'id') <> 'string' then
      raise exception 'link.id is required and must be a string' using errcode = '22023';
    end if;
    lnk_id_txt := lnk ->> 'id';
    if lnk_id_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'link.id is not a UUID: %', lnk_id_txt using errcode = '22023';
    end if;
    lnk_id := lnk_id_txt::uuid;

    -- sourceId / targetId: required UUID strings
    if pg_catalog.jsonb_typeof(lnk -> 'sourceId') <> 'string' then
      raise exception 'link.sourceId is required and must be a string (id %)', lnk_id using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(lnk -> 'targetId') <> 'string' then
      raise exception 'link.targetId is required and must be a string (id %)', lnk_id using errcode = '22023';
    end if;
    src_txt := lnk ->> 'sourceId';
    tgt_txt := lnk ->> 'targetId';
    if src_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'link.sourceId is not a UUID: % (id %)', src_txt, lnk_id using errcode = '22023';
    end if;
    if tgt_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'link.targetId is not a UUID: % (id %)', tgt_txt, lnk_id using errcode = '22023';
    end if;
    src_id := src_txt::uuid;
    tgt_id := tgt_txt::uuid;
    if src_id = tgt_id then
      raise exception 'self-links are not allowed (id %)', lnk_id using errcode = '22023';
    end if;
    if not exists (select 1 from _restore_records where id = src_id) then
      raise exception 'link.sourceId % does not reference an archive record', src_id using errcode = '22023';
    end if;
    if not exists (select 1 from _restore_records where id = tgt_id) then
      raise exception 'link.targetId % does not reference an archive record', tgt_id using errcode = '22023';
    end if;

    -- createdAt: required UTC ISO-8601 string
    if pg_catalog.jsonb_typeof(lnk -> 'createdAt') <> 'string' then
      raise exception 'link.createdAt is required and must be a string (id %)', lnk_id using errcode = '22023';
    end if;
    lnk_created := lnk ->> 'createdAt';
    if lnk_created !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then
      raise exception 'link.createdAt malformed (id %)', lnk_id using errcode = '22023';
    end if;

    -- seedKey: required key, must be JSON null or JSON string.
    if not (lnk ? 'seedKey') then
      raise exception 'link.seedKey is required (use null when absent) (id %)', lnk_id using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(lnk -> 'seedKey') not in ('null','string') then
      raise exception 'link.seedKey must be null or a string (id %)', lnk_id using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(lnk -> 'seedKey') = 'string' then
      lnk_seed := lnk ->> 'seedKey';
      if lnk_seed = '' then
        raise exception 'link.seedKey must be null or a non-empty string (id %)', lnk_id using errcode = '22023';
      end if;
    else
      lnk_seed := null;
    end if;

    if lnk_seed is not null then
      case lnk_seed
        when 'example-link-conversation-chatgpt' then
          approved_src_seed := 'example-conversation-excavatorium-origin';
          approved_tgt_seed := 'example-tool-chatgpt';
        when 'example-link-conversation-grok' then
          approved_src_seed := 'example-conversation-excavatorium-origin';
          approved_tgt_seed := 'example-tool-grok';
        when 'example-link-conversation-mem0' then
          approved_src_seed := 'example-conversation-excavatorium-origin';
          approved_tgt_seed := 'example-tool-mem0';
        when 'example-link-conversation-repository-mem0' then
          approved_src_seed := 'example-conversation-excavatorium-origin';
          approved_tgt_seed := 'example-repository-mem0';
        when 'example-link-conversation-decision-no-mem0' then
          approved_src_seed := 'example-conversation-excavatorium-origin';
          approved_tgt_seed := 'example-decision-no-mem0';
        when 'example-link-conversation-decision-grok-media' then
          approved_src_seed := 'example-conversation-excavatorium-origin';
          approved_tgt_seed := 'example-decision-grok-media';
        when 'example-link-mem0-repository' then
          approved_src_seed := 'example-tool-mem0';
          approved_tgt_seed := 'example-repository-mem0';
        when 'example-link-decision-chatgpt-tool' then
          approved_src_seed := 'example-decision-chatgpt-primary';
          approved_tgt_seed := 'example-tool-chatgpt';
        when 'example-link-decision-obsidian-tool' then
          approved_src_seed := 'example-decision-obsidian-vault';
          approved_tgt_seed := 'example-tool-obsidian';
        else
          raise exception 'link.seedKey % is not an approved canonical link seed key', lnk_seed using errcode = '22023';
      end case;

      select id into approved_src_id from _restore_records where seed_key = approved_src_seed;
      select id into approved_tgt_id from _restore_records where seed_key = approved_tgt_seed;
      if approved_src_id is null or approved_tgt_id is null then
        raise exception 'link.seedKey % requires records with seedKeys % and %',
          lnk_seed, approved_src_seed, approved_tgt_seed using errcode = '22023';
      end if;
      if src_id <> approved_src_id or tgt_id <> approved_tgt_id then
        raise exception 'link.seedKey % endpoints do not match canonical (source %, target %)',
          lnk_seed, approved_src_seed, approved_tgt_seed using errcode = '22023';
      end if;
    end if;

    -- Cross-user UUID collision on link id.
    if exists (
      select 1 from public.record_links
       where id = lnk_id and user_id <> caller_id
    ) then
      raise exception 'link.id % collides with a row owned by another user', lnk_id using errcode = '23505';
    end if;

    begin
      insert into _restore_links (id, source_id, target_id, seed_key, created_at)
        values (lnk_id, src_id, tgt_id, lnk_seed, lnk_created::timestamptz);
    exception when unique_violation then
      raise exception 'link.id % is duplicated in archive.links', lnk_id using errcode = '22023';
    end;
  end loop;

  -- Link seed key uniqueness within the archive.
  if exists (
    select 1 from _restore_links
     where seed_key is not null
     group by seed_key having count(*) > 1
  ) then
    raise exception 'duplicate link seedKey in archive' using errcode = '22023';
  end if;

  -- Unordered endpoint-pair uniqueness across the archive.
  if exists (
    select 1 from _restore_links
     group by least(source_id, target_id), greatest(source_id, target_id)
    having count(*) > 1
  ) then
    raise exception 'duplicate or reciprocal link endpoints in archive' using errcode = '22023';
  end if;

  -- ---- All checks passed: destructive replace ------------------------
  delete from public.record_links where user_id = caller_id;
  delete from public.records where user_id = caller_id;

  insert into public.records (
    id, user_id, record_type, title, summary, tags, record_data,
    is_example, seed_key, created_at, updated_at
  )
  select id, caller_id, record_type, title, summary, tags, record_data,
         is_example, seed_key, created_at, updated_at
    from _restore_records;
  get diagnostics inserted_records = row_count;

  insert into public.record_links (
    id, user_id, source_record_id, target_record_id, seed_key, created_at
  )
  select id, caller_id, source_id, target_id, seed_key, created_at
    from _restore_links;
  get diagnostics inserted_links = row_count;

  -- Preserve app_metadata identity; only refresh lifecycle marker.
  insert into public.app_metadata (user_id, schema_version, seed_lifecycle_initialized)
    values (caller_id, 1, true)
  on conflict (user_id) do update
    set schema_version = 1,
        seed_lifecycle_initialized = true,
        updated_at = now();

  return jsonb_build_object(
    'insertedRecords', inserted_records,
    'insertedLinks', inserted_links
  );
end;
$$;

revoke execute on function public.restore_user_archive(jsonb) from public;
revoke execute on function public.restore_user_archive(jsonb) from anon;
grant execute on function public.restore_user_archive(jsonb) to authenticated;
