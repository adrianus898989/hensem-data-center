CREATE OR REPLACE FUNCTION private.dashboard_admin_live_order_intake()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 p record; d text; v_created timestamptz; v_updated timestamptz;
 v_result jsonb := '[]'::jsonb; v_launch timestamptz; v_found boolean;
begin
 -- wg_existing_orders_v1
 -- The existing platform reader verifies the current account and data scope.
 for p in select * from private.dashboard_admin_live_platforms() loop
  if p.source='newar' then
   select n.launch_at into v_launch from public.newar_detail_platforms n
    where n.platform=p.source_name and n.country_code=p.scope_group and n.enabled
      and (n.launch_at is null or n.launch_at<=now());
   if not found then continue;end if;
  end if;
  foreach d in array array['charge','withdraw'] loop
   v_created:=null;v_updated:=null;v_found:=false;
   if p.source='ar' then
    select a.applied_at at time zone p.timezone,a.updated_at into v_created,v_updated
     from public.ar_collected_orders a
     where a.country_code=p.scope_group and a.platform=p.source_name and a.source_system='AR'
      and a.order_kind=case d when 'charge' then 'recharge' else 'withdraw' end
      and a.applied_at is not null order by a.applied_at desc limit 1;
    v_found:=found;
    if not v_found then
     select null::timestamptz,a.updated_at into v_created,v_updated
      from public.ar_collected_orders a
      where a.country_code=p.scope_group and a.platform=p.source_name and a.source_system='AR'
       and a.order_kind=case d when 'charge' then 'recharge' else 'withdraw' end
       and a.applied_at is null limit 1;
     v_found:=found;
    end if;
   elsif p.source='wg' then
    -- Bound each site's newest-row probe before comparing sites in this scope.
    -- DESC keeps the existing implicit NULLS FIRST and timestamp tie semantics.
    if d='charge' then
     select n.created_at,n.stored_at into v_created,v_updated
      from private.dashboard_admin_wg_sites()s
      cross join lateral (
       select w.created_at,w.stored_at from public.wg_recharge_details w
        where w.site_code=s.site_code order by w.created_at desc limit 1
      )n where s.country_code=p.scope_group and s.platform=p.source_name
      order by n.created_at desc limit 1;
    else
     select n.created_at,n.stored_at into v_created,v_updated
      from private.dashboard_admin_wg_sites()s
      cross join lateral (
       select w.created_at,w.stored_at from public.wg_withdraw_details w
        where w.site_code=s.site_code order by w.created_at desc limit 1
      )n where s.country_code=p.scope_group and s.platform=p.source_name
      order by n.created_at desc limit 1;
    end if;
    v_found:=found;
    if not v_found then
     select null::timestamptz,max(q.last_success_at) into v_created,v_updated from private.wg_detail_progress q
      join private.dashboard_admin_wg_sites()s on s.site_code=q.site_code
      where s.country_code=p.scope_group and s.platform=p.source_name and q.business=case d when 'charge' then 'recharge' else 'withdraw' end
       and q.basis='created' and q.cursor is not null;
     v_found:=v_updated is not null;
    end if;
   elsif p.source='lg' then
    select l.created_at,l.updated_at into v_created,v_updated
     from public.lg_orders l
     where l.country_code=p.scope_group and l.platform=p.source_name and l.source_system='LG'
       and l.order_kind=case d when 'charge' then 'recharge' else 'withdraw' end
       and l.created_at is not null order by l.created_at desc limit 1;
    v_found:=found;
   elsif p.source='newar' then
    select n.created_at,n.received_at into v_created,v_updated
     from public.newar_detail_records n
     where n.platform=p.source_name and n.dataset=d
      and n.created_at>=coalesce(v_launch,'-infinity'::timestamptz)
     order by n.created_at desc limit 1;
    v_found:=found;
   elsif p.source='game66' and d='charge' then
    select g.create_time,g.last_seen_at into v_created,v_updated
     from public.game66_charge_orders g
     where g.platform_id=p.id and g.create_time is not null
     order by g.create_time desc limit 1;
    v_found:=found;
    if not v_found then
     select null::timestamptz,g.last_seen_at into v_created,v_updated
      from public.game66_charge_orders g where g.platform_id=p.id and g.create_time is null limit 1;
     v_found:=found;
    end if;
   elsif p.source='game66' and d='withdraw' then
    select g.create_time,g.last_seen_at into v_created,v_updated
     from public.game66_withdraw_orders g
     where g.platform_id=p.id and g.create_time is not null
     order by g.create_time desc limit 1;
    v_found:=found;
    if not v_found then
     select null::timestamptz,g.last_seen_at into v_created,v_updated
      from public.game66_withdraw_orders g where g.platform_id=p.id and g.create_time is null limit 1;
     v_found:=found;
    end if;
   end if;
   if v_found then
    -- Keep each direction's date separate: a recent payout must not make an
    -- older collection feed appear current.
   v_result:=v_result||jsonb_build_array(jsonb_build_object(
    'dataset','orders','platformId',p.id,'name',p.name,'team',coalesce(nullif(p.team,''),'待归类'),
    'country',p.country,'rawCountry',p.scope_group,'rawPlatform',p.source_name,
    'system',case p.source when 'ar' then 'AR' when 'newar' then 'NEW_AR'
      when 'game66' then case p.scope_group when 'HK_TEAM' then 'GAME66_HK'
        when 'RED_CRAB' then 'GAME66_RED_CRAB' else 'GAME66' end else upper(p.source) end,
    'directions',jsonb_build_array(d),'lastDate',(v_created at time zone p.timezone)::date,'updatedAt',v_updated,
    'provenance',jsonb_build_object('kind','direct','label','采集器直传 Supabase')));
   end if;
  end loop;
 end loop;
 return v_result;
end;
$function$;

revoke all on function private.dashboard_admin_live_order_intake()from public,anon,authenticated,service_role;
