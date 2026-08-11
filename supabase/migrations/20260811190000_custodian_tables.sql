-- Custodian Release 1: owner-scoped data foundation.
-- These tables are an analysis/staging layer around the canonical archive.
-- Decisions remain canonical public.records; this layer never replaces them.

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  objective text not null default '',
  current_question text not null default '',
  default_working_set jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  closed_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cases_title_nonblank_ck check (btrim(title) <> ''),
  constraint cases_title_length_ck check (char_length(title) <= 300),
  constraint cases_objective_length_ck check (char_length(objective) <= 10000),
  constraint cases_question_length_ck check (char_length(current_question) <= 10000),
  constraint cases_working_set_array_ck check (
    jsonb_typeof(default_working_set) = 'array'
    and jsonb_array_length(default_working_set) <= 500
  ),
  constraint cases_status_ck check (status in ('open', 'paused', 'closed', 'archived')),
  constraint cases_closed_status_ck check (
    (status = 'closed' and closed_at is not null)
    or (status <> 'closed')
  ),
  constraint cases_owner_id_unique unique (owner_id, id)
);

create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  raw_content text not null,
  title text not null default '',
  candidate jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  source_label text not null default '',
  captured_at timestamptz not null default now(),
  triaged_at timestamptz,
  promoted_kind text,
  promoted_id uuid,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_items_kind_ck check (
    kind in ('thought', 'conversation', 'document', 'url', 'github', 'context7', 'record', 'clipboard', 'mobile_share')
  ),
  constraint inbox_items_content_nonblank_ck check (btrim(raw_content) <> ''),
  constraint inbox_items_content_length_ck check (char_length(raw_content) <= 200000),
  constraint inbox_items_title_length_ck check (char_length(title) <= 300),
  constraint inbox_items_source_length_ck check (char_length(source_label) <= 500),
  constraint inbox_items_candidate_object_ck check (
    jsonb_typeof(candidate) = 'object'
    and pg_column_size(candidate) <= 1048576
  ),
  constraint inbox_items_status_ck check (status in ('new', 'triaged', 'promoted', 'dismissed', 'archived')),
  constraint inbox_items_promotion_pair_ck check (
    (status = 'promoted' and promoted_kind is not null and promoted_id is not null)
    or (status <> 'promoted' and promoted_kind is null and promoted_id is null)
  ),
  constraint inbox_items_promoted_kind_ck check (
    promoted_kind is null or promoted_kind in ('claim', 'evidence_item', 'action', 'custodian_finding')
  ),
  constraint inbox_items_owner_id_unique unique (owner_id, id)
);

-- case_members is descriptive metadata only. It is deliberately not an
-- authorization or membership table and has no policy that grants access.
create table if not exists public.case_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  display_name text not null,
  role_label text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  lifecycle_status text not null default 'active',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_members_case_fk foreign key (owner_id, case_id)
    references public.cases (owner_id, id) on delete cascade,
  constraint case_members_display_name_nonblank_ck check (btrim(display_name) <> ''),
  constraint case_members_display_name_length_ck check (char_length(display_name) <= 300),
  constraint case_members_role_length_ck check (char_length(role_label) <= 200),
  constraint case_members_metadata_object_ck check (jsonb_typeof(metadata) = 'object'),
  constraint case_members_lifecycle_status_ck check (lifecycle_status in ('active', 'inactive', 'archived')),
  constraint case_members_owner_case_id_unique unique (owner_id, case_id, id)
);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  statement text not null,
  status text not null default 'observed',
  confidence integer not null default 0,
  what_would_change_mind text not null default '',
  revisit_condition text not null default '',
  source_record_id uuid,
  lifecycle_status text not null default 'active',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claims_case_fk foreign key (owner_id, case_id)
    references public.cases (owner_id, id) on delete cascade,
  constraint claims_source_record_fk foreign key (owner_id, source_record_id)
    references public.records (user_id, id) on delete set null,
  constraint claims_statement_nonblank_ck check (btrim(statement) <> ''),
  constraint claims_statement_length_ck check (char_length(statement) <= 20000),
  constraint claims_status_ck check (status in ('observed', 'reported', 'inferred', 'disputed', 'falsified', 'unresolved')),
  constraint claims_confidence_ck check (confidence between 0 and 100),
  constraint claims_change_mind_length_ck check (char_length(what_would_change_mind) <= 10000),
  constraint claims_revisit_length_ck check (char_length(revisit_condition) <= 10000),
  constraint claims_lifecycle_status_ck check (lifecycle_status in ('active', 'superseded', 'archived')),
  constraint claims_owner_case_id_unique unique (owner_id, case_id, id)
);

