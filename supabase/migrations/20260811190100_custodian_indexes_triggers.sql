-- Custodian Release 1: indexes, timestamps, immutable evidence, and archive
-- revision capture. All indexes include owner_id because every read is owner
-- scoped and case_members is metadata rather than authorization.

create index if not exists cases_owner_status_idx
  on public.cases (owner_id, status);
create index if not exists cases_owner_created_idx
  on public.cases (owner_id, created_at, id);
create index if not exists cases_owner_updated_idx
  on public.cases (owner_id, updated_at, id);

create index if not exists inbox_items_owner_status_idx
  on public.inbox_items (owner_id, status);
create index if not exists inbox_items_owner_kind_idx
  on public.inbox_items (owner_id, kind);
create index if not exists inbox_items_owner_captured_idx
  on public.inbox_items (owner_id, captured_at, id);
create index if not exists inbox_items_owner_updated_idx
  on public.inbox_items (owner_id, updated_at, id);

create index if not exists case_members_owner_case_idx
  on public.case_members (owner_id, case_id);
create index if not exists case_members_owner_status_idx
  on public.case_members (owner_id, lifecycle_status);

create index if not exists claims_owner_case_status_idx
  on public.claims (owner_id, case_id, status);
create index if not exists claims_owner_status_idx
  on public.claims (owner_id, status);
create index if not exists claims_owner_updated_idx
  on public.claims (owner_id, updated_at, id);
create index if not exists claims_source_record_idx
  on public.claims (owner_id, source_record_id);

create index if not exists evidence_items_owner_case_lifecycle_idx
  on public.evidence_items (owner_id, case_id, lifecycle_status);
create index if not exists evidence_items_owner_classification_idx
  on public.evidence_items (owner_id, source_classification);
create index if not exists evidence_items_owner_captured_idx
  on public.evidence_items (owner_id, captured_at, id);
create index if not exists evidence_items_source_record_idx
  on public.evidence_items (owner_id, source_record_id);
create index if not exists evidence_items_supersedes_idx
  on public.evidence_items (owner_id, case_id, supersedes_id);

create index if not exists claim_evidence_owner_claim_idx
  on public.claim_evidence (owner_id, case_id, claim_id);
create index if not exists claim_evidence_owner_evidence_idx
  on public.claim_evidence (owner_id, case_id, evidence_id);
create index if not exists claim_evidence_owner_status_idx
  on public.claim_evidence (owner_id, lifecycle_status);

create index if not exists actions_owner_case_status_idx
  on public.actions (owner_id, case_id, status);
create index if not exists actions_owner_due_idx
  on public.actions (owner_id, due_at, id);
create index if not exists actions_owner_updated_idx
  on public.actions (owner_id, updated_at, id);
create index if not exists actions_source_record_idx
  on public.actions (owner_id, source_record_id);

create index if not exists custodian_findings_owner_case_mode_idx
  on public.custodian_findings (owner_id, case_id, analysis_mode);
create index if not exists custodian_findings_owner_status_idx
  on public.custodian_findings (owner_id, status);
create index if not exists custodian_findings_owner_updated_idx
  on public.custodian_findings (owner_id, updated_at, id);
create index if not exists custodian_findings_source_record_idx
  on public.custodian_findings (owner_id, source_record_id);

create index if not exists record_revisions_owner_record_idx
  on public.record_revisions (owner_id, record_id, revision_number);
create index if not exists record_revisions_owner_changed_idx
  on public.record_revisions (owner_id, changed_at, id);

drop trigger if exists cases_set_updated_at on public.cases;
create trigger cases_set_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

drop trigger if exists inbox_items_set_updated_at on public.inbox_items;
create trigger inbox_items_set_updated_at
  before update on public.inbox_items
  for each row execute function public.set_updated_at();

drop trigger if exists case_members_set_updated_at on public.case_members;
create trigger case_members_set_updated_at
  before update on public.case_members
  for each row execute function public.set_updated_at();

drop trigger if exists claims_set_updated_at on public.claims;
create trigger claims_set_updated_at
  before update on public.claims
  for each row execute function public.set_updated_at();

drop trigger if exists evidence_items_set_updated_at on public.evidence_items;
create trigger evidence_items_set_updated_at
  before update on public.evidence_items
  for each row execute function public.set_updated_at();

drop trigger if exists claim_evidence_set_updated_at on public.claim_evidence;
create trigger claim_evidence_set_updated_at
  before update on public.claim_evidence
  for each row execute function public.set_updated_at();

drop trigger if exists actions_set_updated_at on public.actions;
create trigger actions_set_updated_at
  before update on public.actions
  for each row execute function public.set_updated_at();

drop trigger if exists custodian_findings_set_updated_at on public.custodian_findings;
create trigger custodian_findings_set_updated_at
  before update on public.custodian_findings
  for each row execute function public.set_updated_at();

create or replace function public.guard_evidence_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.immutable and (
    new.content is distinct from old.content
    or new.content_hash is distinct from old.content_hash
    or new.source_classification is distinct from old.source_classification
    or new.source_uri is distinct from old.source_uri
    or new.source_record_id is distinct from old.source_record_id
    or new.provenance is distinct from old.provenance
    or new.captured_at is distinct from old.captured_at
    or new.immutable is distinct from old.immutable
  ) then
    raise exception 'immutable evidence provenance cannot be changed' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_evidence_immutability() from public;
revoke execute on function public.guard_evidence_immutability() from anon;
revoke execute on function public.guard_evidence_immutability() from authenticated;

drop trigger if exists evidence_items_immutable_guard on public.evidence_items;
create trigger evidence_items_immutable_guard
  before update on public.evidence_items
  for each row execute function public.guard_evidence_immutability();

create or replace function public.capture_record_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_owner uuid;
  record_id_value uuid;
  record_snapshot jsonb;
  next_revision integer;
begin
  if tg_op = 'INSERT' then
    record_owner := new.user_id;
    record_id_value := new.id;
    record_snapshot := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    record_owner := new.user_id;
    record_id_value := new.id;
    record_snapshot := to_jsonb(new);
  else
    return coalesce(new, old);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('custodian:record:' || record_owner::text || ':' || record_id_value::text, 0)
  );

  select coalesce(max(revision_number), 0) + 1
    into next_revision
    from public.record_revisions
   where owner_id = record_owner
     and record_id = record_id_value;

  insert into public.record_revisions (
    owner_id, record_id, revision_number, operation, snapshot, changed_by
  ) values (
    record_owner,
    record_id_value,
    next_revision,
    lower(tg_op),
    record_snapshot,
    coalesce(auth.uid(), record_owner)
  );

  return coalesce(new, old);
end;
$$;

revoke execute on function public.capture_record_revision() from public;
revoke execute on function public.capture_record_revision() from anon;
revoke execute on function public.capture_record_revision() from authenticated;

drop trigger if exists records_capture_custodian_revision on public.records;
create trigger records_capture_custodian_revision
  after insert or update on public.records
  for each row execute function public.capture_record_revision();

-- Existing archive rows receive a baseline once. Future inserts and updates
-- are captured by the trigger above. The unique constraint makes this rerun
-- safe if a migration is replayed against an already-initialized database.
insert into public.record_revisions (
  owner_id, record_id, revision_number, operation, snapshot, changed_by
)
select r.user_id, r.id, 1, 'insert', to_jsonb(r), r.user_id
  from public.records as r
 where not exists (
   select 1
     from public.record_revisions as rr
    where rr.owner_id = r.user_id
      and rr.record_id = r.id
      and rr.revision_number = 1
 );
