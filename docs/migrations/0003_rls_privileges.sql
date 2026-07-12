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

-- Revoke direct mutation privileges from every non-owner role.
revoke insert, update, delete on public.profiles from public, anon, authenticated;
revoke insert, update, delete on public.records from public, anon, authenticated;
revoke insert, update, delete on public.record_links from public, anon, authenticated;
revoke insert, update, delete on public.app_metadata from public, anon, authenticated;

-- Grant only the owner-scoped SELECT surface to authenticated. Anon has
-- no access to archive data.
grant select on public.profiles to authenticated;
grant select on public.records to authenticated;
grant select on public.record_links to authenticated;
grant select on public.app_metadata to authenticated;

revoke all on public.profiles from anon;
revoke all on public.records from anon;
revoke all on public.record_links from anon;
revoke all on public.app_metadata from anon;
