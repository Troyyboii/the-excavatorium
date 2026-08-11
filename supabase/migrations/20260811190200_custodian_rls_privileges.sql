-- Custodian Release 1: owner-only reads and RPC-only writes.
-- case_members remains metadata, never authorization: its only policy is the
-- same owner policy as every other Custodian row.

alter table public.cases enable row level security;
alter table public.inbox_items enable row level security;
alter table public.case_members enable row level security;
alter table public.claims enable row level security;
alter table public.evidence_items enable row level security;
alter table public.claim_evidence enable row level security;
alter table public.actions enable row level security;
alter table public.custodian_findings enable row level security;
alter table public.record_revisions enable row level security;

drop policy if exists cases_select_own on public.cases;
create policy cases_select_own on public.cases
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists inbox_items_select_own on public.inbox_items;
create policy inbox_items_select_own on public.inbox_items
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists case_members_select_own on public.case_members;
create policy case_members_select_own on public.case_members
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists claims_select_own on public.claims;
create policy claims_select_own on public.claims
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists evidence_items_select_own on public.evidence_items;
create policy evidence_items_select_own on public.evidence_items
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists claim_evidence_select_own on public.claim_evidence;
create policy claim_evidence_select_own on public.claim_evidence
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists actions_select_own on public.actions;
create policy actions_select_own on public.actions
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists custodian_findings_select_own on public.custodian_findings;
create policy custodian_findings_select_own on public.custodian_findings
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists record_revisions_select_own on public.record_revisions;
create policy record_revisions_select_own on public.record_revisions
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

revoke all privileges on public.cases from public, anon, authenticated;
revoke all privileges on public.inbox_items from public, anon, authenticated;
revoke all privileges on public.case_members from public, anon, authenticated;
revoke all privileges on public.claims from public, anon, authenticated;
revoke all privileges on public.evidence_items from public, anon, authenticated;
revoke all privileges on public.claim_evidence from public, anon, authenticated;
revoke all privileges on public.actions from public, anon, authenticated;
revoke all privileges on public.custodian_findings from public, anon, authenticated;
revoke all privileges on public.record_revisions from public, anon, authenticated;

grant select on public.cases to authenticated;
grant select on public.inbox_items to authenticated;
grant select on public.case_members to authenticated;
grant select on public.claims to authenticated;
grant select on public.evidence_items to authenticated;
grant select on public.claim_evidence to authenticated;
grant select on public.actions to authenticated;
grant select on public.custodian_findings to authenticated;
grant select on public.record_revisions to authenticated;
