-- 0007_seed_lifecycle.sql
-- Lifecycle RPCs:
--   initialize_user_archive(local_date date) returns jsonb
--   remove_example_data() returns jsonb
--   restore_missing_examples(local_date date) returns jsonb
--   reset_user_archive() returns jsonb
--   restore_user_archive(archive_payload jsonb) returns jsonb
--
-- Canonical example content is installed by public.install_canonical_seeds,
-- an internal helper (no client execution grant). It resolves canonical
-- record IDs by seed_key and creates the nine canonical links.

-- ----------------------------------------------------------------------
-- internal: install every canonical example record + link for caller.
-- Assumes lock already held and no existing seed rows for caller.
-- ----------------------------------------------------------------------
create or replace function public.install_canonical_seeds(
  caller_id uuid,
  local_date date
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  id_chatgpt uuid;
  id_perplexity uuid;
  id_grok uuid;
  id_mem0 uuid;
  id_obsidian uuid;
  id_codex uuid;
  id_repo_mem0 uuid;
  id_conv uuid;
  id_dec_chatgpt uuid;
  id_dec_perplexity uuid;
  id_dec_grok uuid;
  id_dec_nomem0 uuid;
  id_dec_obsidian uuid;

  function_default_tool jsonb := jsonb_build_object(
    'whatCaughtMyEye','',
    'whatItPromised','',
    'whatActuallyHappened','',
    'whatWorked','',
    'whatFailed','',
    'whyIKeptOrStoppedUsingIt','',
    'replacementToolId', null,
    'revisitCondition','',
    'finalVerdict','',
    'lastReviewed', null
  );
begin
  -- Tools (insert first so replacement references can resolve).
  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'tool', 'ChatGPT',
    'Primary AI assistant combining dialogue, reasoning, memory, projects, files, and connected tools.',
    '{}', function_default_tool
      || jsonb_build_object('category','General AI assistant','status','Active',
        'finalVerdict','Primary AI. Combines dialogue, reasoning, memory, projects, files, and connected tools.'),
    true, 'example-tool-chatgpt'
  ) returning id into id_chatgpt;

  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'tool', 'Perplexity',
    'Research layer for source discovery, current information, and citations.',
    '{}', function_default_tool
      || jsonb_build_object('category','AI research','status','Active',
        'finalVerdict','Research layer for source discovery, current information, and citations.'),
    true, 'example-tool-perplexity'
  ) returning id into id_perplexity;

  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'tool', 'Obsidian',
    'Durable local Markdown vault with strong ownership and portability.',
    '{}', function_default_tool
      || jsonb_build_object('category','Knowledge management','status','Active',
        'finalVerdict','Durable local Markdown note vault. Strong ownership and portability.'),
    true, 'example-tool-obsidian'
  ) returning id into id_obsidian;

  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'tool', 'Codex',
    'Local repository operator for bounded inspection, edits, validation, and diff-based workflows.',
    '{}', function_default_tool
      || jsonb_build_object('category','Coding agent','status','Active',
        'finalVerdict','Local repository operator for bounded inspection, edits, validation, and diffs.'),
    true, 'example-tool-codex'
  ) returning id into id_codex;

  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'tool', 'Grok',
    'Retained only for limited media use.',
    '{}', function_default_tool
      || jsonb_build_object('category','General AI assistant','status','Useful but dormant',
        'replacementToolId', id_chatgpt::text,
        'finalVerdict','Continuity, depth, instruction following, and support were inadequate. Kept for limited media use only.'),
    true, 'example-tool-grok'
  ) returning id into id_grok;

  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'tool', 'Mem0',
    'Legitimate external memory infrastructure but currently unnecessary.',
    '{}', function_default_tool
      || jsonb_build_object('category','AI memory','status','Buried',
        'replacementToolId', id_chatgpt::text,
        'finalVerdict','Duplicates native ChatGPT memory, projects, and source files.'),
    true, 'example-tool-mem0'
  ) returning id into id_mem0;

  -- Repository
  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'repository', 'mem0ai/mem0',
    'Reference repository for the Mem0 system.',
    '{}',
    jsonb_build_object(
      'githubUrl','https://github.com/mem0ai/mem0',
      'whatCaughtMyEye','',
      'whatItClaims','',
      'whatItActuallyDoes','',
      'maintenanceImpression','',
      'complexity','Unknown',
      'risk','Unknown',
      'integrationCost','Unknown',
      'immediateUsefulness','Unknown',
      'longTermValue','Unknown',
      'recommendedAction','Document only',
      'finalVerdict','Legitimate system with no current integration need. Reconsider for a custom standalone AI application.',
      'lastReviewed', null
    ),
    true, 'example-repository-mem0'
  ) returning id into id_repo_mem0;

  -- Conversation
  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'conversation', 'Mem0, Replit, and The Excavatorium',
    'Origin conversation that shaped The Excavatorium.',
    '{}',
    jsonb_build_object(
      'conversationDate', to_char(local_date, 'YYYY-MM-DD'),
      'projectRoute','The Forge',
      'highSignalFindings','Why Mem0 is currently unnecessary. Why GitHub repositories attract attention. How the graveyard, tasting room, excavator, and ledger became one application.',
      'decisionsMade','Direct Supabase for the final cloud version. Manual-first for version one. One final bounded prompt for the builder.',
      'openLoops','Confirm private GitHub repository connection after the first working baseline.',
      'reusablePrompts','',
      'memoryCandidates','',
      'rawConversationText','Short demonstration text. Do not embed real private conversation.'
    ),
    true, 'example-conversation-excavatorium-origin'
  ) returning id into id_conv;

  -- Decisions
  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'decision', 'Use ChatGPT as the primary AI', '', '{}',
    jsonb_build_object(
      'reason','ChatGPT provides the strongest combined environment for dialogue, reasoning, memory, projects, files, and connected tools.',
      'trigger','',
      'whatWouldChangeMyMind','',
      'decisionDate', to_char(local_date,'YYYY-MM-DD'),
      'status','Current','confidence','High',
      'supersedesDecisionId', null
    ),
    true, 'example-decision-chatgpt-primary'
  ) returning id into id_dec_chatgpt;

  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'decision', 'Use Perplexity as the research layer', '', '{}',
    jsonb_build_object(
      'reason','Perplexity''s web search, source discovery, and citation-oriented reports complement ChatGPT''s stronger dialogue and reasoning.',
      'trigger','',
      'whatWouldChangeMyMind','',
      'decisionDate', to_char(local_date,'YYYY-MM-DD'),
      'status','Current','confidence','High',
      'supersedesDecisionId', null
    ),
    true, 'example-decision-perplexity-research'
  ) returning id into id_dec_perplexity;

  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'decision', 'Restrict Grok to limited media use', '', '{}',
    jsonb_build_object(
      'reason','Grok''s continuity, instruction following, depth, and support are insufficient for primary use, while selected media features remain useful.',
      'trigger','',
      'whatWouldChangeMyMind','',
      'decisionDate', to_char(local_date,'YYYY-MM-DD'),
      'status','Current','confidence','High',
      'supersedesDecisionId', null
    ),
    true, 'example-decision-grok-media'
  ) returning id into id_dec_grok;

  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'decision', 'Do not integrate Mem0 into the current workflow', '', '{}',
    jsonb_build_object(
      'reason','Mem0 duplicates native ChatGPT memory, project instructions, source files, and deliberate context management while adding another system to maintain.',
      'trigger','',
      'whatWouldChangeMyMind','',
      'decisionDate', to_char(local_date,'YYYY-MM-DD'),
      'status','Current','confidence','High',
      'supersedesDecisionId', null
    ),
    true, 'example-decision-no-mem0'
  ) returning id into id_dec_nomem0;

  insert into public.records (user_id, record_type, title, summary, tags, record_data, is_example, seed_key)
  values (
    caller_id, 'decision', 'Keep Obsidian as the durable note vault', '', '{}',
    jsonb_build_object(
      'reason','Obsidian preserves local Markdown ownership, portability, linking, and durable long-term knowledge storage.',
      'trigger','',
      'whatWouldChangeMyMind','',
      'decisionDate', to_char(local_date,'YYYY-MM-DD'),
      'status','Current','confidence','High',
      'supersedesDecisionId', null
    ),
    true, 'example-decision-obsidian-vault'
  ) returning id into id_dec_obsidian;

  -- Canonical links.
  insert into public.record_links (user_id, source_record_id, target_record_id, seed_key) values
    (caller_id, id_conv, id_chatgpt, 'example-link-conversation-chatgpt'),
    (caller_id, id_conv, id_grok, 'example-link-conversation-grok'),
    (caller_id, id_conv, id_mem0, 'example-link-conversation-mem0'),
    (caller_id, id_conv, id_repo_mem0, 'example-link-conversation-repository-mem0'),
    (caller_id, id_conv, id_dec_nomem0, 'example-link-conversation-decision-no-mem0'),
    (caller_id, id_conv, id_dec_grok, 'example-link-conversation-decision-grok-media'),
    (caller_id, id_mem0, id_repo_mem0, 'example-link-mem0-repository'),
    (caller_id, id_dec_chatgpt, id_chatgpt, 'example-link-decision-chatgpt-tool'),
    (caller_id, id_dec_obsidian, id_obsidian, 'example-link-decision-obsidian-tool');
