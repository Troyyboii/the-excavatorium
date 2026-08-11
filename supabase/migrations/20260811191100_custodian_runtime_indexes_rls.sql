-- Custodian Release 2/3: owner-first indexes, immutable guards, schema-change
-- quarantine, and owner-only read policies. Authenticated clients receive no
-- table mutation privileges; all writes are protected RPCs in the next file.

create index if not exists entities_owner_case_type_idx
  on public.entities (owner_id, case_id, entity_type);
create index if not exists entities_owner_case_updated_idx
  on public.entities (owner_id, case_id, updated_at, id);
create index if not exists entities_source_record_idx
  on public.entities (owner_id, source_record_id);

create index if not exists entity_relations_owner_case_type_idx
  on public.entity_relations (owner_id, case_id, relation_type);
create index if not exists entity_relations_subject_idx
  on public.entity_relations (owner_id, case_id, subject_entity_id);
create index if not exists entity_relations_object_idx
  on public.entity_relations (owner_id, case_id, object_entity_id);

create index if not exists experiments_owner_case_status_idx
  on public.experiments (owner_id, case_id, status);
create index if not exists experiments_owner_updated_idx
  on public.experiments (owner_id, updated_at, id);
create index if not exists experiments_source_record_idx
  on public.experiments (owner_id, source_record_id);

create index if not exists decision_reviews_owner_case_status_idx
  on public.decision_reviews (owner_id, case_id, status);
create index if not exists decision_reviews_due_idx
  on public.decision_reviews (owner_id, review_due_at, id);
create index if not exists decision_reviews_record_idx
  on public.decision_reviews (owner_id, decision_record_id);

create index if not exists forecasts_owner_case_status_idx
  on public.forecasts (owner_id, case_id, status);
create index if not exists forecasts_owner_horizon_idx
  on public.forecasts (owner_id, horizon, id);
create index if not exists forecasts_claim_idx
  on public.forecasts (owner_id, case_id, claim_id);

create index if not exists tool_policies_owner_status_idx
  on public.tool_policies (owner_id, status);
create index if not exists tool_policies_owner_case_idx
  on public.tool_policies (owner_id, case_id, status);

create index if not exists connector_accounts_owner_status_idx
  on public.connector_accounts (owner_id, status);
create index if not exists connector_accounts_owner_provider_idx
  on public.connector_accounts (owner_id, provider);

create index if not exists connector_tools_owner_account_status_idx
  on public.connector_tools (owner_id, connector_account_id, status);
create index if not exists connector_tools_owner_operation_idx
  on public.connector_tools (owner_id, operation_class);

create index if not exists agent_runs_owner_case_status_idx
  on public.agent_runs (owner_id, case_id, status);
create index if not exists agent_runs_owner_created_idx
  on public.agent_runs (owner_id, created_at, id);
create index if not exists agent_runs_owner_updated_idx
  on public.agent_runs (owner_id, updated_at, id);
create index if not exists agent_runs_policy_idx
  on public.agent_runs (owner_id, tool_policy_id);
create index if not exists agent_runs_cancel_requested_idx
  on public.agent_runs (owner_id, cancel_requested_at, id)
  where cancel_requested_at is not null;

create index if not exists agent_steps_owner_run_sequence_idx
  on public.agent_steps (owner_id, case_id, run_id, sequence_no);
create index if not exists agent_steps_owner_status_idx
  on public.agent_steps (owner_id, status, created_at, id);

create index if not exists approval_requests_owner_case_status_idx
  on public.approval_requests (owner_id, case_id, status);
create index if not exists approval_requests_owner_run_status_idx
  on public.approval_requests (owner_id, case_id, run_id, status);
create index if not exists approval_requests_expiry_idx
  on public.approval_requests (owner_id, expires_at, id)
  where status = 'pending' and expires_at is not null;

create index if not exists change_proposals_owner_case_status_idx
  on public.change_proposals (owner_id, case_id, status);
create index if not exists change_proposals_owner_run_idx
  on public.change_proposals (owner_id, case_id, run_id, status);
