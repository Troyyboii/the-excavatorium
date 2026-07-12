-- 0002_indexes_triggers.sql
-- Useful indexes and the shared updated_at trigger.

create index if not exists records_user_id_idx
  on public.records (user_id);

create index if not exists records_user_type_idx
  on public.records (user_id, record_type);

create index if not exists records_user_created_idx
  on public.records (user_id, created_at);

create index if not exists records_user_updated_idx
  on public.records (user_id, updated_at);

create unique index if not exists records_user_seed_unique_idx
  on public.records (user_id, seed_key)
  where seed_key is not null;

create index if not exists record_links_user_id_idx
  on public.record_links (user_id);

create index if not exists record_links_source_idx
  on public.record_links (source_record_id);

create index if not exists record_links_target_idx
  on public.record_links (target_record_id);

create unique index if not exists record_links_user_pair_unique_idx
  on public.record_links (user_id, record_low_id, record_high_id);

create unique index if not exists record_links_user_seed_unique_idx
  on public.record_links (user_id, seed_key)
  where seed_key is not null;

-- Reusable updated_at trigger. SECURITY INVOKER, empty search_path,
-- schema-qualified. Not client-callable.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public;
revoke execute on function public.set_updated_at() from anon;
revoke execute on function public.set_updated_at() from authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists records_set_updated_at on public.records;
create trigger records_set_updated_at
  before update on public.records
  for each row execute function public.set_updated_at();

drop trigger if exists app_metadata_set_updated_at on public.app_metadata;
create trigger app_metadata_set_updated_at
  before update on public.app_metadata
  for each row execute function public.set_updated_at();
