-- Preserve collected workorder classification, cross-day evidence and access control.
-- Use existing original-identity indexes; normalize Sheet followup platforms once.
begin;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $patch$
declare
 target regprocedure:=to_regprocedure('private.dashboard_admin_deposit_collected_statistics(jsonb)');
 before_meta jsonb;definition text;body_hash text;
 old_related constant text:=$old_related$), related_identity_maps as materialized (
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
$old_related$;
 new_related constant text:=$new_related$), ar_related_keys as materialized (
  -- Keep cross-day originals and physical-alias peers; only the access path changes.
  select d.country_code,d.platform,d.work_order_id,t.platform_key,t.currency target_currency,t.country target_country
  from ar_targets t join seed_workorders s on s.platform_key=t.platform_key and s.source_system='ar'
  join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=t.country_code
   and d.platform=t.platform and d.work_order_id=s.workorder_id and d.issue_kind='deposit'
  union
  select d.country_code,d.platform,d.work_order_id,t.platform_key,t.currency,t.country
  from ar_targets t join original_keys o on o.platform_key=t.platform_key
  cross join lateral (
   select d.country_code,d.platform,d.work_order_id from public.ar_workorder_issue_details d
   where d.system_name='AR' and d.country_code=t.country_code and d.platform=t.platform and d.issue_kind='deposit'
    and d.payment_order_no is not null and upper(nullif(btrim(d.payment_order_no),''))=o.payment_id
   offset 0
  ) d
), ar_related as materialized (
  select d.country_code,d.platform,d.work_order_id,d.work_order_no,d.payment_order_no,d.amount,d.third_party,d.channel_type,
   d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,d.query_date,d.query_basis,
   k.platform_key,k.target_currency,k.target_country
  from ar_related_keys k join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=k.country_code
   and d.platform=k.platform and d.work_order_id=k.work_order_id and d.issue_kind='deposit'
), newar_related_keys as materialized (
  select d.id,t.platform_key,t.currency target_currency,t.country target_country,t.timezone target_timezone
  from newar_targets t join seed_workorders s on s.platform_key=t.platform_key and s.source_system='newar'
  join public.newar_detail_records d on d.platform=t.platform and d.dataset='workorder' and d.source_id=s.workorder_id
  where d.workorder_type in ('存款未到账','存款未到账自动化') and (t.launch_at is null or d.created_at>=t.launch_at)
  union
  select d.id,t.platform_key,t.currency,t.country,t.timezone
  from newar_targets t join original_keys o on o.platform_key=t.platform_key
  cross join lateral (
   select d.id from public.newar_detail_records d
   where d.platform=t.platform and d.dataset='workorder' and d.workorder_type in ('存款未到账','存款未到账自动化')
    and jsonb_typeof(d.raw->'depositOrderNo')='string'
    and md5(upper(nullif(btrim(d.raw->>'depositOrderNo'),'')))=md5(o.payment_id)
    and upper(nullif(btrim(d.raw->>'depositOrderNo'),''))=o.payment_id
    and (t.launch_at is null or d.created_at>=t.launch_at)
   offset 0
  ) d
  union
  select d.id,t.platform_key,t.currency,t.country,t.timezone
  from newar_targets t join original_keys o on o.platform_key=t.platform_key
  cross join lateral (
   select d.id from public.newar_detail_records d
   where d.platform=t.platform and d.dataset='workorder' and d.workorder_type in ('存款未到账','存款未到账自动化')
    and jsonb_typeof(d.raw->'rechargeNumber')='string'
    and md5(upper(nullif(btrim(d.raw->>'rechargeNumber'),'')))=md5(o.payment_id)
    and upper(nullif(btrim(d.raw->>'rechargeNumber'),''))=o.payment_id
    and (t.launch_at is null or d.created_at>=t.launch_at)
   offset 0
  ) d
), newar_related as materialized (
  select d.platform,d.source_id,d.created_at,d.captured_at,d.amount,d.currency,d.provider,d.channel_type,d.status_code,
   jsonb_build_object('depositOrderNo',d.raw->'depositOrderNo','rechargeNumber',d.raw->'rechargeNumber','utr',d.raw->'utr') raw,
   k.platform_key,k.target_currency,k.target_country,k.target_timezone
  from newar_related_keys k join public.newar_detail_records d on d.id=k.id
$new_related$;
 old_followups constant text:=$old_followups$ followups as materialized (
  select private.dashboard_admin_live_deposit_platform_key('IN',f.platform) platform,upper(btrim(f.order_number)) payment_id,f.amount,count(*) followup_count,
   (array_agg(f.followup_at order by f.followup_date desc nulls last,f.source_row desc))[1] last_followup_at
  from public.admin_deposit_followup_rows f cross join online_identity_maps m
  where f.country='印度' and f.stale_at is null and f.source_kind='sheet' and f.amount is not null and private.dashboard_scope_allows(v_scope,'IN',f.platform)
   and m.amounts->jsonb_build_array(private.dashboard_admin_live_deposit_platform_key('IN',f.platform),upper(btrim(f.order_number)))::text=to_jsonb(f.amount)
  group by 1,2,3
$old_followups$;
 new_followups constant text:=$new_followups$ followup_raw_platforms as materialized (
  select distinct f.platform from public.admin_deposit_followup_rows f
  where f.country='印度' and f.stale_at is null and f.source_kind='sheet' and f.amount is not null
 ), followup_platform_keys as materialized (
  select r.platform raw_platform,private.dashboard_admin_live_deposit_platform_key('IN',r.platform) platform
  from followup_raw_platforms r where private.dashboard_scope_allows(v_scope,'IN',r.platform)
 ), followups as materialized (
  select k.platform,upper(btrim(f.order_number)) payment_id,f.amount,count(*) followup_count,
   (array_agg(f.followup_at order by f.followup_date desc nulls last,f.source_row desc))[1] last_followup_at
  from public.admin_deposit_followup_rows f join followup_platform_keys k on k.raw_platform is not distinct from f.platform
  cross join online_identity_maps m
  where f.country='印度' and f.stale_at is null and f.source_kind='sheet' and f.amount is not null
   and m.amounts->jsonb_build_array(k.platform,upper(btrim(f.order_number)))::text=to_jsonb(f.amount)
  group by 1,2,3
$new_followups$;
begin
 if current_user<>'postgres' then raise exception 'deposit_collected_patch_owner_required';end if;
 if target is null or not exists(select 1 from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=target
  and f.proowner='postgres'::regrole and l.lanname='plpgsql' and f.prokind='f' and not f.prosecdef
  and f.provolatile='s' and f.proparallel='u' and not f.proretset and not f.proisstrict and not f.proleakproof
  and f.prorettype='jsonb'::regtype and f.pronargs=1 and f.pronargdefaults=0 and f.provariadic=0
  and f.procost=100 and f.prorows=0 and pg_get_function_arguments(f.oid)='p_request jsonb'
  and f.proconfig=array['search_path=""']::text[]
  and f.proacl::text='{postgres=X/postgres}') then raise exception 'deposit_collected_patch_metadata_drift';end if;
 select to_jsonb(f)-'prosrc',pg_get_functiondef(f.oid),md5(f.prosrc) into before_meta,definition,body_hash from pg_proc f where f.oid=target;
 if body_hash not in ('949f7b1853f52d13383f98e9814fd3f7','5ec7a20f4dcec40609781c26b1fa4d79') then raise exception 'deposit_collected_patch_body_drift';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_collected_summary(jsonb)')) is distinct from 'cb0533ace99068c66a22ffe563914280'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_statistics(jsonb)')) is distinct from '57795c6ea7e81f2bab17b82ff82cff18'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_workorder_provider_batch(jsonb)')) is distinct from '12cc504d23658ed10d677deebb7e7049'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_deposit_platform_key(text,text)')) is distinct from 'e2d393715ea9c1354e5a5cfc5340e39b'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_kyc_summary_v2(jsonb)')) is distinct from '1f19ef03e91fb555a226c345f587c312' then raise exception 'deposit_collected_patch_dependency_drift';end if;
 if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.ar_workorder_deposit_original_identity_v1_idx') and i.indisvalid and i.indisready and i.indislive and pg_get_indexdef(i.indexrelid)=$index$CREATE INDEX ar_workorder_deposit_original_identity_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, upper(NULLIF(btrim(payment_order_no), ''::text))) INCLUDE (work_order_id, payment_order_no) WHERE ((system_name = 'AR'::text) AND (issue_kind = 'deposit'::text) AND (payment_order_no IS NOT NULL))$index$) then raise exception 'deposit_collected_patch_index_drift';end if;
 if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.newar_workorder_deposit_identity_hash_v1_idx') and i.indisvalid and i.indisready and i.indislive and pg_get_indexdef(i.indexrelid)=$index$CREATE INDEX newar_workorder_deposit_identity_hash_v1_idx ON public.newar_detail_records USING btree (platform, md5(upper(NULLIF(btrim((raw ->> 'depositOrderNo'::text)), ''::text)))) WHERE ((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])) AND (jsonb_typeof((raw -> 'depositOrderNo'::text)) = 'string'::text))$index$) then raise exception 'deposit_collected_patch_index_drift';end if;
 if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.newar_workorder_recharge_identity_hash_v1_idx') and i.indisvalid and i.indisready and i.indislive and pg_get_indexdef(i.indexrelid)=$index$CREATE INDEX newar_workorder_recharge_identity_hash_v1_idx ON public.newar_detail_records USING btree (platform, md5(upper(NULLIF(btrim((raw ->> 'rechargeNumber'::text)), ''::text)))) WHERE ((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])) AND (jsonb_typeof((raw -> 'rechargeNumber'::text)) = 'string'::text))$index$) then raise exception 'deposit_collected_patch_index_drift';end if;
 if body_hash='949f7b1853f52d13383f98e9814fd3f7' then
  if (length(definition)-length(replace(definition,old_related,'')))/length(old_related)<>1
   or (length(definition)-length(replace(definition,old_followups,'')))/length(old_followups)<>1 then raise exception 'deposit_collected_patch_anchor_drift';end if;
  execute replace(replace(definition,old_related,new_related),old_followups,new_followups);
 end if;
 if (select to_jsonb(f)-'prosrc' from pg_proc f where f.oid=target) is distinct from before_meta
  or (select md5(prosrc) from pg_proc where oid=target) is distinct from '5ec7a20f4dcec40609781c26b1fa4d79' then raise exception 'deposit_collected_patch_postcondition_drift';end if;
end;
$patch$;
commit;
