-- Extend aggregate-only daily member counts with cumulative order-frequency thresholds.
-- IDs never leave the function. Date, provider, currency and authorization scope
-- are inherited from the same filtered order cohort as the existing member counts.
begin;
do $patch$
declare definition text; old_fragment text; new_fragment text;
begin
  select pg_get_functiondef('private.dashboard_admin_live_member_daily(jsonb)'::regprocedure) into definition;
  if position('per_platform_local_day_order_count' in definition)>0 then return; end if;
  old_fragment:=$old0$  ), days as ($old0$;
  new_fragment:=$new0$  ), member_orders as (
    select date,direction,member_id,
      count(*) filter(where basis='created') as created_count,
      count(*) filter(where basis='success') as success_count
    from filtered where member_id is not null group by date,direction,member_id
  ), frequency as (
    select date,direction,
      count(*) filter(where created_count>=2) as created_members_ge2,
      count(*) filter(where created_count>=3) as created_members_ge3,
      count(*) filter(where created_count>=4) as created_members_ge4,
      count(*) filter(where created_count>=5) as created_members_ge5,
      count(*) filter(where success_count>=2) as success_members_ge2,
      count(*) filter(where success_count>=3) as success_members_ge3,
      count(*) filter(where success_count>=4) as success_members_ge4,
      count(*) filter(where success_count>=5) as success_members_ge5
    from member_orders group by date,direction
  ), days as ($new0$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'Daily member frequency baseline changed; review before applying';
  end if;
  definition:=replace(definition,old_fragment,new_fragment);
  old_fragment:=$old1$      coalesce(c.success_missing_member_count,0) as success_missing_member_count$old1$;
  new_fragment:=$new1$      coalesce(c.success_missing_member_count,0) as success_missing_member_count,
      coalesce(f.created_members_ge2,0) as created_members_ge2,
      coalesce(f.created_members_ge3,0) as created_members_ge3,
      coalesce(f.created_members_ge4,0) as created_members_ge4,
      coalesce(f.created_members_ge5,0) as created_members_ge5,
      coalesce(f.success_members_ge2,0) as success_members_ge2,
      coalesce(f.success_members_ge3,0) as success_members_ge3,
      coalesce(f.success_members_ge4,0) as success_members_ge4,
      coalesce(f.success_members_ge5,0) as success_members_ge5$new1$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'Daily member frequency baseline changed; review before applying';
  end if;
  definition:=replace(definition,old_fragment,new_fragment);
  old_fragment:=$old2$    left join counts c on c.date=days.date and c.direction=d.direction$old2$;
  new_fragment:=$new2$    left join counts c on c.date=days.date and c.direction=d.direction
    left join frequency f on f.date=days.date and f.direction=d.direction$new2$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'Daily member frequency baseline changed; review before applying';
  end if;
  definition:=replace(definition,old_fragment,new_fragment);
  old_fragment:=$old3$'sourceCompletenessVerified',false,'periodTotal','sum_daily_unique_member_visits'$old3$;
  new_fragment:=$new3$'sourceCompletenessVerified',false,'periodTotal','sum_daily_unique_member_visits',
      'frequencyBasis','per_platform_local_day_order_count','frequencyThresholds',jsonb_build_array(2,3,4,5)$new3$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'Daily member frequency baseline changed; review before applying';
  end if;
  definition:=replace(definition,old_fragment,new_fragment);
  execute definition;
end;
$patch$;
notify pgrst,'reload schema';
commit;
