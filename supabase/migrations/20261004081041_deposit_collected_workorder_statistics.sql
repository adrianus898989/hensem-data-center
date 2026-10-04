-- Read accepted current AR/NEWAR workorders; imported candidate files remain private history.
-- No collector changes, business writes, grants, timeout increase or indexes.
begin;
select set_config('lock_timeout','3s',true);
select set_config('statement_timeout','30s',true);
do $guard$
declare current_hash text;
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_statistics(jsonb)')
  and prosecdef and provolatile='s' and proconfig=array['search_path=""','statement_timeout=20s']::text[]) then raise exception 'DEPOSIT_STATISTICS_ROUTER_METADATA_CHANGED';end if;
 select md5(prosrc) into current_hash from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_statistics(jsonb)');
 if current_hash not in ('896244ec8e4e1a32dcfe2119308e9e8d','57795c6ea7e81f2bab17b82ff82cff18') then raise exception 'DEPOSIT_STATISTICS_ROUTER_CHANGED';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_sheet_cases_v2(jsonb)')
  and md5(prosrc)='d97543be4d4d4aac6a8fa6b4f8ba3b3e') then raise exception 'DEPOSIT_SHEET_MATCHER_CHANGED';end if;
 if exists(select 1 from pg_proc p where p.oid in (to_regprocedure('private.dashboard_admin_deposit_collected_statistics(jsonb)'),to_regprocedure('private.dashboard_admin_deposit_collected_summary(jsonb)'))
  and (p.prosecdef or p.provolatile<>'s' or p.proretset or p.proconfig is distinct from array['search_path=""']::text[]
   or p.proowner<>(select proowner from pg_proc where oid='private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure)
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner))) then raise exception 'COLLECTED_STATISTICS_METADATA_CHANGED';end if;
 if to_regclass('public.ar_workorder_issue_details') is null or to_regclass('public.newar_detail_records') is null
  or to_regclass('public.newar_detail_platforms') is null then raise exception 'COLLECTED_WORKORDER_STORAGE_MISSING';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_workorder_provider_batch(jsonb)')
  and md5(prosrc)='12cc504d23658ed10d677deebb7e7049') then raise exception 'WORKORDER_PROVIDER_BATCH_CHANGED';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_kyc_summary_v2(jsonb)')
  and md5(prosrc)='1f19ef03e91fb555a226c345f587c312') then raise exception 'DEPOSIT_KYC_SUMMARY_CHANGED';end if;
 if exists(select 1 from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_collected_statistics(jsonb)') and md5(prosrc)<>'949f7b1853f52d13383f98e9814fd3f7')
  or exists(select 1 from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_collected_summary(jsonb)') and md5(prosrc)<>'cb0533ace99068c66a22ffe563914280') then raise exception 'COLLECTED_STATISTICS_DEFINITION_CHANGED';end if;
end;$guard$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_deposit_collected_summary(p_rows jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO '' AS $collected_summary$
 select value-'exportRows'-'duplicateExportRows'||jsonb_build_object('rawRecords',value->'exportRows','duplicateSourceRows',value->'duplicateExportRows')
 from (select private.dashboard_admin_deposit_kyc_summary_v2(p_rows) value) s;
$collected_summary$;
revoke all on function private.dashboard_admin_deposit_collected_summary(jsonb) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.dashboard_admin_deposit_collected_statistics(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO '' AS $collected$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();v_dimension text:=coalesce(p_request->>'dimension','platform');
 v_kyc text:=coalesce(p_request->>'kycStatus','all');v_processing text:=coalesce(p_request->>'processing','all');
 v_match text:=coalesce(p_request->>'matchStatus','all');v_dates text:=coalesce(p_request->>'dateMode','all');
 v_start date;v_end date;v_offset integer:=0;v_limit integer:=20;v_key text;v_result jsonb;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>12000
  or p_request-array['section','dimension','kycStatus','processing','matchStatus','dateMode','startAt','endAt','country','platform','provider','query','offset','limit']<>'{}'::jsonb then raise exception 'invalid_request';end if;
 foreach v_key in array array['section','dimension','kycStatus','processing','matchStatus','dateMode','country','platform','provider','query','startAt','endAt'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then raise exception 'invalid_filter';end if;
 end loop;
 if p_request->>'section' is distinct from 'kyc' or v_dimension not in ('platform','provider','date','orders')
  or v_kyc not in ('all','connected','disconnected','unknown') or v_processing not in ('all','processed','rejected','unprocessed','unknown')
  or v_match not in ('all','exact_unique','exact_duplicate','amount_conflict','ambiguous_online','online_amount_missing','unmatched','platform_not_in_online_snapshot','missing_rc','source_conflict')
  or v_dates not in ('all','range') then raise exception 'invalid_view';end if;
 if coalesce(p_request->>'country','') not in ('','all','印度','IN') then raise exception 'country_not_supported';end if;
 foreach v_key in array array['offset','limit'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then raise exception 'invalid_pagination';end if;
 end loop;
 v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 if v_offset>1000000 or v_limit not in (20,50,100) then raise exception 'invalid_pagination';end if;
 foreach v_key in array array['startAt','endAt'] loop
  if p_request ? v_key then
   if coalesce(p_request->>v_key,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' then raise exception 'invalid_dates';end if;
   perform (p_request->>v_key)::timestamptz;
  end if;
 end loop;
 if v_dates='range' then
  if not p_request ?& array['startAt','endAt'] then raise exception 'invalid_dates';end if;
  v_start:=left(p_request->>'startAt',10)::date;v_end:=left(p_request->>'endAt',10)::date;
  if v_start>v_end or v_end-v_start>366 then raise exception 'invalid_dates';end if;
 end if;
 with catalog as materialized (
  -- Resolve the authorized directory once. Physical source names, never a
  -- client-supplied raw name, determine which storage partitions are readable.
  select p.source_name,p.scope_group country_code,p.country,
   case when count(distinct coalesce(nullif(btrim(p.currency),''),'(missing)'))=1 then min(nullif(btrim(p.currency),'')) end currency,
   lower(p.source) system,
   private.dashboard_admin_live_deposit_platform_key('IN',p.source_name) platform_key
  from private.dashboard_admin_live_platforms() p
  where p.scope_group='IN' and p.country='印度' and lower(p.source) in ('ar','newar')
   and private.dashboard_scope_allows(v_scope,p.scope_group,p.source_name)
  group by p.source_name,p.scope_group,p.country,lower(p.source)
), ar_targets as materialized (
  select c.country_code,c.country,case when count(distinct coalesce(c.currency,'(missing)'))=1 then min(c.currency) end currency,c.platform_key,a.platform
  from catalog c cross join lateral (
   select c.source_name platform union select c.platform_key
   union select alias.platform from (values ('82BET'),('82LOTTERY'),('OK.WIN'),('OKWIN'),('VEER.GAME'),('VEERGAME'),
    ('RAJA'),('RAJALOTTERY'),('RAJAGAME'),('RAJAGAMES'),('SHREE.WIN'),('SHREEWIN')) alias(platform)
   where private.dashboard_admin_live_deposit_platform_key('IN',alias.platform)=c.platform_key
  ) a
  where c.system='ar' and private.dashboard_scope_allows(v_scope,c.country_code,a.platform)
   and (coalesce(p_request->>'platform','') in ('','all')
    or c.platform_key=private.dashboard_admin_live_deposit_platform_key('IN',p_request->>'platform'))
  group by c.country_code,c.country,c.platform_key,a.platform
), newar_targets as materialized (
  select distinct c.country_code,c.country,c.platform_key,n.platform,n.currency,n.timezone,n.launch_at
  from catalog c join public.newar_detail_platforms n on c.system='newar' and n.platform=c.source_name
   and n.country_code=c.country_code and n.country=c.country and n.enabled
  where (n.launch_at is null or n.launch_at<=statement_timestamp())
   and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
   and (coalesce(p_request->>'platform','') in ('','all')
    or c.platform_key=private.dashboard_admin_live_deposit_platform_key('IN',p_request->>'platform'))
), ar_seed_rows as materialized (
  -- Mutually exclusive branches preserve submitted_date precedence and expose
  -- direct submission date/instant predicates to the existing indexes.
  select d.country_code,d.platform,d.work_order_id,d.work_order_no,d.payment_order_no,d.amount,d.third_party,d.channel_type,
   d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,d.query_date,d.query_basis,
   t.platform_key,t.currency target_currency,t.country target_country
  from ar_targets t join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=t.country_code
   and d.platform=t.platform and d.issue_kind='deposit' where v_dates='all'
  union all
  select d.country_code,d.platform,d.work_order_id,d.work_order_no,d.payment_order_no,d.amount,d.third_party,d.channel_type,
   d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,d.query_date,d.query_basis,
   t.platform_key,t.currency target_currency,t.country target_country
  from ar_targets t join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=t.country_code
   and d.platform=t.platform and d.issue_kind='deposit'
   and d.submitted_date between v_start and v_end where v_dates='range'
  union all
  select d.country_code,d.platform,d.work_order_id,d.work_order_no,d.payment_order_no,d.amount,d.third_party,d.channel_type,
   d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,d.query_date,d.query_basis,
   t.platform_key,t.currency target_currency,t.country target_country
  from ar_targets t join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=t.country_code
   and d.platform=t.platform and d.issue_kind='deposit' and d.submitted_date is null
   and d.submitted_at>=(v_start::timestamp at time zone 'Asia/Kolkata')
   and d.submitted_at<((v_end+1)::timestamp at time zone 'Asia/Kolkata') where v_dates='range'
), newar_seed_rows as materialized (
  select d.platform,d.source_id,d.created_at,d.captured_at,d.amount,d.currency,d.provider,d.channel_type,d.status_code,
   jsonb_build_object('depositOrderNo',d.raw->'depositOrderNo','rechargeNumber',d.raw->'rechargeNumber','utr',d.raw->'utr') raw,
   t.platform_key,t.currency target_currency,t.country target_country,t.timezone target_timezone
  from newar_targets t join public.newar_detail_records d on d.platform=t.platform and d.dataset='workorder'
   and (t.launch_at is null or d.created_at>=t.launch_at)
  where d.workorder_type in ('存款未到账','存款未到账自动化') and v_dates='all'
  union all
  select d.platform,d.source_id,d.created_at,d.captured_at,d.amount,d.currency,d.provider,d.channel_type,d.status_code,
   jsonb_build_object('depositOrderNo',d.raw->'depositOrderNo','rechargeNumber',d.raw->'rechargeNumber','utr',d.raw->'utr') raw,
   t.platform_key,t.currency target_currency,t.country target_country,t.timezone target_timezone
  from newar_targets t join public.newar_detail_records d on d.platform=t.platform and d.dataset='workorder'
   and d.created_at>=(v_start::timestamp at time zone t.timezone)
   and d.created_at<((v_end+1)::timestamp at time zone t.timezone)
   and (t.launch_at is null or d.created_at>=t.launch_at)
  where d.workorder_type in ('存款未到账','存款未到账自动化') and v_dates='range'
), seed_keys as materialized (
  select jsonb_build_array('ar',d.country_code,d.platform_key,d.work_order_id)::text wo_key,d.platform_key,
   upper(nullif(btrim(d.payment_order_no),'')) payment_id,'ar'::text source_system,d.work_order_id workorder_id,
   case when nullif(btrim(d.payment_order_no),'') is not null then array[upper(btrim(d.payment_order_no))] else '{}'::text[] end payment_references
  from ar_seed_rows d
  union all
  select jsonb_build_array('newar','IN',d.platform_key,d.source_id)::text,d.platform_key,
   case when r.deposit_ref is not null and r.recharge_ref is not null and r.deposit_ref<>r.recharge_ref then null
    else coalesce(r.deposit_ref,r.recharge_ref) end,'newar',d.source_id,
   array(select distinct x from unnest(array[r.deposit_ref,r.recharge_ref]) x where x is not null)
  from newar_seed_rows d cross join lateral (select
   case when jsonb_typeof(d.raw->'depositOrderNo')='string' then upper(nullif(btrim(d.raw->>'depositOrderNo'),'')) end deposit_ref,
   case when jsonb_typeof(d.raw->'rechargeNumber')='string' then upper(nullif(btrim(d.raw->>'rechargeNumber'),'')) end recharge_ref) r
), original_keys as materialized (
  select distinct s.platform_key,ref payment_id from seed_keys s cross join lateral unnest(s.payment_references) ref
), seed_workorders as materialized (
  select distinct platform_key,source_system,workorder_id from seed_keys
), related_identity_maps as materialized (
  select (select coalesce(jsonb_object_agg(jsonb_build_array(platform_key,payment_id)::text,true),'{}'::jsonb) from original_keys) originals,
   (select coalesce(jsonb_object_agg(jsonb_build_array(platform_key,workorder_id)::text,true),'{}'::jsonb) from seed_workorders where source_system='ar') ar_workorders,
   (select coalesce(jsonb_object_agg(jsonb_build_array(platform_key,workorder_id)::text,true),'{}'::jsonb) from seed_workorders where source_system='newar') workorders
), ar_related as materialized (
  -- Read each authorized physical platform once. Joining original keys directly
  -- can let an underestimated candidate set drive one full history index scan
  -- per original because normalization is not in the existing index key.
  select d.country_code,d.platform,d.work_order_id,d.work_order_no,d.payment_order_no,d.amount,d.third_party,d.channel_type,
   d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,d.query_date,d.query_basis,
   t.platform_key,t.currency target_currency,t.country target_country
  from ar_targets t join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=t.country_code
   and d.platform=t.platform and d.issue_kind='deposit'
  cross join related_identity_maps m
  where exists(select 1 from seed_keys) and (
   m.ar_workorders ? jsonb_build_array(t.platform_key,d.work_order_id)::text
   or m.originals ? jsonb_build_array(t.platform_key,upper(nullif(btrim(d.payment_order_no),'')))::text)
), newar_related as materialized (
  -- Only the scoped workorder partition is read, with three whitelisted raw
  -- values. A map membership lookup keeps the narrow projection cardinality;
  -- no opaque multi-column classifier/id rejoin drives its estimate to one.
  select d.platform,d.source_id,d.created_at,d.captured_at,d.amount,d.currency,d.provider,d.channel_type,d.status_code,
   jsonb_build_object('depositOrderNo',d.raw->'depositOrderNo','rechargeNumber',d.raw->'rechargeNumber','utr',d.raw->'utr') raw,
   t.platform_key,t.currency target_currency,t.country target_country,t.timezone target_timezone
  from newar_targets t join public.newar_detail_records d on d.platform=t.platform and d.dataset='workorder'
   and (t.launch_at is null or d.created_at>=t.launch_at)
  cross join related_identity_maps m
  where d.workorder_type in ('存款未到账','存款未到账自动化') and exists(select 1 from seed_keys) and (
   m.workorders ? jsonb_build_array(t.platform_key,d.source_id)::text
   or jsonb_typeof(d.raw->'depositOrderNo')='string' and m.originals ? jsonb_build_array(t.platform_key,upper(nullif(btrim(d.raw->>'depositOrderNo'),'')))::text
   or jsonb_typeof(d.raw->'rechargeNumber')='string' and m.originals ? jsonb_build_array(t.platform_key,upper(nullif(btrim(d.raw->>'rechargeNumber'),'')))::text)
), projected as materialized (
  select jsonb_build_array('ar',d.country_code,d.platform_key,d.work_order_id)::text wo_key,
   'ar'::text source_system,d.country_code,d.target_country country,d.platform raw_platform,d.platform_key platform,
   d.work_order_id workorder_id,d.work_order_no workorder_no,upper(nullif(btrim(d.payment_order_no),'')) payment_id,
   case when nullif(btrim(d.payment_order_no),'') is not null then array[upper(btrim(d.payment_order_no))] else '{}'::text[] end payment_references,
   coalesce(d.submitted_date,(d.submitted_at at time zone 'Asia/Kolkata')::date) submitted_date,
   d.submitted_at submitted_at,d.observed_at,
   case when d.amount::text not in ('NaN','Infinity','-Infinity') then d.amount end amount,
   d.target_currency currency,coalesce(nullif(btrim(d.third_party),''),'未识别三方') raw_provider,nullif(btrim(d.channel_type),'') channel_type,
   case d.kyc_connected when true then 'connected' when false then 'disconnected' else 'unknown' end kyc,
   case d.status_code when 4 then 'processed' when 3 then 'rejected' when 1 then 'unprocessed' when 2 then 'unprocessed' when 5 then 'unprocessed' else 'unknown' end processing,
   case d.status_code when 4 then '已处理' when 3 then '已驳回' when 1 then '未处理' when 2 then '未处理' when 5 then '未处理' else '未提供' end source_workorder_state,
   case when nullif(btrim(d.utr),'') is not null then encode(sha256(convert_to(btrim(d.utr),'UTF8')),'hex') end utr_digest,
   nullif(btrim(d.utr),'') is not null utr_present,false source_conflict,
   d.query_date,d.query_basis
  from ar_related d
  union all
  select jsonb_build_array('newar','IN',d.platform_key,d.source_id)::text,
   'newar','IN',d.target_country,d.platform,d.platform_key,d.source_id,null::text,
   case when r.deposit_ref is not null and r.recharge_ref is not null and r.deposit_ref<>r.recharge_ref then null
    else coalesce(r.deposit_ref,r.recharge_ref) end,
   array(select distinct x from unnest(array[r.deposit_ref,r.recharge_ref]) x where x is not null),
   (d.created_at at time zone d.target_timezone)::date,d.created_at,d.captured_at,
   case when d.currency=d.target_currency and d.amount::text not in ('NaN','Infinity','-Infinity') then d.amount end,
   case when d.currency=d.target_currency then d.currency end,
   coalesce(nullif(btrim(d.provider),''),'未识别三方'),nullif(btrim(d.channel_type),''),
   'unknown',
   case d.status_code when '4' then 'processed' when '3' then 'rejected' when '1' then 'unprocessed' when '2' then 'unprocessed' when '5' then 'unprocessed' else 'unknown' end,
   case d.status_code when '4' then '已处理' when '3' then '已驳回' when '1' then '未处理' when '2' then '未处理' when '5' then '未处理' else '未提供' end,
   case when jsonb_typeof(d.raw->'utr')='string' and nullif(btrim(d.raw->>'utr'),'') is not null
    then encode(sha256(convert_to(btrim(d.raw->>'utr'),'UTF8')),'hex') end,
   jsonb_typeof(d.raw->'utr')='string' and nullif(btrim(d.raw->>'utr'),'') is not null,
   coalesce(r.deposit_ref is not null and r.recharge_ref is not null and r.deposit_ref<>r.recharge_ref,false)
    or (d.raw ? 'depositOrderNo' and d.raw->'depositOrderNo'<>'null'::jsonb and jsonb_typeof(d.raw->'depositOrderNo')<>'string')
    or (d.raw ? 'rechargeNumber' and d.raw->'rechargeNumber'<>'null'::jsonb and jsonb_typeof(d.raw->'rechargeNumber')<>'string'),
   null::date,null::text
  from newar_related d cross join lateral(select
   case when jsonb_typeof(d.raw->'depositOrderNo')='string' then upper(nullif(btrim(d.raw->>'depositOrderNo'),'')) end deposit_ref,
   case when jsonb_typeof(d.raw->'rechargeNumber')='string' then upper(nullif(btrim(d.raw->>'rechargeNumber'),'')) end recharge_ref) r
), provider_names as materialized (
  select * from private.dashboard_admin_live_workorder_provider_batch((select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
   from(select distinct country,raw_platform platform,raw_provider,channel_type from projected) x))
), provider_mapping as materialized (
  select coalesce(jsonb_object_agg(jsonb_build_array(country,platform,raw_provider,channel_type)::text,provider),'{}'::jsonb) names from provider_names
), mapped as materialized (
  -- A single map lookup per row preserves projected cardinality. Joining the
  -- opaque batch classifier on three names can estimate one row, causing
  -- quadratic nested loops for later materialized workorder/case joins.
  select d.*,p.provider,regexp_replace(lower(btrim(coalesce(p.provider,''))),'[[:space:]_-]+','','g')
   in ('','未标记三方','未识别三方','未识别通道','未分类三方','未提供','unknown','unmarked') unknown_provider
  from projected d cross join provider_mapping m cross join lateral(select m.names->>jsonb_build_array(d.country,d.raw_platform,d.raw_provider,d.channel_type)::text provider) p
), reference_observations as materialized (
  select distinct m.wo_key,m.platform,ref payment_reference from mapped m cross join lateral unnest(m.payment_references) ref
), workorder_references as materialized (
  select wo_key,array_agg(distinct payment_reference order by payment_reference) payment_references from reference_observations group by wo_key
), wo_groups as materialized (
  -- One canonical workorder per source system. Keep all physical aliases as
  -- paired evidence; disagreements stay unknown/conflicting, never newest-wins.
  select wo_key,min(platform) platform,min(workorder_id) workorder_id,
   string_agg(distinct workorder_no,', ' order by workorder_no) workorder_no,
   count(*) export_rows,
   case when count(distinct coalesce(payment_id,'(missing)'))=1 then min(payment_id) end payment_id,
   case when count(distinct kyc)=1 then min(kyc) else 'unknown' end kyc,
   case when count(distinct processing)=1 and not bool_or(source_conflict) then min(processing) else 'unknown' end processing,
   case when count(distinct source_workorder_state)=1 then min(source_workorder_state) else '源状态有变化' end source_workorder_state,
   case when count(distinct coalesce(amount::text,'(missing)'))=1 then min(amount) end amount,
   case when count(distinct coalesce(currency,'(missing)'))=1 then min(currency) end currency,
   case when count(distinct provider) filter(where not unknown_provider)=1 then min(provider) filter(where not unknown_provider)
    when count(distinct provider) filter(where not unknown_provider)>1 then '来源冲突' else '未提供' end provider,
   count(distinct provider) filter(where not unknown_provider)=0 unknown_provider,
   case when count(distinct coalesce(submitted_date::text,'(missing)'))=1 then min(submitted_date) end submitted_date,
   min(submitted_at) submitted_at,max(observed_at) observed_at,min(source_system) source_system,
   bool_or(source_conflict) or count(distinct coalesce(payment_id,'(missing)'))<>1 identity_conflict,
   bool_or(source_conflict) or count(distinct coalesce(amount::text,'(missing)'))<>1
    or count(distinct coalesce(payment_id,'(missing)'))<>1
    or count(distinct provider) filter(where not unknown_provider)>1 source_conflict,
   case when count(distinct utr_digest)=1 then min(utr_digest) end utr_digest,
   bool_or(utr_present) utr_present,count(distinct utr_digest)>1 utr_conflict
  from mapped group by wo_key
), wo as materialized (
  select g.*,coalesce(r.payment_references,'{}'::text[]) payment_references from wo_groups g left join workorder_references r using(wo_key)
), keyed as materialized (
  select d.*,jsonb_build_array(d.platform,coalesce(d.payment_id,'WORKORDER:'||d.wo_key))::text case_key from wo d
), case_base as materialized (
  select case_key,min(platform) platform,min(payment_id) payment_id,
   case when count(distinct coalesce(amount::text,'(missing)'))=1 and not bool_or(source_conflict) then min(amount) end amount,
   case when count(distinct coalesce(currency,'(missing)'))=1 then min(currency) end currency,
   case when count(distinct provider) filter(where not unknown_provider)=1 then min(provider) filter(where not unknown_provider)
    when count(distinct provider) filter(where not unknown_provider)>1 then '来源冲突' else '未提供' end provider,
   case when count(distinct processing)=1 then min(processing) else 'unknown' end case_processing,
   bool_or(source_conflict) or count(distinct coalesce(amount::text,'(missing)'))<>1
    or count(distinct provider) filter(where not unknown_provider)>1 source_conflict,
   case when count(distinct utr_digest)=1 then min(utr_digest) end utr_digest,
   bool_or(utr_present) utr_present,bool_or(utr_conflict) or count(distinct utr_digest)>1 utr_conflict,count(*) related_workorders,sum(export_rows) related_records
  from keyed group by case_key
), reference_conflicts as materialized (
  -- Conflicting explicit references never choose one original. Preserve their
  -- ambiguity on every selected exact original they could identify instead.
  select distinct c.case_key,w.wo_key,w.export_rows
  from case_base c join reference_observations m on m.platform=c.platform and c.payment_id=m.payment_reference
  join wo w on w.wo_key=m.wo_key where c.payment_id is not null and w.payment_id is null and w.source_conflict
  union
  select ambiguous.case_key,related.wo_key,related.export_rows
  from keyed ambiguous join reference_observations refs on refs.wo_key=ambiguous.wo_key
  join keyed related on related.platform=ambiguous.platform and related.payment_id=refs.payment_reference
  where ambiguous.payment_id is null and ambiguous.source_conflict and related.wo_key<>ambiguous.wo_key
), reference_conflict_totals as materialized (
  select case_key,count(*) n,sum(export_rows) records from reference_conflicts group by case_key
), cases as materialized (
  select c.case_key,c.platform,c.payment_id,
   case when coalesce(f.n,0)=0 then c.amount end amount,c.currency,c.provider,c.case_processing,
   c.source_conflict or coalesce(f.n,0)>0 source_conflict,c.utr_digest,c.utr_present,c.utr_conflict,
   c.related_workorders+coalesce(f.n,0) related_workorders,c.related_records+coalesce(f.records,0) related_records,coalesce(f.n,0) reference_conflict_workorders
  from case_base c left join reference_conflict_totals f using(case_key)
), eligible_workorders as materialized (
  select w.* from keyed w where exists(select 1 from seed_keys s where s.wo_key=w.wo_key)
  and (coalesce(p_request->>'query','')='' or strpos(lower(coalesce(w.payment_id,'')),lower(p_request->>'query'))>0
   or exists(select 1 from unnest(w.payment_references) ref where strpos(lower(ref),lower(p_request->>'query'))>0)
   or strpos(lower(w.workorder_id),lower(p_request->>'query'))>0 or strpos(lower(coalesce(w.workorder_no,'')),lower(p_request->>'query'))>0)
   and (v_processing='all' or w.processing=v_processing)
), candidate_cases as materialized (
  select c.* from cases c where exists(select 1 from eligible_workorders w where w.case_key=c.case_key)
   and (coalesce(p_request->>'provider','') in ('','all') or c.provider=p_request->>'provider')
 ), online_raw_platforms as materialized (
  select distinct r.platform
  from public.admin_deposit_issue_rows r
  where r.stale_at is null and r.country='印度'
 ), online_platform_keys as materialized (
  -- Authorization and alias normalization depend only on the source platform.
  select r.platform,private.dashboard_admin_live_deposit_platform_key('IN',r.platform) platform_key
  from online_raw_platforms r where private.dashboard_scope_allows(v_scope,'IN',r.platform)
   and exists(select 1 from candidate_cases c where c.platform=private.dashboard_admin_live_deposit_platform_key('IN',r.platform))
 ), online_platforms as materialized (
  -- Existence is independent of whether the requested original order is present.
  select distinct platform_key platform from online_platform_keys
 ), online_identity_maps as materialized (
  -- Scalar identity membership prevents candidate-driven full platform scans
  -- when the authorized directory function has a low cardinality estimate.
  select coalesce(jsonb_object_agg(jsonb_build_array(platform,payment_id)::text,true),'{}'::jsonb) originals,
   coalesce(jsonb_object_agg(jsonb_build_array(platform,payment_id)::text,to_jsonb(amount)) filter(where amount is not null),'{}'::jsonb) amounts
  from candidate_cases where payment_id is not null
 ), online_scoped as materialized (
  -- Keep every source row of each selected original, including conflicting copies.
  select r.*,k.platform_key,
   coalesce(nullif(upper(btrim(r.order_number)),''),'ROW:'||r.id) order_key,
   jsonb_build_array(r.amount,r.provider,r.canonical_provider,r.utr,r.status,r.confirmation_status,
    r.match_status,r.kyc_correct,r.utr_match,r.provider_reply,r.upi_id,r.kyc_upi_id) semantic
  from public.admin_deposit_issue_rows r join online_platform_keys k on k.platform=r.platform cross join online_identity_maps m
  where r.stale_at is null and r.country='印度'
   and m.originals ? jsonb_build_array(k.platform_key,upper(btrim(r.order_number)))::text
 ), online_positioned as materialized (
  select r.*,row_number() over(partition by platform_key,order_key order by source_sheet,source_tab,source_row,id) source_pos from online_scoped r
 ), online_groups as (
  select platform_key,order_key,min(id) row_id,count(*) n,count(distinct semantic) variants,
   array_agg(source_row order by source_row) filter(where source_pos<=200) source_rows,
   jsonb_agg(jsonb_build_object('sourceSheet',source_sheet,'sourceTab',source_tab,'sourceRow',source_row,'sourceId',id,
    'amount',amount,'provider',coalesce(nullif(canonical_provider,''),provider),'status',status,'confirmation',confirmation_status,'manualKyc',kyc_correct,'manualUtr',utr_match)
    order by source_sheet,source_tab,source_row) filter(where source_pos<=200) sources,max(updated_at) updated_at
  from online_positioned group by platform_key,order_key
 ), online as materialized (
  select md5(jsonb_build_array(g.platform_key,g.order_key)::text) id,case when variants=1 then r.source_row end source_row,
   g.platform_key platform,'印度' country,nullif(g.order_key,'ROW:'||r.id) order_number,case when variants=1 then r.utr end utr,
   case when variants=1 then r.amount end amount,case when variants=1 then r.provider else '来源冲突' end provider,
   case when variants=1 then r.canonical_provider else '来源冲突' end canonical_provider,
   case when variants=1 then r.match_status else '来源冲突' end match_status,case when variants=1 then r.status else '来源冲突' end status,
   case when variants=1 then r.confirmation_status else '来源冲突' end confirmation_status,
   case when variants=1 then r.upi_id end upi_id,case when variants=1 then r.kyc_upi_id end kyc_upi_id,
   case when variants=1 then r.kyc_correct end kyc_correct,case when variants=1 then r.utr_match end utr_match,
   case when variants=1 then r.provider_reply end provider_reply,g.updated_at,n source_row_count,variants variant_count,g.source_rows,g.sources
  from online_groups g join online_scoped r on r.id=g.row_id
 ),
 followups as materialized (
  select private.dashboard_admin_live_deposit_platform_key('IN',f.platform) platform,upper(btrim(f.order_number)) payment_id,f.amount,count(*) followup_count,
   (array_agg(f.followup_at order by f.followup_date desc nulls last,f.source_row desc))[1] last_followup_at
  from public.admin_deposit_followup_rows f cross join online_identity_maps m
  where f.country='印度' and f.stale_at is null and f.source_kind='sheet' and f.amount is not null and private.dashboard_scope_allows(v_scope,'IN',f.platform)
   and m.amounts->jsonb_build_array(private.dashboard_admin_live_deposit_platform_key('IN',f.platform),upper(btrim(f.order_number)))::text=to_jsonb(f.amount)
  group by 1,2,3
 ), matched as materialized (
  select c.*,o.sources online_sources,o.source_row_count online_source_count,o.status online_state,o.kyc_correct manual_kyc,o.utr_match manual_utr,
   case when o.id is not null and o.variant_count=1 then nullif(btrim(o.utr),'') is not null end online_utr_present,o.provider_reply,
   case when c.source_conflict or c.amount is null then 'source_conflict' when c.payment_id is null then 'missing_rc'
    when not exists(select 1 from online_platforms p where p.platform=c.platform) then 'platform_not_in_online_snapshot'
    when o.id is null then 'unmatched' when o.variant_count>1 then 'ambiguous_online'
    when o.amount is null then 'online_amount_missing' when c.amount<>o.amount then 'amount_conflict'
    when o.source_row_count>1 then 'exact_duplicate' else 'exact_unique' end match_status,
   case when o.id is null then 'not_compared' when c.utr_conflict then 'source_conflict' when o.variant_count>1 then 'online_conflict'
    when not coalesce(c.utr_present,false) and nullif(btrim(o.utr),'') is null then 'both_missing'
    when not coalesce(c.utr_present,false) then 'source_missing' when nullif(btrim(o.utr),'') is null then 'online_missing'
    when c.utr_digest is null then 'not_compared'
    when c.utr_digest=encode(sha256(convert_to(btrim(o.utr),'UTF8')),'hex') then 'match' else 'conflict' end utr_state,
   coalesce(f.followup_count,0) followup_count,f.last_followup_at
  from candidate_cases c left join online o on o.platform=c.platform and o.order_number=upper(btrim(c.payment_id))
   left join followups f on f.platform=c.platform and f.payment_id=upper(btrim(c.payment_id)) and c.amount is not null and f.amount=c.amount
 ), eligible as materialized (
  select w.wo_key,w.workorder_id,w.workorder_no,w.export_rows,w.kyc,w.processing,w.source_workorder_state,w.submitted_date,
   w.submitted_at,w.observed_at,w.source_system,c.*
  from eligible_workorders w join matched c using(case_key) where v_match='all' or c.match_status=v_match
 ), filtered as materialized (select * from eligible where v_kyc='all' or kyc=v_kyc),
 groups as (
  select case v_dimension when 'platform' then platform when 'provider' then coalesce(provider,'未提供') when 'date' then coalesce(submitted_date::text,'未提供') end key,
   jsonb_agg(jsonb_build_object('wo_key',wo_key,'case_key',case_key,'payment_id',payment_id,'export_rows',export_rows,
    'kyc',kyc,'processing',processing,'case_processing',case_processing,'amount',amount,'currency',currency,'match_status',match_status,'source_conflict',source_conflict)) items
  from filtered group by 1
 ), group_items as (select key,private.dashboard_admin_deposit_collected_summary(items)||jsonb_build_object('key',key,'label',key) item from groups),
 case_evidence as (
  select r.*,k.case_key,k.identity_conflict reference_conflict from mapped r join keyed k using(wo_key)
  union all
  select r.*,f.case_key,true reference_conflict from mapped r join reference_conflicts f using(wo_key)
 ), provenance as (select r.*,row_number() over(partition by r.case_key order by r.source_system,r.raw_platform,r.workorder_id) source_pos
  from case_evidence r where exists(select 1 from filtered f where f.case_key=r.case_key)),
 provenance_groups as materialized (
  select p.case_key,jsonb_agg(jsonb_build_object('sourceSystem',p.source_system,'sourcePlatform',p.raw_platform,'workOrderId',p.workorder_id,
   'submittedAt',p.submitted_at,'observedAt',p.observed_at,'amount',p.amount,'currency',p.currency,
   'submittedDate',p.submitted_date,'sourceWorkorderState',p.source_workorder_state,'kycStatus',p.kyc,
   'paymentOrderReferences',p.payment_references,'referenceConflict',p.reference_conflict or p.source_conflict)
   order by p.source_system,p.raw_platform,p.workorder_id) filter(where p.source_pos<=200) sources
  from provenance p group by p.case_key
 ),
 order_items as (
  select md5(case_key) key,jsonb_build_object('id',md5(case_key),'platform',min(platform),'paymentOrderId',min(payment_id),
   'workOrderId',string_agg(distinct workorder_id,', ' order by workorder_id),'workorderCount',count(*),'rawRecords',sum(export_rows),
   'relatedWorkorderCount',max(related_workorders),'referenceConflictWorkorderCount',max(reference_conflict_workorders),
   'kycStatus',case when count(distinct kyc)=1 then min(kyc) else 'unknown' end,'hasKycCategoryChange',count(distinct kyc)>1,
   'manualKyc',min(manual_kyc),'manualUtr',min(manual_utr),
   'provider',min(provider),'amount',min(amount),'currency',min(currency),'sourceWorkorderState',string_agg(distinct source_workorder_state,', '),
   'sourceSystem',string_agg(distinct source_system,', '),'onlineState',min(online_state),'onlineSourceCount',max(online_source_count),
   'onlineSourcesTruncated',coalesce(max(online_source_count)>200,false),'onlineSources',online_sources,
   'matchStatus',min(match_status),'utrState',min(utr_state),'receiptState','unverified',
   'sourceUtrPresent',bool_or(utr_present),'onlineUtrPresent',bool_or(online_utr_present),
   'sources',pgroup.sources,
   'sourceCount',max(related_records),'sourcesTruncated',max(related_records)>200,
   'followupCount',max(followup_count),'lastFollowupAt',min(last_followup_at),'providerReply',min(provider_reply)) item
  from filtered left join provenance_groups pgroup using(case_key) group by case_key,online_sources,pgroup.sources
 ), chosen as (select * from order_items where v_dimension='orders' union all select * from group_items where v_dimension<>'orders'),
 paged as (select * from chosen order by key offset v_offset limit v_limit),
 stats as (select private.dashboard_admin_deposit_collected_summary(coalesce(jsonb_agg(jsonb_build_object('wo_key',wo_key,'case_key',case_key,'payment_id',payment_id,'export_rows',export_rows,
  'kyc',kyc,'processing',processing,'case_processing',case_processing,'amount',amount,'currency',currency,'match_status',match_status,'source_conflict',source_conflict)),'[]'::jsonb)) value from filtered),
 selected_records as materialized(select k.* from keyed k where exists(select 1 from seed_keys s where s.wo_key=k.wo_key)),
 source_latest_candidates as materialized (
  -- Existing submission indexes provide the latest stored submission date.
  -- Its record capture time is explicit metadata, not the global max capture of
  -- all history (which would reread every large raw record on every query).
  select t.platform_key platform,'ar'::text system,r.submitted_date,r.submitted_at,r.observed_at
  from ar_targets t cross join lateral (
   (select d.submitted_date,d.submitted_at,d.observed_at
    from public.ar_workorder_issue_details d where d.system_name='AR' and d.country_code=t.country_code
     and d.platform=t.platform and d.issue_kind='deposit' and d.submitted_date is not null
    order by d.submitted_date desc,d.submitted_at desc nulls last,d.work_order_id desc limit 1)
   union all
   (select (d.submitted_at at time zone 'Asia/Kolkata')::date,d.submitted_at,d.observed_at
    from public.ar_workorder_issue_details d where d.system_name='AR' and d.country_code=t.country_code
     and d.platform=t.platform and d.issue_kind='deposit' and d.submitted_date is null and d.submitted_at is not null
    order by d.submitted_at desc,d.work_order_id desc limit 1)
  ) r
  union all
  select t.platform_key,'newar',(d.created_at at time zone t.timezone)::date,d.created_at,d.captured_at
  from newar_targets t cross join lateral (
   select n.created_at,n.captured_at from public.newar_detail_records n where n.platform=t.platform and n.dataset='workorder'
    and (t.launch_at is null or n.created_at>=t.launch_at) and n.workorder_type in ('存款未到账','存款未到账自动化')
   order by n.created_at desc,n.id desc limit 1
  ) d
 ), source_latest as materialized (
  select distinct on(platform,system) platform,system,submitted_date latest_submitted_date,observed_at last_observed_at
  from source_latest_candidates order by platform,system,submitted_date desc,submitted_at desc nulls last,observed_at desc
 ), platform_manifest as (
  select t.platform,t.system,count(d.wo_key) selected_workorders,max(l.latest_submitted_date) latest_submitted_date,max(l.last_observed_at) last_observed_at
  from (select distinct platform_key platform,'ar'::text system from ar_targets union select distinct platform_key,'newar' from newar_targets) t
  left join selected_records d on d.platform=t.platform and d.source_system=t.system
  left join source_latest l on l.platform=t.platform and l.system=t.system group by t.platform,t.system
 )
 select jsonb_build_object('version',2,'section','kyc','source','collected-workorders','dimension',v_dimension,'summary',stats.value,
  'kycSummary',jsonb_build_object('connected',jsonb_build_object('count',(select count(*) from eligible where kyc='connected')),
   'disconnected',jsonb_build_object('count',(select count(*) from eligible where kyc='disconnected')),'unknown',jsonb_build_object('count',(select count(*) from eligible where kyc='unknown'))),
  'rows',coalesce((select jsonb_agg(item order by key) from paged),'[]'::jsonb),'total',(select count(*) from chosen),'offset',v_offset,'limit',v_limit,
  'currency',stats.value->'currency','scopeLabel','已采集存款未到账工单 · 原支付订单核对','kycBasisLabel','AR 按原工单连接字段；新 AR 连接含义未确认，列为待核实',
  'updatedAt',(select max(observed_at) from selected_records),'updatedAtBasis','selected-workorders',
  'coverage',jsonb_build_object('complete',false,'label',case when (select count(*) from selected_records)=0
   then '所选提交日期暂无已采集工单；采集完整性未确认，不代表源后台零单'
   else '统计已采集工单；采集完整性未确认，工单已处理不代表实际到账' end,
   'dateMode',v_dates,'submittedDateFrom',v_start,'submittedDateTo',v_end,
   'expectedPlatforms',(select count(*) from platform_manifest),'platformsWithRecords',(select count(*) from platform_manifest where selected_workorders>0),
   'selectedWorkorders',(select count(*) from selected_records)),
  'sourceManifest',jsonb_build_object('platforms',coalesce((select jsonb_agg(jsonb_build_object('platform',platform,'system',system,
   'selectedWorkorders',selected_workorders,'latestSubmittedDate',latest_submitted_date,'lastObservedAt',last_observed_at,
   'lastObservedBasis','latest-submitted-workorder') order by platform,system)
   from platform_manifest),'[]'::jsonb)),
  'options',jsonb_build_object('platforms',coalesce((select jsonb_agg(x order by x) from(select distinct platform x from platform_manifest)s),'[]'::jsonb),
   'providers',coalesce((select jsonb_agg(x order by x) from(select distinct provider x from cases where provider is not null)s),'[]'::jsonb))
 ) into v_result from stats;
 return v_result;
end;
$collected$;
revoke all on function private.dashboard_admin_deposit_collected_statistics(jsonb) from public,anon,authenticated,service_role;
do $router_guard$
declare before_meta jsonb;after_meta jsonb;
begin
 select to_jsonb(p)-'prosrc' into before_meta from pg_proc p where oid='private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure;
 execute $router_definition$CREATE OR REPLACE FUNCTION private.dashboard_admin_deposit_statistics(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '20s'
AS $function$
begin
 if p_request->>'section'='kyc' then return private.dashboard_admin_deposit_collected_statistics(p_request);end if;
 return private.dashboard_admin_deposit_sheet_statistics_v2(p_request);
end;$function$$router_definition$;
 select to_jsonb(p)-'prosrc' into after_meta from pg_proc p where oid='private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure;
 if before_meta is distinct from after_meta then raise exception 'DEPOSIT_ROUTER_PRIVILEGES_CHANGED';end if;
 if exists(select 1 from pg_proc p where p.oid in ('private.dashboard_admin_deposit_collected_statistics(jsonb)'::regprocedure,'private.dashboard_admin_deposit_collected_summary(jsonb)'::regprocedure)
  and (p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
   or p.proowner<>(select proowner from pg_proc where oid='private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure)
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner))) then raise exception 'COLLECTED_STATISTICS_PRIVILEGES_CHANGED';end if;
end;$router_guard$;
notify pgrst,'reload schema';
commit;