create index if not exists change_proposals_approval_idx
  on public.change_proposals (owner_id, case_id, approval_request_id);

create index if not exists tool_events_owner_run_created_idx
  on public.tool_events (owner_id, case_id, run_id, created_at, id);
create index if not exists tool_events_owner_operation_idx
  on public.tool_events (owner_id, operation_class, event_kind);
create index if not exists tool_events_approval_idx
  on public.tool_events (owner_id, case_id, approval_request_id);

create index if not exists automation_rules_owner_case_status_idx
  on public.automation_rules (owner_id, case_id, status);
create index if not exists automation_rules_connector_idx
  on public.automation_rules (owner_id, connector_account_id, status);

create index if not exists automation_runs_owner_case_status_idx
  on public.automation_runs (owner_id, case_id, status);
create index if not exists automation_runs_rule_created_idx
  on public.automation_runs (owner_id, case_id, rule_id, created_at, id);
create index if not exists automation_runs_agent_idx
  on public.automation_runs (owner_id, case_id, agent_run_id);

create index if not exists audit_events_owner_created_idx
  on public.audit_events (owner_id, created_at, id);
create index if not exists audit_events_owner_case_created_idx
  on public.audit_events (owner_id, case_id, created_at, id);
create index if not exists audit_events_owner_run_created_idx
  on public.audit_events (owner_id, case_id, run_id, created_at, id);
create index if not exists audit_events_target_idx
  on public.audit_events (owner_id, target_type, target_id, created_at);

create index if not exists record_embeddings_owner_record_status_idx
  on public.record_embeddings (owner_id, record_id, embedding_status);
create index if not exists record_embeddings_owner_model_idx
  on public.record_embeddings (owner_id, model, source_content_hash);
create index if not exists record_embeddings_owner_case_idx
  on public.record_embeddings (owner_id, case_id, embedding_status);

-- ---------------------------------------------------------------------------
-- Shared runtime guards.
-- ---------------------------------------------------------------------------

create or replace function public.custodian_validate_embedding_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
begin
  if new.embedding is null then
    if new.embedding_dimension is not null or new.model is not null or new.model_version is not null then
      raise exception 'embedding metadata requires an embedding payload' using errcode = '22023';
    end if;
    return new;
  end if;

  if not new.embedding_opt_in then
    raise exception 'record embedding requires explicit opt-in' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(new.embedding) <> 'array' then
    raise exception 'embedding must be a JSON array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(new.embedding) < 1
     or pg_catalog.jsonb_array_length(new.embedding) > 8192 then
    raise exception 'embedding must contain between 1 and 8192 values' using errcode = '22023';
  end if;
  if new.embedding_dimension is null
     or new.embedding_dimension <> pg_catalog.jsonb_array_length(new.embedding) then
    raise exception 'embedding dimension must equal the JSON array length' using errcode = '22023';
  end if;
  if pg_catalog.pg_column_size(new.embedding) > 262144 then
    raise exception 'embedding payload exceeds the bounded JSON size' using errcode = '22023';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(new.embedding) loop
    if pg_catalog.jsonb_typeof(item) <> 'number' then
      raise exception 'embedding values must be JSON numbers' using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.custodian_validate_embedding_row() from public, anon, authenticated;

drop trigger if exists record_embeddings_validate_payload on public.record_embeddings;
create trigger record_embeddings_validate_payload
  before insert or update on public.record_embeddings
  for each row execute function public.custodian_validate_embedding_row();

create or replace function public.custodian_guard_agent_run_inputs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.owner_id is distinct from new.owner_id
     or old.case_id is distinct from new.case_id
     or old.tool_policy_id is distinct from new.tool_policy_id
     or old.idempotency_key is distinct from new.idempotency_key
     or old.request_hash is distinct from new.request_hash
     or old.objective is distinct from new.objective
     or old.input_snapshot is distinct from new.input_snapshot
     or old.input_snapshot_hash is distinct from new.input_snapshot_hash
     or old.agent_graph is distinct from new.agent_graph
     or old.agent_config is distinct from new.agent_config
     or old.prompt_version is distinct from new.prompt_version
     or old.tool_allowlist is distinct from new.tool_allowlist
     or old.model_tier is distinct from new.model_tier
     or old.retention_class is distinct from new.retention_class
     or old.budget_tokens is distinct from new.budget_tokens
     or old.budget_cost_usd is distinct from new.budget_cost_usd
     or old.budget_latency_ms is distinct from new.budget_latency_ms
     or old.budget_tool_events is distinct from new.budget_tool_events then
    raise exception 'agent run input and execution policy fields are immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function public.custodian_guard_agent_run_inputs() from public, anon, authenticated;