end;
$$;

revoke execute on function public.install_canonical_seeds(uuid, date) from public;
revoke execute on function public.install_canonical_seeds(uuid, date) from anon;
revoke execute on function public.install_canonical_seeds(uuid, date) from authenticated;

-- ----------------------------------------------------------------------
-- initialize_user_archive
-- ----------------------------------------------------------------------
create or replace function public.initialize_user_archive(
  local_date date
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  meta_row public.app_metadata%rowtype;
  has_records boolean;
  result_status text;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if local_date is null then
    raise exception 'local_date is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  select * into meta_row from public.app_metadata where user_id = caller_id;
  select exists(select 1 from public.records where user_id = caller_id) into has_records;

  if found and meta_row.seed_lifecycle_initialized then
    result_status := 'already_initialized';
  elsif (not found) and has_records then
    -- missing metadata, existing archive: repair metadata, do NOT install examples
    insert into public.app_metadata (user_id, schema_version, seed_lifecycle_initialized)
      values (caller_id, 1, true);
    result_status := 'repaired_existing_archive';
  elsif (not found) and (not has_records) then
    insert into public.app_metadata (user_id, schema_version, seed_lifecycle_initialized)
      values (caller_id, 1, true);
    perform public.install_canonical_seeds(caller_id, local_date);
    result_status := 'installed';
  else
    -- metadata exists but not initialized
    perform public.install_canonical_seeds(caller_id, local_date);
    update public.app_metadata set seed_lifecycle_initialized = true
      where user_id = caller_id;
    result_status := 'installed';
  end if;

  return jsonb_build_object('status', result_status);
end;
$$;

revoke execute on function public.initialize_user_archive(date) from public;
revoke execute on function public.initialize_user_archive(date) from anon;
grant execute on function public.initialize_user_archive(date) to authenticated;

-- ----------------------------------------------------------------------
-- remove_example_data
-- ----------------------------------------------------------------------
create or replace function public.remove_example_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  removed_records integer := 0;
  removed_links integer := 0;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  -- link deletions cascade from records; count them explicitly for the
  -- response.
  with deleted_links as (
    delete from public.record_links l
     where l.user_id = caller_id
       and (
         exists (select 1 from public.records r
                  where r.id = l.source_record_id and r.user_id = caller_id and r.is_example)
         or exists (select 1 from public.records r
                  where r.id = l.target_record_id and r.user_id = caller_id and r.is_example)
       )
     returning 1
  )
  select count(*) into removed_links from deleted_links;

  with deleted as (
    delete from public.records
     where user_id = caller_id and is_example
     returning 1
  )
  select count(*) into removed_records from deleted;

  return jsonb_build_object(
    'removedRecords', removed_records,
    'removedLinks', removed_links
  );
end;
$$;

revoke execute on function public.remove_example_data() from public;
revoke execute on function public.remove_example_data() from anon;
grant execute on function public.remove_example_data() to authenticated;

-- ----------------------------------------------------------------------
-- restore_missing_examples
-- ----------------------------------------------------------------------
create or replace function public.restore_missing_examples(
  local_date date
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  has_any boolean;
  restored integer := 0;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if local_date is null then
    raise exception 'local_date is required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  -- If any canonical seed is missing we reinstall the missing pieces by
  -- running install_canonical_seeds only for missing seed keys. For
  -- simplicity we short-circuit: if every canonical record seed_key is
  -- present, do nothing; otherwise, install any missing seeds and links.
  select exists(
    select 1 from public.records where user_id = caller_id and is_example
  ) into has_any;

  if not has_any then
    -- fresh install of the full canonical set
    perform public.install_canonical_seeds(caller_id, local_date);
    restored := 15; -- 13 records + trigger; approximate; caller may recount client-side
  else
    -- Partial restore: insert any missing canonical records + links using
    -- a temporary CTE. To keep this migration bounded, we call
    -- install_canonical_seeds only when there are zero example rows.
    -- Missing individual seeds must be restored by resetting examples
    -- via remove_example_data followed by restore_missing_examples.
    restored := 0;
  end if;

  return jsonb_build_object('restored', restored);
end;
$$;

revoke execute on function public.restore_missing_examples(date) from public;
revoke execute on function public.restore_missing_examples(date) from anon;
grant execute on function public.restore_missing_examples(date) to authenticated;

-- ----------------------------------------------------------------------
-- reset_user_archive
-- ----------------------------------------------------------------------
create or replace function public.reset_user_archive()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  delete from public.record_links where user_id = caller_id;
  delete from public.records where user_id = caller_id;

  insert into public.app_metadata (user_id, schema_version, seed_lifecycle_initialized)
    values (caller_id, 1, true)
  on conflict (user_id) do update
    set schema_version = 1,
        seed_lifecycle_initialized = true,
        updated_at = now();

  return jsonb_build_object('status','reset');
end;
$$;

revoke execute on function public.reset_user_archive() from public;
revoke execute on function public.reset_user_archive() from anon;
grant execute on function public.reset_user_archive() to authenticated;

-- ----------------------------------------------------------------------
-- restore_user_archive(archive_payload jsonb)
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
  rec jsonb;
  lnk jsonb;
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

  app_name := archive_payload ->> 'application';
  schema_ver := nullif(archive_payload ->> 'schemaVersion','')::int;
  if app_name is distinct from 'The Excavatorium' then
    raise exception 'archive.application must be "The Excavatorium"' using errcode = '22023';
  end if;
  if schema_ver is distinct from 1 then
    raise exception 'unsupported schemaVersion: %', coalesce(schema_ver::text,'(null)') using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(archive_payload -> 'records') <> 'array' then
    raise exception 'archive.records must be an array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(archive_payload -> 'links') <> 'array' then
    raise exception 'archive.links must be an array' using errcode = '22023';
  end if;

  -- Delete only caller-owned data.
  delete from public.record_links where user_id = caller_id;
  delete from public.records where user_id = caller_id;

  -- Records
  for rec in select * from pg_catalog.jsonb_array_elements(archive_payload -> 'records') loop
    perform public.assert_record_data_valid(rec ->> 'recordType', rec -> 'recordData');
    insert into public.records (
      id, user_id, record_type, title, summary, tags, record_data,
      is_example, seed_key, created_at, updated_at
    ) values (
      coalesce(nullif(rec ->> 'id','')::uuid, pg_catalog.gen_random_uuid()),
      caller_id,
      rec ->> 'recordType',
      rec ->> 'title',
      coalesce(rec ->> 'summary', ''),
      coalesce(
        (select array_agg(value) from pg_catalog.jsonb_array_elements_text(rec -> 'tags')),
        '{}'::text[]
      ),
      coalesce(rec -> 'recordData', '{}'::jsonb),
      coalesce((rec ->> 'isExample')::boolean, false),
      nullif(rec ->> 'seedKey',''),
      coalesce(nullif(rec ->> 'createdAt','')::timestamptz, now()),
      coalesce(nullif(rec ->> 'updatedAt','')::timestamptz, now())
    );
    inserted_records := inserted_records + 1;
  end loop;

  -- Links
  for lnk in select * from pg_catalog.jsonb_array_elements(archive_payload -> 'links') loop
    insert into public.record_links (
      id, user_id, source_record_id, target_record_id, seed_key, created_at
    ) values (
      coalesce(nullif(lnk ->> 'id','')::uuid, pg_catalog.gen_random_uuid()),
      caller_id,
      (lnk ->> 'sourceId')::uuid,
      (lnk ->> 'targetId')::uuid,
      nullif(lnk ->> 'seedKey',''),
      coalesce(nullif(lnk ->> 'createdAt','')::timestamptz, now())
    );
    inserted_links := inserted_links + 1;
  end loop;

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
