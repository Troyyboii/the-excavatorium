-- 0003_rls_privileges.sql
-- Row-level security and explicit table-privilege revocations. Only
-- owner-scoped SELECT policies exist. All INSERT/UPDATE/DELETE flow
-- through SECURITY DEFINER RPCs in later migrations.

alter table public.profiles enable row level security;
alter table public.records enable row level security;
alter table public.record_links enable row level security;
alter table public.app_metadata enable row level security;

-- Owner-scoped SELECT policies only.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists records_select_own on public.records;
create policy records_select_own on public.records
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists record_links_select_own on public.record_links;
create policy record_links_select_own on public.record_links
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists app_metadata_select_own on public.app_metadata;
create policy app_metadata_select_own on public.app_metadata
  for select
  to authenticated
  using (user_id = auth.uid());

-- Reset table privileges to the minimum required surface. All roles except
-- the table owner start with no privileges; only authenticated receives
-- owner-scoped SELECT (enforced by RLS policies above).
revoke all privileges on public.profiles from public, anon, authenticated;
revoke all privileges on public.records from public, anon, authenticated;
revoke all privileges on public.record_links from public, anon, authenticated;
revoke all privileges on public.app_metadata from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.records to authenticated;
grant select on public.record_links to authenticated;
grant select on public.app_metadata to authenticated;
