-- Bring-your-own OpenAI key (BYOK) for Custodian provider execution.
--
-- The key is a SECRET. Design contract for this migration:
--
--   * Postgres stores CIPHERTEXT ONLY. Encryption (AES-256-GCM, owner-bound
--     AAD) happens inside the authenticated `provider-key` Edge Function
--     using a server-only Edge secret. The database never sees plaintext and
--     holds no wrapping key.
--   * public.owner_provider_credentials has RLS enabled and NO privileges for
--     anon or authenticated: the browser can not select, insert, update or
--     delete it. Only the SECURITY DEFINER functions below touch it.
--   * The ciphertext is returned only by custodian_get_provider_credential,
--     executable only by service_role (the trusted Custodian runtime), and
--     only for the owner id the runtime derived from the caller's JWT.
--   * The browser can learn only a non-secret status (configured, last four
--     characters, key version, updated_at) via custodian_provider_key_status.
--   * The append-only event log records that a key was stored/replaced/
--     removed. It never carries key material or ciphertext.
--
-- Model preference is a separate, non-secret, owner-scoped table.

-- ----------------------------------------------------------------------
-- Credentials (ciphertext only)
-- ----------------------------------------------------------------------
create table if not exists public.owner_provider_credentials (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'openai',
  ciphertext text not null,
  key_version smallint not null,
  key_last4 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider),
  constraint owner_provider_credentials_provider_ck check (provider = 'openai'),
  constraint owner_provider_credentials_ciphertext_ck check (
    char_length(ciphertext) between 1 and 2048 and ciphertext !~ '^\s*sk-'
  ),
  constraint owner_provider_credentials_version_ck check (key_version between 1 and 1000),
  constraint owner_provider_credentials_last4_ck check (key_last4 ~ '^[A-Za-z0-9_-]{1,4}$')
);

drop trigger if exists owner_provider_credentials_set_updated_at
  on public.owner_provider_credentials;
create trigger owner_provider_credentials_set_updated_at
  before update on public.owner_provider_credentials
  for each row execute function public.set_updated_at();

alter table public.owner_provider_credentials enable row level security;
-- Deliberately no policy: with RLS on and no policy, non-bypass roles see no rows.
revoke all privileges on public.owner_provider_credentials from public, anon, authenticated;
revoke all privileges on public.owner_provider_credentials from service_role;

-- ----------------------------------------------------------------------
-- Non-secret event log (append-only)
-- ----------------------------------------------------------------------
create table if not exists public.owner_provider_credential_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'openai',
  event text not null,
  key_version smallint,
  created_at timestamptz not null default now(),
  constraint owner_provider_credential_events_provider_ck check (provider = 'openai'),
  constraint owner_provider_credential_events_event_ck check (event in ('stored', 'replaced', 'removed'))
);

create index if not exists owner_provider_credential_events_owner_idx
  on public.owner_provider_credential_events (owner_id, created_at desc);

create or replace function public.owner_provider_credential_events_reject_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'provider credential events are append-only' using errcode = '42501';
end;
$$;

revoke execute on function public.owner_provider_credential_events_reject_change()
  from public, anon, authenticated;
drop trigger if exists owner_provider_credential_events_reject_update
  on public.owner_provider_credential_events;
create trigger owner_provider_credential_events_reject_update
  before update on public.owner_provider_credential_events
  for each row execute function public.owner_provider_credential_events_reject_change();

alter table public.owner_provider_credential_events enable row level security;
drop policy if exists owner_provider_credential_events_select_own
  on public.owner_provider_credential_events;
create policy owner_provider_credential_events_select_own
  on public.owner_provider_credential_events
  for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all privileges on public.owner_provider_credential_events from public, anon, authenticated;
grant select on public.owner_provider_credential_events to authenticated;
revoke all privileges on public.owner_provider_credential_events from service_role;

-- ----------------------------------------------------------------------
-- Owner model preference (non-secret)
-- ----------------------------------------------------------------------
create table if not exists public.owner_provider_settings (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'openai',
  model_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider),
  constraint owner_provider_settings_provider_ck check (provider = 'openai'),
  constraint owner_provider_settings_model_ck check (
    public.custodian_openai_model_tier(model_name) is not null
  )
);

drop trigger if exists owner_provider_settings_set_updated_at
  on public.owner_provider_settings;
create trigger owner_provider_settings_set_updated_at
  before update on public.owner_provider_settings
  for each row execute function public.set_updated_at();

alter table public.owner_provider_settings enable row level security;
drop policy if exists owner_provider_settings_select_own on public.owner_provider_settings;
create policy owner_provider_settings_select_own
  on public.owner_provider_settings
  for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all privileges on public.owner_provider_settings from public, anon, authenticated;
grant select on public.owner_provider_settings to authenticated;
revoke all privileges on public.owner_provider_settings from service_role;

