-- New accounts start EMPTY. No example records, no owner-specific default
-- content, and nothing already stored for an existing owner is touched.
begin;

select plan(14);

set local role postgres;

-- A brand-new signup goes through the real on_auth_user_created trigger.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'authenticated', 'authenticated', 'fresh-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
  ('a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', 'authenticated', 'authenticated', 'existing-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

select is(
  (select count(*)::integer from public.profiles where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  1,
  'signup creates a profile'
);

select is(
  (select seed_lifecycle_initialized from public.app_metadata where user_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  true,
  'signup creates initialized app metadata so no seed step is ever needed'
);

select is(
  (select count(*)::integer from public.records where user_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1')
  + (select count(*)::integer from public.record_links where user_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  0,
  'a new account has no records and no links'
);

-- An existing owner whose archive already holds example-flagged rows that
-- mention The Forge. Nothing below may change them.
insert into public.records (id, user_id, record_type, title, summary, tags, record_data, is_example, seed_key) values
  ('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', 'tool', 'Kept example', 'kept', array['keep'], '{"projectRoute":"The Forge"}'::jsonb, true, 'example-tool-chatgpt'),
  ('b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', 'tool', 'Owner row', 'mine', array['mine'], '{"note":"The Chamber"}'::jsonb, false, null);

create temporary table before_state on commit drop as
select id, title, summary, tags, record_data, is_example, seed_key, updated_at
  from public.records
 where user_id = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
grant select on before_state to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', true);

select is(
  public.initialize_user_archive(current_date) ->> 'status',
  'already_initialized',
  'initialize_user_archive on a new account only reports its state'
);

select is(
  (public.restore_missing_examples(current_date) ->> 'insertedRecords')::integer
  + (public.restore_missing_examples(current_date) ->> 'insertedLinks')::integer,
  0,
  'restore_missing_examples installs nothing'
);

select is(
  public.restore_missing_examples(current_date) ->> 'status',
  'examples_unavailable',
  'restore_missing_examples reports that examples are retired'
);

select is(
  (select count(*)::integer from public.records),
  0,
  'the new account is still empty after both lifecycle calls'
);

-- An account that lost its metadata row but has data is repaired, not seeded.
set local role postgres;
delete from public.app_metadata where user_id = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', true);

select is(
  public.initialize_user_archive(current_date) ->> 'status',
  'repaired_existing_archive',
  'an existing archive without metadata is repaired'
);
select public.restore_missing_examples(current_date);

select is(
  (select count(*)::integer from public.records),
  2,
  'lifecycle calls add nothing to an existing owner'
);

select is(
  (
    select count(*)::integer
      from public.records r
      join before_state b using (id)
     where r.title = b.title and r.summary = b.summary and r.tags = b.tags
       and r.record_data = b.record_data and r.is_example = b.is_example
       and r.seed_key is not distinct from b.seed_key and r.updated_at = b.updated_at
  ),
  2,
  'existing rows keep their IDs, titles, tags, data, and timestamps unchanged'
);

set local role postgres;

select is(
  (
    select count(*)::integer
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'handle_new_auth_user', 'initialize_user_archive',
         'install_canonical_seeds', 'restore_missing_examples'
       )
       and (p.prosrc ilike '%The Forge%' or p.prosrc ilike '%The Chamber%' or p.prosrc ilike '%The Book%'
            or p.prosrc ilike '%projectRoute%' or p.prosrc ilike '%insert into public.records%')
  ),
  0,
  'no default-data function still contains owner-specific labels or installs records'
);

select ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.install_canonical_seeds(uuid,date)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.install_canonical_seeds(uuid,date)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated', 'public.handle_new_auth_user()', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.initialize_user_archive(date)', 'EXECUTE')
  and pg_catalog.has_function_privilege('authenticated', 'public.initialize_user_archive(date)', 'EXECUTE'),
  'grants are unchanged: internal helpers stay internal, anon cannot initialize'
);

select is(
  (select count(*)::integer from pg_catalog.pg_trigger where tgname = 'on_auth_user_created' and not tgisinternal),
  1,
  'the signup trigger is still installed exactly once'
);

select is(
  (select count(*)::integer from public.records where user_id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  0,
  'the new account stays empty after every step'
);

select * from finish();
rollback;
