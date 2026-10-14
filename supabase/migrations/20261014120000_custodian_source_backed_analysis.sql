-- Custodian: source-backed read-only analysis.
--
-- Root cause repaired here: custodian_build_readonly_analysis_snapshot admitted
-- only record title + a 2,000 character summary, never record_data, and only
-- case-linked evidence_items were citable. A run over selected archive records
-- with no hand-made evidence items therefore reached the provider with almost
-- no content and a schema that forbade an ordinary "finding".
--
-- This migration (forward only; earlier migrations are not edited):
--   1. Builds a bounded, deterministic evidence bundle from the explicitly
--      selected, owner-owned records: extracted claim "source units" with
--      stable refs (r<selection index>.<field code><n>), provenance, evidence
--      level, truncation/omission accounting and currency (current/superseded).
--      rawConversationText and storage paths are never admitted.
--   2. Lets a Finding cite admitted source units by ref. Refs are resolved by
--      the database from the persisted run snapshot, never from model-supplied
--      record ids, and are stored on the Finding as source_citations. No
--      evidence_items row is created by a read-only run.
--   3. Derives the evidence byte budget from the owner's own per-run token
--      ceiling (the provider hold counts request bytes as tokens).
--
-- No provider is contacted and no archive or evidence row is written here.

-- ---------------------------------------------------------------------------
-- 1. Finding source citations
-- ---------------------------------------------------------------------------
alter table public.custodian_findings
  add column if not exists source_citations jsonb not null default '[]'::jsonb;

alter table public.custodian_findings
  drop constraint if exists custodian_findings_source_citations_ck;
alter table public.custodian_findings
  add constraint custodian_findings_source_citations_ck check (
    pg_catalog.jsonb_typeof(source_citations) = 'array'
    and pg_catalog.jsonb_array_length(source_citations) <= 64
  );

-- ---------------------------------------------------------------------------
-- 2. Pure helpers
-- ---------------------------------------------------------------------------
create or replace function public.custodian_split_source_units(
  field_text text,
  max_units integer,
  max_unit_chars integer
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  part text;
  cleaned text;
  units jsonb := '[]'::jsonb;
  total integer := 0;
begin
  if field_text is null then
    return pg_catalog.jsonb_build_object('units', units, 'total', 0);
  end if;
  for part in
    select value from pg_catalog.regexp_split_to_table(field_text, E'\\r?\\n') as t(value)
  loop
    cleaned := pg_catalog.btrim(pg_catalog.regexp_replace(part, E'^\\s*([-*•]|[0-9]{1,3}[.)])\\s+', ''));
    if cleaned = '' then
      continue;
    end if;
    total := total + 1;
    if total <= max_units then
      units := units || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'text', pg_catalog.left(cleaned, max_unit_chars),
          'text_chars', pg_catalog.char_length(cleaned),
          'truncated', pg_catalog.char_length(cleaned) > max_unit_chars
        )
      );
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('units', units, 'total', total);
end;
$$;

create or replace function public.custodian_objective_terms(objective_text text)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(distinct term), '{}'::text[])
    from (
      select pg_catalog.lower(value) as term
        from pg_catalog.regexp_split_to_table(coalesce(objective_text, ''), '[^A-Za-z0-9]+') as t(value)
       where pg_catalog.char_length(value) >= 4
    ) terms;
$$;

create or replace function public.custodian_unit_relevance(unit_text text, terms text[])
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(count(*), 0)::integer
    from pg_catalog.unnest(terms) as t(term)
   where pg_catalog.strpos(pg_catalog.lower(coalesce(unit_text, '')), t.term) > 0;
$$;

