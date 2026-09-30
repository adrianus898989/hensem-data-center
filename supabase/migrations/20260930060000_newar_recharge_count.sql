-- The daily submission reader already consumes this source scalar. Keep it
-- through ingestion; missing values remain unknown and are never defaulted.
begin;
do $migration$
declare keys text[];
begin
  keys := private.newar_detail_raw_keys();
  if not ('rechargeCount' = any(keys)) then
    keys := array_append(keys, 'rechargeCount');
    execute format(
      'create or replace function private.newar_detail_raw_keys() returns text[] language sql immutable set search_path='''' as %L',
      'select ' || quote_literal(keys::text) || '::text[];'
    );
  end if;
end;
$migration$;
notify pgrst, 'reload schema';
commit;
