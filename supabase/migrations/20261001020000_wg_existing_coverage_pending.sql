-- WG feeds enter the existing M8 completeness and midnight-stock contracts.
-- Read-only adapters; source records, historical snapshots and ACLs stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function private.dashboard_admin_wg_day_evidence(p_site text,p_business text,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s record; lo timestamptz; hi timestamptz; n bigint; seen timestamptz; covered boolean; has_window boolean;
begin
 select * into s from private.dashboard_admin_wg_sites() where site_code=p_site;
 if not found or p_business not in('recharge','withdraw') then raise exception 'invalid_wg_scope';end if;
 lo:=p_date::timestamp at time zone s.timezone;hi:=(p_date+1)::timestamp at time zone s.timezone;
 if p_business='recharge' then
  select count(*),max(stored_at) into n,seen from public.wg_recharge_details where site_code=p_site and created_at>=lo and created_at<hi;
 else
  select count(*),max(stored_at) into n,seen from public.wg_withdraw_details where site_code=p_site and created_at>=lo and created_at<hi;
 end if;
 select coalesce(bool_or(complete),false),count(*)>0 into covered,has_window from public.wg_detail_coverage
  where site_code=p_site and business=p_business and basis='created' and business_date=p_date;
 -- Only fully acknowledged creation windows certify a complete day, even zero.
 covered:=covered and hi<=statement_timestamp();
 return jsonb_build_object('received',n>0 or covered,'count',n,'complete',covered,'hasWindow',has_window,
  'zeroConfirmed',covered and n=0,'seen',seen,
  'status',case when covered and n=0 then 'zero_complete' when covered then 'complete' when n>0 or has_window then 'partial' else 'not_received' end,
  'evidence',case when covered and n=0 then 'source_completed_zero_rows' when covered then 'source_day_task_completed'
   when n>0 or has_window then 'source_full_day_not_published' else 'no_created_orders_received' end);
end;$$;
revoke all on function private.dashboard_admin_wg_day_evidence(text,text,date) from public,anon,authenticated,service_role;

-- Summary files are no longer emitted for these exact WG identities. Keep their
-- historical tables/readers, but do not raise missing-upload alerts for them.
create or replace function private.dashboard_admin_wg_current_feeds(p_feeds jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(f order by ord),'[]') from jsonb_array_elements(p_feeds) with ordinality a(f,ord)
 where not(coalesce(f->>'dataset','') in('volume','auto','auto_report','operators','reasons')
  and upper(coalesce(f->>'system','')) in('WG','REPORT','SHEET') and exists(
   select 1 from private.dashboard_admin_wg_sites()s
   where upper(coalesce(f->>'rawCountry','')) in(upper(s.country_code),upper(s.country))
    and upper(regexp_replace(coalesce(f->>'rawPlatform',''),'[^a-zA-Z0-9]','','g'))=upper(s.platform)));
$$;
revoke all on function private.dashboard_admin_wg_current_feeds(jsonb) from public,anon,authenticated,service_role;

create or replace function private.dashboard_admin_wg_pending_row(p_platform jsonb,p_date date,p_providers text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s record; r public.wg_withdraw_midnight_runs%rowtype; target timestamptz; record_n bigint; valid boolean;
 state text:='missing'; selected_count bigint; selected_amount numeric; groups jsonb:='[]';stats jsonb; result jsonb;
begin
 select * into s from private.dashboard_admin_wg_sites() where country_code=p_platform->>'scope_group'
  and platform=p_platform->>'source_name';
 if not found then raise exception 'invalid_wg_scope';end if;
 target:=(p_date+1)::timestamp at time zone s.timezone;
 select * into r from public.wg_withdraw_midnight_runs where site_code=s.site_code and scheduled_at=target;
 if found then
  state:=case r.status when 'missed' then 'missing' when 'capturing' then 'pending' else 'invalid' end;
  if r.status='complete' and r.snapshot_date=p_date and r.window_start=target-interval '7 days'
   and r.window_end=target-interval '1 second' and r.observed_started_at>=target
   and r.observed_started_at<=target+interval '15 minutes' and r.observed_finished_at>=r.observed_started_at
   and r.observed_finished_at<=target+interval '15 minutes' and r.observed_finished_at<=statement_timestamp() then
   select count(*),coalesce(bool_and(coalesce(i.safe_record->>'site_code'=s.site_code and i.safe_record->>'business'='withdraw'
    and i.safe_record->>'status_code'='3' and i.safe_record->>'status_group'='paying'
    and i.safe_record->>'member_currency'=s.currency
    and (i.safe_record->>'created_at')::timestamptz>=r.window_start
    and (i.safe_record->>'created_at')::timestamptz<target
    and (i.safe_record->>'member_amount')::numeric>=0
    and (i.safe_record->>'member_amount')::numeric::text not in('NaN','Infinity','-Infinity'),false)),true)
    into record_n,valid from public.wg_withdraw_midnight_items i where i.site_code=s.site_code and i.scheduled_at=target;
   if valid and record_n=r.record_count then
    state:='complete';
    with observed as materialized (
     select private.dashboard_admin_live_provider_canonical(s.country,s.platform,coalesce(nullif(i.safe_record->>'provider',''),'未识别通道')) provider,
      coalesce(nullif(i.safe_record->>'provider',''),'未识别通道') raw_channel,coalesce(nullif(i.safe_record->>'channel',''),'其他类型') channel_type,
      (i.safe_record->>'member_amount')::numeric amount,
      extract(epoch from r.observed_finished_at-(i.safe_record->>'created_at')::timestamptz)/3600 hours
     from public.wg_withdraw_midnight_items i where i.site_code=s.site_code and i.scheduled_at=target
    ), selected as materialized (
     select * from observed where cardinality(coalesce(p_providers,'{}'))=0 or provider=any(p_providers)
    ), by_channel as (
     select provider,raw_channel,channel_type,count(*) n,sum(amount) amount from selected group by 1,2,3
    ), by_provider as (
     select provider,count(*) n,sum(amount) amount,count(*) filter(where hours>=24) over24,
      coalesce(sum(amount) filter(where hours>=24),0) over24_amount,max(hours) max_hours,avg(hours) avg_hours
     from selected group by provider
    ), bucket_keys(key,label,min_hours,max_hours) as (values
     (0,'<1小时',0::numeric,1::numeric),(1,'1–3小时',1,3),(2,'3–6小时',3,6),(3,'6–12小时',6,12),
     (4,'12–24小时',12,24),(5,'24–48小时',24,48),(6,'48–72小时',48,72),(7,'≥72小时',72,null)),
    buckets as (
     select b.key,b.label,count(o.hours) n,coalesce(sum(o.amount),0) amount from bucket_keys b
     left join selected o on o.hours>=b.min_hours and (b.max_hours is null or o.hours<b.max_hours) group by b.key,b.label
    )
    select count(*),coalesce(sum(amount),0),
     (select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'rawChannel',raw_channel,'channelType',channel_type,'count',n,'amount',amount::text) order by provider,raw_channel,channel_type),'[]') from by_channel),
     jsonb_build_object('matchedCount',count(*),'unknownCount',0,'unknownAmount','0','count',count(*),'amount',coalesce(sum(amount),0)::text,
      'over24Count',count(*) filter(where hours>=24),'over24Amount',coalesce(sum(amount) filter(where hours>=24),0)::text,
      'maxHours',max(hours),'avgHours',avg(hours),
      'groups',(select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'matchedCount',n,'unknownCount',0,'unknownAmount','0',
       'count',n,'amount',amount::text,'over24Count',over24,'over24Amount',over24_amount::text,'maxHours',max_hours,'avgHours',avg_hours) order by n desc,provider),'[]') from by_provider),
      'buckets',(select jsonb_agg(jsonb_build_object('key',key,'label',label,'count',n,'amount',amount::text) order by key) from buckets))
     into selected_count,selected_amount,groups,stats from selected;
   end if;
  end if;
 end if;
 result:=jsonb_build_object('id',p_platform->>'id','name',p_platform->>'name','sourceName',s.platform,'source','wg',
  'country',s.country,'scopeGroup',s.country_code,'team',p_platform->'team','currency',s.currency,'timezone',s.timezone,
  'state',state,'count',selected_count,'amount',selected_amount::text,'groups',groups,
  'windowStart',case when r.site_code is not null then p_date-6 end,'windowEnd',case when r.site_code is not null then p_date end,
  'captureDate',case when r.site_code is not null then p_date+1 end,'snapshotAt',r.observed_finished_at,'updatedAt',r.observed_finished_at,
  'coverage',jsonb_build_object('complete',state='complete','observation','near_midnight_paginated','sourceStatus',r.status),
  'wgAging',stats);
 return result;