revoke execute on function public.custodian_split_source_units(text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.custodian_objective_terms(text)
  from public, anon, authenticated;
revoke execute on function public.custodian_unit_relevance(text, text[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Snapshot builder
-- ---------------------------------------------------------------------------
drop function if exists public.custodian_build_readonly_analysis_snapshot(uuid, uuid, text);

create or replace function public.custodian_build_readonly_analysis_snapshot(
  caller_id uuid,
  case_id_value uuid,
  objective_value text,
  evidence_budget_bytes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hard_limit constant integer := 80000;
  unit_char_limit constant integer := 700;
  field_unit_cap constant integer := 24;
  ref_enum_cost constant integer := 70;
  contrary_share constant numeric := 0.4;
  case_row public.cases;
  scope jsonb;
  effective_limit integer;
  terms text[];
  record_id_text text;
  selection_index integer;
  record_row public.records;
  record_code text;
  data jsonb;
  spec jsonb;
  field_spec jsonb;
  field_order integer;
  field_value jsonb;
  split_result jsonb;
  unit_row jsonb;
  position_in_field integer;
  field_total integer;
  summary_text text;
  meta jsonb;
  currency_value text;
  original_text_state text;
  raw_chars integer;
  link_count integer;
  document_source_count integer;
  header jsonb;
  headers jsonb := '[]'::jsonb;
  excluded jsonb := '[]'::jsonb;
  candidates jsonb := '[]'::jsonb;
  admitted_units jsonb := '[]'::jsonb;
  omitted_units jsonb := '[]'::jsonb;
  ranked jsonb;
  cand jsonb;
  pub jsonb;
  cost integer;
  base_cost integer;
  unit_budget integer;
  used integer := 0;
  contrary_used integer := 0;
  assembled_records jsonb;
  record_units jsonb;
  record_header jsonb;
  citable_refs jsonb;
  evidence_ids jsonb;
  snapshot jsonb;
  total_units integer;
  admitted_count integer;
  substantive_count integer;
  contrary_count integer;
  truncated_flag boolean;
  owner_context_text text;
  owner_context_truncated boolean;
  objective_text text;
  question_text text;
  index_value integer;
  last_admitted jsonb;
  popped_ref text;
  header_count integer;
  legend_key text;
  legend_seen jsonb := '{}'::jsonb;
begin
  select * into case_row
    from public.cases
   where owner_id = caller_id and id = case_id_value;
  if not found then
    raise exception 'case is not owned by the authenticated user' using errcode = 'P0002';
  end if;
  scope := case_row.archive_scope;
  effective_limit := least(hard_limit, greatest(0, coalesce(evidence_budget_bytes, hard_limit)));
  terms := public.custodian_objective_terms(objective_value);

  objective_text := pg_catalog.left(coalesce(objective_value, ''), 4000);
  question_text := pg_catalog.left(coalesce(case_row.current_question, ''), 1000);
  owner_context_text := pg_catalog.left(coalesce(scope ->> 'free_text_context', ''), 3000);
  owner_context_truncated := pg_catalog.char_length(coalesce(scope ->> 'free_text_context', '')) > 3000;

  selection_index := 0;
  for record_id_text in
    select value
      from pg_catalog.jsonb_array_elements_text(scope -> 'record_ids') as item(value)
  loop
    selection_index := selection_index + 1;
    select * into record_row
      from public.records
     where user_id = caller_id and id = record_id_text::uuid;
    if not found then
      excluded := excluded || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'record_id', record_id_text, 'selection_index', selection_index, 'reason', 'unavailable'
        )
      );
      continue;
    end if;

    data := record_row.record_data;
    record_code := 'r' || selection_index::text;

    spec := case record_row.record_type
      when 'conversation' then '[
        ["highSignalFindings","f","High-signal findings","finding",2,"owner_extracted_notes",false],
        ["decisionsMade","d","Decisions made","decision",2,"owner_extracted_notes",false],
        ["openLoops","o","Open loops","open_loop",1,"owner_extracted_notes",false],
        ["memoryCandidates","m","Memory candidates","memory_candidate",3,"owner_extracted_notes",false],
        ["reusablePrompts","p","Reusable prompts","prompt",3,"owner_extracted_notes",false]]'::jsonb
      when 'document' then '[
        ["highSignalFindings","f","High-signal findings","finding",2,"document_extraction",true],
        ["keyClaims","k","Key claims","claim",2,"document_extraction",true],
        ["contradictions","c","Contradictions","contradiction",1,"document_extraction",true],
        ["uncertainties","u","Uncertainties","uncertainty",1,"document_extraction",true]]'::jsonb
      when 'decision' then '[
        ["reason","r","Reason","rationale",2,"owner_authored_record",false],
        ["trigger","t","Trigger","context",3,"owner_authored_record",false],
        ["whatWouldChangeMyMind","w","What would change my mind","uncertainty",1,"owner_authored_record",false]]'::jsonb
      when 'tool' then '[
        ["whatActuallyHappened","h","What actually happened","finding",2,"owner_authored_record",false],
        ["whatWorked","w","What worked","finding",2,"owner_authored_record",false],
        ["whatFailed","x","What failed","failure",1,"owner_authored_record",false],
        ["whyIKeptOrStoppedUsingIt","y","Why kept or stopped","rationale",2,"owner_authored_record",false],
        ["finalVerdict","v","Final verdict","verdict",2,"owner_authored_record",false],
        ["whatItPromised","p","What it promised","claim",3,"owner_authored_record",false],
        ["revisitCondition","r","Revisit condition","uncertainty",3,"owner_authored_record",false]]'::jsonb
      when 'repository' then '[
        ["whatItClaims","c","What it claims","claim",3,"owner_authored_record",false],
        ["whatItActuallyDoes","a","What it actually does","finding",2,"owner_authored_record",false],
        ["maintenanceImpression","m","Maintenance impression","finding",3,"owner_authored_record",false],
        ["finalVerdict","v","Final verdict","verdict",2,"owner_authored_record",false]]'::jsonb
      else '[]'::jsonb
    end;

    meta := '{}'::jsonb;
    currency_value := 'unspecified';
    original_text_state := 'not_applicable';
    document_source_count := null;
    if record_row.record_type = 'conversation' then
      meta := pg_catalog.jsonb_build_object(
        'conversation_date', data -> 'conversationDate'
      );
      raw_chars := pg_catalog.char_length(coalesce(data ->> 'rawConversationText', ''));
      original_text_state := case when raw_chars > 0 then 'stored_not_admitted' else 'not_retained' end;
    elsif record_row.record_type = 'document' then
      meta := pg_catalog.jsonb_build_object(
        'original_file_name', data -> 'originalFileName',
        'document_date', data -> 'documentDate',
        'page_count', data -> 'pageCount',
        'mime_type', data -> 'mimeType'
      );
      original_text_state := case
        when pg_catalog.jsonb_typeof(data -> 'storagePath') = 'string' then 'stored_not_admitted'
        else 'not_retained'
      end;
      document_source_count := pg_catalog.jsonb_array_length(coalesce(data -> 'sourceReferences', '[]'::jsonb));
    elsif record_row.record_type = 'decision' then
      meta := pg_catalog.jsonb_build_object(
        'decision_date', data -> 'decisionDate',
        'status', data -> 'status',
        'confidence', data -> 'confidence',
        'supersedes_decision_id', data -> 'supersedesDecisionId'
      );
      currency_value := case
        when data ->> 'status' in ('Superseded', 'Reversed', 'Archived') then 'superseded'
        when data ->> 'status' in ('Current', 'Tentative') then 'current'
        else 'unspecified'
      end;
    elsif record_row.record_type = 'tool' then
      meta := pg_catalog.jsonb_build_object(
        'category', data -> 'category', 'status', data -> 'status',
        'last_reviewed', data -> 'lastReviewed',
        'replacement_tool_id', data -> 'replacementToolId'
      );
      if pg_catalog.jsonb_typeof(data -> 'replacementToolId') = 'string' then
        currency_value := 'superseded';
      end if;
    elsif record_row.record_type = 'repository' then
      meta := pg_catalog.jsonb_build_object(
        'github_url', data -> 'githubUrl', 'last_reviewed', data -> 'lastReviewed'
      );
    end if;

    select count(*) into link_count
      from public.record_links link
     where link.user_id = caller_id
       and (link.source_record_id = record_row.id or link.target_record_id = record_row.id)
       and not (
         pg_catalog.jsonb_build_array(link.source_record_id::text) <@ (scope -> 'record_ids')
         and pg_catalog.jsonb_build_array(link.target_record_id::text) <@ (scope -> 'record_ids')
       );

    header := pg_catalog.jsonb_build_object(
      'record_id', record_row.id,
      'record_type', record_row.record_type,
      'title', pg_catalog.left(record_row.title, 300),
      'selection_index', selection_index,
      'ref_prefix', record_code,
      'currency', currency_value,
      'original_text', original_text_state,
      'source_limitations', case record_row.record_type
        when 'document' then pg_catalog.jsonb_build_array(
          'Extracted claims and notes only; the original document text is not admitted to this run.',
          'Claims are secondary extractions, not independently verified.')
        when 'conversation' then pg_catalog.jsonb_build_array(
          'Owner-extracted conversation notes; the raw transcript is not admitted to this run.',
          'Notes may mix owner-reported experience with generated hypotheses.')
        else pg_catalog.jsonb_build_array(
          'Owner-authored archive record; not independently verified.')
      end,
      'provenance', pg_catalog.jsonb_build_object(
        'created_at', record_row.created_at,
        'updated_at', record_row.updated_at,
        'source_reference_count', document_source_count,
        'meta', meta
      ),
      'linked_records_not_admitted', link_count
    );
    headers := headers || pg_catalog.jsonb_build_array(header);

    -- Summary is a secondary, derived unit.
    summary_text := pg_catalog.btrim(coalesce(record_row.summary, ''));
    if summary_text <> '' then
      candidates := candidates || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'rec_idx', selection_index, 'tier', 3, 'field_order', 0, 'pos', 0,
          'score', public.custodian_unit_relevance(summary_text, terms),
          'field_code', 's',
          'legend', pg_catalog.jsonb_build_object(
            'field', 'Summary', 'kind', 'summary', 'evidence_level', 'record_summary'),
          'pub', pg_catalog.jsonb_build_object(
            'ref', record_code || '.s',
            'text', pg_catalog.left(summary_text, unit_char_limit)
          ) || case when pg_catalog.char_length(summary_text) > unit_char_limit
                    then '{"truncated":true}'::jsonb else '{}'::jsonb end
        )
      );
    end if;

    field_order := 0;
    for field_spec in select value from pg_catalog.jsonb_array_elements(spec) as s(value)
    loop
      field_order := field_order + 1;
      field_value := data -> (field_spec ->> 0);
      if field_value is null or pg_catalog.jsonb_typeof(field_value) = 'null' then
        continue;
      end if;
      if (field_spec ->> 6)::boolean then
        -- Document insight arrays: [{text, sourceReferenceIds}]
        if pg_catalog.jsonb_typeof(field_value) <> 'array' then
          continue;
        end if;
        position_in_field := 0;
        for unit_row in select value from pg_catalog.jsonb_array_elements(field_value) as u(value)
        loop
          position_in_field := position_in_field + 1;
          if position_in_field > field_unit_cap then
            omitted_units := omitted_units || pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'rec_idx', selection_index, 'field_code', field_spec ->> 1, 'reason', 'unit_cap'));
            continue;
          end if;
          candidates := candidates || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'rec_idx', selection_index, 'tier', (field_spec ->> 4)::integer,
              'field_order', field_order, 'pos', position_in_field,
              'score', public.custodian_unit_relevance(unit_row ->> 'text', terms),
              'field_code', field_spec ->> 1,
              'legend', pg_catalog.jsonb_build_object(
                'field', field_spec ->> 2, 'kind', field_spec ->> 3,
                'evidence_level', field_spec ->> 5),
              'pub', pg_catalog.jsonb_build_object(
                'ref', record_code || '.' || (field_spec ->> 1) || position_in_field::text,
                'text', pg_catalog.left(coalesce(unit_row ->> 'text', ''), unit_char_limit)
              ) || case when pg_catalog.char_length(coalesce(unit_row ->> 'text', '')) > unit_char_limit
                        then '{"truncated":true}'::jsonb else '{}'::jsonb end
                || pg_catalog.jsonb_build_object(
                'source_references', coalesce((
                  select pg_catalog.jsonb_agg(
                           pg_catalog.jsonb_build_object(
                             'id', reference.value ->> 'id',
                             'locator', pg_catalog.left(reference.value ->> 'locator', 120),
                             'label', pg_catalog.left(reference.value ->> 'label', 200))
                           order by reference.ordinality)
                    from pg_catalog.jsonb_array_elements(coalesce(data -> 'sourceReferences', '[]'::jsonb))
                           with ordinality as reference(value, ordinality)
                   where pg_catalog.jsonb_build_array(reference.value ->> 'id')
                         <@ coalesce(unit_row -> 'sourceReferenceIds', '[]'::jsonb)
                ), '[]'::jsonb)
              ) - case when pg_catalog.jsonb_array_length(coalesce(unit_row -> 'sourceReferenceIds', '[]'::jsonb)) = 0
                       then 'source_references' else '' end
            )
          );
        end loop;
      else
        if pg_catalog.jsonb_typeof(field_value) <> 'string' then
          continue;
        end if;
        split_result := public.custodian_split_source_units(
          field_value #>> '{}', field_unit_cap, unit_char_limit);
        field_total := (split_result ->> 'total')::integer;
        if field_total > field_unit_cap then
          omitted_units := omitted_units || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'rec_idx', selection_index, 'field_code', field_spec ->> 1, 'reason', 'unit_cap',
              'count', field_total - field_unit_cap));
        end if;
        position_in_field := 0;
        for unit_row in select value from pg_catalog.jsonb_array_elements(split_result -> 'units') as u(value)
        loop
          position_in_field := position_in_field + 1;
          candidates := candidates || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'rec_idx', selection_index, 'tier', (field_spec ->> 4)::integer,
              'field_order', field_order, 'pos', position_in_field,
              'score', public.custodian_unit_relevance(unit_row ->> 'text', terms),
              'field_code', field_spec ->> 1,
              'legend', pg_catalog.jsonb_build_object(
                'field', field_spec ->> 2, 'kind', field_spec ->> 3,
                'evidence_level', field_spec ->> 5),
              'pub', pg_catalog.jsonb_build_object(
                'ref', record_code || '.' || (field_spec ->> 1) || position_in_field::text,
                'text', unit_row ->> 'text'
              ) || case when (unit_row ->> 'truncated')::boolean
                        then '{"truncated":true}'::jsonb else '{}'::jsonb end
            )
          );
        end loop;
      end if;
    end loop;
  end loop;

  -- Rank inside (record, tier): most objective-relevant first, then stored order.
  select coalesce(pg_catalog.jsonb_agg(
           c.value || pg_catalog.jsonb_build_object('rank', c.rank)
           order by (c.value ->> 'tier')::integer, c.rank,
                    (c.value ->> 'rec_idx')::integer,
                    (c.value ->> 'field_order')::integer, (c.value ->> 'pos')::integer), '[]'::jsonb)
    into ranked
    from (
      select e.value,
             pg_catalog.row_number() over (
               partition by (e.value ->> 'rec_idx')::integer, (e.value ->> 'tier')::integer
               order by (e.value ->> 'score')::integer desc,
                        (e.value ->> 'field_order')::integer, (e.value ->> 'pos')::integer
             ) as rank
        from pg_catalog.jsonb_array_elements(candidates) as e(value)
    ) c;

  total_units := pg_catalog.jsonb_array_length(ranked);

  -- Fixed part of the snapshot, including record headers.
  select coalesce(pg_catalog.jsonb_agg(h.value order by (h.value ->> 'selection_index')::integer), '[]'::jsonb)
    into assembled_records
    from pg_catalog.jsonb_array_elements(headers) as h(value);
  header_count := pg_catalog.jsonb_array_length(headers);

  -- Admission: contrary/uncertain material first (capped share), then
  -- fair round-robin across records.
  base_cost := pg_catalog.octet_length(
    pg_catalog.jsonb_build_object(
      'objective', objective_text, 'case_question', question_text,
      'owner_context', owner_context_text, 'admitted_records', assembled_records,
      'excluded_records', excluded)::text) + 1200;
  unit_budget := effective_limit - base_cost;

  for cand in select value from pg_catalog.jsonb_array_elements(ranked) as r(value)
  loop
    cost := pg_catalog.octet_length((cand -> 'pub')::text) + 1 + ref_enum_cost;
    legend_key := (cand ->> 'rec_idx') || '.' || (cand ->> 'field_code');
    if cand ->> 'field_code' <> 's' and not (legend_seen ? legend_key) then
      cost := cost + pg_catalog.octet_length((cand -> 'legend')::text) + 6;
    end if;
    if used + cost > unit_budget then
      omitted_units := omitted_units || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'rec_idx', (cand ->> 'rec_idx')::integer, 'field_code', cand ->> 'field_code',
          'reason', 'context_budget'));
      continue;
    end if;
    if (cand ->> 'tier')::integer = 1
       and contrary_used + cost > pg_catalog.floor(unit_budget * contrary_share) then
      omitted_units := omitted_units || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'rec_idx', (cand ->> 'rec_idx')::integer, 'field_code', cand ->> 'field_code',
          'reason', 'context_budget'));
      continue;
    end if;
    used := used + cost;
    legend_seen := legend_seen || pg_catalog.jsonb_build_object(legend_key, true);
    if (cand ->> 'tier')::integer = 1 then
      contrary_used := contrary_used + cost;
    end if;
    admitted_units := admitted_units || pg_catalog.jsonb_build_array(cand);
  end loop;

  -- Exact assembly with a deterministic safety net: drop the last-admitted
  -- unit, then the last selected record, until the real size fits.
  loop
    select coalesce(pg_catalog.jsonb_agg(
             h.value || pg_catalog.jsonb_build_object(
               'summary', coalesce((
                 select a.value #>> '{pub,text}'
                   from pg_catalog.jsonb_array_elements(admitted_units) as a(value)
                  where (a.value ->> 'rec_idx')::integer = (h.value ->> 'selection_index')::integer
                    and a.value ->> 'field_code' = 's'
               ), ''),
               'summary_ref', (
                 select a.value #>> '{pub,ref}'
                   from pg_catalog.jsonb_array_elements(admitted_units) as a(value)
                  where (a.value ->> 'rec_idx')::integer = (h.value ->> 'selection_index')::integer
                    and a.value ->> 'field_code' = 's'
               ),
               'summary_truncated', exists (
                 select 1
                   from pg_catalog.jsonb_array_elements(candidates) as c(value)
                  where (c.value ->> 'rec_idx')::integer = (h.value ->> 'selection_index')::integer
                    and c.value ->> 'field_code' = 's'
                    and (
                      coalesce((c.value #>> '{pub,truncated}')::boolean, false)
                      or not exists (
                        select 1
                          from pg_catalog.jsonb_array_elements(admitted_units) as a(value)
                         where (a.value ->> 'rec_idx')::integer = (h.value ->> 'selection_index')::integer
                           and a.value ->> 'field_code' = 's')
                    )
               ),
               'field_legend', coalesce((
                 select pg_catalog.jsonb_object_agg(l.code, l.legend)
                   from (
                     select distinct on (a.value ->> 'field_code')
                            a.value ->> 'field_code' as code, a.value -> 'legend' as legend
                       from pg_catalog.jsonb_array_elements(admitted_units) as a(value)
                      where (a.value ->> 'rec_idx')::integer = (h.value ->> 'selection_index')::integer
                        and a.value ->> 'field_code' <> 's'
                   ) l
               ), '{}'::jsonb),
               'source_units', coalesce((
                 select pg_catalog.jsonb_agg(a.value -> 'pub'
                          order by (a.value ->> 'field_order')::integer, (a.value ->> 'pos')::integer)
                   from pg_catalog.jsonb_array_elements(admitted_units) as a(value)
                  where (a.value ->> 'rec_idx')::integer = (h.value ->> 'selection_index')::integer
                    and a.value ->> 'field_code' <> 's'
               ), '[]'::jsonb)
             ) order by (h.value ->> 'selection_index')::integer), '[]'::jsonb)
      into assembled_records
      from pg_catalog.jsonb_array_elements(headers) as h(value);

    select coalesce(pg_catalog.jsonb_agg(unit_ref order by unit_rec, unit_field, unit_pos), '[]'::jsonb)
      into citable_refs
      from (
        select a.value #>> '{pub,ref}' as unit_ref,
               (a.value ->> 'rec_idx')::integer as unit_rec,
               (a.value ->> 'field_order')::integer as unit_field,
               (a.value ->> 'pos')::integer as unit_pos
          from pg_catalog.jsonb_array_elements(admitted_units) as a(value)
      ) refs;

    select coalesce(pg_catalog.jsonb_agg(evidence.id order by evidence.id), '[]'::jsonb)
      into evidence_ids
      from public.evidence_items evidence
     where evidence.owner_id = caller_id
       and evidence.case_id = case_id_value
       and evidence.source_record_id is not null
       and exists (
         select 1
           from pg_catalog.jsonb_array_elements(headers) as h(value)
          where h.value ->> 'record_id' = evidence.source_record_id::text
       );

    admitted_count := pg_catalog.jsonb_array_length(admitted_units);
    select count(*) filter (where a.value ->> 'field_code' <> 's'
                              or pg_catalog.char_length(a.value #>> '{pub,text}') >= 80),
           count(*) filter (where (a.value ->> 'tier')::integer = 1)
      into substantive_count, contrary_count
      from pg_catalog.jsonb_array_elements(admitted_units) as a(value);
    truncated_flag := admitted_count < total_units
      or pg_catalog.jsonb_array_length(omitted_units) > 0
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(admitted_units) as a(value)
         where coalesce((a.value #>> '{pub,truncated}')::boolean, false)
      )
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(excluded) as x(value)
         where x.value ->> 'reason' = 'reading_limit'
      )
      or owner_context_truncated;

    snapshot := pg_catalog.jsonb_build_object(
      'kind', 'readonly_analysis_snapshot',
      'contract_version', 2,
      'case_id', case_id_value,
      'objective', objective_text,
      'case_question', question_text,
      'owner_context', owner_context_text,
      'owner_context_truncated', owner_context_truncated,
      'source_classes', pg_catalog.jsonb_build_object(
        'owner_context', 'owner_provided',
        'source_units', 'archive_extracted_not_independently_verified',
        'external_sources', 'none_retrieved'),
      'admitted_records', assembled_records,
      'excluded_records', excluded,
      'citable_evidence_ids', evidence_ids,
      'citable_source_refs', citable_refs,
      'evidence_budget', pg_catalog.jsonb_build_object(
        'limit_bytes', effective_limit,
        'units_total', total_units,
        'units_admitted', admitted_count,
        'units_omitted', greatest(total_units - admitted_count, 0),
        'substantive_units_admitted', substantive_count,
        'contrary_or_uncertain_units_admitted', contrary_count,
        'omitted_by_field', coalesce((
          select pg_catalog.jsonb_agg(
                   pg_catalog.jsonb_build_object(
                     'selection_index', o.rec_idx, 'field_code', o.field_code,
                     'reason', o.reason, 'count', o.n)
                   order by o.rec_idx, o.field_code, o.reason)
            from (
              select (x.value ->> 'rec_idx')::integer as rec_idx,
                     x.value ->> 'field_code' as field_code,
                     x.value ->> 'reason' as reason,
                     sum(coalesce((x.value ->> 'count')::integer, 1))::integer as n
                from pg_catalog.jsonb_array_elements(omitted_units) as x(value)
               group by 1, 2, 3
            ) o
        ), '[]'::jsonb)),
      'truncated', truncated_flag
    );

    exit when pg_catalog.octet_length(snapshot::text) <= effective_limit;

    if admitted_count > 0 then
      last_admitted := admitted_units -> (admitted_count - 1);
      popped_ref := last_admitted #>> '{pub,ref}';
      omitted_units := omitted_units || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'rec_idx', (last_admitted ->> 'rec_idx')::integer,
          'field_code', last_admitted ->> 'field_code', 'reason', 'context_budget'));
      admitted_units := admitted_units - (admitted_count - 1);
    elsif header_count > 0 then
      excluded := excluded || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'record_id', headers -> (header_count - 1) ->> 'record_id',
          'selection_index', (headers -> (header_count - 1) ->> 'selection_index')::integer,
          'reason', 'reading_limit'));
      headers := headers - (header_count - 1);
      header_count := header_count - 1;
    else
      exit;
    end if;
  end loop;

  if pg_catalog.octet_length(snapshot::text) > hard_limit then
    raise exception 'readonly analysis snapshot exceeds the runtime bound' using errcode = '22023';
  end if;
  return snapshot;
