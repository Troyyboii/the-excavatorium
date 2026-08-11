-- 0005_validation_helpers.sql
-- Internal validation helper. Four boring branches: tool, repository,
-- conversation, decision. Validates required fields, value types, enum
-- values, date formats, and reference shapes. No client execution grant.
-- Empty search_path; schema-qualified.

create or replace function public.assert_record_data_valid(
  p_record_type text,
  p_record_data jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v text;
begin
  if p_record_data is null or pg_catalog.jsonb_typeof(p_record_data) <> 'object' then
    raise exception 'record_data must be a JSON object' using errcode = '22023';
  end if;

  if p_record_type = 'tool' then
    v := p_record_data ->> 'category';
    if v is null or pg_catalog.btrim(v) = '' then
      raise exception 'tool.category is required' using errcode = '22023';
    end if;
    v := p_record_data ->> 'status';
    if v is null or v not in (
      'Active','Useful but dormant','Experimental','Worth revisiting',
      'Disappointing','Buried','Grok-tier cursed'
    ) then
      raise exception 'tool.status invalid: %', coalesce(v,'(null)') using errcode = '22023';
    end if;
    -- replacementToolId must be null or a valid uuid string; ownership
    -- and self-reference checks happen in the calling RPC.
    v := p_record_data ->> 'replacementToolId';
    if v is not null then
      begin
        perform v::uuid;
      exception when others then
        raise exception 'tool.replacementToolId must be a uuid or null' using errcode = '22023';
      end;
    end if;
    v := p_record_data ->> 'lastReviewed';
    if v is not null and v !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'tool.lastReviewed must be YYYY-MM-DD or null' using errcode = '22023';
    end if;

  elsif p_record_type = 'repository' then
    v := p_record_data ->> 'githubUrl';
    if v is null or pg_catalog.btrim(v) = '' then
      raise exception 'repository.githubUrl is required' using errcode = '22023';
    end if;
    for v in select pg_catalog.jsonb_object_field_text(p_record_data, k)
             from (values
               ('complexity'),('risk'),('integrationCost'),
               ('immediateUsefulness'),('longTermValue')
             ) t(k)
    loop
      if v is not null and v not in ('Unknown','Low','Medium','High','Very high') then
        raise exception 'repository rating invalid: %', v using errcode = '22023';
      end if;
    end loop;
    v := p_record_data ->> 'recommendedAction';
    if v is not null and v not in (
      'Use now','Cellar','Compare later','Extract patterns',
      'Document only','Skip','Pour down sink'
    ) then
      raise exception 'repository.recommendedAction invalid: %', v using errcode = '22023';
    end if;

  elsif p_record_type = 'conversation' then
    v := p_record_data ->> 'projectRoute';
    if v is null or v not in (
      'The Forge','The Chamber','The Book','General','Do not preserve'
    ) then
      raise exception 'conversation.projectRoute invalid: %', coalesce(v,'(null)') using errcode = '22023';
    end if;
    v := p_record_data ->> 'conversationDate';
    if v is not null and v !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'conversation.conversationDate must be YYYY-MM-DD or null' using errcode = '22023';
    end if;

  elsif p_record_type = 'decision' then
    v := p_record_data ->> 'reason';
    if v is null or pg_catalog.btrim(v) = '' then
      raise exception 'decision.reason is required' using errcode = '22023';
    end if;
    v := p_record_data ->> 'decisionDate';
    if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'decision.decisionDate must be YYYY-MM-DD' using errcode = '22023';
    end if;
    v := p_record_data ->> 'status';
    if v is null or v not in ('Current','Tentative','Superseded','Reversed','Archived') then
      raise exception 'decision.status invalid: %', coalesce(v,'(null)') using errcode = '22023';
    end if;
    v := p_record_data ->> 'confidence';
    if v is null or v not in ('Low','Medium','High') then
      raise exception 'decision.confidence invalid: %', coalesce(v,'(null)') using errcode = '22023';
    end if;
    v := p_record_data ->> 'supersedesDecisionId';
    if v is not null then
      begin
        perform v::uuid;
      exception when others then
        raise exception 'decision.supersedesDecisionId must be a uuid or null' using errcode = '22023';
      end;
    end if;

  else
    raise exception 'unknown record_type: %', p_record_type using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.assert_record_data_valid(text, jsonb) from public;
revoke execute on function public.assert_record_data_valid(text, jsonb) from anon;
revoke execute on function public.assert_record_data_valid(text, jsonb) from authenticated;
