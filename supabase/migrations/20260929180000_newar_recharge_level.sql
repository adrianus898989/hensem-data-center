-- Extend the existing source-field contract without replacing later workorder
-- additions. Legacy batches stay valid and absent levels stay absent.
begin;
do $migration$
declare keys text[];
begin
  keys := private.newar_detail_raw_keys();
  if not ('rechargeLevel' = any(keys)) then
    keys := array_append(keys, 'rechargeLevel');
    execute format(
      'create or replace function private.newar_detail_raw_keys() returns text[] language sql immutable set search_path='''' as %L',
      'select ' || quote_literal(keys::text) || '::text[];'
    );
  end if;
end;
$migration$;
notify pgrst, 'reload schema';
commit;