drop trigger if exists agent_runs_guard_inputs on public.agent_runs;
create trigger agent_runs_guard_inputs
  before update on public.agent_runs
  for each row execute function public.custodian_guard_agent_run_inputs();

create or replace function public.custodian_guard_approval_payload()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.owner_id is distinct from new.owner_id
     or old.case_id is distinct from new.case_id
     or old.run_id is distinct from new.run_id
     or old.idempotency_key is distinct from new.idempotency_key
     or old.approval_kind is distinct from new.approval_kind
     or old.title is distinct from new.title
     or old.rationale is distinct from new.rationale
     or old.proposed_diff is distinct from new.proposed_diff
     or old.tool_action is distinct from new.tool_action
     or old.exact_action_hash is distinct from new.exact_action_hash then
    raise exception 'approval request exact action is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function public.custodian_guard_approval_payload() from public, anon, authenticated;

drop trigger if exists approval_requests_guard_payload on public.approval_requests;
create trigger approval_requests_guard_payload
  before update on public.approval_requests
  for each row execute function public.custodian_guard_approval_payload();

create or replace function public.custodian_guard_change_proposal_payload()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.owner_id is distinct from new.owner_id
     or old.case_id is distinct from new.case_id
     or old.run_id is distinct from new.run_id
     or old.approval_request_id is distinct from new.approval_request_id
     or old.idempotency_key is distinct from new.idempotency_key
     or old.target_type is distinct from new.target_type
     or old.target_id is distinct from new.target_id
     or old.operation is distinct from new.operation
     or old.before_snapshot is distinct from new.before_snapshot
     or old.proposed_diff is distinct from new.proposed_diff
     or old.after_snapshot is distinct from new.after_snapshot then
    raise exception 'change proposal exact diff is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function public.custodian_guard_change_proposal_payload() from public, anon, authenticated;

drop trigger if exists change_proposals_guard_payload on public.change_proposals;
create trigger change_proposals_guard_payload
  before update on public.change_proposals
  for each row execute function public.custodian_guard_change_proposal_payload();

create or replace function public.custodian_reject_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'audit events are immutable' using errcode = '22023';
end;
$$;

revoke execute on function public.custodian_reject_audit_mutation() from public, anon, authenticated;

drop trigger if exists audit_events_reject_update on public.audit_events;
create trigger audit_events_reject_update
  before update or delete on public.audit_events
  for each row execute function public.custodian_reject_audit_mutation();

-- A connector schema revision invalidates the tool contract assumed by every
-- attached automation. The rule is quarantined until its owner reviews it.
create or replace function public.custodian_disable_automations_for_account_schema()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.schema_version is distinct from new.schema_version then
    update public.automation_rules
       set status = 'pending_review',
           review_required = true,
           disabled_reason = 'connector account schema changed; review required',
           updated_at = pg_catalog.now()
     where owner_id = new.owner_id
       and connector_account_id = new.id
       and status in ('draft', 'active', 'paused');
  end if;
  return new;
end;
$$;

revoke execute on function public.custodian_disable_automations_for_account_schema() from public, anon, authenticated;

drop trigger if exists connector_accounts_quarantine_automations on public.connector_accounts;
create trigger connector_accounts_quarantine_automations
  after update on public.connector_accounts
  for each row execute function public.custodian_disable_automations_for_account_schema();

