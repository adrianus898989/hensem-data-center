-- Extend only the deposit-ticket reader. The existing gateway, permission checks,
-- native platform aliases, row order and cursor context also apply to larger pages.
do $migration$
declare
  reader text;
begin
  if (select md5(prosrc) from pg_proc where oid='private.dashboard_admin_deposit_ticket_list(jsonb)'::regprocedure)
      is distinct from '684d8e5734065f66a705b8e10aab0224' then
    raise exception 'deposit ticket reader changed before migration';
  end if;
  select pg_get_functiondef('private.dashboard_admin_deposit_ticket_list(jsonb)'::regprocedure) into reader;
  reader:=replace(reader, $old$filters-array['team','platform','from','to'$old$,
                          $new$filters-array['team','platform','source','from','to'$new$);
  reader:=replace(reader, $old$or coalesce(filters->>'issueKind','') not in ('','deposit')$old$,
                          $new$or coalesce(filters->>'source','') not in ('','AR','NEW_AR')
     or coalesce(filters->>'issueKind','') not in ('','deposit')$new$);
  reader:=replace(reader, $old$'^(20|50|100)$'$old$, $new$'^(20|50|100|200|300|500)$'$new$);
  reader:=replace(reader, $old$where p.scope_group=country_code and p.source in ('ar','newar')$old$,
                          $new$where p.scope_group=country_code and p.source in ('ar','newar')
      and (nullif(filters->>'source','') is null
        or p.source=case filters->>'source' when 'AR' then 'ar' when 'NEW_AR' then 'newar' end)$new$);
  if strpos(reader,$check$filters-array['team','platform','source'$check$)=0
      or strpos(reader,$check$not in ('','AR','NEW_AR')$check$)=0
      or strpos(reader,$check$'^(20|50|100|200|300|500)$'$check$)=0
      or strpos(reader,$check$p.source=case filters->>'source'$check$)=0 then
    raise exception 'deposit ticket upgrade incomplete';
  end if;
  execute reader;
end
$migration$;
