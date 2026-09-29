-- Include every supplied UTR in original-order rows, independently of matching.
-- Patch only this projection so deployed scope and other statistics stay intact.
do $migration$
declare
  definition text;
  old_fragment text := 'filter(where utr_matched is true and nullif(btrim(detail_utr),'''') is not null)';
  new_fragment text := 'filter(where nullif(btrim(detail_utr),'''') is not null)';
begin
  select pg_get_functiondef('private.dashboard_admin_live_workorder_analysis(jsonb)'::regprocedure)
    into definition;
  if strpos(definition, old_fragment) > 0 then
    execute replace(definition, old_fragment, new_fragment);
  elsif strpos(definition, new_fragment) = 0 then
    raise exception 'Workorder UTR projection changed; review before applying';
  end if;
end;
$migration$;