create table if not exists public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  title text not null default '',
  content jsonb not null default '{}'::jsonb,
  content_hash text not null,
  source_classification text not null,
  source_uri text not null default '',
  source_record_id uuid,
  provenance jsonb not null default '{}'::jsonb,
  lifecycle_status text not null default 'active',
  immutable boolean not null default true,
  captured_at timestamptz not null default now(),
  supersedes_id uuid,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evidence_items_case_fk foreign key (owner_id, case_id)
    references public.cases (owner_id, id) on delete cascade,
  constraint evidence_items_source_record_fk foreign key (owner_id, source_record_id)
    references public.records (user_id, id) on delete set null,
  constraint evidence_items_supersedes_fk foreign key (owner_id, case_id, supersedes_id)
    references public.evidence_items (owner_id, case_id, id) on delete set null,
  constraint evidence_items_title_length_ck check (char_length(title) <= 500),
  constraint evidence_items_content_object_ck check (jsonb_typeof(content) in ('object', 'array', 'string', 'number', 'boolean', 'null')),
  constraint evidence_items_hash_ck check (content_hash ~ '^[0-9a-fA-F]{16,128}$'),
  constraint evidence_items_source_classification_ck check (
    source_classification in ('primary', 'secondary', 'tertiary', 'self_report', 'inference', 'unknown')
  ),
  constraint evidence_items_source_uri_length_ck check (char_length(source_uri) <= 4000),
  constraint evidence_items_provenance_object_ck check (jsonb_typeof(provenance) = 'object'),
  constraint evidence_items_lifecycle_status_ck check (lifecycle_status in ('active', 'superseded', 'rejected', 'archived')),
  constraint evidence_items_owner_case_id_unique unique (owner_id, case_id, id)
);

create table if not exists public.claim_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  claim_id uuid not null,
  evidence_id uuid not null,
  relationship_note text not null default '',
  lifecycle_status text not null default 'active',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claim_evidence_claim_fk foreign key (owner_id, case_id, claim_id)
    references public.claims (owner_id, case_id, id) on delete cascade,
  constraint claim_evidence_evidence_fk foreign key (owner_id, case_id, evidence_id)
    references public.evidence_items (owner_id, case_id, id) on delete cascade,
  constraint claim_evidence_note_length_ck check (char_length(relationship_note) <= 10000),
  constraint claim_evidence_lifecycle_status_ck check (lifecycle_status in ('active', 'archived')),
  constraint claim_evidence_owner_pair_unique unique (owner_id, case_id, claim_id, evidence_id)
);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  title text not null,
  description text not null default '',
  status text not null default 'proposed',
  priority integer not null default 50,
  due_at timestamptz,
  source_record_id uuid,
  lifecycle_status text not null default 'active',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint actions_case_fk foreign key (owner_id, case_id)
    references public.cases (owner_id, id) on delete cascade,
  constraint actions_source_record_fk foreign key (owner_id, source_record_id)
    references public.records (user_id, id) on delete set null,
  constraint actions_title_nonblank_ck check (btrim(title) <> ''),
  constraint actions_title_length_ck check (char_length(title) <= 500),
  constraint actions_description_length_ck check (char_length(description) <= 20000),
  constraint actions_status_ck check (status in ('proposed', 'ready', 'in_progress', 'blocked', 'completed', 'cancelled', 'deferred')),
  constraint actions_priority_ck check (priority between 0 and 100),
  constraint actions_lifecycle_status_ck check (lifecycle_status in ('active', 'archived')),
  constraint actions_owner_case_id_unique unique (owner_id, case_id, id)
);

create table if not exists public.custodian_findings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  analysis_mode text not null,
  title text not null,
  finding text not null,
  confidence integer not null default 0,
  what_would_change_mind text not null default '',
  revisit_condition text not null default '',
  source_record_id uuid,
  status text not null default 'draft',
  lifecycle_status text not null default 'active',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custodian_findings_case_fk foreign key (owner_id, case_id)
    references public.cases (owner_id, id) on delete cascade,
  constraint custodian_findings_source_record_fk foreign key (owner_id, source_record_id)
    references public.records (user_id, id) on delete set null,
  constraint custodian_findings_mode_ck check (
    analysis_mode in ('plan', 'claim_review', 'evidence_gap', 'contradiction', 'timeline', 'causal', 'risk', 'decision', 'synthesis')
  ),
  constraint custodian_findings_title_nonblank_ck check (btrim(title) <> ''),
  constraint custodian_findings_title_length_ck check (char_length(title) <= 500),
  constraint custodian_findings_text_nonblank_ck check (btrim(finding) <> ''),
  constraint custodian_findings_text_length_ck check (char_length(finding) <= 30000),
  constraint custodian_findings_confidence_ck check (confidence between 0 and 100),
  constraint custodian_findings_change_mind_length_ck check (char_length(what_would_change_mind) <= 10000),
  constraint custodian_findings_revisit_length_ck check (char_length(revisit_condition) <= 10000),
  constraint custodian_findings_status_ck check (status in ('draft', 'open', 'resolved', 'superseded', 'archived')),
  constraint custodian_findings_lifecycle_status_ck check (lifecycle_status in ('active', 'archived')),
  constraint custodian_findings_owner_case_id_unique unique (owner_id, case_id, id)
);

-- Revision history is trigger-owned. The archive remains the canonical source
-- of decisions; this table stores immutable snapshots for comparison only.
create table if not exists public.record_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  revision_number integer not null,
  operation text not null,
  snapshot jsonb not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  constraint record_revisions_record_fk foreign key (owner_id, record_id)
    references public.records (user_id, id) on delete cascade,
  constraint record_revisions_revision_number_ck check (revision_number > 0),
  constraint record_revisions_operation_ck check (operation in ('insert', 'update')),
  constraint record_revisions_snapshot_object_ck check (jsonb_typeof(snapshot) = 'object'),
  constraint record_revisions_owner_record_revision_unique unique (owner_id, record_id, revision_number)
);
