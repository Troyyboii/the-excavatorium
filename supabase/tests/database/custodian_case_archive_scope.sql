-- Run against a local Supabase database after all migrations.
-- This test is source-only in the Milestone A implementation task; it is not
-- applied to the linked project.
begin;

select plan(6);

set local role postgres;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  (
    '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
    'case-scope-owner-a@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
    'case-scope-owner-b@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
  );

insert into public.records (id, user_id, record_type, title, record_data) values
  (
    '01010101-0101-4101-8101-010101010101',
    '11111111-1111-4111-8111-111111111111',
    'tool',
    'Owner A first',
    '{}'::jsonb
  ),
  (
    '02020202-0202-4202-8202-020202020202',
    '11111111-1111-4111-8111-111111111111',
    'decision',
    'Owner A second',
    '{}'::jsonb
  ),
  (
    '03030303-0303-4303-8303-030303030303',
    '22222222-2222-4222-8222-222222222222',
    'conversation',
    'Owner B only',
    '{}'::jsonb
  );

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'cases'
       and column_name = 'archive_scope'
  )
  and exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.cases'::regclass
       and conname = 'cases_archive_scope_shape_ck'
  ),
  'cases has the bounded archive_scope column and shape constraint'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare
  response_value jsonb;
  case_id uuid;
begin
  response_value := public.custodian_create_case(
    jsonb_build_object(
      'title', 'Scoped Case',
      'objective', 'Check a decision',
      'current_question', 'Does the evidence still support it?',
      'archive_scope', jsonb_build_object(
        'record_ids', jsonb_build_array(
          '01010101-0101-4101-8101-010101010101',
          '02020202-0202-4202-8202-020202020202'
        ),
        'free_text_context', 'Owner context is not archive evidence.'
      )
    )
  );
  if response_value #>> '{archive_scope,record_ids,0}' <>
       '01010101-0101-4101-8101-010101010101'
     or response_value #>> '{archive_scope,record_ids,1}' <>
       '02020202-0202-4202-8202-020202020202'
     or response_value #>> '{archive_scope,free_text_context}' <>
       'Owner context is not archive evidence.' then
    raise exception 'created case did not persist the selected owner records and context';
  end if;

  case_id := (response_value ->> 'id')::uuid;
  response_value := public.custodian_update_case(
    case_id,
    jsonb_build_object('title', 'Updated Scoped Case')
  );
  if response_value #>> '{archive_scope,record_ids,0}' <>
       '01010101-0101-4101-8101-010101010101'
     or response_value #>> '{archive_scope,record_ids,1}' <>
       '02020202-0202-4202-8202-020202020202' then
    raise exception 'omitted archive_scope update did not preserve the existing scope';
  end if;

  response_value := public.custodian_update_case(
    case_id,
    jsonb_build_object(
      'archive_scope',
      jsonb_build_object('record_ids', '[]'::jsonb, 'free_text_context', '')
    )
  );
  if response_value #>> '{archive_scope,record_ids}' <> '[]'
     or response_value #>> '{archive_scope,free_text_context}' <> '' then
    raise exception 'explicit empty archive_scope did not clear the owner scope';
  end if;
end;
$$;

select ok(true, 'case create and update preserve explicit scope semantics');

do $$
begin
  begin
    perform public.custodian_create_case(
      jsonb_build_object(
        'title', 'Duplicate scope',
        'archive_scope', jsonb_build_object(
          'record_ids', jsonb_build_array(
            '01010101-0101-4101-8101-010101010101',
            '01010101-0101-4101-8101-010101010101'
          ),
          'free_text_context', ''
        )
      )
    );
    raise exception 'duplicate archive record IDs were accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.custodian_create_case(
      jsonb_build_object(
        'title', 'Invalid scope',
        'archive_scope', jsonb_build_object(
          'record_ids', jsonb_build_array('not-a-uuid'),
          'free_text_context', ''
        )
      )
    );
    raise exception 'invalid archive record ID was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.custodian_create_case(
      jsonb_build_object(
        'title', 'Null scope',
        'archive_scope', null
      )
    );
    raise exception 'null archive scope was accepted';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;

select ok(true, 'duplicate and malformed archive scopes are rejected');

do $$
declare
  over_limit_ids jsonb;
begin
  select pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(
      '00000000-0000-4000-8000-' || pg_catalog.lpad(item_value::text, 12, '0')
    )
  )
    into over_limit_ids
    from pg_catalog.generate_series(0, 50) as series(item_value);

  begin
    perform public.custodian_create_case(
      jsonb_build_object(
        'title', 'Over limit scope',
        'archive_scope', jsonb_build_object(
          'record_ids', over_limit_ids,
          'free_text_context', ''
        )
      )
    );
    raise exception 'over-limit archive scope was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.custodian_create_case(
      jsonb_build_object(
        'title', 'Oversized context',
        'archive_scope', jsonb_build_object(
          'record_ids', '[]'::jsonb,
          'free_text_context', pg_catalog.repeat('x', 10001)
        )
      )
    );
    raise exception 'oversized archive context was accepted';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;

select ok(true, 'archive scope record and context limits are enforced');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $$
begin
  begin
    perform public.custodian_create_case(
      jsonb_build_object(
        'title', 'Cross owner scope',
        'archive_scope', jsonb_build_object(
          'record_ids', jsonb_build_array(
            '01010101-0101-4101-8101-010101010101'
          ),
          'free_text_context', ''
        )
      )
    );
    raise exception 'a foreign owner archive record was accepted';
  exception
    when no_data_found then null;
  end;
end;
$$;

select ok(true, 'archive scope selection is owner-scoped');

set local role postgres;

select ok(
  pg_catalog.to_regprocedure('public.custodian_validate_archive_scope(jsonb,uuid)') is not null
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.custodian_validate_archive_scope(jsonb,uuid)',
    'EXECUTE'
  ),
  'archive scope validation helper is installed but not client-callable'
);

select * from finish();
rollback;
