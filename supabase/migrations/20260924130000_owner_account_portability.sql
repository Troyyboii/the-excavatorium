-- Wave 2: owner account portability — expanded export snapshot + purge RPC.
--
-- Export is SECURITY INVOKER so existing SELECT RLS remains the boundary.
-- Ciphertext in owner_provider_credentials is never selected here (no grants /
-- no policies for authenticated). Non-secret provider preferences come from
-- owner_provider_settings. Key last4/status is merged client-side via
-- custodian_provider_key_status().
--
-- Purge is SECURITY DEFINER with search_path='' and owner derived only from
-- auth.uid(). It deletes structured owner rows so NO ACTION created_by /
-- updated_by FKs cannot block a later auth.users delete. Storage binaries are
-- not removed here — the account-delete Edge Function purges document-files
-- before calling this RPC and auth.admin.deleteUser.

create or replace function public.export_user_account_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  archive_value jsonb;
  cases_value jsonb;
  evidence_value jsonb;
  findings_value jsonb;
  finding_evidence_value jsonb;
  claims_value jsonb;
  claim_evidence_value jsonb;
  approvals_value jsonb;
  decision_reviews_value jsonb;
  runs_value jsonb;
  provider_settings_value jsonb;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  archive_value := public.export_user_archive_snapshot();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'owner_id', c.owner_id,
        'title', c.title,
        'objective', c.objective,
        'current_question', c.current_question,
        'default_working_set', c.default_working_set,
        'archive_scope', c.archive_scope,
        'status', c.status,
        'closed_at', c.closed_at,
        'created_at', c.created_at,
        'updated_at', c.updated_at
      ) order by c.id
    ),
    '[]'::jsonb
  ) into cases_value
  from public.cases c
  where c.owner_id = caller_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'owner_id', e.owner_id,
        'case_id', e.case_id,
        'title', e.title,
        'content', e.content,
        'content_hash', e.content_hash,
        'source_classification', e.source_classification,
        'source_uri', e.source_uri,
        'source_record_id', e.source_record_id,
        'provenance', e.provenance,
        'lifecycle_status', e.lifecycle_status,
        'immutable', e.immutable,
        'captured_at', e.captured_at,
        'supersedes_id', e.supersedes_id,
        'created_at', e.created_at,
        'updated_at', e.updated_at
      ) order by e.id
    ),
    '[]'::jsonb
  ) into evidence_value
  from public.evidence_items e
  where e.owner_id = caller_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'owner_id', f.owner_id,
        'case_id', f.case_id,
        'analysis_mode', f.analysis_mode,
        'title', f.title,
        'finding', f.finding,
        'confidence', f.confidence,
        'what_would_change_mind', f.what_would_change_mind,
        'revisit_condition', f.revisit_condition,
        'source_record_id', f.source_record_id,
        'status', f.status,
        'lifecycle_status', f.lifecycle_status,
        'origin_kind', f.origin_kind,
        'analysis_outcome', f.analysis_outcome,
        'origin_run_id', f.origin_run_id,
        'origin_step_id', f.origin_step_id,
        'candidate_index', f.candidate_index,
        'analysis_result_hash', f.analysis_result_hash,
        'uncertainties', f.uncertainties,
        'assumptions', f.assumptions,
        'scope_limits', f.scope_limits,
        'evidence_gaps', f.evidence_gaps,
        'created_at', f.created_at,
        'updated_at', f.updated_at
      ) order by f.id
    ),
    '[]'::jsonb
  ) into findings_value
  from public.custodian_findings f
  where f.owner_id = caller_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', fe.id,
        'owner_id', fe.owner_id,
        'case_id', fe.case_id,
        'finding_id', fe.finding_id,
        'evidence_id', fe.evidence_id,
        'relationship_kind', fe.relationship_kind,
        'relationship_note', fe.relationship_note,
        'lifecycle_status', fe.lifecycle_status,
        'created_at', fe.created_at,
        'updated_at', fe.updated_at
      ) order by fe.id
    ),
    '[]'::jsonb
  ) into finding_evidence_value
  from public.custodian_finding_evidence fe
  where fe.owner_id = caller_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', cl.id,
        'owner_id', cl.owner_id,
        'case_id', cl.case_id,
        'statement', cl.statement,
        'status', cl.status,
        'confidence', cl.confidence,
        'what_would_change_mind', cl.what_would_change_mind,
        'revisit_condition', cl.revisit_condition,
        'source_record_id', cl.source_record_id,
        'lifecycle_status', cl.lifecycle_status,
        'created_at', cl.created_at,
        'updated_at', cl.updated_at
      ) order by cl.id
    ),
    '[]'::jsonb
  ) into claims_value
  from public.claims cl
  where cl.owner_id = caller_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ce.id,
        'owner_id', ce.owner_id,
        'case_id', ce.case_id,
        'claim_id', ce.claim_id,
        'evidence_id', ce.evidence_id,
        'relationship_note', ce.relationship_note,
        'lifecycle_status', ce.lifecycle_status,
        'created_at', ce.created_at,
        'updated_at', ce.updated_at
      ) order by ce.id
    ),
    '[]'::jsonb
  ) into claim_evidence_value
  from public.claim_evidence ce
  where ce.owner_id = caller_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'owner_id', a.owner_id,
        'case_id', a.case_id,
        'run_id', a.run_id,
        'approval_kind', a.approval_kind,
        'status', a.status,
        'title', a.title,
        'rationale', a.rationale,
        'proposed_diff', a.proposed_diff,
        'tool_action', a.tool_action,
        'exact_action_hash', a.exact_action_hash,
        'response_note', a.response_note,
        'requested_at', a.requested_at,
        'responded_at', a.responded_at,
        'expires_at', a.expires_at,
        'lifecycle_status', a.lifecycle_status,
        'created_at', a.created_at,
        'updated_at', a.updated_at
      ) order by a.id
    ),
    '[]'::jsonb
  ) into approvals_value
  from public.approval_requests a
  where a.owner_id = caller_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'owner_id', d.owner_id,
        'case_id', d.case_id,
        'decision_record_id', d.decision_record_id,
        'question', d.question,
        'criteria', d.criteria,
        'options', d.options,
        'recommendation', d.recommendation,
        'decision', d.decision,
        'rationale', d.rationale,
        'status', d.status,
        'review_due_at', d.review_due_at,
        'lifecycle_status', d.lifecycle_status,
        'created_at', d.created_at,
        'updated_at', d.updated_at
      ) order by d.id
    ),
    '[]'::jsonb
  ) into decision_reviews_value
  from public.decision_reviews d
  where d.owner_id = caller_id;

  -- Run history metadata only — not full input/output forensic payloads.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'owner_id', r.owner_id,
        'case_id', r.case_id,
        'objective', r.objective,
        'status', r.status,
        'lifecycle_status', r.lifecycle_status,
        'model_tier', r.model_tier,
        'prompt_version', r.prompt_version,
        'tool_allowlist', to_jsonb(r.tool_allowlist),
        'budget_tokens', r.budget_tokens,
        'budget_cost_usd', r.budget_cost_usd,
        'budget_latency_ms', r.budget_latency_ms,
        'budget_tool_events', r.budget_tool_events,
        'tokens_used', r.tokens_used,
        'cost_usd', r.cost_usd,
        'latency_ms', r.latency_ms,
        'tool_events_count', r.tool_events_count,
        'started_at', r.started_at,
        'completed_at', r.completed_at,
        'cancel_requested_at', r.cancel_requested_at,
        'failure_code', r.failure_code,
        'failure_message', r.failure_message,
        'last_step_number', r.last_step_number,
        'created_at', r.created_at,
        'updated_at', r.updated_at
      ) order by r.id
    ),
    '[]'::jsonb
  ) into runs_value
  from public.agent_runs r
  where r.owner_id = caller_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'provider', s.provider,
        'model_name', s.model_name,
        'updated_at', s.updated_at
      ) order by s.provider
    ),
    '[]'::jsonb
  ) into provider_settings_value
  from public.owner_provider_settings s
  where s.owner_id = caller_id;

  return jsonb_build_object(
    'archive', archive_value,
    'cases', cases_value,
    'evidence', evidence_value,
    'findings', findings_value,
    'finding_evidence', finding_evidence_value,
    'claims', claims_value,
    'claim_evidence', claim_evidence_value,
    'approvals', approvals_value,
    'decision_reviews', decision_reviews_value,
    'custodian_runs', runs_value,
    'provider_settings', provider_settings_value
  );
end;
$$;

revoke execute on function public.export_user_account_snapshot() from public;
revoke execute on function public.export_user_account_snapshot() from anon;
grant execute on function public.export_user_account_snapshot() to authenticated;

-- Destructive purge is service_role-only from the first migration that
-- introduces it. Do NOT create an authenticated-callable intermediate form:
-- if a later hardening migration failed to apply, a weaker RPC must not remain.
-- Explicit runtime_owner_id (trusted Edge passes JWT-derived owner only).
-- RESTRICT-safe order: break findings↔ runs/steps and runs ↔ policies before cases.

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
