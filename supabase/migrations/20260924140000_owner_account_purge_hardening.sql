-- Wave 2 follow-up: idempotent hardening for account purge.
-- The service_role-only, RESTRICT-safe purge already ships in
-- 20260924130000_owner_account_portability.sql. This migration must NOT be
-- required to close a dangerous authenticated EXECUTE gap — it only reasserts
-- the same boundary and table order if an older intermediate ever existed.

drop function if exists public.purge_owner_account_data();

create or replace function public.purge_owner_account_data(runtime_owner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_cases integer := 0;
  deleted_records integer := 0;
  deleted_links integer := 0;
  deleted_credentials integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if runtime_owner_id is null then
    raise exception 'runtime_owner_id is required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = runtime_owner_id) then
    raise exception 'owner does not exist' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('purge-owner-account:' || runtime_owner_id::text, 0)
  );

  -- --- Break ON DELETE RESTRICT graphs before touching cases ---
  -- custodian_findings.origin_run_id / origin_step_id → agent_runs / agent_steps RESTRICT
  delete from public.custodian_finding_evidence cfe
   where cfe.owner_id = runtime_owner_id;
  delete from public.custodian_findings cf
   where cf.owner_id = runtime_owner_id;

  delete from public.audit_events ae where ae.owner_id = runtime_owner_id;
  delete from public.agent_provider_diagnostics d where d.owner_id = runtime_owner_id;
  delete from public.agent_provider_reservations r where r.owner_id = runtime_owner_id;
  delete from public.tool_events te where te.owner_id = runtime_owner_id;
  delete from public.change_proposals cp where cp.owner_id = runtime_owner_id;
  delete from public.approval_requests ar where ar.owner_id = runtime_owner_id;
  delete from public.automation_runs aur where aur.owner_id = runtime_owner_id;
  delete from public.automation_rules aul where aul.owner_id = runtime_owner_id;
  delete from public.agent_steps s where s.owner_id = runtime_owner_id;

  -- agent_runs.tool_policy_id is NOT NULL and ON DELETE RESTRICT toward
  -- tool_policies: delete runs while policies still exist, then policies.
  delete from public.agent_runs ag where ag.owner_id = runtime_owner_id;
  delete from public.tool_policies tp where tp.owner_id = runtime_owner_id;

  delete from public.connector_tools ct where ct.owner_id = runtime_owner_id;
  delete from public.connector_accounts ca where ca.owner_id = runtime_owner_id;
  delete from public.record_embeddings re where re.owner_id = runtime_owner_id;
  delete from public.forecasts fo where fo.owner_id = runtime_owner_id;
  delete from public.decision_reviews dr where dr.owner_id = runtime_owner_id;
  delete from public.experiments ex where ex.owner_id = runtime_owner_id;
  delete from public.entity_relations er where er.owner_id = runtime_owner_id;
  delete from public.entities en where en.owner_id = runtime_owner_id;
  delete from public.claim_evidence ce where ce.owner_id = runtime_owner_id;
  delete from public.claims cl where cl.owner_id = runtime_owner_id;
  delete from public.evidence_items ei where ei.owner_id = runtime_owner_id;
  delete from public.actions ac where ac.owner_id = runtime_owner_id;
  delete from public.case_members cm where cm.owner_id = runtime_owner_id;
  delete from public.record_revisions rr where rr.owner_id = runtime_owner_id;
  delete from public.inbox_items i where i.owner_id = runtime_owner_id;

  -- Cases last among Custodian rows (remaining child FKs are CASCADE / SET NULL).
  delete from public.cases c where c.owner_id = runtime_owner_id;
  get diagnostics deleted_cases = row_count;

  delete from public.record_links l where l.user_id = runtime_owner_id;
  get diagnostics deleted_links = row_count;

  delete from public.records r where r.user_id = runtime_owner_id;
  get diagnostics deleted_records = row_count;

  delete from public.app_metadata m where m.user_id = runtime_owner_id;
  delete from public.profiles p where p.id = runtime_owner_id;

  delete from public.owner_provider_credential_events e where e.owner_id = runtime_owner_id;
  delete from public.owner_provider_credentials c where c.owner_id = runtime_owner_id;
  get diagnostics deleted_credentials = row_count;
  delete from public.owner_provider_settings s where s.owner_id = runtime_owner_id;

  delete from private.conversation_extraction_quota q where q.user_id = runtime_owner_id;

  return jsonb_build_object(
    'purged', true,
    'owner_id', runtime_owner_id,
    'deleted_cases', deleted_cases,
    'deleted_records', deleted_records,
    'deleted_links', deleted_links,
    'deleted_credentials', deleted_credentials
  );
end;
$$;

revoke execute on function public.purge_owner_account_data(uuid) from public;
revoke execute on function public.purge_owner_account_data(uuid) from anon;
revoke execute on function public.purge_owner_account_data(uuid) from authenticated;
grant execute on function public.purge_owner_account_data(uuid) to service_role;
