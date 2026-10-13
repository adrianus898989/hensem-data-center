-- Read only existing covered AR workorder fields; exceptional native keys keep PK fallback.
-- Submission/association/classification/authorization/DTO/ACL remain unchanged; no source writes.
begin;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $patch$
declare
 target regprocedure:=to_regprocedure('private.dashboard_admin_deposit_collected_statistics(jsonb)');
 before_meta jsonb;definition text;body_hash text;
 old_related constant text:=$old_related$), ar_related as materialized (
  select d.country_code,d.platform,d.work_order_id,d.work_order_no,d.payment_order_no,d.amount,d.third_party,d.channel_type,
   d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,d.query_date,d.query_basis,
   k.platform_key,k.target_currency,k.target_country
  from ar_related_keys k join public.ar_workorder_issue_details d on d.system_name='AR' and d.country_code=k.country_code
   and d.platform=k.platform and d.work_order_id=k.work_order_id and d.issue_kind='deposit'
$old_related$;
 new_related constant text:=$new_related$), ar_related_safe_rows as materialized (
  -- Read normal-width records from the existing covering index. Keep every
  -- authorized native key and target context; only unmatched keys read heap.
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
), ar_related as materialized (
  select country_code,platform,work_order_id,work_order_no,payment_order_no,amount,third_party,channel_type,
   kyc_connected,status_code,submitted_date,submitted_at,observed_at,utr,platform_key,target_currency,target_country
  from ar_related_safe_rows where safe_match
  union all
  select d.country_code,d.platform,d.work_order_id,d.work_order_no,d.payment_order_no,d.amount,d.third_party,d.channel_type,
   d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,k.platform_key,k.target_currency,k.target_country
  from ar_fallback_keys k join public.ar_workorder_issue_details d on d.system_name='AR' and d.issue_kind='deposit'
   and d.country_code=k.country_code and d.platform=k.platform and d.work_order_id=k.work_order_id
$new_related$;
 old_seed constant text:=$old_seed$d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,d.query_date,d.query_basis,$old_seed$;
 new_seed constant text:=$new_seed$d.kyc_connected,d.status_code,d.submitted_date,d.submitted_at,d.observed_at,d.utr,$new_seed$;
 old_projection constant text:=$old_projection$false source_conflict,
   d.query_date,d.query_basis$old_projection$;
 new_projection constant text:=$new_projection$false source_conflict$new_projection$;
 old_newar_tail constant text:=$old_newar_tail$jsonb_typeof(d.raw->'rechargeNumber')<>'string'),
   null::date,null::text$old_newar_tail$;
 new_newar_tail constant text:=$new_newar_tail$jsonb_typeof(d.raw->'rechargeNumber')<>'string')$new_newar_tail$;
