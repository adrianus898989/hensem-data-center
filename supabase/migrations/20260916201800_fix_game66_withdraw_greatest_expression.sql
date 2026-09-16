-- GREATEST is a PostgreSQL conditional expression, not an ordinary function;
-- it must not be schema-qualified.  Patch the live function created by the
-- earlier migration while keeping fresh installs explicit in 201600.
do $migration$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'dashboard_game66_withdraw_daily'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_start date, p_end date';

  if v_definition is null then
    raise exception 'dashboard_game66_withdraw_daily(date,date) is missing';
  end if;

  execute pg_catalog.replace(v_definition, 'pg_catalog.greatest(', 'greatest(');
end;
$migration$;

revoke all on function public.dashboard_game66_withdraw_daily(date,date) from public, anon;
grant execute on function public.dashboard_game66_withdraw_daily(date,date) to authenticated, service_role;