end;
$$;

create or replace function public.custodian_build_readonly_analysis_snapshot(
  caller_id uuid,
  case_id_value uuid,
  objective_value text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.custodian_build_readonly_analysis_snapshot(caller_id, case_id_value, objective_value, null);
$$;

revoke execute on function public.custodian_build_readonly_analysis_snapshot(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke execute on function public.custodian_build_readonly_analysis_snapshot(uuid, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Run creation: the evidence budget follows the owner's own ceiling.
--    request bytes ~ tokens in the provider hold, so
--    evidence bytes = per-run token ceiling - max output hold - fixed request.
-- ---------------------------------------------------------------------------
create or replace function public.custodian_create_readonly_analysis_run(
  case_id_value uuid,
  idempotency_key text,
  run_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  payload jsonb := public.custodian_runtime_require_object(run_payload, 'run_payload');
  policy_row public.tool_policies;
  policy_id uuid;
  model_value text;
  prompt_value text;
  objective_value text;
  snapshot jsonb;
  evidence_count integer;
  record_count integer;
  evidence_budget integer;
begin
  perform public.custodian_reject_owner_keys(payload);
  perform public.custodian_lock(caller_id);
  perform public.custodian_runtime_assert_case(caller_id, case_id_value);
  if exists (
    select 1
      from pg_catalog.jsonb_object_keys(payload) as keys(key)
     where keys.key not in ('model_tier', 'prompt_version', 'objective', 'tool_policy_id')
  ) then
    raise exception 'readonly analysis run accepts only model_tier, prompt_version, objective, and tool_policy_id'
      using errcode = '22023';
  end if;

  policy_id := public.custodian_runtime_uuid(payload ->> 'tool_policy_id', 'tool_policy_id');
  if policy_id is null then
    raise exception 'tool_policy_id is required' using errcode = '22023';
  end if;
  model_value := public.custodian_require_text(payload ->> 'model_tier', 'model_tier', 20);
  prompt_value := public.custodian_require_text(payload ->> 'prompt_version', 'prompt_version', 200);
  objective_value := public.custodian_require_text(payload ->> 'objective', 'objective', 20000);
  if model_value not in ('luna', 'terra', 'sol', 'pro') then
    raise exception 'model_tier is not allowed' using errcode = '22023';
  end if;

  select * into policy_row
    from public.tool_policies
   where owner_id = caller_id
     and id = policy_id
     and tool_policies.case_id = case_id_value
   for update;
  if not found
     or policy_row.status <> 'active'
     or policy_row.lifecycle_status <> 'active'
     or policy_row.kill_switch then
    raise exception 'readonly analysis policy is not active for this case' using errcode = '42501';
  end if;
  if policy_row.allowed_tools <> '{}'::text[] then
    raise exception 'readonly analysis requires an empty tool allowlist' using errcode = '42501';
  end if;
  if policy_row.daily_cost_usd is null or policy_row.monthly_cost_usd is null then
    raise exception 'readonly analysis requires explicit daily and monthly cost ceilings'
      using errcode = '42501';
  end if;
  if not (model_value = any(policy_row.allowed_model_tiers)) then
    raise exception 'model tier is not permitted by the selected owner policy' using errcode = '42501';
  end if;

  -- The provider hold counts request bytes as tokens:
  --   hold = request_bytes + 4096 (bounded output) <= per-run token ceiling.
  -- Request bytes = ~10,500 fixed (instructions, schema with refs) + the
  -- objective (sent once more outside the snapshot) + the snapshot, which is
  -- embedded as an escaped JSON string (quotes grow ~12%, so divide by 1.15).
  -- custodian-run/provider-attempt.test.ts (T11) proves a snapshot at this limit fits.
  evidence_budget := greatest(
    pg_catalog.floor(
      (policy_row.per_run_token_budget - 4096 - 10500
        - pg_catalog.octet_length(objective_value)) * 100 / 115.0
    )::integer,
    0);

  select count(*) into evidence_count from public.evidence_items where owner_id = caller_id;
  select count(*) into record_count from public.records where user_id = caller_id;
  snapshot := public.custodian_build_readonly_analysis_snapshot(
    caller_id, case_id_value, objective_value, evidence_budget);
  if (select count(*) from public.evidence_items where owner_id = caller_id) <> evidence_count
     or (select count(*) from public.records where user_id = caller_id) <> record_count then
    raise exception 'readonly analysis snapshot mutated archive or evidence rows' using errcode = '42501';
  end if;

  return public.custodian_create_agent_run(
    pg_catalog.jsonb_build_object(
      'case_id', case_id_value,
      'tool_policy_id', policy_id,
      'objective', objective_value,
      'model_tier', model_value,
      'prompt_version', prompt_value,
      'input_snapshot', snapshot,
      'tool_allowlist', '[]'::jsonb,
      'agent_config', '{}'::jsonb,
      'agent_graph', '{}'::jsonb
    ),
    idempotency_key
  );
end;
$$;

revoke execute on function public.custodian_create_readonly_analysis_run(uuid, text, jsonb)
  from public, anon;
grant execute on function public.custodian_create_readonly_analysis_run(uuid, text, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Finding materialization with source-unit citations.
--    Refs are resolved only against the run's persisted snapshot.
-- ---------------------------------------------------------------------------
create or replace function public.custodian_resolve_source_citations(
  run_snapshot jsonb,
  supporting_refs jsonb,
  contrary_refs jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  kind_value text;
  ref_value text;
  unit jsonb;
  record_value jsonb;
  citations jsonb := '[]'::jsonb;
  admitted_refs jsonb := coalesce(run_snapshot -> 'citable_source_refs', '[]'::jsonb);
begin
  if pg_catalog.jsonb_typeof(supporting_refs) <> 'array' or pg_catalog.jsonb_typeof(contrary_refs) <> 'array' then
    raise exception 'Finding source references must be arrays' using errcode = '22023';
  end if;
  foreach kind_value in array array['supporting', 'contrary'] loop
    for ref_value in
      select value from pg_catalog.jsonb_array_elements_text(
        case kind_value when 'supporting' then supporting_refs else contrary_refs end) as r(value)
    loop
      if not (pg_catalog.jsonb_build_array(ref_value) <@ admitted_refs) then
        raise exception 'source reference is outside the admitted snapshot' using errcode = 'P0002';
      end if;
      unit := null;
      for record_value in
        select value from pg_catalog.jsonb_array_elements(run_snapshot -> 'admitted_records') as a(value)
      loop
        select u.value into unit
          from pg_catalog.jsonb_array_elements(record_value -> 'source_units') as u(value)
         where u.value ->> 'ref' = ref_value;
        if unit is null and record_value ->> 'summary_ref' = ref_value then
          unit := pg_catalog.jsonb_build_object(
            'field', 'Summary', 'kind', 'summary', 'evidence_level', 'record_summary',
            'text', record_value ->> 'summary');
        elsif unit is not null then
          -- Field name, kind and evidence level live once in the record's legend.
          unit := unit || coalesce(
            record_value -> 'field_legend' -> pg_catalog.substring(ref_value, '\.([a-z])'),
            '{}'::jsonb);
        end if;
        if unit is not null then
          citations := citations || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'ref', ref_value,
              'relationship', kind_value,
              'record_id', record_value ->> 'record_id',
              'record_type', record_value ->> 'record_type',
              'record_title', record_value ->> 'title',
              'selection_index', (record_value ->> 'selection_index')::integer,
              'field', unit ->> 'field',
              'unit_kind', unit ->> 'kind',
              'evidence_level', unit ->> 'evidence_level',
              'currency', record_value ->> 'currency',
              'excerpt', pg_catalog.left(unit ->> 'text', 400),
              'excerpt_hash', pg_catalog.md5(unit ->> 'text'),
              'source_references', coalesce(unit -> 'source_references', '[]'::jsonb)
            )
          );
          exit;
        end if;
      end loop;
      if unit is null then
        raise exception 'source reference is outside the admitted snapshot' using errcode = 'P0002';
      end if;
    end loop;
  end loop;
  return citations;
end;
$$;

revoke execute on function public.custodian_resolve_source_citations(jsonb, jsonb, jsonb)
  from public, anon, authenticated;

create or replace function public.custodian_materialize_finding(
  agent_step_id uuid,
  candidate_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := public.custodian_current_owner();
  step_row public.agent_steps;
  run_row public.agent_runs;
  candidate jsonb;
  findings jsonb;
  outcome_value text;
  analysis_mode_value text;
  title_value text;
  conclusion_value text;
  confidence_value integer;
  change_mind_value text;
  revisit_value text;
  uncertainties_value jsonb;
  assumptions_value jsonb;
  scope_limits_value jsonb;
  evidence_gaps_value jsonb;
  supporting_ids jsonb;
  contrary_ids jsonb;
  supporting_refs jsonb;
  contrary_refs jsonb;
  citations_value jsonb := '[]'::jsonb;
  evidence_value text;
  evidence_uuid uuid;
  existing_finding public.custodian_findings;
  inserted_finding public.custodian_findings;
  result_hash_value text;
begin
  perform public.custodian_lock(caller_id);
  if candidate_index is null or candidate_index < 0 or candidate_index > 63 then
    raise exception 'candidate_index must be between 0 and 63' using errcode = '22023';
  end if;

  select * into step_row
    from public.agent_steps
   where owner_id = caller_id and id = agent_step_id
   for update;
  if not found then
    raise exception 'synthesis step not found for authenticated owner' using errcode = 'P0002';
  end if;
  if step_row.step_kind <> 'synthesize' or step_row.status <> 'completed' then
    raise exception 'Finding materialization requires a completed synthesize step' using errcode = '42501';
  end if;

  select * into run_row
    from public.agent_runs
   where owner_id = caller_id and case_id = step_row.case_id and id = step_row.run_id
   for update;
  if not found then
    raise exception 'originating run is not owner-scoped' using errcode = 'P0002';
  end if;

  result_hash_value := pg_catalog.md5(step_row.output_payload::text);
  select * into existing_finding
    from public.custodian_findings
   where owner_id = caller_id
     and origin_step_id = step_row.id
     and public.custodian_findings.candidate_index = custodian_materialize_finding.candidate_index
   for update;
  if found then
    if existing_finding.analysis_result_hash <> result_hash_value then
      raise exception 'conflicting synthesis result for Finding materialization identity' using errcode = '23505';
    end if;
    return to_jsonb(existing_finding) || jsonb_build_object('outcome', existing_finding.analysis_outcome, 'materialized', true, 'idempotent', true);
  end if;

  if pg_catalog.jsonb_typeof(step_row.output_payload) <> 'object'
     or pg_catalog.jsonb_typeof(step_row.output_payload -> 'findings') <> 'array'
     or pg_catalog.jsonb_array_length(step_row.output_payload -> 'findings') > 64 then
    raise exception 'synthesis output does not match the structured Finding contract' using errcode = '22023';
  end if;
  findings := step_row.output_payload -> 'findings';
  candidate := findings -> custodian_materialize_finding.candidate_index;
  if candidate is null or pg_catalog.jsonb_typeof(candidate) <> 'object' then
    raise exception 'requested Finding candidate is missing or malformed' using errcode = '22023';
  end if;

  outcome_value := candidate ->> 'outcome';
  if outcome_value not in ('finding', 'unresolved', 'refusal', 'no_finding') then
    raise exception 'invalid Finding outcome' using errcode = '22023';
  end if;
  analysis_mode_value := candidate ->> 'analysis_mode';
  if analysis_mode_value not in ('plan', 'claim_review', 'evidence_gap', 'contradiction', 'timeline', 'causal', 'risk', 'decision', 'synthesis') then
    raise exception 'invalid Finding analysis mode' using errcode = '22023';
  end if;
  title_value := public.custodian_require_text(candidate ->> 'title', 'title', 500);
  conclusion_value := public.custodian_require_text(candidate ->> 'conclusion', 'conclusion', 30000);
  confidence_value := (candidate ->> 'confidence')::integer;
  if confidence_value not between 0 and 100 then
    raise exception 'confidence must be between 0 and 100' using errcode = '22023';
  end if;
  change_mind_value := public.custodian_require_text(candidate ->> 'what_would_change_mind', 'what_would_change_mind', 10000, false);
  revisit_value := public.custodian_require_text(candidate ->> 'revisit_condition', 'revisit_condition', 10000, false);

  uncertainties_value := candidate -> 'uncertainties';
  assumptions_value := candidate -> 'assumptions';
  scope_limits_value := candidate -> 'scope_limits';
  evidence_gaps_value := candidate -> 'evidence_gaps';
  if not public.custodian_finding_string_array_valid(uncertainties_value, 32, 1000)
     or not public.custodian_finding_string_array_valid(assumptions_value, 32, 1000)
     or not public.custodian_finding_string_array_valid(scope_limits_value, 32, 1000)
     or not public.custodian_finding_string_array_valid(evidence_gaps_value, 32, 1000) then
    raise exception 'Finding caveats must be bounded non-empty string arrays' using errcode = '22023';
  end if;

  supporting_ids := candidate -> 'supporting_evidence_ids';
  contrary_ids := candidate -> 'contrary_evidence_ids';
  -- Legacy outputs carry no source refs; absent means none.
  supporting_refs := coalesce(candidate -> 'supporting_source_refs', '[]'::jsonb);
  contrary_refs := coalesce(candidate -> 'contrary_source_refs', '[]'::jsonb);
  if supporting_ids is null or contrary_ids is null
     or pg_catalog.jsonb_typeof(supporting_ids) <> 'array'
     or pg_catalog.jsonb_typeof(contrary_ids) <> 'array'
     or pg_catalog.jsonb_array_length(supporting_ids) > 32
     or pg_catalog.jsonb_array_length(contrary_ids) > 32
     or not public.custodian_finding_string_array_valid(supporting_ids, 32, 100)
     or not public.custodian_finding_string_array_valid(contrary_ids, 32, 100) then
    raise exception 'Finding evidence references must be bounded non-empty UUID string arrays' using errcode = '22023';
  end if;
  if not public.custodian_finding_string_array_valid(supporting_refs, 32, 40)
     or not public.custodian_finding_string_array_valid(contrary_refs, 32, 40) then
    raise exception 'Finding source references must be bounded non-empty string arrays' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements_text(supporting_ids) value
    group by value having count(*) > 1
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements_text(contrary_ids) value
    group by value having count(*) > 1
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements_text(supporting_ids) supporting(value)
      join pg_catalog.jsonb_array_elements_text(contrary_ids) contrary(value)
        on supporting.value = contrary.value
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements_text(supporting_refs) value
    group by value having count(*) > 1
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements_text(contrary_refs) value
    group by value having count(*) > 1
  ) or exists (
    select 1
      from pg_catalog.jsonb_array_elements_text(supporting_refs) supporting(value)
      join pg_catalog.jsonb_array_elements_text(contrary_refs) contrary(value)
        on supporting.value = contrary.value
  ) then
    raise exception 'Finding evidence references must be non-duplicated' using errcode = '22023';
  end if;
  if outcome_value = 'finding'
     and pg_catalog.jsonb_array_length(supporting_ids) + pg_catalog.jsonb_array_length(supporting_refs) = 0 then
    raise exception 'a conclusive Finding requires supporting evidence' using errcode = '22023';
  end if;
  if outcome_value = 'unresolved'
     and pg_catalog.jsonb_array_length(uncertainties_value) = 0
     and pg_catalog.jsonb_array_length(evidence_gaps_value) = 0 then
    raise exception 'an unresolved result requires uncertainty or evidence gaps' using errcode = '22023';
  end if;

  if outcome_value in ('refusal', 'no_finding') then
    return jsonb_build_object('materialized', false, 'outcome', outcome_value, 'idempotent', false);
  end if;

  for evidence_value in select value from pg_catalog.jsonb_array_elements_text(supporting_ids)
  loop
    begin
      evidence_uuid := evidence_value::uuid;
    exception when invalid_text_representation then
      raise exception 'Finding evidence reference is not a UUID' using errcode = '22023';
    end;
    if not exists (
      select 1 from public.evidence_items
       where owner_id = caller_id and case_id = step_row.case_id and id = evidence_uuid
    ) then
      raise exception 'supporting evidence is missing or outside the Case' using errcode = 'P0002';
    end if;
  end loop;
  for evidence_value in select value from pg_catalog.jsonb_array_elements_text(contrary_ids)
  loop
    begin
      evidence_uuid := evidence_value::uuid;
    exception when invalid_text_representation then
      raise exception 'Finding evidence reference is not a UUID' using errcode = '22023';
    end;
    if not exists (
      select 1 from public.evidence_items
       where owner_id = caller_id and case_id = step_row.case_id and id = evidence_uuid
    ) then
      raise exception 'contrary evidence is missing or outside the Case' using errcode = 'P0002';
    end if;
  end loop;

  citations_value := public.custodian_resolve_source_citations(
    run_row.input_snapshot, supporting_refs, contrary_refs);

  insert into public.custodian_findings (
    owner_id, case_id, analysis_mode, title, finding, confidence,
    what_would_change_mind, revisit_condition, status, lifecycle_status,
    origin_kind, analysis_outcome, origin_run_id, origin_step_id, candidate_index, analysis_result_hash,
    uncertainties, assumptions, scope_limits, evidence_gaps, source_citations, created_by, updated_by
  ) values (
    caller_id, step_row.case_id, analysis_mode_value, title_value, conclusion_value, confidence_value,
    change_mind_value, revisit_value, 'open', 'active', 'analysis', outcome_value, run_row.id, step_row.id,
    custodian_materialize_finding.candidate_index, result_hash_value,
    uncertainties_value, assumptions_value, scope_limits_value, evidence_gaps_value,
    citations_value, caller_id, caller_id
  ) returning * into inserted_finding;

  for evidence_value in select value from pg_catalog.jsonb_array_elements_text(supporting_ids)
  loop
    evidence_uuid := evidence_value::uuid;
    insert into public.custodian_finding_evidence (
      owner_id, case_id, finding_id, evidence_id, relationship_kind, created_by, updated_by
    ) values (caller_id, step_row.case_id, inserted_finding.id, evidence_uuid, 'supporting', caller_id, caller_id);
  end loop;
  for evidence_value in select value from pg_catalog.jsonb_array_elements_text(contrary_ids)
  loop
    evidence_uuid := evidence_value::uuid;
    insert into public.custodian_finding_evidence (
      owner_id, case_id, finding_id, evidence_id, relationship_kind, created_by, updated_by
    ) values (caller_id, step_row.case_id, inserted_finding.id, evidence_uuid, 'contrary', caller_id, caller_id);
  end loop;

  return to_jsonb(inserted_finding) || jsonb_build_object('outcome', outcome_value, 'materialized', true, 'idempotent', false);
end;
$$;

revoke execute on function public.custodian_materialize_finding(uuid, integer) from public, anon;
grant execute on function public.custodian_materialize_finding(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Owner export carries the new column. The existing function is patched in
--    place and the patch is asserted, so a changed body fails the migration
--    instead of silently dropping citations from the export.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
  def text;
  patched text;
begin
  for fn in
    select p.oid
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_catalog.pg_get_functiondef(p.oid) like '%''evidence_gaps'', f.evidence_gaps,%'
       and pg_catalog.pg_get_functiondef(p.oid) not like '%source_citations%'
  loop
    def := pg_catalog.pg_get_functiondef(fn.oid);
    patched := pg_catalog.replace(
      def,
      '''evidence_gaps'', f.evidence_gaps,',
      '''evidence_gaps'', f.evidence_gaps, ''source_citations'', f.source_citations,');
    if patched = def then
      raise exception 'owner export patch did not apply';
    end if;
    execute patched;
  end loop;
end;
$$;
