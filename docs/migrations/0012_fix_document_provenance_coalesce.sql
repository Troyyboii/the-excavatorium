-- Correct the document provenance validator installed by 0011.
-- COALESCE is SQL syntax and cannot be schema-qualified as pg_catalog.coalesce.
do $$
declare
  function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.assert_record_data_valid(text, jsonb)'::pg_catalog.regprocedure
  ) into function_definition;

  function_definition := pg_catalog.replace(
    function_definition,
    'pg_catalog.coalesce',
    'coalesce'
  );

  function_definition := pg_catalog.replace(
    function_definition,
    'metadata ->> ''document_',
    'user_metadata ->> ''document_'
  );

  execute function_definition;
end;
$$;
