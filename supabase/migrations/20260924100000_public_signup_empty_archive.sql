-- Public signup: new owners start with an EMPTY archive.
--
-- Historical migrations (0004, 0007) are unchanged. This migration only
-- replaces the FUTURE behavior of four functions:
--
--   handle_new_auth_user      also creates the owner's app_metadata row,
--                             already marked initialized, so the client never
--                             needs to run a seed step for a new account.
--   initialize_user_archive   no longer installs example records. It only
--                             repairs/creates app_metadata (idempotent).
--   install_canonical_seeds   internal helper; now a no-op.
--   restore_missing_examples  client-callable; now a no-op that reports the
--                             examples are unavailable. The old body installed
--                             owner-specific example rows (including
--                             `projectRoute: The Forge`).
--
-- NOT touched, by design:
--   * existing records, links, revisions, IDs, tags, titles (no backfill, no
--     cleanup, no rename). Rows an existing owner already has, including rows
--     with is_example = true, stay exactly as they are.
--   * remove_example_data, reset_user_archive, restore_user_archive and the
--     records_approved_seed_key_type_ck constraint, so an owner can still
--     remove examples they already hold and restore their own JSON backups.
--
-- Optional demo data, if ever offered again, must be a new, explicit, neutral
-- opt-in function; it must not reuse the retired helper.

-- ----------------------------------------------------------------------
-- New auth users: empty profile + initialized (empty) metadata.
-- ----------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, created_at, updated_at)
  values (new.id, now(), now())
  on conflict (id) do nothing;

  insert into public.app_metadata (user_id, schema_version, seed_lifecycle_initialized)
  values (new.id, 1, true)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public;
revoke execute on function public.handle_new_auth_user() from anon;
revoke execute on function public.handle_new_auth_user() from authenticated;

-- ----------------------------------------------------------------------
-- Retired helper: never inserts example content.
-- ----------------------------------------------------------------------
create or replace function public.install_canonical_seeds(
  caller_id uuid,
  local_date date
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Intentionally empty. Example/seed content is retired for new accounts.
  return;
end;
$$;

revoke execute on function public.install_canonical_seeds(uuid, date) from public;
revoke execute on function public.install_canonical_seeds(uuid, date) from anon;
revoke execute on function public.install_canonical_seeds(uuid, date) from authenticated;

-- ----------------------------------------------------------------------
-- initialize_user_archive: metadata only, never examples.
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
  metadata_present boolean;
  metadata_initialized boolean;
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

  select true, am.seed_lifecycle_initialized
    into metadata_present, metadata_initialized
    from public.app_metadata am
   where am.user_id = caller_id;
  if metadata_present is null then
    metadata_present := false;
  end if;

  select exists(
    select 1 from public.records where user_id = caller_id
  ) into has_records;

  if metadata_present and metadata_initialized then
    result_status := 'already_initialized';
  elsif metadata_present then
    -- Metadata exists but was never marked initialized. Mark it; add nothing.
    update public.app_metadata
       set seed_lifecycle_initialized = true,
           updated_at = now()
     where user_id = caller_id;
    result_status := 'initialized_empty';
  else
    insert into public.app_metadata (user_id, schema_version, seed_lifecycle_initialized)
      values (caller_id, 1, true);
    result_status := case when has_records then 'repaired_existing_archive' else 'initialized_empty' end;
  end if;

  return jsonb_build_object('status', result_status);
end;
$$;

revoke execute on function public.initialize_user_archive(date) from public;
revoke execute on function public.initialize_user_archive(date) from anon;
grant execute on function public.initialize_user_archive(date) to authenticated;

-- ----------------------------------------------------------------------
-- restore_missing_examples: retired. Same signature and result shape.
-- ----------------------------------------------------------------------
create or replace function public.restore_missing_examples(
  local_date date
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if local_date is null then
    raise exception 'local_date is required' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'insertedRecords', 0,
    'insertedLinks', 0,
    'status', 'examples_unavailable'
  );
end;
$$;

revoke execute on function public.restore_missing_examples(date) from public;
revoke execute on function public.restore_missing_examples(date) from anon;
grant execute on function public.restore_missing_examples(date) to authenticated;
