-- Production function definitions only; no records or credentials.
CREATE OR REPLACE FUNCTION private.newar_stats_time(p_text text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
BEGIN
 IF p_text IS NULL OR p_text !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' THEN RETURN NULL; END IF;
 RETURN p_text::timestamptz;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION private.ingest_newar_detail_batch(p_token_hash text, p_batch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$-- NEWAR_WORKORDER_ORIGINAL_PRESERVE_V1

declare
  credential private.newar_detail_credentials%rowtype;
  receipt private.newar_detail_batches%rowtype;
  v_batch_id uuid; v_payload_hash text; received integer; written integer;
begin
  select * into credential from private.newar_detail_credentials where token_hash=p_token_hash for share;
  if not found or credential.revoked or credential.expires_at<=clock_timestamp() then
    raise exception using errcode='28000',message='NEWAR_AUTH_INVALID';
  end if;
  perform private.newar_detail_assert_batch(p_batch);
  if not credential.allowed_scopes @> jsonb_build_array(jsonb_build_object(
    'platform',p_batch->>'platform','dataset',p_batch->>'dataset')) then
    raise exception using errcode='42501',message='NEWAR_SCOPE_DENIED';
  end if;
  v_batch_id:=(p_batch->>'batch_id')::uuid;
  v_payload_hash:=encode(sha256(convert_to(p_batch::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('newar-detail-batch:'||v_batch_id::text,0));
  select * into receipt from private.newar_detail_batches b where b.batch_id=v_batch_id;
  if found then
    if receipt.payload_hash<>v_payload_hash then raise exception using errcode='23505',message='NEWAR_BATCH_CONFLICT'; end if;
    return jsonb_build_object('ok',true,'batch_id',v_batch_id,'status','unchanged',
      'received_count',receipt.received_count,'written_count',receipt.written_count,'stale_count',receipt.stale_count);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('newar-detail-scope:'||(p_batch->>'platform')||':'||(p_batch->>'dataset'),0));
  received:=jsonb_array_length(p_batch->'records');
  insert into public.newar_detail_records as old (platform,dataset,source_id,member_id,order_number,third_party_order_number,
    provider,provider_id,channel_type,currency,amount,actual_amount,fee,status_code,status_group,created_at,success_at,
    processed_at,source_updated_at,captured_at,workorder_type,operator,followup_count,raw)
  select p_batch->>'platform',p_batch->>'dataset',r->>'source_id',r->>'member_id',r->>'order_number',r->>'third_party_order_number',
    r->>'provider',r->>'provider_id',r->>'channel_type',r->>'currency',(r->>'amount')::numeric,(r->>'actual_amount')::numeric,
    (r->>'fee')::numeric,r->>'status_code',r->>'status_group',(r->>'created_at')::timestamptz,(r->>'success_at')::timestamptz,
    (r->>'processed_at')::timestamptz,(r->>'source_updated_at')::timestamptz,(r->>'captured_at')::timestamptz,
    r->>'workorder_type',r->>'operator',(r->>'followup_count')::integer,r->'raw'
  from jsonb_array_elements(p_batch->'records') r order by r->>'source_id'
  on conflict(platform,dataset,source_id) do update set
    member_id=excluded.member_id,order_number=case when (old.dataset='workorder' and excluded.dataset='workorder'
      and nullif(btrim(excluded.order_number),'') is null
      and (excluded.raw->'depositOrderNo' is null or excluded.raw->'depositOrderNo'='null'::jsonb
        or jsonb_typeof(excluded.raw->'depositOrderNo')='string' and nullif(btrim(excluded.raw->>'depositOrderNo'),'') is null)
      and (excluded.raw->'rechargeNumber' is null or excluded.raw->'rechargeNumber'='null'::jsonb
        or jsonb_typeof(excluded.raw->'rechargeNumber')='string' and nullif(btrim(excluded.raw->>'rechargeNumber'),'') is null)
      and not (coalesce(jsonb_typeof(old.raw->'depositOrderNo')='string' and (old.raw->>'depositOrderNo') ~ '^RC[A-Za-z0-9_-]{1,198}$',false)
        and coalesce(jsonb_typeof(old.raw->'rechargeNumber')='string' and (old.raw->>'rechargeNumber') ~ '^RC[A-Za-z0-9_-]{1,198}$',false)
        and old.raw->>'depositOrderNo'<>old.raw->>'rechargeNumber')
      and coalesce(
      case when jsonb_typeof(old.raw->'depositOrderNo')='string' and (old.raw->>'depositOrderNo') ~ '^RC[A-Za-z0-9_-]{1,198}$' then old.raw->>'depositOrderNo' end,
      case when jsonb_typeof(old.raw->'rechargeNumber')='string' and (old.raw->>'rechargeNumber') ~ '^RC[A-Za-z0-9_-]{1,198}$' then old.raw->>'rechargeNumber' end) is not null) then coalesce(
      case when jsonb_typeof(old.raw->'depositOrderNo')='string' and (old.raw->>'depositOrderNo') ~ '^RC[A-Za-z0-9_-]{1,198}$' then old.raw->>'depositOrderNo' end,
      case when jsonb_typeof(old.raw->'rechargeNumber')='string' and (old.raw->>'rechargeNumber') ~ '^RC[A-Za-z0-9_-]{1,198}$' then old.raw->>'rechargeNumber' end) else excluded.order_number end,third_party_order_number=excluded.third_party_order_number,
    provider=excluded.provider,provider_id=excluded.provider_id,channel_type=excluded.channel_type,currency=excluded.currency,
    amount=excluded.amount,actual_amount=excluded.actual_amount,fee=excluded.fee,status_code=excluded.status_code,status_group=excluded.status_group,
    created_at=excluded.created_at,success_at=excluded.success_at,processed_at=excluded.processed_at,
    source_updated_at=excluded.source_updated_at,captured_at=excluded.captured_at,
    workorder_type=excluded.workorder_type,operator=excluded.operator,followup_count=excluded.followup_count,
    raw=case when (old.dataset='workorder' and excluded.dataset='workorder'
      and nullif(btrim(excluded.order_number),'') is null
      and (excluded.raw->'depositOrderNo' is null or excluded.raw->'depositOrderNo'='null'::jsonb
        or jsonb_typeof(excluded.raw->'depositOrderNo')='string' and nullif(btrim(excluded.raw->>'depositOrderNo'),'') is null)
      and (excluded.raw->'rechargeNumber' is null or excluded.raw->'rechargeNumber'='null'::jsonb
        or jsonb_typeof(excluded.raw->'rechargeNumber')='string' and nullif(btrim(excluded.raw->>'rechargeNumber'),'') is null)
      and not (coalesce(jsonb_typeof(old.raw->'depositOrderNo')='string' and (old.raw->>'depositOrderNo') ~ '^RC[A-Za-z0-9_-]{1,198}$',false)
        and coalesce(jsonb_typeof(old.raw->'rechargeNumber')='string' and (old.raw->>'rechargeNumber') ~ '^RC[A-Za-z0-9_-]{1,198}$',false)
        and old.raw->>'depositOrderNo'<>old.raw->>'rechargeNumber')
      and coalesce(
      case when jsonb_typeof(old.raw->'depositOrderNo')='string' and (old.raw->>'depositOrderNo') ~ '^RC[A-Za-z0-9_-]{1,198}$' then old.raw->>'depositOrderNo' end,
      case when jsonb_typeof(old.raw->'rechargeNumber')='string' and (old.raw->>'rechargeNumber') ~ '^RC[A-Za-z0-9_-]{1,198}$' then old.raw->>'rechargeNumber' end) is not null) then excluded.raw
      ||coalesce((select jsonb_object_agg(k.key,k.value) from jsonb_each(old.raw) k
        where k.key in ('depositOrderNo','rechargeNumber') and jsonb_typeof(k.value)='string' and (k.value#>>'{}') ~ '^RC[A-Za-z0-9_-]{1,198}$'),'{}'::jsonb)
      ||case when jsonb_typeof(old.raw->'_depositOriginalBackfill')='object'
        and old.raw#>>'{_depositOriginalBackfill,source}'='typed-workorder-original-backfill'
        and old.raw#>>'{_depositOriginalBackfill,workOrderId}'=old.source_id
        and old.raw#>>'{_depositOriginalBackfill,depositOrderNo}'=coalesce(
      case when jsonb_typeof(old.raw->'depositOrderNo')='string' and (old.raw->>'depositOrderNo') ~ '^RC[A-Za-z0-9_-]{1,198}$' then old.raw->>'depositOrderNo' end,
      case when jsonb_typeof(old.raw->'rechargeNumber')='string' and (old.raw->>'rechargeNumber') ~ '^RC[A-Za-z0-9_-]{1,198}$' then old.raw->>'rechargeNumber' end)
        then jsonb_build_object('_depositOriginalBackfill',old.raw->'_depositOriginalBackfill') else '{}'::jsonb end
      else excluded.raw end,received_at=clock_timestamp()
  where (old.source_updated_at is null and (excluded.source_updated_at is not null or excluded.captured_at>=old.captured_at))
    or (old.source_updated_at is not null and excluded.source_updated_at is not null and
      (excluded.source_updated_at>old.source_updated_at or
       (excluded.source_updated_at=old.source_updated_at and excluded.captured_at>=old.captured_at)));
  get diagnostics written=row_count;
  perform private.collector_record_receipt_route_v1('newar_detail',p_token_hash,jsonb_build_object('platform',p_batch->>'platform','dataset',p_batch->>'dataset'),'newar_detail',v_batch_id);
  insert into private.newar_detail_batches values(v_batch_id,v_payload_hash,p_batch->>'platform',p_batch->>'dataset',received,written,received-written,clock_timestamp());
  perform private.newar_detail_record_batch_proof(p_batch);
  return jsonb_build_object('ok',true,'batch_id',v_batch_id,'status','accepted',
    'received_count',received,'written_count',written,'stale_count',received-written);
end;
$function$;


CREATE OR REPLACE FUNCTION private.dashboard_admin_newar_withdraw_days(p_request jsonb, p_scope jsonb, p_start date, p_end date)
 RETURNS TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, pending_count bigint, unknown_count bigint, unclassified_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, currencies jsonb, currency_unknown_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with sites as materialized (
  select distinct p.name,p.country,p.source_name,p.timezone,n.launch_at,private.dashboard_admin_live_withdraw_key(p.name) platform_key
  from private.dashboard_admin_live_platforms() p join public.newar_detail_platforms n on n.platform=p.source_name
  where p.source='newar' and n.enabled and private.dashboard_scope_allows(p_scope,n.country_code,n.platform)
   and (case when p_request ? 'scopeTargets' then exists(select 1 from jsonb_array_elements(p_request->'scopeTargets') t
    where t->>'country'=p.country and exists(select 1 from jsonb_array_elements_text(t->'platforms') f
     where private.dashboard_admin_live_withdraw_key(f)=private.dashboard_admin_live_withdraw_key(p.name))) else p_request->>'country'=p.country end)
   and (nullif(p_request->>'platform','') is null or private.dashboard_admin_live_withdraw_key(p_request->>'platform')=private.dashboard_admin_live_withdraw_key(p.name))
   and (not p_request ? 'platforms' or jsonb_array_length(p_request->'platforms')=0 or nullif(p_request->>'platform','') is not null
    or exists(select 1 from jsonb_array_elements_text(p_request->'platforms') f where private.dashboard_admin_live_withdraw_key(f)=private.dashboard_admin_live_withdraw_key(p.name)))
 ), business as materialized (
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
 ), days as materialized (
  select s.*,(p_start+g.day_offset)::date local_date,
   (p_start+g.day_offset)::timestamp at time zone s.timezone day_start,
   (p_start+g.day_offset+1)::timestamp at time zone s.timezone day_end,c.ranges,c.coverage_seen
  from sites s cross join generate_series(0,p_end-p_start) g(day_offset)
  cross join lateral (
   select range_agg(tstzrange(c.effective_start_at,c.end_at,'[)')) ranges,max(c.observed_at) coverage_seen
   from private.newar_detail_coverage_runs c
   where c.platform=s.source_name and c.dataset='withdraw' and c.invalidated_at is null
    and c.observed_at<=statement_timestamp()
    and c.effective_start_at<(p_start+g.day_offset+1)::timestamp at time zone s.timezone
    and c.end_at>(p_start+g.day_offset)::timestamp at time zone s.timezone
  ) c ), evidence as materialized (
  select d.*,day_end<=statement_timestamp() and (launch_at is null or day_start>=launch_at)
   and coalesce(ranges @> tstzrange(day_start,day_end,'[)'),false) complete from days d
 ), operators as materialized (
  select country,platform_key,local_date,account,count(*) processed,count(*) filter(where status_group='success') success,
   count(*) filter(where status_group in('failed','rejected')) rejected,
   max(captured_at) source_updated_at,max(received_at) updated_at,count(processing_seconds) duration_sample_count,
   sum(processing_seconds) duration_total_seconds,avg(processing_seconds) avg_seconds
  from facts where method is distinct from 'auto' group by 1,2,3,4
 )
 select d.local_date,d.country,d.name,d.platform_key,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where status_group='success') end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where status_group in('failed','rejected')) end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where method='auto') end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where method='manual') end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where status_group='pending') end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where status_group is null or status_group not in('success','failed','rejected','pending')) end,
  case when count(f.source_id)>0 or d.complete then count(f.source_id) filter(where method is null) end,avg(processing_seconds),count(processing_seconds),sum(processing_seconds),
  max(captured_at),greatest(max(received_at),d.coverage_seen),d.complete and coalesce(max(captured_at)<=statement_timestamp(),true),
  coalesce((select jsonb_agg(to_jsonb(o) order by o.account) from operators o
   where o.country=d.country and o.platform_key=d.platform_key and o.local_date=d.local_date),'[]'::jsonb),
  coalesce(jsonb_agg(distinct f.currency) filter(where nullif(f.currency,'') is not null),'[]'::jsonb),count(f.source_id) filter(where nullif(f.currency,'') is null)
 from evidence d left join facts f on f.country=d.country and f.platform_key=d.platform_key and f.local_date=d.local_date
 group by d.local_date,d.country,d.name,d.platform_key,d.complete,d.coverage_seen;
$function$;

