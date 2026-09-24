-- Project route becomes optional, owner-defined metadata.
--
-- Removes the global allowlist (The Forge / The Chamber / The Book / General /
-- Do not preserve) from record validation. A route is now null or a non-blank
-- string of at most 120 characters. Every existing stored value stays valid as
-- an ordinary string and no row is rewritten. This is a forward-only redefinition
-- of assert_record_data_valid; only the two projectRoute checks differ from the
-- definition in 20260809132453_document_records.sql.

create or replace function public.assert_record_data_valid(
  p_record_type text,
  p_record_data jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rec_type text := p_record_type;
  data jsonb := p_record_data;
  s text;
  key text;
  item jsonb;
  item_key text;
  ref_id text;
  string_fields text[];
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  date_re constant text := '^\d{4}-\d{2}-\d{2}$';
begin
  if data is null or pg_catalog.jsonb_typeof(data) is distinct from 'object' then
    raise exception 'recordData must be a JSON object' using errcode = '22023';
  end if;

  if rec_type = 'tool' then
    string_fields := array[
      'category','status','whatCaughtMyEye','whatItPromised',
      'whatActuallyHappened','whatWorked','whatFailed',
      'whyIKeptOrStoppedUsingIt','revisitCondition','finalVerdict'
    ];
    foreach key in array string_fields loop
      if not (data ? key) then
        raise exception 'tool.% is required', key using errcode = '22023';
      end if;
      if pg_catalog.jsonb_typeof(data -> key) is distinct from 'string' then
        raise exception 'tool.% must be a JSON string', key using errcode = '22023';
      end if;
    end loop;

    if pg_catalog.btrim(data ->> 'category') = '' then
      raise exception 'tool.category must be a non-empty string' using errcode = '22023';
    end if;
    if (data ->> 'status') not in (
      'Active','Useful but dormant','Experimental','Worth revisiting',
      'Disappointing','Buried','Grok-tier cursed'
    ) then
      raise exception 'tool.status invalid: %', data ->> 'status' using errcode = '22023';
    end if;

    if not (data ? 'replacementToolId') then
      raise exception 'tool.replacementToolId is required (use null when absent)' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'replacementToolId') not in ('null','string') then
      raise exception 'tool.replacementToolId must be null or a UUID string' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'replacementToolId') = 'string' then
      s := data ->> 'replacementToolId';
      if s !~* uuid_re then
        raise exception 'tool.replacementToolId is not a UUID: %', s using errcode = '22023';
      end if;
    end if;

    if not (data ? 'lastReviewed') then
      raise exception 'tool.lastReviewed is required (use null when absent)' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'lastReviewed') not in ('null','string') then
      raise exception 'tool.lastReviewed must be null or a YYYY-MM-DD string' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'lastReviewed') = 'string' then
      s := data ->> 'lastReviewed';
      if s !~ date_re then
        raise exception 'tool.lastReviewed must be YYYY-MM-DD: %', s using errcode = '22023';
      end if;
      begin
        perform s::date;
      exception when others then
        raise exception 'tool.lastReviewed is not a valid calendar date: %', s using errcode = '22023';
      end;
    end if;

  elsif rec_type = 'repository' then
    string_fields := array[
      'githubUrl','whatCaughtMyEye','whatItClaims','whatItActuallyDoes',
      'maintenanceImpression','complexity','risk','integrationCost',
      'immediateUsefulness','longTermValue','finalVerdict'
    ];
    foreach key in array string_fields loop
      if not (data ? key) then
        raise exception 'repository.% is required', key using errcode = '22023';
      end if;
      if pg_catalog.jsonb_typeof(data -> key) is distinct from 'string' then
        raise exception 'repository.% must be a JSON string', key using errcode = '22023';
      end if;
    end loop;

    if pg_catalog.btrim(data ->> 'githubUrl') = '' then
      raise exception 'repository.githubUrl must be a non-empty string' using errcode = '22023';
    end if;
    foreach key in array array['complexity','risk','integrationCost','immediateUsefulness','longTermValue'] loop
      if (data ->> key) not in ('Unknown','Low','Medium','High','Very high') then
        raise exception 'repository.% invalid rating: %', key, data ->> key using errcode = '22023';
      end if;
    end loop;

    if not (data ? 'recommendedAction') then
      raise exception 'repository.recommendedAction is required (use null when absent)' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'recommendedAction') not in ('null','string') then
      raise exception 'repository.recommendedAction must be null or a string' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'recommendedAction') = 'string'
       and (data ->> 'recommendedAction') not in (
         'Use now','Cellar','Compare later','Extract patterns',
         'Document only','Skip','Pour down sink'
       ) then
      raise exception 'repository.recommendedAction invalid: %', data ->> 'recommendedAction' using errcode = '22023';
    end if;

    if not (data ? 'lastReviewed') then
      raise exception 'repository.lastReviewed is required (use null when absent)' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'lastReviewed') not in ('null','string') then
      raise exception 'repository.lastReviewed must be null or a YYYY-MM-DD string' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'lastReviewed') = 'string' then
      s := data ->> 'lastReviewed';
      if s !~ date_re then
        raise exception 'repository.lastReviewed must be YYYY-MM-DD: %', s using errcode = '22023';
      end if;
      begin
        perform s::date;
      exception when others then
        raise exception 'repository.lastReviewed is not a valid calendar date: %', s using errcode = '22023';
      end;
    end if;

  elsif rec_type = 'conversation' then
    if not (data ? 'conversationDate') then
      raise exception 'conversation.conversationDate is required (use null when absent)' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'conversationDate') not in ('null','string') then
      raise exception 'conversation.conversationDate must be null or a YYYY-MM-DD string' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'conversationDate') = 'string' then
      s := data ->> 'conversationDate';
      if s !~ date_re then
        raise exception 'conversation.conversationDate must be YYYY-MM-DD: %', s using errcode = '22023';
      end if;
      begin
        perform s::date;
      exception when others then
        raise exception 'conversation.conversationDate is not a valid calendar date: %', s using errcode = '22023';
      end;
    end if;

    string_fields := array[
      'highSignalFindings','decisionsMade','openLoops',
      'reusablePrompts','memoryCandidates','rawConversationText'
    ];
    foreach key in array string_fields loop
      if not (data ? key) then
        raise exception 'conversation.% is required', key using errcode = '22023';
      end if;
      if pg_catalog.jsonb_typeof(data -> key) is distinct from 'string' then
        raise exception 'conversation.% must be a JSON string', key using errcode = '22023';
      end if;
    end loop;
    -- Project route is optional, owner-defined metadata: null or a bounded,
    -- non-blank string. Historical values remain ordinary valid strings.
    if not (data ? 'projectRoute') then
      raise exception 'conversation.projectRoute is required (use null when absent)' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'projectRoute') not in ('null','string')
       or (pg_catalog.jsonb_typeof(data -> 'projectRoute') = 'string'
           and (pg_catalog.btrim(data ->> 'projectRoute') = ''
                or pg_catalog.char_length(data ->> 'projectRoute') > 120)) then
      raise exception 'conversation.projectRoute must be null or a non-blank string of at most 120 characters' using errcode = '22023';
    end if;

  elsif rec_type = 'decision' then
    string_fields := array[
      'reason','trigger','whatWouldChangeMyMind','decisionDate','status','confidence'
    ];
    foreach key in array string_fields loop
      if not (data ? key) then
        raise exception 'decision.% is required', key using errcode = '22023';
      end if;
      if pg_catalog.jsonb_typeof(data -> key) is distinct from 'string' then
        raise exception 'decision.% must be a JSON string', key using errcode = '22023';
      end if;
    end loop;
    if pg_catalog.btrim(data ->> 'reason') = '' then
      raise exception 'decision.reason must be a non-empty string' using errcode = '22023';
    end if;
    s := data ->> 'decisionDate';
    if s !~ date_re then
      raise exception 'decision.decisionDate must be YYYY-MM-DD: %', s using errcode = '22023';
    end if;
    begin
      perform s::date;
    exception when others then
      raise exception 'decision.decisionDate is not a valid calendar date: %', s using errcode = '22023';
    end;
    if (data ->> 'status') not in ('Current','Tentative','Superseded','Reversed','Archived') then
      raise exception 'decision.status invalid: %', data ->> 'status' using errcode = '22023';
    end if;
    if (data ->> 'confidence') not in ('Low','Medium','High') then
      raise exception 'decision.confidence invalid: %', data ->> 'confidence' using errcode = '22023';
    end if;
    if not (data ? 'supersedesDecisionId') then
      raise exception 'decision.supersedesDecisionId is required (use null when absent)' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'supersedesDecisionId') not in ('null','string') then
      raise exception 'decision.supersedesDecisionId must be null or a UUID string' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'supersedesDecisionId') = 'string' then
      s := data ->> 'supersedesDecisionId';
      if s !~* uuid_re then
        raise exception 'decision.supersedesDecisionId is not a UUID: %', s using errcode = '22023';
      end if;
    end if;

  elsif rec_type = 'document' then
    -- Exact top-level document shape. This explicitly excludes raw/full-body
    -- fields and keeps the archive row metadata-only.
    if exists (
      select 1 from pg_catalog.jsonb_object_keys(data) as object_key
       where object_key not in (
         'originalFileName','mimeType','fileSizeBytes','documentDate','pageCount',
         'storagePath','extractedContentPath','contentHash','highSignalFindings',
         'keyClaims','contradictions','uncertainties','sourceReferences','projectRoute'
       )
    ) then
      raise exception 'document.recordData contains an unsupported field' using errcode = '22023';
    end if;

    foreach key in array array[
      'originalFileName','mimeType','fileSizeBytes','documentDate','pageCount',
      'storagePath','extractedContentPath','contentHash','highSignalFindings',
      'keyClaims','contradictions','uncertainties','sourceReferences','projectRoute'
    ] loop
      if not (data ? key) then
        raise exception 'document.% is required', key using errcode = '22023';
      end if;
    end loop;

    if pg_catalog.jsonb_typeof(data -> 'originalFileName') not in ('null','string')
       or (pg_catalog.jsonb_typeof(data -> 'originalFileName') = 'string'
           and (pg_catalog.length(data ->> 'originalFileName') > 240
             or pg_catalog.strpos(data ->> 'originalFileName', '/') > 0
             or pg_catalog.strpos(data ->> 'originalFileName', pg_catalog.chr(92)) > 0)) then
      raise exception 'document.originalFileName must be null or a bounded filename without path separators' using errcode = '22023';
    end if;

    if pg_catalog.jsonb_typeof(data -> 'mimeType') not in ('null','string')
       or (pg_catalog.jsonb_typeof(data -> 'mimeType') = 'string'
           and data ->> 'mimeType' not in ('application/pdf','text/markdown','text/plain')) then
      raise exception 'document.mimeType must be null or an allowed document MIME type' using errcode = '22023';
    end if;

    if pg_catalog.jsonb_typeof(data -> 'fileSizeBytes') not in ('null','number')
       or (pg_catalog.jsonb_typeof(data -> 'fileSizeBytes') = 'number'
           and (data ->> 'fileSizeBytes') !~ '^[0-9]+$') then
      raise exception 'document.fileSizeBytes must be null or a non-negative integer' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'fileSizeBytes') = 'number' then
      begin
        if (data ->> 'fileSizeBytes')::bigint > 10000000 then
          raise exception 'document.fileSizeBytes exceeds the 10 MB limit' using errcode = '22023';
        end if;
      exception when numeric_value_out_of_range then
        raise exception 'document.fileSizeBytes is out of range' using errcode = '22023';
      end;
    end if;

    if pg_catalog.jsonb_typeof(data -> 'documentDate') not in ('null','string') then
      raise exception 'document.documentDate must be null or YYYY-MM-DD' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'documentDate') = 'string' then
      s := data ->> 'documentDate';
      if s !~ date_re then
        raise exception 'document.documentDate must be YYYY-MM-DD: %', s using errcode = '22023';
      end if;
      begin
        perform s::date;
      exception when others then
        raise exception 'document.documentDate is not a valid calendar date: %', s using errcode = '22023';
      end;
    end if;

    if pg_catalog.jsonb_typeof(data -> 'pageCount') not in ('null','number') then
      raise exception 'document.pageCount must be null or a positive integer' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'pageCount') = 'number' then
      if (data ->> 'pageCount') !~ '^[1-9][0-9]*$' then
        raise exception 'document.pageCount must be a positive integer' using errcode = '22023';
      end if;
      begin
        if (data ->> 'pageCount')::bigint > 1000 then
          raise exception 'document.pageCount exceeds the supported bound' using errcode = '22023';
        end if;
      exception when numeric_value_out_of_range then
        raise exception 'document.pageCount is out of range' using errcode = '22023';
      end;
    end if;

    foreach key in array array['storagePath','extractedContentPath'] loop
      if pg_catalog.jsonb_typeof(data -> key) not in ('null','string') then
        raise exception 'document.% must be null or a storage path', key using errcode = '22023';
      end if;
      if pg_catalog.jsonb_typeof(data -> key) = 'string' then
        s := data ->> key;
        if s !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/documents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(original|extracted)/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$' then
          raise exception 'document.% has an invalid path shape', key using errcode = '22023';
        end if;
        if auth.uid() is not null and pg_catalog.split_part(s, '/', 1) <> (auth.uid())::text then
          raise exception 'document.% must be scoped to the authenticated user', key using errcode = '42501';
        end if;
      end if;
    end loop;
    if (pg_catalog.jsonb_typeof(data -> 'storagePath') = 'null') <> (pg_catalog.jsonb_typeof(data -> 'extractedContentPath') = 'null') then
      raise exception 'document storage paths must be both null or both present' using errcode = '22023';
    end if;

    if pg_catalog.jsonb_typeof(data -> 'contentHash') not in ('null','string')
       or (pg_catalog.jsonb_typeof(data -> 'contentHash') = 'string'
           and (data ->> 'contentHash') !~ '^[0-9a-f]{64}$') then
      raise exception 'document.contentHash must be null or a lowercase SHA-256 hex string' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(data -> 'storagePath') = 'string'
       and pg_catalog.jsonb_typeof(data -> 'contentHash') is distinct from 'string' then
      raise exception 'document.contentHash is required when a file is stored' using errcode = '22023';
    end if;

    if pg_catalog.jsonb_typeof(data -> 'storagePath') = 'string' then
      if not exists (
        select 1
          from storage.objects
         where bucket_id = 'document-files'
           and name = data ->> 'storagePath'
           and owner_id = (auth.uid())::text
      ) then
        raise exception 'document.storagePath does not resolve to a caller-owned object' using errcode = '22023';
      end if;
      if not exists (
        select 1
          from storage.objects
         where bucket_id = 'document-files'
           and name = data ->> 'extractedContentPath'
           and owner_id = (auth.uid())::text
           and user_metadata ->> 'document_version' = '1'
           and user_metadata ->> 'document_content_hash' = data ->> 'contentHash'
           and not exists (
             select 1
               from pg_catalog.jsonb_array_elements(data -> 'sourceReferences') as refs(value)
              where pg_catalog.strpos(
                coalesce(user_metadata ->> 'document_source_reference_ids', ''),
                '"' || (refs.value ->> 'id') || '"'
              ) = 0
           )
      ) then
        raise exception 'document.extractedContentPath does not resolve to a caller-owned validated object' using errcode = '22023';
      end if;
    end if;

    if pg_catalog.jsonb_typeof(data -> 'projectRoute') not in ('null','string')
       or (pg_catalog.jsonb_typeof(data -> 'projectRoute') = 'string'
           and (pg_catalog.btrim(data ->> 'projectRoute') = ''
                or pg_catalog.char_length(data ->> 'projectRoute') > 120)) then
      raise exception 'document.projectRoute must be null or a non-blank string of at most 120 characters' using errcode = '22023';
    end if;

    if pg_catalog.jsonb_typeof(data -> 'sourceReferences') is distinct from 'array' then
      raise exception 'document.sourceReferences must be an array of at most 64 entries' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_array_length(data -> 'sourceReferences') > 64 then
      raise exception 'document.sourceReferences must be an array of at most 64 entries' using errcode = '22023';
    end if;
    for item in select value from pg_catalog.jsonb_array_elements(data -> 'sourceReferences') as entries(value) loop
      if pg_catalog.jsonb_typeof(item) is distinct from 'object' then
        raise exception 'document.sourceReferences entries must be objects' using errcode = '22023';
      end if;
      if exists (
        select 1 from pg_catalog.jsonb_object_keys(item) as object_key
         where object_key not in ('id','locator','label','note')
      ) then
        raise exception 'document.sourceReferences entry contains an unsupported field' using errcode = '22023';
      end if;
      foreach key in array array['id','locator','label','note'] loop
        if not (item ? key) or pg_catalog.jsonb_typeof(item -> key) is distinct from 'string' then
          raise exception 'document.sourceReferences.% must be a JSON string', key using errcode = '22023';
        end if;
      end loop;
      if (item ->> 'id') !~ '^ref_[0-9a-f]{8}$'
         or pg_catalog.length(item ->> 'locator') not between 1 and 120
         or pg_catalog.length(item ->> 'label') not between 1 and 200
         or pg_catalog.length(item ->> 'note') > 500 then
        raise exception 'document.sourceReferences entry has an invalid bounded value' using errcode = '22023';
      end if;
    end loop;
    if exists (
      select 1
        from (
          select entry.value ->> 'id' as source_id
            from pg_catalog.jsonb_array_elements(data -> 'sourceReferences') as entry(value)
           group by entry.value ->> 'id'
          having count(*) > 1
        ) duplicates
    ) then
      raise exception 'document.sourceReferences ids must be unique' using errcode = '22023';
    end if;

    foreach key in array array['highSignalFindings','keyClaims','contradictions','uncertainties'] loop
      if pg_catalog.jsonb_typeof(data -> key) is distinct from 'array' then
        raise exception 'document.% must be a bounded insight array', key using errcode = '22023';
      end if;
      if pg_catalog.jsonb_array_length(data -> key) >
         (case when key = 'keyClaims' then 16 else 12 end) then
        raise exception 'document.% exceeds its bounded insight count', key using errcode = '22023';
      end if;
      for item in select value from pg_catalog.jsonb_array_elements(data -> key) as entries(value) loop
        if pg_catalog.jsonb_typeof(item) is distinct from 'object' then
          raise exception 'document.% entries must be objects', key using errcode = '22023';
        end if;
        if exists (
          select 1 from pg_catalog.jsonb_object_keys(item) as object_key
           where object_key not in ('text','sourceReferenceIds')
        ) then
          raise exception 'document.% entry contains an unsupported field', key using errcode = '22023';
        end if;
        if not (item ? 'text') or pg_catalog.jsonb_typeof(item -> 'text') is distinct from 'string'
           or pg_catalog.length(item ->> 'text') not between 1 and 2000 then
          raise exception 'document.% entry text must be a bounded non-empty string', key using errcode = '22023';
        end if;
        if not (item ? 'sourceReferenceIds')
           or pg_catalog.jsonb_typeof(item -> 'sourceReferenceIds') is distinct from 'array' then
          raise exception 'document.% sourceReferenceIds must be an array of at most 4 entries', key using errcode = '22023';
        end if;
        if pg_catalog.jsonb_array_length(item -> 'sourceReferenceIds') > 4 then
          raise exception 'document.% sourceReferenceIds must be an array of at most 4 entries', key using errcode = '22023';
        end if;
        if exists (
          select 1
            from pg_catalog.jsonb_array_elements(item -> 'sourceReferenceIds') as refs(value)
           where pg_catalog.jsonb_typeof(refs.value) is distinct from 'string'
        ) then
        raise exception 'document.% sourceReferenceIds entries must be reference ids', key using errcode = '22023';
        end if;
        for ref_id in select value from pg_catalog.jsonb_array_elements_text(item -> 'sourceReferenceIds') as refs(value) loop
          if ref_id !~ '^ref_[0-9a-f]{8}$' then
            raise exception 'document.% sourceReferenceIds contains an invalid reference id', key using errcode = '22023';
          end if;
          if not exists (
            select 1
              from pg_catalog.jsonb_array_elements(data -> 'sourceReferences') as refs(value)
             where refs.value ->> 'id' = ref_id
          ) then
            raise exception 'document.% references an unknown sourceReference id', key using errcode = '22023';
          end if;
        end loop;
      end loop;
    end loop;

  else
    raise exception 'unknown recordType: %', rec_type using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.assert_record_data_valid(text, jsonb) from public;
revoke execute on function public.assert_record_data_valid(text, jsonb) from anon;
revoke execute on function public.assert_record_data_valid(text, jsonb) from authenticated;