create or replace function public.custodian_disable_automations_for_tool_schema()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.schema_version is distinct from new.schema_version then
    update public.automation_rules
       set status = 'pending_review',
           review_required = true,
           disabled_reason = 'connector tool schema changed; review required',
           updated_at = pg_catalog.now()
     where owner_id = new.owner_id
       and connector_account_id = new.connector_account_id
       and status in ('draft', 'active', 'paused');
  end if;
  return new;
end;
$$;

revoke execute on function public.custodian_disable_automations_for_tool_schema() from public, anon, authenticated;

drop trigger if exists connector_tools_quarantine_automations on public.connector_tools;
create trigger connector_tools_quarantine_automations
  after update on public.connector_tools
  for each row execute function public.custodian_disable_automations_for_tool_schema();

-- Updated timestamps are maintained in the database, not trusted from a
-- caller payload.
drop trigger if exists entities_set_updated_at on public.entities;
create trigger entities_set_updated_at before update on public.entities for each row execute function public.set_updated_at();
drop trigger if exists entity_relations_set_updated_at on public.entity_relations;
create trigger entity_relations_set_updated_at before update on public.entity_relations for each row execute function public.set_updated_at();
drop trigger if exists experiments_set_updated_at on public.experiments;
create trigger experiments_set_updated_at before update on public.experiments for each row execute function public.set_updated_at();
drop trigger if exists decision_reviews_set_updated_at on public.decision_reviews;
create trigger decision_reviews_set_updated_at before update on public.decision_reviews for each row execute function public.set_updated_at();
drop trigger if exists forecasts_set_updated_at on public.forecasts;
create trigger forecasts_set_updated_at before update on public.forecasts for each row execute function public.set_updated_at();
drop trigger if exists tool_policies_set_updated_at on public.tool_policies;
create trigger tool_policies_set_updated_at before update on public.tool_policies for each row execute function public.set_updated_at();
drop trigger if exists connector_accounts_set_updated_at on public.connector_accounts;
create trigger connector_accounts_set_updated_at before update on public.connector_accounts for each row execute function public.set_updated_at();
drop trigger if exists connector_tools_set_updated_at on public.connector_tools;
create trigger connector_tools_set_updated_at before update on public.connector_tools for each row execute function public.set_updated_at();
drop trigger if exists agent_runs_set_updated_at on public.agent_runs;
create trigger agent_runs_set_updated_at before update on public.agent_runs for each row execute function public.set_updated_at();
drop trigger if exists agent_steps_set_updated_at on public.agent_steps;
create trigger agent_steps_set_updated_at before update on public.agent_steps for each row execute function public.set_updated_at();
drop trigger if exists approval_requests_set_updated_at on public.approval_requests;
create trigger approval_requests_set_updated_at before update on public.approval_requests for each row execute function public.set_updated_at();
drop trigger if exists change_proposals_set_updated_at on public.change_proposals;
create trigger change_proposals_set_updated_at before update on public.change_proposals for each row execute function public.set_updated_at();
drop trigger if exists tool_events_set_updated_at on public.tool_events;
create trigger tool_events_set_updated_at before update on public.tool_events for each row execute function public.set_updated_at();
drop trigger if exists automation_rules_set_updated_at on public.automation_rules;
create trigger automation_rules_set_updated_at before update on public.automation_rules for each row execute function public.set_updated_at();
drop trigger if exists automation_runs_set_updated_at on public.automation_runs;
create trigger automation_runs_set_updated_at before update on public.automation_runs for each row execute function public.set_updated_at();
drop trigger if exists audit_events_set_updated_at on public.audit_events;
create trigger audit_events_set_updated_at before update on public.audit_events for each row execute function public.set_updated_at();
drop trigger if exists record_embeddings_set_updated_at on public.record_embeddings;
create trigger record_embeddings_set_updated_at before update on public.record_embeddings for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Owner-only RLS. case_members is intentionally irrelevant here: it is
-- metadata in the preceding release, not an authorization grant.
-- ---------------------------------------------------------------------------

