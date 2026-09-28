-- Optimize collected-workorder reads without changing request, response, authorization or history metadata.
-- No business data writes, new grants, helper exposure, or timeout increases.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare definition text; old_part text; new_part text;
begin
 select pg_get_functiondef('private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure) into definition;
 if position('records_scope_first_v1' in definition)>0 then return;end if;
 old_part:=$old_0$ with catalog as materialized (
  select distinct p.source_name,p.name,p.team from private.dashboard_admin_live_platforms() p
  where p.scope_group=v_code and lower(p.source)='ar'
 ), names as (
  select d.*,coalesce(a.name,d.platform) display_platform,coalesce(a.team,'') display_team
  from public.ar_workorder_issue_details d
  left join lateral(select min(case when v_code='IN' and c.team='M8' and c.source_name='RAJA' then 'RAJALOTTERY' else c.name end) name,min(c.team) team
    from catalog c where c.source_name=d.platform
    having count(distinct case when v_code='IN' and c.team='M8' and c.source_name='RAJA' then 'RAJALOTTERY' else c.name end)=1
      and count(distinct nullif(btrim(c.team),''))=1) a on true
  where d.system_name='AR' and d.country_code=v_code and private.dashboard_scope_allows(v_scope,d.country_code,d.platform)
 ), eligible as (
  select d.*,case when f->>'dateBasis'='operation' then d.operated_at else coalesce(d.submitted_at,d.submitted_date::timestamp at time zone v_timezone) end sort_at
  from names d where (coalesce(f->>'platform','')='' or d.display_platform=f->>'platform')
  and (v_view<>'missing' or d.status_code=3)
 ), scoped as (
  select d.* from eligible d where (v_view='records' or d.operation_time_source in ('operationTime','operateTime')) and (action='detail' or all_history or
   case when f->>'dateBasis'='operation' then (d.operated_at at time zone v_timezone)::date else coalesce(d.submitted_date,(d.submitted_at at time zone v_timezone)::date) end between first_day and last_day)
 ), filtered as materialized (
$old_0$;
 new_part:=$new_0$ -- records_scope_first_v1: authorize/map each physical platform once; never materialize full-history wide records.
 with catalog as materialized (
  select p.source_name,
   min(case when v_code='IN' and p.team='M8' and p.source_name='RAJA' then 'RAJALOTTERY' else p.name end) display_platform,
   min(p.team) display_team
  from private.dashboard_admin_live_platforms() p
  where p.scope_group=v_code and lower(p.source)='ar'
  group by p.source_name
  having count(distinct case when v_code='IN' and p.team='M8' and p.source_name='RAJA' then 'RAJALOTTERY' else p.name end)=1
    and count(distinct nullif(btrim(p.team),''))=1
 ), platform_totals as materialized (
  -- These intentionally remain whole-history, matching the existing metadata contract.
  -- Only narrow counters/timestamps are grouped; none are returned before authorization.
  select d.platform,max(d.observed_at) latest_collected_at,
   count(*) filter(where (v_view<>'missing' or d.status_code=3) and
    (d.operated_at is null or d.operation_time_source is distinct from 'operationTime' and d.operation_time_source is distinct from 'operateTime')) unknown_operation_count,
   count(*) filter(where (v_view<>'missing' or d.status_code=3) and d.operation_time_source='lastUpdateTime') fallback_operation_count
  from public.ar_workorder_issue_details d
  where d.system_name='AR' and d.country_code=v_code
  group by d.platform
 ), authorized_platforms as materialized (
  select p.*,coalesce(c.display_platform,p.platform) display_platform,coalesce(c.display_team,'') display_team
  from platform_totals p left join catalog c on c.source_name=p.platform
  where private.dashboard_scope_allows(v_scope,v_code,p.platform)
 ), eligible_platforms as materialized (
  select * from authorized_platforms p
  where coalesce(f->>'platform','')='' or p.display_platform=f->>'platform'
 ), candidates as (
  -- Mutually exclusive branches preserve submitted_date precedence and permit
  -- direct date/instant index conditions instead of OR/coalesce column filters.
  select d.*,p.display_platform,p.display_team
   from eligible_platforms p join public.ar_workorder_issue_details d
    on d.system_name='AR' and d.country_code=v_code and d.platform=p.platform
   where action='detail' and d.work_order_id=f->>'workorderId'
  union all
  select d.*,p.display_platform,p.display_team
   from eligible_platforms p join public.ar_workorder_issue_details d
    on d.system_name='AR' and d.country_code=v_code and d.platform=p.platform
   where action<>'detail' and all_history
  union all
  select d.*,p.display_platform,p.display_team
   from eligible_platforms p join public.ar_workorder_issue_details d
    on d.system_name='AR' and d.country_code=v_code and d.platform=p.platform
   where action<>'detail' and not all_history and f->>'dateBasis'='operation' and d.operated_at>=first_day::timestamp at time zone v_timezone and d.operated_at<(last_day+1)::timestamp at time zone v_timezone
  union all
  select d.*,p.display_platform,p.display_team
   from eligible_platforms p join public.ar_workorder_issue_details d
    on d.system_name='AR' and d.country_code=v_code and d.platform=p.platform
   where action<>'detail' and not all_history and coalesce(f->>'dateBasis','')<>'operation' and d.submitted_date between first_day and last_day
  union all
  select d.*,p.display_platform,p.display_team
   from eligible_platforms p join public.ar_workorder_issue_details d
    on d.system_name='AR' and d.country_code=v_code and d.platform=p.platform
   where action<>'detail' and not all_history and coalesce(f->>'dateBasis','')<>'operation' and d.submitted_date is null and d.submitted_at>=first_day::timestamp at time zone v_timezone and d.submitted_at<(last_day+1)::timestamp at time zone v_timezone
 ), scoped as (
  select d.*,case when f->>'dateBasis'='operation' then d.operated_at else coalesce(d.submitted_at,d.submitted_date::timestamp at time zone v_timezone) end sort_at
  from candidates d where (v_view<>'missing' or d.status_code=3)
   and (v_view='records' or d.operation_time_source in ('operationTime','operateTime'))
 ), filtered as materialized (
$new_0$;
 if (length(definition)-length(replace(definition,old_part,'')))/length(old_part)<>1 then raise exception 'Collected-workorder baseline changed at fragment 0; review before applying';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old_1$from names),
  'summary'$old_1$;
 new_part:=$new_1$from authorized_platforms),
  'summary'$new_1$;
 if (length(definition)-length(replace(definition,old_part,'')))/length(old_part)<>1 then raise exception 'Collected-workorder baseline changed at fragment 1; review before applying';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old_2$(select count(*) from eligible where operated_at is null or operation_time_source is distinct from 'operationTime' and operation_time_source is distinct from 'operateTime')$old_2$;
 new_part:=$new_2$(select coalesce(sum(unknown_operation_count),0) from eligible_platforms)$new_2$;
 if (length(definition)-length(replace(definition,old_part,'')))/length(old_part)<>1 then raise exception 'Collected-workorder baseline changed at fragment 2; review before applying';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old_3$(select count(*) from eligible where operation_time_source='lastUpdateTime')$old_3$;
 new_part:=$new_3$(select coalesce(sum(fallback_operation_count),0) from eligible_platforms)$new_3$;
 if (length(definition)-length(replace(definition,old_part,'')))/length(old_part)<>1 then raise exception 'Collected-workorder baseline changed at fragment 3; review before applying';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old_4$(select max(observed_at) from names)$old_4$;
 new_part:=$new_4$(select max(latest_collected_at) from authorized_platforms)$new_4$;
 if (length(definition)-length(replace(definition,old_part,'')))/length(old_part)<>1 then raise exception 'Collected-workorder baseline changed at fragment 4; review before applying';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old_5$    and private.dashboard_scope_allows(v_scope,v_code,d.platform)
$old_5$;
 new_part:=$new_5$$new_5$;
 if (length(definition)-length(replace(definition,old_part,'')))/length(old_part)<>1 then raise exception 'Collected-workorder baseline changed at fragment 5; review before applying';end if;
 definition:=replace(definition,old_part,new_part);
 execute definition;
end;
$patch$;
notify pgrst,'reload schema';
commit;
