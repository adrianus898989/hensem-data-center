-- Keep the original YASH day evidence audit unchanged. Group the report using
-- only its typed complete/seen fields, avoiding hashing full progress arrays per order.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $patch$
declare f oid:=to_regprocedure('private.dashboard_admin_yash_withdraw_days(jsonb,jsonb,date,date)');
 old_body text:=$old$
 with sites as materialized (
  select p.name,p.country,p.source_name,p.timezone,private.dashboard_admin_live_withdraw_key(p.name) platform_key
  from private.dashboard_admin_live_platforms() p
  where p.source='kb' and p.scope_group='IN' and p.source_name='YASH.BET'
   and private.dashboard_scope_allows(p_scope,'IN','YASH.BET')
   and (case when p_request ? 'scopeTargets' then exists(
     select 1 from jsonb_array_elements(p_request->'scopeTargets') t where t->>'country'=p.country
      and exists(select 1 from jsonb_array_elements_text(t->'platforms') f where private.dashboard_admin_live_withdraw_key(f)=private.dashboard_admin_live_withdraw_key(p.name)))
    else p_request->>'country'=p.country end)
   and (nullif(p_request->>'platform','') is null or private.dashboard_admin_live_withdraw_key(p_request->>'platform')=private.dashboard_admin_live_withdraw_key(p.name))
   and (not p_request ? 'platforms' or jsonb_array_length(p_request->'platforms')=0 or nullif(p_request->>'platform','') is not null
    or exists(select 1 from jsonb_array_elements_text(p_request->'platforms') f where private.dashboard_admin_live_withdraw_key(f)=private.dashboard_admin_live_withdraw_key(p.name)))
 ), orders as materialized (
  select y.*,s.name display_platform,s.country display_country,s.platform_key,(y.created_at at time zone 'Asia/Kolkata')::date local_date,
   private.dashboard_admin_yash_status(y.order_type,y.status) status_group,
   case when private.dashboard_admin_yash_status(y.order_type,y.status)='success'
    and isfinite(y.created_at) and isfinite(y.completed_at) and isfinite(y.observed_at)
    and y.completed_at>=y.created_at and y.completed_at<=y.observed_at and y.completed_at<=statement_timestamp()
    then extract(epoch from y.completed_at-y.created_at) end processing_seconds
  from sites s join private.yash_orders y on y.source_site='yash' and y.order_type='withdrawal'
  where y.created_at>=p_start::timestamp at time zone 'Asia/Kolkata' and y.created_at<(p_end+1)::timestamp at time zone 'Asia/Kolkata'
 ), days as materialized (
  select s.*,d::date local_date,private.dashboard_admin_yash_day_evidence('IN','YASH.BET','withdraw',d::date) evidence
  from sites s cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
 ), operators as (
  select local_date,coalesce(nullif(btrim(operator),''),'（未知操作人）') account,
   count(*) processed,count(*) filter(where status_group='success') success,count(*) filter(where status_group='rejected') rejected,
   count(*) filter(where status_group='pending') pending_count,count(*) filter(where status_group='failed') failed_count,count(*) filter(where status_group='unknown') unknown_count,
   max(observed_at) source_updated_at,max(received_at) updated_at,
   count(processing_seconds) duration_sample_count,sum(processing_seconds) duration_total_seconds,avg(processing_seconds) avg_seconds
  from orders group by 1,2
 )
 select d.local_date,d.country,d.name,d.platform_key,
  case when count(o.order_no)>0 or (d.evidence->>'complete')::boolean then count(o.order_no) end,
  count(o.order_no) filter(where o.status_group='success'),count(o.order_no) filter(where o.status_group='rejected'),
  count(o.order_no) filter(where o.status_group='pending'),count(o.order_no) filter(where o.status_group='failed'),count(o.order_no) filter(where o.status_group='unknown'),
  avg(o.processing_seconds),count(o.processing_seconds),sum(o.processing_seconds),
  max(o.observed_at),greatest(max(o.received_at),(d.evidence->>'seen')::timestamptz),(d.evidence->>'complete')::boolean,
  coalesce((select jsonb_agg(to_jsonb(r) order by r.account) from operators r where r.local_date=d.local_date),'[]'::jsonb)
 from days d left join orders o on o.local_date=d.local_date
 group by d.local_date,d.country,d.name,d.platform_key,d.evidence;