alter table public.entities enable row level security;
alter table public.entity_relations enable row level security;
alter table public.experiments enable row level security;
alter table public.decision_reviews enable row level security;
alter table public.forecasts enable row level security;
alter table public.tool_policies enable row level security;
alter table public.connector_accounts enable row level security;
alter table public.connector_tools enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.approval_requests enable row level security;
alter table public.change_proposals enable row level security;
alter table public.tool_events enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
alter table public.audit_events enable row level security;
alter table public.record_embeddings enable row level security;

drop policy if exists entities_select_own on public.entities;
create policy entities_select_own on public.entities for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists entity_relations_select_own on public.entity_relations;
create policy entity_relations_select_own on public.entity_relations for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists experiments_select_own on public.experiments;
create policy experiments_select_own on public.experiments for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists decision_reviews_select_own on public.decision_reviews;
create policy decision_reviews_select_own on public.decision_reviews for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists forecasts_select_own on public.forecasts;
create policy forecasts_select_own on public.forecasts for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists tool_policies_select_own on public.tool_policies;
create policy tool_policies_select_own on public.tool_policies for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists connector_accounts_select_own on public.connector_accounts;
create policy connector_accounts_select_own on public.connector_accounts for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists connector_tools_select_own on public.connector_tools;
create policy connector_tools_select_own on public.connector_tools for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists agent_runs_select_own on public.agent_runs;
create policy agent_runs_select_own on public.agent_runs for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists agent_steps_select_own on public.agent_steps;
create policy agent_steps_select_own on public.agent_steps for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists approval_requests_select_own on public.approval_requests;
create policy approval_requests_select_own on public.approval_requests for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists change_proposals_select_own on public.change_proposals;
create policy change_proposals_select_own on public.change_proposals for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists tool_events_select_own on public.tool_events;
create policy tool_events_select_own on public.tool_events for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists automation_rules_select_own on public.automation_rules;
create policy automation_rules_select_own on public.automation_rules for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists automation_runs_select_own on public.automation_runs;
create policy automation_runs_select_own on public.automation_runs for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists audit_events_select_own on public.audit_events;
create policy audit_events_select_own on public.audit_events for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists record_embeddings_select_own on public.record_embeddings;
create policy record_embeddings_select_own on public.record_embeddings for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all privileges on public.entities from public, anon, authenticated;
revoke all privileges on public.entity_relations from public, anon, authenticated;
revoke all privileges on public.experiments from public, anon, authenticated;
revoke all privileges on public.decision_reviews from public, anon, authenticated;
revoke all privileges on public.forecasts from public, anon, authenticated;
revoke all privileges on public.tool_policies from public, anon, authenticated;
revoke all privileges on public.connector_accounts from public, anon, authenticated;
revoke all privileges on public.connector_tools from public, anon, authenticated;
revoke all privileges on public.agent_runs from public, anon, authenticated;
revoke all privileges on public.agent_steps from public, anon, authenticated;
revoke all privileges on public.approval_requests from public, anon, authenticated;
revoke all privileges on public.change_proposals from public, anon, authenticated;
revoke all privileges on public.tool_events from public, anon, authenticated;
revoke all privileges on public.automation_rules from public, anon, authenticated;
revoke all privileges on public.automation_runs from public, anon, authenticated;
revoke all privileges on public.audit_events from public, anon, authenticated;
revoke all privileges on public.record_embeddings from public, anon, authenticated;

grant select on public.entities to authenticated;
grant select on public.entity_relations to authenticated;
grant select on public.experiments to authenticated;
grant select on public.decision_reviews to authenticated;
grant select on public.forecasts to authenticated;
grant select on public.tool_policies to authenticated;
grant select on public.connector_accounts to authenticated;
grant select on public.connector_tools to authenticated;
grant select on public.agent_runs to authenticated;
grant select on public.agent_steps to authenticated;
grant select on public.approval_requests to authenticated;
grant select on public.change_proposals to authenticated;
grant select on public.tool_events to authenticated;
grant select on public.automation_rules to authenticated;
grant select on public.automation_runs to authenticated;
grant select on public.audit_events to authenticated;
grant select on public.record_embeddings to authenticated;