-- ----------------------------------------------------------------------
-- Owner RPCs (authenticated, owner derived from auth.uid())
-- ----------------------------------------------------------------------
create or replace function public.custodian_provider_key_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  credential public.owner_provider_credentials;
begin
  if caller_id is null then
    raise exception 'authenticated owner is required' using errcode = '28000';
  end if;
  select * into credential
    from public.owner_provider_credentials c
   where c.owner_id = caller_id and c.provider = 'openai';
  if not found then
    return pg_catalog.jsonb_build_object('configured', false);
  end if;
  return pg_catalog.jsonb_build_object(
    'configured', true,
    'last4', credential.key_last4,
    'key_version', credential.key_version,
    'updated_at', credential.updated_at
  );
end;
$$;

revoke execute on function public.custodian_provider_key_status() from public, anon;
grant execute on function public.custodian_provider_key_status() to authenticated;

create or replace function public.custodian_remove_provider_credential()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  removed_version smallint;
begin
  if caller_id is null then
    raise exception 'authenticated owner is required' using errcode = '28000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('provider-credential:' || caller_id::text, 0)
  );
  delete from public.owner_provider_credentials c
   where c.owner_id = caller_id and c.provider = 'openai'
  returning c.key_version into removed_version;
  if found then
    insert into public.owner_provider_credential_events (owner_id, event, key_version)
      values (caller_id, 'removed', removed_version);
    return pg_catalog.jsonb_build_object('configured', false, 'removed', true);
  end if;
  return pg_catalog.jsonb_build_object('configured', false, 'removed', false);
end;
$$;

revoke execute on function public.custodian_remove_provider_credential() from public, anon;
grant execute on function public.custodian_remove_provider_credential() to authenticated;

create or replace function public.custodian_set_model_preference(model_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  chosen text := model_name;
begin
  if caller_id is null then
    raise exception 'authenticated owner is required' using errcode = '28000';
  end if;
  if chosen is null or public.custodian_openai_model_tier(chosen) is null then
    raise exception 'model is not on the Custodian model list' using errcode = '22023';
  end if;
  insert into public.owner_provider_settings (owner_id, provider, model_name)
    values (caller_id, 'openai', chosen)
  on conflict (owner_id, provider) do update
    set model_name = excluded.model_name;
  return pg_catalog.jsonb_build_object(
    'model_name', chosen,
    'model_tier', public.custodian_openai_model_tier(chosen)
  );
end;
$$;

revoke execute on function public.custodian_set_model_preference(text) from public, anon;
grant execute on function public.custodian_set_model_preference(text) to authenticated;

-- ----------------------------------------------------------------------
-- Trusted-runtime RPCs (service_role only)
--
-- runtime_owner_id is derived by the Edge Function from the caller's verified
-- JWT. Neither function is reachable with anon/authenticated credentials.
-- ----------------------------------------------------------------------
create or replace function public.custodian_store_provider_credential(
  runtime_owner_id uuid,
  ciphertext text,
  key_version smallint,
  key_last4 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existed boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trusted runtime producer is required' using errcode = '42501';
  end if;
  if runtime_owner_id is null then
    raise exception 'runtime owner is required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = runtime_owner_id) then
    raise exception 'runtime owner not found' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('provider-credential:' || runtime_owner_id::text, 0)
  );
  select true into existed
    from public.owner_provider_credentials c
   where c.owner_id = runtime_owner_id and c.provider = 'openai';
  insert into public.owner_provider_credentials (
    owner_id, provider, ciphertext, key_version, key_last4
  ) values (
    runtime_owner_id, 'openai', ciphertext, key_version, key_last4
  )
  on conflict (owner_id, provider) do update
    set ciphertext = excluded.ciphertext,
        key_version = excluded.key_version,
        key_last4 = excluded.key_last4;
  insert into public.owner_provider_credential_events (owner_id, event, key_version)
    values (runtime_owner_id, case when existed then 'replaced' else 'stored' end, key_version);
  return pg_catalog.jsonb_build_object(
    'configured', true,
    'last4', key_last4,
    'key_version', key_version
  );
end;
$$;

revoke execute on function public.custodian_store_provider_credential(uuid, text, smallint, text)
  from public, anon, authenticated;
grant execute on function public.custodian_store_provider_credential(uuid, text, smallint, text)
  to service_role;

create or replace function public.custodian_get_provider_credential(runtime_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  credential public.owner_provider_credentials;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'trusted runtime producer is required' using errcode = '42501';
  end if;
  if runtime_owner_id is null then
    raise exception 'runtime owner is required' using errcode = '22023';
  end if;
  select * into credential
    from public.owner_provider_credentials c
   where c.owner_id = runtime_owner_id and c.provider = 'openai';
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'ciphertext', credential.ciphertext,
    'key_version', credential.key_version
  );
end;
$$;

revoke execute on function public.custodian_get_provider_credential(uuid)
  from public, anon, authenticated;
grant execute on function public.custodian_get_provider_credential(uuid) to service_role;
