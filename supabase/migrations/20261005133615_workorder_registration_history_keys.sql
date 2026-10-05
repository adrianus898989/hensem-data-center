-- Resolve full original identities with narrow scoped keys; retain every physical
-- alias and cross-day observation. Normalize registration platforms once and
-- avoid wide duplicate materialization. Success semantics and permissions stay.
-- work_mem is scoped to this helper and restores on normal/error return; the
-- authenticated/authenticator 8-second timeout and router timeout stay unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $history_keys$
declare p record;h record;auth_role oid;before_meta jsonb;router_meta jsonb;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_workorder_records(jsonb)');
 select oid into auth_role from pg_roles where rolname='authenticated';
 if p.oid is null or md5(p.prosrc)<>'2fb4df122737456d9d5bbd8307786183'
  or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s' or not p.prosecdef or p.pronargdefaults<>0
  or p.proconfig is distinct from array['search_path=""','statement_timeout=20s']::text[] then raise exception 'REGISTRATION_HISTORY_ROUTER_CHANGED';end if;
 if auth_role is null or not exists(select 1 from aclexplode(p.proacl) a where a.grantee=auth_role and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,auth_role) or a.grantee=auth_role and a.is_grantable) then raise exception 'REGISTRATION_HISTORY_ACL_CHANGED';end if;
 select * into h from pg_proc where oid=to_regprocedure('private.dashboard_admin_workorder_registration(jsonb)');
 if h.oid is null or md5(h.prosrc) not in ('82332dfe28f2103981addfc26c95f12d','7e577b093875df32a36b5f5398b2b639') or h.prosecdef or h.provolatile<>'s' or h.prorettype<>'jsonb'::regtype or h.pronargdefaults<>0
  or h.proowner<>p.proowner or exists(select 1 from aclexplode(coalesce(h.proacl,acldefault('f',h.proowner))) a where a.grantee<>h.proowner)
  or (md5(h.prosrc)='82332dfe28f2103981addfc26c95f12d' and h.proconfig is distinct from array['search_path=""']::text[])
  or (md5(h.prosrc)='7e577b093875df32a36b5f5398b2b639' and h.proconfig is distinct from array['search_path=""','work_mem=32MB']::text[]) then raise exception 'REGISTRATION_HISTORY_HELPER_CHANGED';end if;
 if md5(h.prosrc)='7e577b093875df32a36b5f5398b2b639' then return;end if;
 before_meta:=to_jsonb(h)-'prosrc'-'proconfig';router_meta:=to_jsonb(p);
 execute $definition$
