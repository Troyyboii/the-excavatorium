-- Preserve the existing owner-only semantics while avoiding repeated auth.uid()
-- evaluation in each scanned row, and cover the two composite ownership FKs.

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists records_select_own on public.records;
create policy records_select_own
  on public.records
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists record_links_select_own on public.record_links;
create policy record_links_select_own
  on public.record_links
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists app_metadata_select_own on public.app_metadata;
create policy app_metadata_select_own
  on public.app_metadata
  for select to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists record_links_user_source_fk_idx
  on public.record_links (user_id, source_record_id);

create index if not exists record_links_user_target_fk_idx
  on public.record_links (user_id, target_record_id);