exception when data_exception then
 return jsonb_build_object('id',p_platform->>'id','name',p_platform->>'name','source','wg','sourceName',s.platform,
  'scopeGroup',s.country_code,'country',s.country,'team',p_platform->'team','currency',s.currency,'timezone',s.timezone,
  'state','invalid','count',null,'amount',null,'groups','[]'::jsonb);
end;$$;
revoke all on function private.dashboard_admin_wg_pending_row(jsonb,date,text[]) from public,anon,authenticated,service_role;

-- Guarded edits preserve the exact live definitions and their execute grants.
do $patch$
declare p record; body text; old text; fresh text; signature text; expected text;
begin
 for signature,expected in select * from(values
  ('private.dashboard_admin_live_pending_snapshot(jsonb)','0e91728541c57d347eee54f44ca1b1f6'),
  ('private.dashboard_admin_live_pending_analysis(jsonb)','1c2be1ee5c714c992ffafd956ccca8e1'),
  ('private.dashboard_admin_live_intake_coverage(jsonb)','8bad6e11cb619395a8cc6ea75a19a978'),
  ('private.dashboard_admin_live_sync_health_rows(timestamptz)','cf0db025a3277a58a79a25e629befdbc')
 )v(signature,expected) loop
  select * into p from pg_proc where oid=to_regprocedure(signature);
  if not found then raise exception 'WG baseline missing: %',signature;end if;
  if position('WG_EXISTING_FEEDS_V1' in p.prosrc)>0 then continue;end if;
  if md5(p.prosrc)<>expected or not p.prosecdef then raise exception 'WG baseline changed: %',signature;end if;
  body:=p.prosrc;
  if p.proname='dashboard_admin_live_pending_snapshot' then
   old:='if v_target.source_family<>''withdraw_review'' then v_state:=''unsupported'';';
   fresh:=$text$-- WG_EXISTING_FEEDS_V1
  if v_target.source_family='wg' then
   v_item:=private.dashboard_admin_wg_pending_row(v_item,v_date,v_providers)||jsonb_build_object('selectedIds',v_target.ids);
   v_rows:=v_rows||jsonb_build_array(v_item);
   if v_item->>'state'='complete' then
    v_received:=v_received+1;v_count:=v_count+(v_item->>'count')::bigint;v_amount:=v_amount+(v_item->>'amount')::numeric;
    v_min_at:=least(v_min_at,(v_item->>'snapshotAt')::timestamptz);v_max_at:=greatest(v_max_at,(v_item->>'snapshotAt')::timestamptz);
   end if;
   continue;
  end if;
  if v_target.source_family<>'withdraw_review' then v_state:='unsupported';$text$;
  elsif p.proname='dashboard_admin_live_pending_analysis' then
   old:='v_scope_group:=v_row->>''scopeGroup'';';
   fresh:=$text$-- WG_EXISTING_FEEDS_V1
  if v_row->>'source'='wg' then
   v_stats:=v_row->'wgAging';
   if jsonb_typeof(v_stats)='object' then
    v_platforms:=v_platforms||jsonb_build_array(v_stats||jsonb_build_object('id',v_row->>'id','name',v_row->>'name','state','complete',
     'expectedCount',v_row->'count','expectedAmount',v_row->'amount','snapshotAt',v_row->'snapshotAt'));
   else
    v_platforms:=v_platforms||jsonb_build_array(jsonb_build_object('id',v_row->>'id','name',v_row->>'name','state','detail_unavailable','groups','[]'::jsonb,'buckets','[]'::jsonb));
    v_missing:=v_missing||jsonb_build_array(jsonb_build_object('id',v_row->>'id','name',v_row->>'name','state','detail_unavailable'));
   end if;
   continue;
  end if;
  v_scope_group:=v_row->>'scopeGroup';$text$;
  else
   old:='if dataset=''orders'' and source_system=''ar'' then';
   if p.proname='dashboard_admin_live_intake_coverage' then
    fresh:=$text$-- WG_EXISTING_FEEDS_V1
    if dataset='orders' and source_system='wg' then
     select private.dashboard_admin_wg_day_evidence(s.site_code,v_kind,v_day) as value into v_run
      from private.dashboard_admin_wg_sites()s where s.country_code=v_raw_country and s.platform=v_raw_platform;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=v_run.value->>'status';evidence:=v_run.value->>'evidence';complete:=(v_run.value->>'complete')::boolean;
     zero_confirmed:=(v_run.value->>'zeroConfirmed')::boolean;fetched_count:=(v_run.value->>'count')::bigint;
     collector_status:=case when complete then 'complete' else 'unverified' end;
    elsif dataset='orders' and source_system='ar' then$text$;
   else
    fresh:=$text$-- WG_EXISTING_FEEDS_V1
    if dataset='orders' and source_system='wg' then
     select private.dashboard_admin_wg_day_evidence(s.site_code,v_kind,v_day) as value into v_run
      from private.dashboard_admin_wg_sites()s where s.country_code=v_raw_country and s.platform=v_raw_platform;
     v_has:=(v_run.value->>'received')::boolean;v_seen:=(v_run.value->>'seen')::timestamptz;
     status:=case when (v_run.value->>'complete')::boolean then 'received' when (v_run.value->>'received')::boolean or (v_run.value->>'hasWindow')::boolean then 'unverified' else 'not_received' end;
     evidence:=v_run.value->>'evidence';
    elsif dataset='orders' and source_system='ar' then$text$;
   end if;
  end if;
  if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'WG anchor changed: %',signature;end if;
  body:=replace(body,old,fresh);
  if p.proname in('dashboard_admin_live_intake_coverage','dashboard_admin_live_sync_health_rows') then
   old:='select true,t.received_at into v_has,v_seen from public.wg_config_daily t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.observed_local_date=v_day limit 1;';
   fresh:=$config$
     select true,t.received_at into v_has,v_seen from (
      select c.observed_at received_at from public.wg_realtime_config_daily c
      join private.dashboard_admin_wg_sites()s on s.country_code=c.country_code
       and c.site_code=case s.country_code when 'BR' then '278' else '3257' end
      where s.country_code=v_raw_country and s.platform=v_raw_platform and c.observed_local_date=v_day
      union all
      select c.received_at from public.wg_config_daily c
      where c.country_code=v_raw_country and c.platform=v_raw_platform and c.observed_local_date=v_day
     )t order by t.received_at desc limit 1;$config$;
   if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'WG config probe anchor changed: %',signature;end if;
   body:=replace(body,old,fresh);
   if p.proname='dashboard_admin_live_intake_coverage' then
    old:='case when v_operation=''orderCatalog'' then private.dashboard_admin_live_intake_order_feeds(v_asof) else private.dashboard_admin_live_intake_feeds(v_asof) end';
    fresh:='private.dashboard_admin_wg_current_feeds('||old||')';
   else
    old:='for v_feed in select distinct x from jsonb_array_elements(v_feeds)x where x->>''dataset'' in';
    fresh:='for v_feed in select distinct x from jsonb_array_elements(private.dashboard_admin_wg_current_feeds(v_feeds))x where x->>''dataset'' in';
   end if;
   if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'WG feed catalog anchor changed: %',signature;end if;
   body:=replace(body,old,fresh);
  end if;
  execute replace(pg_get_functiondef(p.oid),p.prosrc,body);
  if (select proacl from pg_proc where oid=p.oid) is distinct from p.proacl then raise exception 'WG ACL drift: %',signature;end if;
 end loop;
end;$patch$;
notify pgrst,'reload schema';
commit;
