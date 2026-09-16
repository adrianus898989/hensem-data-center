-- Allow the existing GAME66 dashboard RPC to be queried by an exact platform
-- name/code as well as by team.  The Edge Function uses this to split a large
-- team-day into small indexed platform queries and merge the safe aggregates.
do $migration$
declare
  v_function text;
  v_old constant text := 'g.team_name, g.team_code,';
  v_new constant text := 'g.team_name, g.team_code, g.platform_name, g.platform_code,';
begin
  select pg_catalog.pg_get_functiondef(
    'public.dashboard_game66_charge_volume(date,date,text)'::regprocedure
  ) into v_function;

  if pg_catalog.strpos(v_function, v_new) > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_function, v_old) = 0 then
    raise exception 'GAME66_DASHBOARD_FILTER_NOT_FOUND';
  end if;

  v_function := pg_catalog.replace(v_function, v_old, v_new);
  execute v_function;
end
$migration$;

revoke all on function public.dashboard_game66_charge_volume(date,date,text) from public, anon;
grant execute on function public.dashboard_game66_charge_volume(date,date,text) to authenticated, service_role;
