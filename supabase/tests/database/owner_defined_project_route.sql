-- Project route is optional, owner-defined metadata. Historical values stay
-- valid as ordinary strings; nothing global is enforced; unrelated validation
-- (required fields, enums, bounds) is untouched.
begin;

select plan(20);

create temp table route_fixture (kind text primary key, data jsonb) on commit drop;

insert into route_fixture values
  ('conversation', jsonb_build_object(
    'conversationDate', null,
    'projectRoute', null,
    'highSignalFindings', '', 'decisionsMade', '', 'openLoops', '',
    'reusablePrompts', '', 'memoryCandidates', '', 'rawConversationText', ''
  )),
  ('document', jsonb_build_object(
    'originalFileName', null, 'mimeType', null, 'fileSizeBytes', null,
    'documentDate', null, 'pageCount', null, 'storagePath', null,
    'extractedContentPath', null, 'contentHash', null,
    'highSignalFindings', '[]'::jsonb, 'keyClaims', '[]'::jsonb,
    'contradictions', '[]'::jsonb, 'uncertainties', '[]'::jsonb,
    'sourceReferences', '[]'::jsonb, 'projectRoute', null
  )),
  ('decision', jsonb_build_object(
    'reason', 'Because.', 'trigger', '', 'whatWouldChangeMyMind', '',
    'decisionDate', '2026-01-01', 'status', 'Current', 'confidence', 'Low',
    'supersedesDecisionId', null
  ));

-- Null route --------------------------------------------------------------

select lives_ok(
  $$select public.assert_record_data_valid('conversation', (select data from route_fixture where kind = 'conversation'))$$,
  'a conversation with a null route is valid'
);
select lives_ok(
  $$select public.assert_record_data_valid('document', (select data from route_fixture where kind = 'document'))$$,
  'a document with a null route is valid'
);

-- Historical values remain ordinary valid strings -------------------------

select lives_ok(
  format($$select public.assert_record_data_valid('conversation', (select data || jsonb_build_object('projectRoute', %L) from route_fixture where kind = 'conversation'))$$, r),
  format('conversation route %L remains valid', r)
) from unnest(array['The Forge','The Chamber','The Book','General','Do not preserve']) as r;

select lives_ok(
  format($$select public.assert_record_data_valid('document', (select data || jsonb_build_object('projectRoute', %L) from route_fixture where kind = 'document'))$$, r),
  format('document route %L remains valid', r)
) from unnest(array['The Forge','General']) as r;

-- Arbitrary owner-defined values -------------------------------------------

select lives_ok(
  $$select public.assert_record_data_valid('conversation', (select data || '{"projectRoute":"Kitchen renovation"}'::jsonb from route_fixture where kind = 'conversation'))$$,
  'an arbitrary owner-defined conversation route is valid'
);
select lives_ok(
  $$select public.assert_record_data_valid('document', (select data || '{"projectRoute":"Q4 research"}'::jsonb from route_fixture where kind = 'document'))$$,
  'an arbitrary owner-defined document route is valid'
);
select lives_ok(
  $$select public.assert_record_data_valid('conversation', (select data || jsonb_build_object('projectRoute', repeat('r', 120)) from route_fixture where kind = 'conversation'))$$,
  'a 120-character route is valid'
);

-- Bounds --------------------------------------------------------------------

select throws_ok(
  $$select public.assert_record_data_valid('conversation', (select data || jsonb_build_object('projectRoute', repeat('r', 121)) from route_fixture where kind = 'conversation'))$$,
  '22023', null, 'an overlong conversation route is rejected'
);
select throws_ok(
  $$select public.assert_record_data_valid('document', (select data || jsonb_build_object('projectRoute', repeat('r', 121)) from route_fixture where kind = 'document'))$$,
  '22023', null, 'an overlong document route is rejected'
);
select throws_ok(
  $$select public.assert_record_data_valid('conversation', (select data || '{"projectRoute":"   "}'::jsonb from route_fixture where kind = 'conversation'))$$,
  '22023', null, 'a blank conversation route is rejected (blank must be stored as null)'
);
select throws_ok(
  $$select public.assert_record_data_valid('document', (select data || '{"projectRoute":7}'::jsonb from route_fixture where kind = 'document'))$$,
  '22023', null, 'a non-string document route is rejected'
);

-- Unrelated validation is intact --------------------------------------------

select throws_ok(
  $$select public.assert_record_data_valid('conversation', (select data - 'projectRoute' from route_fixture where kind = 'conversation'))$$,
  '22023', null, 'a conversation must still state its route key (null when absent)'
);
select throws_ok(
  $$select public.assert_record_data_valid('conversation', (select data - 'rawConversationText' from route_fixture where kind = 'conversation'))$$,
  '22023', null, 'other conversation fields are still required'
);
select throws_ok(
  $$select public.assert_record_data_valid('decision', (select data || '{"status":"Nope"}'::jsonb from route_fixture where kind = 'decision'))$$,
  '22023', null, 'decision enums are still enforced'
);

select ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.assert_record_data_valid(text,jsonb)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.assert_record_data_valid(text,jsonb)', 'EXECUTE'),
  'the validator is still not executable by browser roles'
);

select finish();
rollback;