begin
 if current_user<>'postgres' then raise exception 'deposit_collected_cover_owner_required';end if;
 if target is null or not exists(select 1 from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=target
  and f.proowner='postgres'::regrole and l.lanname='plpgsql' and f.prokind='f' and not f.prosecdef
  and f.provolatile='s' and f.proparallel='u' and not f.proretset and not f.proisstrict and not f.proleakproof
  and f.prorettype='jsonb'::regtype and f.pronargs=1 and f.pronargdefaults=0 and f.provariadic=0
  and f.procost=100 and f.prorows=0 and pg_get_function_arguments(f.oid)='p_request jsonb'
  and f.proconfig=array['search_path=""']::text[]
  and f.proacl::text='{postgres=X/postgres}') then raise exception 'deposit_collected_cover_metadata_drift';end if;
 select to_jsonb(f)-'prosrc',pg_get_functiondef(f.oid),md5(f.prosrc) into before_meta,definition,body_hash from pg_proc f where f.oid=target;
 if body_hash not in ('5ec7a20f4dcec40609781c26b1fa4d79','e6f8a15952fc7549654332e401f29500') then raise exception 'deposit_collected_cover_body_drift';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_collected_summary(jsonb)')) is distinct from 'cb0533ace99068c66a22ffe563914280'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_statistics(jsonb)')) is distinct from '57795c6ea7e81f2bab17b82ff82cff18'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_workorder_provider_batch(jsonb)')) is distinct from '12cc504d23658ed10d677deebb7e7049'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_deposit_platform_key(text,text)')) is distinct from 'e2d393715ea9c1354e5a5cfc5340e39b'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_admin_deposit_kyc_summary_v2(jsonb)')) is distinct from '1f19ef03e91fb555a226c345f587c312' then raise exception 'deposit_collected_cover_dependency_drift';end if;
 if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.ar_workorder_deposit_original_identity_v1_idx') and i.indisvalid and i.indisready and i.indislive and pg_get_indexdef(i.indexrelid)=$index$CREATE INDEX ar_workorder_deposit_original_identity_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, upper(NULLIF(btrim(payment_order_no), ''::text))) INCLUDE (work_order_id, payment_order_no) WHERE ((system_name = 'AR'::text) AND (issue_kind = 'deposit'::text) AND (payment_order_no IS NOT NULL))$index$) then raise exception 'deposit_collected_cover_index_drift';end if;
 if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.newar_workorder_deposit_identity_hash_v1_idx') and i.indisvalid and i.indisready and i.indislive and pg_get_indexdef(i.indexrelid)=$index$CREATE INDEX newar_workorder_deposit_identity_hash_v1_idx ON public.newar_detail_records USING btree (platform, md5(upper(NULLIF(btrim((raw ->> 'depositOrderNo'::text)), ''::text)))) WHERE ((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])) AND (jsonb_typeof((raw -> 'depositOrderNo'::text)) = 'string'::text))$index$) then raise exception 'deposit_collected_cover_index_drift';end if;
 if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.newar_workorder_recharge_identity_hash_v1_idx') and i.indisvalid and i.indisready and i.indislive and pg_get_indexdef(i.indexrelid)=$index$CREATE INDEX newar_workorder_recharge_identity_hash_v1_idx ON public.newar_detail_records USING btree (platform, md5(upper(NULLIF(btrim((raw ->> 'rechargeNumber'::text)), ''::text)))) WHERE ((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])) AND (jsonb_typeof((raw -> 'rechargeNumber'::text)) = 'string'::text))$index$) then raise exception 'deposit_collected_cover_index_drift';end if;
 if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.ar_workorder_deposit_safe_cover_v1_idx') and i.indisvalid and i.indisready and i.indislive and pg_get_indexdef(i.indexrelid)=$cover_index$CREATE INDEX ar_workorder_deposit_safe_cover_v1_idx ON public.ar_workorder_issue_details USING btree (country_code, platform, work_order_id) INCLUDE (work_order_no, payment_order_no, amount, third_party, channel_type, kyc_connected, status_code, submitted_date, submitted_at, observed_at, utr) WHERE ((system_name = 'AR'::text) AND (issue_kind = 'deposit'::text) AND ((((((((octet_length(COALESCE(country_code, ''::text)) + octet_length(COALESCE(platform, ''::text))) + octet_length(COALESCE(work_order_id, ''::text))) + octet_length(COALESCE(work_order_no, ''::text))) + octet_length(COALESCE(payment_order_no, ''::text))) + octet_length(COALESCE(third_party, ''::text))) + octet_length(COALESCE(channel_type, ''::text))) + octet_length(COALESCE(utr, ''::text))) <= 1500))$cover_index$) then raise exception 'deposit_collected_cover_index_drift';end if;
 if body_hash='5ec7a20f4dcec40609781c26b1fa4d79' then
  if (length(definition)-length(replace(definition,old_related,'')))/length(old_related)<>1 then raise exception 'deposit_collected_cover_anchor_drift';end if;
  definition:=replace(definition,old_related,new_related);
  if (length(definition)-length(replace(definition,old_seed,'')))/length(old_seed)<>3 then raise exception 'deposit_collected_cover_anchor_drift';end if;
  definition:=replace(definition,old_seed,new_seed);
  if (length(definition)-length(replace(definition,old_projection,'')))/length(old_projection)<>1 then raise exception 'deposit_collected_cover_anchor_drift';end if;
  definition:=replace(definition,old_projection,new_projection);
  if (length(definition)-length(replace(definition,old_newar_tail,'')))/length(old_newar_tail)<>1 then raise exception 'deposit_collected_cover_anchor_drift';end if;
  definition:=replace(definition,old_newar_tail,new_newar_tail);
  execute definition;
 end if;
 if (select to_jsonb(f)-'prosrc' from pg_proc f where f.oid=target) is distinct from before_meta
  or (select md5(prosrc) from pg_proc where oid=target) is distinct from 'e6f8a15952fc7549654332e401f29500' then raise exception 'deposit_collected_cover_postcondition_drift';end if;
end;
$patch$;
commit;
