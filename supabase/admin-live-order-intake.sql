-- Intake facts for already-authorized order platforms. A configured target is
-- not proof of received orders. Each direction probes one newest indexed row;
-- no counts, amounts, member fields, or order identifiers are read or returned.
begin;
create or replace function private.dashboard_admin_live_order_intake()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 p record; d text; v_created timestamptz; v_updated timestamptz;
 v_result jsonb := '[]'::jsonb; v_launch timestamptz; v_found boolean;
begin
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
$$;
revoke all on function private.dashboard_admin_live_order_intake() from public,anon,authenticated;
commit;
