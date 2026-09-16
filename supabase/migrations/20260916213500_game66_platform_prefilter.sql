-- Resolve an exact GAME66 platform once and push its UUID into every raw-order
-- scan. This lets the dashboard fan a large team-day into fast indexed reads.
do $migration$
declare
  v_function text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.dashboard_game66_charge_volume(date,date,text)'::regprocedure
  ) into v_function;

  if pg_catalog.strpos(v_function, 'v_platform_id uuid;') > 0 then
    return;
  end if;
  if pg_catalog.strpos(v_function, 'v_end_at timestamptz;') = 0 then
    raise exception 'GAME66_DASHBOARD_DECLARATION_NOT_FOUND';
  end if;

  v_function := pg_catalog.replace(
    v_function,
    'v_end_at timestamptz;',
    'v_end_at timestamptz;' || chr(10) || '  v_platform_id uuid;'
  );
  v_function := pg_catalog.replace(
    v_function,
    'v_end_at := (p_end + 1)::timestamp at time zone ''Asia/Kolkata'';',
    'v_end_at := (p_end + 1)::timestamp at time zone ''Asia/Kolkata'';' || chr(10) || chr(10) ||
    '  select g.id into v_platform_id' || chr(10) ||
    '  from public.game66_platforms g' || chr(10) ||
    '  where v_country is not null and v_country in (g.platform_name, g.platform_code)' || chr(10) ||
    '  order by g.id limit 1;'
  );
  v_function := pg_catalog.replace(
    v_function,
    'where c.create_time >= v_start_at and c.create_time < v_end_at',
    'where c.create_time >= v_start_at and c.create_time < v_end_at' || chr(10) ||
    '      and (v_platform_id is null or c.platform_id = v_platform_id)'
  );
  v_function := pg_catalog.replace(
    v_function,
    'and w.create_time >= v_start_at and w.create_time < v_end_at',
    'and w.create_time >= v_start_at and w.create_time < v_end_at' || chr(10) ||
    '      and (v_platform_id is null or w.platform_id = v_platform_id)'
  );
  v_function := pg_catalog.replace(
    v_function,
    'where w.create_time >= v_start_at and w.create_time < v_end_at',
    'where w.create_time >= v_start_at and w.create_time < v_end_at' || chr(10) ||
    '      and (v_platform_id is null or w.platform_id = v_platform_id)'
  );
  execute v_function;
end
$migration$;

revoke all on function public.dashboard_game66_charge_volume(date,date,text) from public, anon;
grant execute on function public.dashboard_game66_charge_volume(date,date,text) to authenticated, service_role;