CREATE OR REPLACE FUNCTION private.dashboard_admin_workorder_registration(p_query jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET work_mem TO '32MB'
AS $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();f jsonb:=coalesce(p_query->'filters','{}'::jsonb);
 v_start date;v_end date;v_dates text:='range';v_offset int;v_limit int;v_key text;v text;
 v_basis text:=coalesce(nullif(f->>'successBasis',''),'processed');v_result jsonb;
begin
 if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>12000
  or p_query-array['view','operation','country','filters','offset','limit']<>'{}'::jsonb
  or p_query->>'view' is distinct from 'missing' or coalesce(p_query->>'operation','list')<>'list'
  or coalesce(p_query->>'country','') not in ('IN','印度') or jsonb_typeof(f) is distinct from 'object'
  or f-array['platform','from','to','dateBasis','issueKind','statusCode','workorderId','workorderNo','orderNo','sourceOrderNo','utr','provider','operator','minAmount','maxAmount','kyc','utrMatch','registrationStatus','successBasis']<>'{}'::jsonb then raise exception 'invalid_registration_request';end if;
 for v_key,v in select key,value#>>'{}' from jsonb_each(f) loop
  if jsonb_typeof(f->v_key)<>'string' or length(v)>200 or v<>btrim(v) or v ~ '[[:cntrl:]]' then raise exception 'invalid_registration_filter';end if;
 end loop;
 if v_basis not in ('receipt','processed') or coalesce(f->>'dateBasis','') not in ('','submission')
  or coalesce(f->>'issueKind','') not in ('','deposit') or coalesce(f->>'registrationStatus','') not in ('','missing','matched','review')
  or coalesce(f->>'statusCode','') not in ('','1','2','3','4','5') or coalesce(f->>'kyc','') not in ('','yes','no','unknown')
  or coalesce(f->>'utrMatch','')<>'' or coalesce(f->>'sourceOrderNo','')<>'' or coalesce(f->>'operator','')<>'' then raise exception 'unsupported_registration_filter';end if;
 foreach v_key in array array['minAmount','maxAmount'] loop
  if coalesce(f->>v_key,'')<>'' and f->>v_key !~ '^[0-9]{1,16}([.][0-9]{1,8})?$' then raise exception 'invalid_amount';end if;
 end loop;
 if nullif(f->>'minAmount','')::numeric>nullif(f->>'maxAmount','')::numeric then raise exception 'invalid_amount';end if;
 if coalesce(f->>'from','')='' and coalesce(f->>'to','')='' then v_end:=(now() at time zone 'Asia/Kolkata')::date;v_start:=v_end-30;
 else
  if coalesce(f->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(f->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_dates';end if;
  v_start:=(f->>'from')::date;v_end:=(f->>'to')::date;
  if v_start>v_end or v_end-v_start>92 then raise exception 'invalid_dates';end if;
 end if;
 if p_query ? 'offset' and (jsonb_typeof(p_query->'offset')<>'number' or p_query->>'offset' !~ '^[0-9]{1,7}$')
  or p_query ? 'limit' and (jsonb_typeof(p_query->'limit')<>'number' or p_query->>'limit' !~ '^(20|50|100)$') then raise exception 'invalid_pagination';end if;
 v_offset:=coalesce((p_query->>'offset')::int,0);v_limit:=coalesce((p_query->>'limit')::int,20);
 if v_offset>1000000 then raise exception 'invalid_pagination';end if;
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
   and (coalesce(f->>'platform','') in ('','all')
    or c.platform_key=private.dashboard_admin_live_deposit_platform_key('IN',f->>'platform'))
  group by c.country_code,c.country,c.platform_key,a.platform
), newar_targets as materialized (
  select distinct c.country_code,c.country,c.platform_key,n.platform,n.currency,n.timezone,n.launch_at
  from catalog c join public.newar_detail_platforms n on c.system='newar' and n.platform=c.source_name
   and n.country_code=c.country_code and n.country=c.country and n.enabled
  where (n.launch_at is null or n.launch_at<=statement_timestamp())
   and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
   and (coalesce(f->>'platform','') in ('','all')
    or c.platform_key=private.dashboard_admin_live_deposit_platform_key('IN',f->>'platform'))
), ar_seed_rows as materialized (
  -- Mutually exclusive branches preserve submitted_date precedence and expose
  -- direct submission date/instant predicates to the existing indexes.
  select d.country_code,d.platform,t.platform_key,d.work_order_id,d.payment_order_no
  from ar_targets t join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=t.country_code
   and d.platform=t.platform and d.issue_kind='deposit' where v_dates='all'
  union all
  select d.country_code,d.platform,t.platform_key,d.work_order_id,d.payment_order_no
  from ar_targets t join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=t.country_code
   and d.platform=t.platform and d.issue_kind='deposit'
   and d.submitted_date between v_start and v_end where v_dates='range'
  union all
  select d.country_code,d.platform,t.platform_key,d.work_order_id,d.payment_order_no
  from ar_targets t join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=t.country_code
   and d.platform=t.platform and d.issue_kind='deposit' and d.submitted_date is null
   and d.submitted_at>=(v_start::timestamp at time zone 'Asia/Kolkata')
   and d.submitted_at<((v_end+1)::timestamp at time zone 'Asia/Kolkata') where v_dates='range'
), newar_seed_rows as materialized (
  select d.source_id,t.platform_key,
   jsonb_build_object('depositOrderNo',d.raw->'depositOrderNo','rechargeNumber',d.raw->'rechargeNumber') raw
  from newar_targets t join public.newar_detail_records d on d.platform=t.platform and d.dataset='workorder'
   and (t.launch_at is null or d.created_at>=t.launch_at)
  where d.workorder_type in ('存款未到账','存款未到账自动化') and v_dates='all'
  union all
  select d.source_id,t.platform_key,
   jsonb_build_object('depositOrderNo',d.raw->'depositOrderNo','rechargeNumber',d.raw->'rechargeNumber') raw
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
), ar_related_keys as materialized (
 select d.country_code,d.platform,d.work_order_id,t.platform_key,t.currency target_currency,t.country target_country
 from ar_targets t join original_keys o on o.platform_key=t.platform_key
 join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=t.country_code and d.platform=t.platform
  and d.issue_kind='deposit' and d.payment_order_no is not null and upper(nullif(btrim(d.payment_order_no),''))=o.payment_id
 union
 select s.country_code,s.platform,s.work_order_id,t.platform_key,t.currency,t.country
 from ar_seed_rows s join ar_targets t on t.country_code=s.country_code and t.platform=s.platform
 union
 select d.country_code,d.platform,d.work_order_id,t.platform_key,t.currency,t.country
 from ar_targets t join ar_seed_rows s on s.platform_key=t.platform_key and s.platform<>t.platform
 join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=t.country_code and d.platform=t.platform
  and d.work_order_id=s.work_order_id and d.issue_kind='deposit'
), ar_related_safe_rows as materialized (
 -- Keep every already-authorized key in the estimate. A nullable cover match
 -- identifies only the exceptional keys requiring a source-heap fallback.
 select k.country_code,k.platform,k.work_order_id,d.work_order_no,d.payment_order_no,d.amount,d.third_party,d.channel_type,
   d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,
   k.platform_key,k.target_currency,k.target_country,d.work_order_id is not null safe_match
 from ar_related_keys k left join public.ar_workorder_issue_details d on d.system_name='AR' and d.issue_kind='deposit'
  and d.country_code=k.country_code and d.platform=k.platform and d.work_order_id=k.work_order_id
  and octet_length(coalesce(d.country_code,''))+octet_length(coalesce(d.platform,''))+octet_length(coalesce(d.work_order_id,''))
   +octet_length(coalesce(d.work_order_no,''))+octet_length(coalesce(d.payment_order_no,''))+octet_length(coalesce(d.third_party,''))
   +octet_length(coalesce(d.channel_type,''))+octet_length(coalesce(d.utr,''))<=1500
), ar_fallback_keys as materialized (
 select country_code,platform,work_order_id,platform_key,target_currency,target_country
 from ar_related_safe_rows where not safe_match
), ar_related as not materialized (
 select country_code,platform,work_order_id,work_order_no,payment_order_no,amount,third_party,channel_type,
   kyc_connected,status_code,submitted_date,submitted_at,observed_at,utr,platform_key,target_currency,target_country from ar_related_safe_rows where safe_match
 union all
 select d.country_code,d.platform,d.work_order_id,d.work_order_no,d.payment_order_no,d.amount,d.third_party,d.channel_type,
   d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,k.platform_key,k.target_currency,k.target_country
 from ar_fallback_keys k left join public.ar_workorder_issue_details d on d.system_name='AR' and d.issue_kind='deposit'
  and d.country_code=k.country_code and d.platform=k.platform and d.work_order_id=k.work_order_id
), newar_related_keys as materialized (
 -- Hashes select a bounded candidate set only. The next CTE independently
 -- rechecks full normalized original text before any candidate can be shown.
 select d.platform,d.source_id,t.platform_key,t.currency target_currency,t.country target_country,t.timezone target_timezone
 from newar_targets t join seed_workorders s on s.platform_key=t.platform_key and s.source_system='newar'
 join public.newar_detail_records d on d.platform=t.platform and d.dataset='workorder' and d.source_id=s.workorder_id
 where d.workorder_type in ('存款未到账','存款未到账自动化') and (t.launch_at is null or d.created_at>=t.launch_at)
 union
 select d.platform,d.source_id,t.platform_key,t.currency target_currency,t.country target_country,t.timezone target_timezone
 from newar_targets t join original_keys o on o.platform_key=t.platform_key
 cross join lateral (
  select d.platform,d.source_id from public.newar_detail_records d
  where d.platform=t.platform and d.dataset='workorder'
   and md5(upper(nullif(btrim(d.raw->>'depositOrderNo'),'')))=md5(o.payment_id)
   and d.workorder_type in ('存款未到账','存款未到账自动化') and jsonb_typeof(d.raw->'depositOrderNo')='string'
   and (t.launch_at is null or d.created_at>=t.launch_at)
  offset 0
 ) d
 union
 select d.platform,d.source_id,t.platform_key,t.currency target_currency,t.country target_country,t.timezone target_timezone
 from newar_targets t join original_keys o on o.platform_key=t.platform_key
 cross join lateral (
  select d.platform,d.source_id from public.newar_detail_records d
  where d.platform=t.platform and d.dataset='workorder'
   and md5(upper(nullif(btrim(d.raw->>'rechargeNumber'),'')))=md5(o.payment_id)
   and d.workorder_type in ('存款未到账','存款未到账自动化') and jsonb_typeof(d.raw->'rechargeNumber')='string'
   and (t.launch_at is null or d.created_at>=t.launch_at)
  offset 0
 ) d
), newar_related as materialized (
 select d.platform,d.source_id,d.created_at,d.captured_at,d.amount,d.currency,d.provider,d.channel_type,d.status_code,
   jsonb_build_object('depositOrderNo',d.raw->'depositOrderNo','rechargeNumber',d.raw->'rechargeNumber','utr',d.raw->'utr') raw,
   k.platform_key,k.target_currency,k.target_country,k.target_timezone
 from newar_related_keys k left join public.newar_detail_records d on d.platform=k.platform and d.dataset='workorder' and d.source_id=k.source_id
 where (k.platform_key,d.source_id) in(select platform_key,workorder_id from seed_workorders where source_system='newar')
  or jsonb_typeof(d.raw->'depositOrderNo')='string' and (k.platform_key,upper(nullif(btrim(d.raw->>'depositOrderNo'),''))) in(select platform_key,payment_id from original_keys)
  or jsonb_typeof(d.raw->'rechargeNumber')='string' and (k.platform_key,upper(nullif(btrim(d.raw->>'rechargeNumber'),''))) in(select platform_key,payment_id from original_keys)
), projected as not materialized (
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
   d.status_code::text source_status_code
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
   d.status_code::text
  from newar_related d cross join lateral(select
   case when jsonb_typeof(d.raw->'depositOrderNo')='string' then upper(nullif(btrim(d.raw->>'depositOrderNo'),'')) end deposit_ref,
   case when jsonb_typeof(d.raw->'rechargeNumber')='string' then upper(nullif(btrim(d.raw->>'rechargeNumber'),'')) end recharge_ref) r
), provider_inputs as materialized (
 select target_country country,platform,coalesce(nullif(btrim(third_party),''),'未识别三方') raw_provider,nullif(btrim(channel_type),'') channel_type from ar_related
 union
 select target_country,platform,coalesce(nullif(btrim(provider),''),'未识别三方'),nullif(btrim(channel_type),'') from newar_related
), provider_names as materialized (
 select * from private.dashboard_admin_live_workorder_provider_batch((select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from provider_inputs x))
), provider_mapping as materialized (
  select coalesce(jsonb_object_agg(jsonb_build_array(country,platform,raw_provider,channel_type)::text,provider),'{}'::jsonb) names from provider_names
), provider_pairs as materialized (
 select p.key,p.value provider from provider_mapping m cross join lateral jsonb_each_text(m.names) p
), mapped as materialized (
  -- Expand the final mapping object once into unique keys. A left join has
  -- exactly the same absent/null semantics as the previous JSON text lookup.
  select d.wo_key,d.source_system,d.platform,d.workorder_id,d.workorder_no,d.payment_id,d.payment_references,d.submitted_date,d.submitted_at,d.observed_at,d.amount,d.currency,d.kyc,d.processing,d.source_workorder_state,d.utr_digest,d.utr_present,d.source_conflict,d.source_status_code,p.provider,regexp_replace(lower(btrim(coalesce(p.provider,''))),'[[:space:]_-]+','','g')
   in ('','未标记三方','未识别三方','未识别通道','未分类三方','未提供','unknown','unmarked') unknown_provider
  from projected d left join provider_pairs p on p.key=jsonb_build_array(d.country,d.raw_platform,d.raw_provider,d.channel_type)::text
), single_wo_keys as materialized (
 select wo_key from mapped group by wo_key having count(*)=1
), wo_groups as materialized (
 select d.wo_key,d.platform,d.workorder_id,d.workorder_no,1::bigint export_rows,
  d.payment_id,coalesce(d.kyc,'unknown') kyc,
  case when d.processing is not null and not d.source_conflict then d.processing else 'unknown' end processing,
  coalesce(d.source_workorder_state,'源状态有变化') source_workorder_state,
  d.amount,d.currency,
  case when not d.unknown_provider then coalesce(d.provider,'未提供') else '未提供' end provider,
  d.provider is null or d.unknown_provider is distinct from false unknown_provider,
  d.submitted_date,d.submitted_at,d.observed_at,d.source_system,
  d.source_conflict identity_conflict,d.source_conflict,
  d.utr_digest,d.utr_present,false utr_conflict
 from mapped d where d.wo_key in(select wo_key from single_wo_keys)
 union all
 select wo_key,min(platform) platform,min(workorder_id) workorder_id,
   string_agg(distinct workorder_no,', ' order by workorder_no) workorder_no,
   count(*) export_rows,
   case when min(coalesce(payment_id,'(missing)'))=max(coalesce(payment_id,'(missing)')) then min(payment_id) end payment_id,
   case when min(kyc)=max(kyc) then min(kyc) else 'unknown' end kyc,
   case when min(processing)=max(processing) and not bool_or(source_conflict) then min(processing) else 'unknown' end processing,
   case when min(source_workorder_state)=max(source_workorder_state) then min(source_workorder_state) else '源状态有变化' end source_workorder_state,
   case when min(coalesce(amount::text,'(missing)'))=max(coalesce(amount::text,'(missing)')) then min(amount) end amount,
   case when min(coalesce(currency,'(missing)'))=max(coalesce(currency,'(missing)')) then min(currency) end currency,
   case when min(provider) filter(where not unknown_provider)=max(provider) filter(where not unknown_provider)
     then min(provider) filter(where not unknown_provider)
    when coalesce(min(provider) filter(where not unknown_provider)<>max(provider) filter(where not unknown_provider),false)
     then '来源冲突' else '未提供' end provider,
   min(provider) filter(where not unknown_provider) is null unknown_provider,
   case when min(coalesce(submitted_date::text,'(missing)'))=max(coalesce(submitted_date::text,'(missing)')) then min(submitted_date) end submitted_date,
   min(submitted_at) submitted_at,max(observed_at) observed_at,min(source_system) source_system,
   bool_or(source_conflict) or min(coalesce(payment_id,'(missing)'))<>max(coalesce(payment_id,'(missing)')) identity_conflict,
   bool_or(source_conflict) or min(coalesce(amount::text,'(missing)'))<>max(coalesce(amount::text,'(missing)'))
    or min(coalesce(payment_id,'(missing)'))<>max(coalesce(payment_id,'(missing)'))
    or coalesce(min(provider) filter(where not unknown_provider)<>max(provider) filter(where not unknown_provider),false) source_conflict,
   case when min(utr_digest)=max(utr_digest) then min(utr_digest) end utr_digest,
   bool_or(utr_present) utr_present,coalesce(min(utr_digest)<>max(utr_digest),false) utr_conflict
 from mapped where wo_key not in(select wo_key from single_wo_keys) group by wo_key
), reference_observations as materialized (
  select distinct m.wo_key,m.platform,ref payment_reference from mapped m join wo_groups g using(wo_key) cross join lateral unnest(m.payment_references) ref where g.payment_id is null or g.identity_conflict
), workorder_references as materialized (
  select wo_key,array_agg(distinct payment_reference order by payment_reference) payment_references from reference_observations group by wo_key
), wo as not materialized (
  select g.*,case when g.payment_id is not null and not g.identity_conflict then array[g.payment_id] else coalesce(r.payment_references,'{}'::text[]) end payment_references from wo_groups g left join workorder_references r using(wo_key)
), keyed as materialized (
  select d.*,jsonb_build_array(d.platform,coalesce(d.payment_id,'WORKORDER:'||d.wo_key))::text case_key from wo d
), case_base as materialized (
  select case_key,min(platform) platform,min(payment_id) payment_id,
   case when min(coalesce(amount::text,'(missing)'))=max(coalesce(amount::text,'(missing)')) and not bool_or(source_conflict) then min(amount) end amount,
   case when min(coalesce(currency,'(missing)'))=max(coalesce(currency,'(missing)')) then min(currency) end currency,
   case when min(provider) filter(where not unknown_provider)=max(provider) filter(where not unknown_provider) then min(provider) filter(where not unknown_provider)
    when coalesce(min(provider) filter(where not unknown_provider)<>max(provider) filter(where not unknown_provider),false) then '来源冲突' else '未提供' end provider,
   case when min(processing)=max(processing) then min(processing) else 'unknown' end case_processing,
   bool_or(source_conflict) or min(coalesce(amount::text,'(missing)'))<>max(coalesce(amount::text,'(missing)'))
    or coalesce(min(provider) filter(where not unknown_provider)<>max(provider) filter(where not unknown_provider),false) source_conflict,
   case when min(utr_digest)=max(utr_digest) then min(utr_digest) end utr_digest,
   bool_or(utr_present) utr_present,bool_or(utr_conflict) or coalesce(min(utr_digest)<>max(utr_digest),false) utr_conflict,count(*) related_workorders,sum(export_rows) related_records,
   count(*) workorder_count,max(submitted_at) submitted_at,max(observed_at) collected_at,
   bool_or(processing='processed' and not identity_conflict) processed_success
  from keyed group by case_key
), reference_conflicts as materialized (
  -- Conflicting explicit references never choose one original. Preserve their
  -- ambiguity on every selected exact original they could identify instead.
  select distinct c.case_key,w.wo_key,w.export_rows
  from case_base c join reference_observations m on m.platform=c.platform and c.payment_id=m.payment_reference
  join keyed w on w.wo_key=m.wo_key where c.payment_id is not null and w.payment_id is null and w.source_conflict
  union
  select ambiguous.case_key,related.wo_key,related.export_rows
  from keyed ambiguous join reference_observations refs on refs.wo_key=ambiguous.wo_key
  join keyed related on related.platform=ambiguous.platform and related.payment_id=refs.payment_reference
  where ambiguous.payment_id is null and ambiguous.source_conflict and related.wo_key<>ambiguous.wo_key
), reference_conflict_totals as materialized (
  select case_key,count(*) n,sum(export_rows) records from reference_conflicts group by case_key
), cases as not materialized (
  select c.case_key,c.platform,c.payment_id,
   case when coalesce(f.n,0)=0 then c.amount end amount,c.currency,c.provider,c.case_processing,
   c.source_conflict or coalesce(f.n,0)>0 source_conflict,c.utr_digest,c.utr_present,c.utr_conflict,
   c.related_workorders+coalesce(f.n,0) related_workorders,c.related_records+coalesce(f.records,0) related_records,coalesce(f.n,0) reference_conflict_workorders,
   c.workorder_count,c.submitted_at,c.collected_at,c.processed_success
  from case_base c left join reference_conflict_totals f using(case_key)
), selected_workorders as materialized (
 select w.case_key,w.wo_key,w.kyc from keyed w where exists(select 1 from seed_keys s where s.wo_key=w.wo_key)
), candidate_cases as materialized (
 select c.* from cases c where exists(select 1 from selected_workorders w where w.case_key=c.case_key)
  and (coalesce(f->>'orderNo','')='' or strpos(lower(coalesce(c.payment_id,'')),lower(f->>'orderNo'))>0
   or exists(select 1 from keyed w cross join lateral unnest(w.payment_references) ref where w.case_key=c.case_key and strpos(lower(ref),lower(f->>'orderNo'))>0))
  and (coalesce(f->>'workorderNo','')='' or exists(select 1 from keyed w where w.case_key=c.case_key and
   (strpos(lower(coalesce(w.workorder_no,'')),lower(f->>'workorderNo'))>0 or strpos(lower(w.workorder_id),lower(f->>'workorderNo'))>0)))
  and (coalesce(f->>'workorderId','')='' or exists(select 1 from keyed w where w.case_key=c.case_key and strpos(lower(w.workorder_id),lower(f->>'workorderId'))>0))
  and (coalesce(f->>'provider','')='' or strpos(lower(coalesce(c.provider,'')),lower(f->>'provider'))>0)
  and (coalesce(f->>'minAmount','')='' or c.amount>=(f->>'minAmount')::numeric)
  and (coalesce(f->>'maxAmount','')='' or c.amount<=(f->>'maxAmount')::numeric)
  and (coalesce(f->>'utr','')='' or c.utr_digest=encode(sha256(convert_to(btrim(f->>'utr'),'UTF8')),'hex'))
  and (coalesce(f->>'kyc','')='' or exists(select 1 from selected_workorders w where w.case_key=c.case_key and w.kyc=case f->>'kyc' when 'yes' then 'connected' when 'no' then 'disconnected' else 'unknown' end))
  and (coalesce(f->>'statusCode','')='' or exists(select 1 from mapped w where w.wo_key in(select s.wo_key from selected_workorders s where s.case_key=c.case_key)
   and w.source_status_code=f->>'statusCode'))
), directory_teams as materialized (
 select private.dashboard_admin_live_deposit_platform_key('IN',p.source_name) platform,
  case when bool_and(nullif(btrim(p.team),'') is not null) and count(distinct btrim(p.team))=1 then min(btrim(p.team)) end team
 from private.dashboard_admin_live_platforms() p where p.scope_group='IN' and p.country='印度' and lower(p.source) in ('ar','newar')
  and private.dashboard_scope_allows(v_scope,'IN',p.source_name)
  and private.dashboard_admin_live_deposit_platform_key('IN',p.source_name) in (select platform_key from ar_targets union select platform_key from newar_targets)
 group by 1
), registration_candidates as materialized (
 select case_key,platform,amount,payment_id from candidate_cases c where not (v_basis='processed' and c.payment_id is not null and coalesce(c.processed_success,false))
), candidate_identifiers as materialized (
 select c.case_key,c.platform,c.amount case_amount,c.payment_id case_payment_id,'order'::text kind,c.payment_id identifier from registration_candidates c where c.payment_id is not null
 union
 select c.case_key,c.platform,c.amount,c.payment_id,'workorder',upper(btrim(ref.identifier))
 from registration_candidates c join keyed w using(case_key) join mapped m using(wo_key)
 cross join lateral(values(m.workorder_id),(m.workorder_no)) ref(identifier)
 where nullif(btrim(ref.identifier),'') is not null
), registration_platform_values as materialized (
 select distinct e.platform,e.source_kind,e.portal_team from public.admin_deposit_followup_rows e
 where e.country in ('IN','印度') and e.stale_at is null and e.source_kind in ('sheet','portal')
 union
 select distinct e.platform,'result_sheet',null::text from public.admin_deposit_issue_rows e
 where e.country in ('IN','印度') and e.stale_at is null
), registration_platform_keys as materialized (
 select r.*,private.dashboard_admin_live_deposit_platform_key('IN',r.platform) platform_key from registration_platform_values r
), authorized_registration_platforms as materialized (
 select distinct r.platform raw_platform,r.platform_key platform,t.team
 from registration_platform_keys r join directory_teams t on t.platform=r.platform_key
 where private.dashboard_scope_allows(v_scope,'IN',r.platform)
  and (r.source_kind in ('sheet','result_sheet') or r.source_kind='portal' and t.team is not null and r.portal_team=t.team)
), registration_rows as materialized (
 select e.id source_id,e.source_kind,p.platform,e.source_sheet,e.source_tab,e.source_gid,e.source_row,
  upper(nullif(btrim(e.order_number),'')) order_no,e.work_order_number workorder_no,e.amount,'INR'::text currency,
  case when e.source_kind='portal' then coalesce(nullif(e.portal_payload->'entry'->>'outcome',''),e.followup_status) else e.followup_status end status,
  case when e.source_kind='portal' then coalesce(nullif(e.portal_payload->'entry'->>'outcome',''),e.followup_status) else e.followup_status end outcome,
  coalesce(e.source_updated_at,e.updated_at) updated_at,
  array(select distinct upper(btrim(x)) from unnest(array[e.work_order_number]||case when e.source_kind='portal' and jsonb_typeof(e.portal_payload->'workorders')='array'
   then array(select value from jsonb_array_elements_text(e.portal_payload->'workorders')) else '{}'::text[] end) x where nullif(btrim(x),'') is not null) workorder_refs
 from public.admin_deposit_followup_rows e join authorized_registration_platforms p on p.raw_platform=e.platform

 where e.country in ('IN','印度') and e.stale_at is null and e.source_kind in ('sheet','portal')
  and (e.source_kind='sheet' or p.team is not null and e.portal_team=p.team)
  and ((p.platform,'order',upper(nullif(btrim(e.order_number),''))) in(select platform,kind,identifier from candidate_identifiers)
   or (p.platform,'workorder',upper(nullif(btrim(e.work_order_number),''))) in(select platform,kind,identifier from candidate_identifiers)
   or e.source_kind='portal' and exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(e.portal_payload->'workorders')='array' then e.portal_payload->'workorders' else '[]'::jsonb end) x
    where (p.platform,'workorder',upper(nullif(btrim(x),''))) in(select platform,kind,identifier from candidate_identifiers)))
 union all
 select e.id,'result_sheet',p.platform,e.source_sheet,e.source_tab,null::bigint,e.source_row,upper(nullif(btrim(e.order_number),'')),null::text,e.amount,'INR',
  e.status,e.confirmation_status,coalesce(e.source_updated_at,e.updated_at),'{}'::text[]
 from public.admin_deposit_issue_rows e join authorized_registration_platforms p on p.raw_platform=e.platform
 where e.country in ('IN','印度') and e.stale_at is null and (p.platform,'order',upper(nullif(btrim(e.order_number),''))) in(select platform,kind,identifier from candidate_identifiers)
), registration_keys as materialized (
 -- Carry already-scoped evidence through exact-key matching. Rejoining the
 -- small-estimate CTE by source id can compare every registration to every case.
 select r.*,'order'::text kind,r.order_no identifier from registration_rows r where r.order_no is not null
 union
 select r.*,'workorder',ref from registration_rows r cross join lateral unnest(r.workorder_refs) ref
), registration_links as materialized (
 select distinct c.case_key,c.case_amount,c.case_payment_id,
  r.source_id,r.source_kind,r.platform,r.source_sheet,r.source_tab,r.source_gid,r.source_row,
  r.order_no,r.workorder_no,r.amount,r.currency,r.status,r.outcome,r.updated_at,r.workorder_refs
 from candidate_identifiers c join registration_keys r using(platform,kind,identifier)
), evidence as materialized (
 select r.*,r.case_amount is not null and r.amount is not null and r.case_amount<>r.amount amount_conflict,
  r.case_payment_id is not null and r.order_no is not null and r.case_payment_id<>r.order_no identifier_conflict,
  case when r.source_kind='result_sheet' then case when r.outcome='已入款' then 'success'
    when r.status='未入款' or r.outcome in ('入其他订单','转其他三方') then 'pending' else 'unknown' end
   when lower(btrim(coalesce(r.outcome,''))) in ('success','成功','成功到账','已入款') then 'success'
   when lower(btrim(coalesce(r.outcome,''))) in ('pending','not yet received','尚未收到','尚未到账','未入款','need_evidence','need to provide pdf/video','other_id','other_platform','other_order','success to other id','success to other platform','success to other order','over30','over15','refund','more than 30days/refund','more than 15days refund','no_refund','no refund','save upi / no refund','appeal','save account contact appeal') then 'pending'
   else 'unknown' end receipt_mark,
  row_number() over(partition by r.case_key order by r.updated_at desc nulls last,r.source_kind,r.source_id) evidence_pos
 from registration_links r
), registration_summary as materialized (
 select case_key,count(*) n,bool_or(amount_conflict) amount_conflict,bool_or(identifier_conflict) identifier_conflict,
  bool_or(receipt_mark='success') success_mark,bool_or(receipt_mark='pending') pending_mark,
  jsonb_agg(distinct source_kind) sources
 from evidence group by case_key
), processing_conflicts as materialized (
 select distinct case_key from keyed where processing='unknown' and source_workorder_state='源状态有变化'
), evaluated as not materialized (
 select c.*,coalesce(r.n,0) registration_count,coalesce(r.sources,'[]'::jsonb) registration_sources,
  case when coalesce(r.success_mark,false) and (coalesce(r.pending_mark,false) or coalesce(r.amount_conflict,false) or coalesce(r.identifier_conflict,false) or c.source_conflict) then 'conflict'
   when coalesce(r.success_mark,false) then 'success_marked' when coalesce(r.pending_mark,false) then 'pending_marked' else 'unknown' end receipt_state,
  case when c.payment_id is null or c.source_conflict or v_basis='processed' and p.case_key is not null or coalesce(r.identifier_conflict,false) or coalesce(r.amount_conflict,false)
    or coalesce(r.success_mark,false) and coalesce(r.pending_mark,false) then 'review'
   when coalesce(r.n,0)>0 then 'matched'
   when not exists(select 1 from authorized_registration_platforms p where p.platform=c.platform) then 'review' else 'missing' end registration_status,
  case when c.payment_id is null then 'no_identifiers' when c.source_conflict then 'source_conflict'
   when v_basis='processed' and p.case_key is not null then 'processing_conflict'
   when coalesce(r.identifier_conflict,false) then 'identifier_conflict' when coalesce(r.amount_conflict,false) then 'amount_conflict'
   when coalesce(r.success_mark,false) and coalesce(r.pending_mark,false) then 'receipt_conflict'
   when coalesce(r.n,0)>0 then 'matched' when not exists(select 1 from authorized_registration_platforms p where p.platform=c.platform) then 'source_unavailable' else 'no_registration' end reason
 from candidate_cases c left join registration_summary r using(case_key) left join processing_conflicts p using(case_key)
), classified as materialized (
 select e.*,case when v_basis='receipt' then receipt_state='success_marked'
  else e.payment_id is not null and coalesce(e.processed_success,false) end excluded_success
 from evaluated e
), pending as materialized(select * from classified where not excluded_success),
 selected as materialized(select * from pending where coalesce(f->>'registrationStatus','')='' or registration_status=f->>'registrationStatus'),
 paged_keys as materialized (
 -- These fields were aggregated once with the original case. Paginate without
 -- rejoining the entire workorder population when cardinality is underestimated.
 select c.* from selected c
 order by c.submitted_at desc nulls last,c.platform,c.case_key offset v_offset limit v_limit
), page_workorder_rows as materialized (
 select w.*,row_number() over(partition by w.case_key order by w.submitted_at desc nulls last,w.wo_key) evidence_pos
 from keyed w join paged_keys p using(case_key)
), page_workorders as materialized (
 select case_key,jsonb_agg(distinct source_system) systems,jsonb_agg(distinct source_workorder_state) states,
  jsonb_agg(jsonb_build_object('sourceSystem',source_system,'workorderId',workorder_id,'workorderNo',workorder_no,'orderNo',payment_id,
   'state',source_workorder_state,'processing',processing,'submittedAt',submitted_at,'collectedAt',observed_at,'amount',amount,'currency',currency)
   order by evidence_pos) filter(where evidence_pos<=100) workorders
 from page_workorder_rows group by case_key
), page_evidence as materialized (
 select e.case_key,jsonb_agg(jsonb_build_object('sourceKind',source_kind,'sourceSheet',source_sheet,'sourceGid',source_gid,'sourceTab',source_tab,'sourceRow',source_row,'sourceId',source_id,
   'orderNo',order_no,'workorderNo',workorder_no,'amount',e.amount,'currency',e.currency,'status',status,'outcome',outcome,'updatedAt',updated_at,'receiptMark',receipt_mark)
   order by evidence_pos) evidence
 from evidence e join paged_keys p using(case_key) where evidence_pos<=40 group by e.case_key
), paged as (
 select p.*,w.systems,w.states,w.workorders,coalesce(e.evidence,'[]'::jsonb) registration_evidence
 from paged_keys p join page_workorders w using(case_key) left join page_evidence e using(case_key)
), platform_coverage as (
 select t.platform,count(distinct s.wo_key) selected_workorders,exists(select 1 from authorized_registration_platforms p where p.platform=t.platform) registration_present
 from (select distinct platform_key platform from ar_targets union select distinct platform_key from newar_targets) t
 left join seed_keys s on s.platform_key=t.platform group by t.platform
)
 select jsonb_build_object('ok',true,'version',2,'view','missing','sourceStatus','ready','source','collected-registration-reconciliation','country','印度','countryCode','IN','currency','INR','timezone','Asia/Kolkata',
  'successBasis',v_basis,'dateBasis','submission','offset',v_offset,'limit',v_limit,'total',(select count(*) from selected),
  'platforms',coalesce((select jsonb_agg(platform order by platform) from platform_coverage),'[]'::jsonb),
  'summary',(select jsonb_build_object('candidateCount',(select count(*) from classified),'pendingCount',count(*),'excludedSuccessCount',(select count(*) from classified where excluded_success),
   'missingCount',count(*) filter(where registration_status='missing'),'matchedCount',count(*) filter(where registration_status='matched'),'reviewCount',count(*) filter(where registration_status='review'),
   'missingAmount',case when count(*) filter(where registration_status='missing' and amount is null)=0 then coalesce(sum(amount) filter(where registration_status='missing'),0) end,
   'missingAmountExact',(case when count(*) filter(where registration_status='missing' and amount is null)=0 then coalesce(sum(amount) filter(where registration_status='missing'),0) end)::text,
   'matchedAmount',case when count(*) filter(where registration_status='matched' and amount is null)=0 then coalesce(sum(amount) filter(where registration_status='matched'),0) end,
   'matchedAmountExact',(case when count(*) filter(where registration_status='matched' and amount is null)=0 then coalesce(sum(amount) filter(where registration_status='matched'),0) end)::text,
   'reviewAmount',case when count(*) filter(where registration_status='review' and amount is null)=0 then coalesce(sum(amount) filter(where registration_status='review'),0) end,
   'reviewAmountExact',(case when count(*) filter(where registration_status='review' and amount is null)=0 then coalesce(sum(amount) filter(where registration_status='review'),0) end)::text,
   'unknownAmountCount',count(*) filter(where amount is null),'latestCollectedAt',(select max(collected_at) from candidate_cases)) from pending),
  'coverage',jsonb_build_object('complete',false,'registrationSnapshotComplete',false,'expectedPlatforms',(select count(*) from platform_coverage),
   'platformsWithRecords',(select count(*) from platform_coverage where selected_workorders>0),'label','仅核对已采集存款工单；未找到登记表示当前镜像未匹配，来源完整性未确认；工单已处理与实际入款分别展示',
   'platforms',coalesce((select jsonb_agg(jsonb_build_object('platform',platform,'selectedWorkorders',selected_workorders,'registrationPresent',registration_present) order by platform) from platform_coverage),'[]'::jsonb)),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',md5(p.case_key),'platform',p.platform,'orderNo',p.payment_id,'issueKind','deposit','amount',p.amount,'currency',p.currency,'provider',p.provider,
   'workorderCount',p.workorder_count,'workorders',p.workorders,'workordersTruncated',p.workorder_count>100,'sourceSystems',p.systems,'processingState',p.case_processing,'processingStates',p.states,
   'registrationStatus',p.registration_status,'registrationSources',p.registration_sources,'registrationMatchCount',p.registration_count,
   'registrationEvidence',p.registration_evidence,'receiptEvidence',p.registration_evidence,'evidenceTruncated',p.registration_count>40,
   'receiptState',p.receipt_state,'sourceConflict',p.source_conflict,'reason',p.reason,'submittedAt',p.submitted_at,'collectedAt',p.collected_at,
   'readOnly',true,'retained',true) order by p.submitted_at desc nulls last,p.platform,p.case_key) from paged p),'[]'::jsonb)) into v_result;
 return v_result;
end;$function$


$definition$;
 if (select to_jsonb(f)-'prosrc'-'proconfig' from pg_proc f where f.oid=h.oid) is distinct from before_meta
  or (select to_jsonb(f) from pg_proc f where f.oid=p.oid) is distinct from router_meta then raise exception 'REGISTRATION_HISTORY_METADATA_CHANGED';end if;
 if (select md5(prosrc) from pg_proc where oid=h.oid)<>'7e577b093875df32a36b5f5398b2b639'
  or (select proconfig from pg_proc where oid=h.oid) is distinct from array['search_path=""','work_mem=32MB']::text[] then raise exception 'REGISTRATION_HISTORY_RESULT_CHANGED';end if;
end;$history_keys$;
commit;