$old$;
 new_body text:=$new$
 with sites as materialized (
  select p.name,p.country,p.source_name,p.timezone,private.dashboard_admin_live_withdraw_key(p.name) platform_key
  from private.dashboard_admin_live_platforms() p
  where p.source='kb' and p.scope_group='IN' and p.source_name='YASH.BET'
   and private.dashboard_scope_allows(p_scope,'IN','YASH.BET')
   and (case when p_request ? 'scopeTargets' then exists(
     select 1 from jsonb_array_elements(p_request->'scopeTargets') t where t->>'country'=p.country
      and exists(select 1 from jsonb_array_elements_text(t->'platforms') f where private.dashboard_admin_live_withdraw_key(f)=private.dashboard_admin_live_withdraw_key(p.name)))
    else p_request->>'country'=p.country end)
   and (nullif(p_request->>'platform','') is null or private.dashboard_admin_live_withdraw_key(p_request->>'platform')=private.dashboard_admin_live_withdraw_key(p.name))
   and (not p_request ? 'platforms' or jsonb_array_length(p_request->'platforms')=0 or nullif(p_request->>'platform','') is not null
    or exists(select 1 from jsonb_array_elements_text(p_request->'platforms') f where private.dashboard_admin_live_withdraw_key(f)=private.dashboard_admin_live_withdraw_key(p.name)))
 ), orders as materialized (
  select y.*,s.name display_platform,s.country display_country,s.platform_key,(y.created_at at time zone 'Asia/Kolkata')::date local_date,
   private.dashboard_admin_yash_status(y.order_type,y.status) status_group,
   case when private.dashboard_admin_yash_status(y.order_type,y.status)='success'
    and isfinite(y.created_at) and isfinite(y.completed_at) and isfinite(y.observed_at)
    and y.completed_at>=y.created_at and y.completed_at<=y.observed_at and y.completed_at<=statement_timestamp()
    then extract(epoch from y.completed_at-y.created_at) end processing_seconds
  from sites s join private.yash_orders y on y.source_site='yash' and y.order_type='withdrawal'
  where y.created_at>=p_start::timestamp at time zone 'Asia/Kolkata' and y.created_at<(p_end+1)::timestamp at time zone 'Asia/Kolkata'
 ), days as materialized (
  select s.*,d::date local_date,private.dashboard_admin_yash_day_evidence('IN','YASH.BET','withdraw',d::date) evidence
  from sites s cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
 ), day_flags as materialized (
  -- Group only the two coverage values consumed by this report. Keep the
  -- original evidence computation, including current-window count rechecks.
  select local_date,country,name,platform_key,(evidence->>'complete')::boolean complete,
   (evidence->>'seen')::timestamptz seen from days
 ), operators as (
  select local_date,coalesce(nullif(btrim(operator),''),'（未知操作人）') account,
   count(*) processed,count(*) filter(where status_group='success') success,count(*) filter(where status_group='rejected') rejected,
   count(*) filter(where status_group='pending') pending_count,count(*) filter(where status_group='failed') failed_count,count(*) filter(where status_group='unknown') unknown_count,
   max(observed_at) source_updated_at,max(received_at) updated_at,
   count(processing_seconds) duration_sample_count,sum(processing_seconds) duration_total_seconds,avg(processing_seconds) avg_seconds
  from orders group by 1,2
 )
 select d.local_date,d.country,d.name,d.platform_key,
  case when count(o.order_no)>0 or d.complete then count(o.order_no) end,
  count(o.order_no) filter(where o.status_group='success'),count(o.order_no) filter(where o.status_group='rejected'),
  count(o.order_no) filter(where o.status_group='pending'),count(o.order_no) filter(where o.status_group='failed'),count(o.order_no) filter(where o.status_group='unknown'),
  avg(o.processing_seconds),count(o.processing_seconds),sum(o.processing_seconds),
  max(o.observed_at),greatest(max(o.received_at),d.seen),d.complete,
  coalesce((select jsonb_agg(to_jsonb(r) order by r.account) from operators r where r.local_date=d.local_date),'[]'::jsonb)
 from day_flags d left join orders o on o.local_date=d.local_date
 group by d.local_date,d.country,d.name,d.platform_key,d.complete,d.seen;
$new$;
 before_meta jsonb;after_meta jsonb;definition text;body_hash text;
begin
 if f is null then raise exception 'YASH_COVERAGE_KEY_BASELINE_MISSING';end if;
 select md5(p.prosrc),to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid)
 into body_hash,before_meta,definition from pg_proc p where p.oid=f;
 if not exists(select 1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace
   join pg_language l on l.oid=p.prolang join pg_roles r on r.oid=p.proowner
   where p.oid=f and s.nspname='private' and r.rolname='postgres' and l.lanname='sql'
    and p.provolatile='s' and not p.prosecdef and p.proparallel='u'
    and p.proconfig=array['search_path=""']::text[] and p.proacl=array['postgres=X/postgres']::aclitem[]
    and p.proretset and p.prorettype='record'::regtype and p.pronargs=4
    and pg_get_function_identity_arguments(p.oid)='p_request jsonb, p_scope jsonb, p_start date, p_end date'
    and pg_get_function_result(p.oid)='TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, pending_count bigint, failed_count bigint, unknown_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb)') then
  raise exception 'YASH_COVERAGE_KEY_METADATA_MISMATCH';end if;
 if body_hash='1e9eda16514b65889295810e6bf1d742' then return;end if;
 if body_hash<>'3a9751fdc8c61a3df1bd0776c9a5d352' or md5(old_body)<>'3a9751fdc8c61a3df1bd0776c9a5d352' or md5(new_body)<>'1e9eda16514b65889295810e6bf1d742'
  or (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 then
  raise exception 'YASH_COVERAGE_KEY_BODY_MISMATCH';end if;
 execute replace(definition,old_body,new_body);
 select to_jsonb(p)-'prosrc' into after_meta from pg_proc p where p.oid=f;
 if before_meta is distinct from after_meta or (select md5(prosrc) from pg_proc where oid=f)<>'1e9eda16514b65889295810e6bf1d742' then
  raise exception 'YASH_COVERAGE_KEY_POSTCHECK_MISMATCH';end if;
end;
$patch$;
commit;
