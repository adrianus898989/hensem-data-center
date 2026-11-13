-- Preserve the existing authorized RPC, native source, result policies and ACL.
set local lock_timeout = '2s';
do $install$
declare
  target regprocedure := 'private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure;
  previous constant text := '120a5932b5302ff9fab97d5440023672';
  expected constant text := 'eccdf823c61341254a60396ab87735b3';
  definition text := pg_get_functiondef(target);
  fingerprint text;
  old constant text := $old$    -- Reuse the authorized, filtered native source exactly once. Inlining the
    -- single-use filtered projection lets PostgreSQL discard unused buckets
    -- and latency fields. Keep the upstream native source materialization.
    v_sql := replace(v_prefix,'filtered as materialized (','filtered as (') || $q$,
    raw_hours as materialized (
      select f.direction,f.currency,f.provider,e.hour,f.status_group,e.created,e.paid,
             count(*) as n
      from filtered f cross join lateral (
        select f.local_hour as hour,true as created,
               coalesce(f.success_in_range and f.success_local_hour = f.local_hour,false) as paid
        where f.created_in_range
        union all
        select f.success_local_hour,false,true
        where f.success_in_range and (f.created_in_range and f.success_local_hour = f.local_hour) is not true
      ) e
      group by f.direction,f.currency,f.provider,e.hour,f.status_group,e.created,e.paid
$old$;
  replacement constant text := $new$    if p_request->>'successBasis'='created' and v_platform.source in ('ar','newar') then
      -- Both counters share the validated creation window. Only selected amount
      -- bounds need the native amount; let the planner prune all unused fields.
      v_sql := 'with orders as (' || v_source || $q$), raw_hours as materialized (
        select direction,currency,provider,extract(hour from created_at at time zone $4)::integer as hour,
               status_group,true as created,status_group='success' as paid,count(*) as n
        from orders
        where ($12 is null or provider=any($12))
          and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
          and ($15 is null or amount>=$15)
          and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
        group by direction,currency,provider,hour,status_group
      $q$;
    else
      -- On independent clocks one order can contribute to two different hours.
      v_sql := replace(v_prefix,'filtered as materialized (','filtered as (') || $q$,
    raw_hours as materialized (
      select f.direction,f.currency,f.provider,e.hour,f.status_group,e.created,e.paid,
             count(*) as n
      from filtered f cross join lateral (
        select f.local_hour as hour,true as created,
               coalesce(f.success_in_range and f.success_local_hour = f.local_hour,false) as paid
        where f.created_in_range
        union all
        select f.success_local_hour,false,true
        where f.success_in_range and (f.created_in_range and f.success_local_hour = f.local_hour) is not true
      ) e
      group by f.direction,f.currency,f.provider,e.hour,f.status_group,e.created,e.paid
      $q$;
    end if;
    v_sql := v_sql || $q$
$new$;
begin
  select md5(prosrc) into fingerprint from pg_proc where oid = target;
  if fingerprint = expected then return; end if;
  if fingerprint <> previous or position(old in definition) = 0 then
    raise exception 'provider_hour_created_drilldown_baseline_changed';
  end if;
  execute replace(definition, old, replacement);
  if (select md5(prosrc) from pg_proc where oid=target) is distinct from expected then
    raise exception 'provider_hour_created_drilldown_installation_incomplete';
  end if;
end
$install$;
