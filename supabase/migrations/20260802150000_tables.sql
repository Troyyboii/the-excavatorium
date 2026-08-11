-- 0001_tables.sql
-- The Excavatorium — Phase A foundation
-- Core tables, constraints, composite ownership keys, and the approved
-- canonical seed-key lists. Row-level security, privileges, indexes, and
-- functions live in later migrations. Run these migrations in numeric
-- order against the connected Supabase project via the Supabase SQL
-- editor or the Supabase CLI.

-- ---------------------------------------------------------------------------
-- profiles: application-read-only mirror of auth.users. Never stores auth
-- secrets, tokens, roles, or mutable identity fields. Populated by the
-- trigger defined in 0004_profile_trigger.sql.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- records: the archive. Every record is owned by exactly one auth user.
-- The composite unique (user_id, id) lets record_links reference ownership
-- and record identity together, so a link can never cross users.
-- ---------------------------------------------------------------------------
create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null,
  title text not null,
  summary text not null default '',
  tags text[] not null default '{}',
  record_data jsonb not null default '{}'::jsonb,
  is_example boolean not null default false,
  seed_key text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint records_type_ck
    check (record_type in ('tool', 'repository', 'conversation', 'decision')),
  constraint records_title_nonblank_ck
    check (btrim(title) <> ''),
  constraint records_record_data_object_ck
    check (jsonb_typeof(record_data) = 'object'),
  constraint records_tags_no_null_ck
    check (array_position(tags, null) is null),
  constraint records_example_identity_ck
    check (
      (is_example and seed_key is not null)
      or (not is_example and seed_key is null)
    ),
  constraint records_seed_key_allowed_ck
    check (
      seed_key is null
      or seed_key in (
        'example-tool-chatgpt',
        'example-tool-perplexity',
        'example-tool-grok',
        'example-tool-mem0',
        'example-tool-obsidian',
        'example-tool-codex',
        'example-repository-mem0',
        'example-conversation-excavatorium-origin',
        'example-decision-chatgpt-primary',
        'example-decision-perplexity-research',
        'example-decision-grok-media',
        'example-decision-no-mem0',
        'example-decision-obsidian-vault'
      )
    ),
  constraint records_user_seed_unique
    unique (user_id, seed_key),
  constraint records_user_id_unique
    unique (user_id, id)
);

-- ---------------------------------------------------------------------------
-- record_links: undirected pair between two caller-owned records.
-- Generated columns record_low_id / record_high_id normalize ordering so
-- the unique index rejects reciprocal duplicates (A→B vs B→A). Composite
-- FKs bind both endpoints to the same user_id via records(user_id, id).
-- ---------------------------------------------------------------------------
create table if not exists public.record_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_record_id uuid not null,
  target_record_id uuid not null,
  record_low_id uuid generated always as (
    least(source_record_id, target_record_id)
  ) stored,
  record_high_id uuid generated always as (
    greatest(source_record_id, target_record_id)
  ) stored,
  seed_key text null,
  created_at timestamptz not null default now(),
  constraint record_links_no_self_ck
    check (source_record_id <> target_record_id),
  constraint record_links_seed_key_allowed_ck
    check (
      seed_key is null
      or seed_key in (
        'example-link-conversation-chatgpt',
        'example-link-conversation-grok',
        'example-link-conversation-mem0',
        'example-link-conversation-repository-mem0',
        'example-link-conversation-decision-no-mem0',
        'example-link-conversation-decision-grok-media',
        'example-link-mem0-repository',
        'example-link-decision-chatgpt-tool',
        'example-link-decision-obsidian-tool'
      )
    ),
  constraint record_links_user_seed_unique
    unique (user_id, seed_key),
  constraint record_links_source_fk
    foreign key (user_id, source_record_id)
    references public.records (user_id, id) on delete cascade,
  constraint record_links_target_fk
    foreign key (user_id, target_record_id)
    references public.records (user_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- app_metadata: single row per user. Frontend may read only its own row;
-- inserts/updates come exclusively from lifecycle RPCs.
-- ---------------------------------------------------------------------------
create table if not exists public.app_metadata (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null default 1,
  seed_lifecycle_initialized boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
