-- Parse each source business object and timestamp once, without changing result semantics.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $guard$
declare p record;
begin
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid='private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if md5(p.prosrc)<>'22abdfe231e34d4e9e1458b72b09c22f' or p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.owner_name<>'postgres'
  or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'newar_withdraw_single_parse_baseline_drift';end if;
end;$guard$;
do $patch$
declare d text;old_part text:=$old$ ), facts as materialized (
  select s.*,n.source_id,n.status_group,n.currency,n.captured_at,n.received_at,(n.created_at at time zone s.timezone)::date local_date,
   case when n.raw->>'businessSchemaVersion'='2' and nullif(btrim(n.raw->>'operatorSourceField'),'') is not null
    and nullif(btrim(n.raw->>'operatorName'),'') is not null and n.raw->>'operatorType' in ('auto','manual') then n.raw->>'operatorType' end method,
   case when n.raw->>'businessSchemaVersion'='2' and nullif(btrim(n.raw->>'operatorSourceField'),'') is not null
    and nullif(btrim(n.raw->>'operatorName'),'') is not null and n.raw->>'operatorType' in ('auto','manual')
    then btrim(n.raw->>'operatorName') else '（未知操作人）' end account,
   case when n.raw->>'businessSchemaVersion'='2' and nullif(n.raw->>'sourceSubmittedSourceField','') is not null
    and nullif(n.raw->>'sourceHandledSourceField','') is not null and isfinite(t.submitted) and isfinite(t.handled)
    and t.handled>=t.submitted and t.handled<=n.captured_at and t.handled<=statement_timestamp()
    then extract(epoch from t.handled-t.submitted) end processing_seconds
  from sites s join public.newar_detail_records n on n.platform=s.source_name and n.dataset='withdraw'
  cross join lateral (select private.newar_stats_time(n.raw->>'sourceSubmittedAt') submitted,private.newar_stats_time(n.raw->>'sourceHandledAt') handled) t
  where n.created_at>=p_start::timestamp at time zone s.timezone and n.created_at<(p_end+1)::timestamp at time zone s.timezone
   and (s.launch_at is null or n.created_at>=s.launch_at)
$old$;new_part text:=$new$ ), business as materialized (
  select s.country,s.platform_key,n.source_id,n.status_group,n.currency,n.captured_at,n.received_at,
   (n.created_at at time zone s.timezone)::date local_date,
   case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
    and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual') then r."operatorType" end method,
   case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
    and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual')
    then btrim(r."operatorName") else '（未知操作人）' end account,
   case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
    and nullif(r."sourceHandledSourceField",'') is not null then private.newar_stats_time(r."sourceSubmittedAt") end submitted_at,
   case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
    and nullif(r."sourceHandledSourceField",'') is not null then private.newar_stats_time(r."sourceHandledAt") end handled_at
  from sites s join public.newar_detail_records n on n.platform=s.source_name and n.dataset='withdraw'
  cross join lateral jsonb_to_record(case when jsonb_typeof(n.raw)='object' then n.raw else '{}'::jsonb end)
   r("businessSchemaVersion" text,"operatorType" text,"operatorName" text,"operatorSourceField" text,
     "sourceSubmittedAt" text,"sourceSubmittedSourceField" text,"sourceHandledAt" text,"sourceHandledSourceField" text)
  where n.created_at>=p_start::timestamp at time zone s.timezone and n.created_at<(p_end+1)::timestamp at time zone s.timezone
   and (s.launch_at is null or n.created_at>=s.launch_at)
 ), facts as materialized (
  select country,platform_key,source_id,status_group,currency,captured_at,received_at,local_date,method,account,
   case when isfinite(submitted_at) and isfinite(handled_at) and handled_at>=submitted_at
    and handled_at<=captured_at and handled_at<=statement_timestamp()
    then extract(epoch from handled_at-submitted_at) end processing_seconds
  from business
$new$;before_meta jsonb;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into d,before_meta from pg_proc p where p.oid='private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if (length(d)-length(replace(d,old_part,'')))/length(old_part)<>1 then raise exception 'newar_withdraw_single_parse_anchor_drift';end if;
 execute replace(d,old_part,new_part);
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid='private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure) is distinct from before_meta then raise exception 'newar_withdraw_single_parse_metadata_changed';end if;
end;$patch$;
commit;
