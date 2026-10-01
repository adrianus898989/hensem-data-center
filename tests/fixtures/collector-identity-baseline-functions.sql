-- Exact production function definitions read on 2026-10-01; code only.
-- Synthetic SQL tests provision their own hashes/scopes. No live credentials or data.
CREATE OR REPLACE FUNCTION private.newar_business_assert_batch(p_batch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  kind text; platform text; payload jsonb; field text; row jsonb; k text; v jsonb;
  stat_date date; captured timestamptz; zone text; country text; country_code text;
  total integer:=0; seen text[]; identity text;
begin
  if jsonb_typeof(p_batch) is distinct from 'object' or octet_length(p_batch::text)>2000000
    or not(p_batch ?& array['action','kind','batch_id','platform','captured_at','payload'])
    or (p_batch-array['action','kind','batch_id','platform','captured_at','snapshot_at','payload'])<>'{}'::jsonb
    or p_batch->>'action' is distinct from 'ingest' or jsonb_typeof(p_batch->'batch_id') is distinct from 'string'
    or p_batch->>'batch_id' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    or jsonb_typeof(p_batch->'kind') is distinct from 'string' or jsonb_typeof(p_batch->'platform') is distinct from 'string'
    or jsonb_typeof(p_batch->'payload') is distinct from 'object' then
    raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_BATCH';
  end if;
  kind:=p_batch->>'kind';platform:=p_batch->>'platform';payload:=p_batch->'payload';
  if kind not in ('third_party_volume','auto_withdraw_bundle','workorder_daily_bundle') or platform not in ('POPZAR','DhaniWin','92BLAZE') then
    raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_SCOPE';
  end if;
  zone:=case platform when 'DhaniWin' then 'Asia/Kolkata' else 'Asia/Karachi' end;
  country:=case platform when 'DhaniWin' then '印度' else '巴基斯坦' end;
  country_code:=case platform when 'DhaniWin' then 'IN' else 'PK' end;
  if jsonb_typeof(p_batch->'captured_at') is distinct from 'string'
    or p_batch->>'captured_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+]00:00)$'
    or (p_batch ? 'snapshot_at' and p_batch->'snapshot_at' is distinct from p_batch->'captured_at') then
    raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TIME';
  end if;
  begin captured:=(p_batch->>'captured_at')::timestamptz;
  exception when others then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TIME'; end;
  if not isfinite(captured) or captured<'2020-01-01Z'::timestamptz or captured>clock_timestamp()+interval '5 minutes'
    or (platform='92BLAZE' and (captured<'2026-09-21T19:00:00Z'::timestamptz or clock_timestamp()<'2026-09-21T19:00:00Z'::timestamptz)) then
    raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_LAUNCH_OR_TIME';
  end if;
  if (payload-(private.newar_business_fields(kind)||array['action','source','system_name','third_party_rows']))<>'{}'::jsonb
    or (kind<>'third_party_volume' and payload ? 'third_party_rows')
    or (payload ? 'third_party_rows' and payload->'third_party_rows' is distinct from payload->'rows') then
    raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_PAYLOAD';
  end if;
  foreach k in array array['action','source','system_name'] loop
    if payload ? k and (jsonb_typeof(payload->k) is distinct from 'string' or length(payload->>k)>200 or payload->>k ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_PAYLOAD';
    end if;
  end loop;
  foreach field in array private.newar_business_fields(kind) loop
    if jsonb_typeof(payload->field) is distinct from 'array' or jsonb_array_length(payload->field)>5000 then
      raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_ROWS';
    end if;
    seen:=array[]::text[];total:=total+jsonb_array_length(payload->field);
    for row in select value from jsonb_array_elements(payload->field) loop
      if jsonb_typeof(row) is distinct from 'object' or (row-private.newar_business_row_keys(kind,field))<>'{}'::jsonb
        or not(row ?& array['stat_date','platform','system_name','country'])
        or row->>'platform' is distinct from platform or row->>'country' is distinct from country
        or (row ? 'country_code' and row->>'country_code' is distinct from country_code)
        or jsonb_typeof(row->'stat_date') is distinct from 'string' or row->>'stat_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_ROW';
      end if;
      begin stat_date:=(row->>'stat_date')::date;
      exception when others then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_DATE'; end;
      if stat_date<'2020-01-01'::date or stat_date>(captured at time zone zone)::date
        or (platform='92BLAZE' and stat_date<'2026-09-22'::date) then
        raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_LAUNCH_OR_DATE';
      end if;
      for k,v in select * from jsonb_each(row) loop
        if k ~ '(_count|_seconds)$' or k in ('count','amount','total_amount','success_amount','success_rate') then
          if jsonb_typeof(v) is distinct from 'number' or (v::text)::numeric<0 or (v::text)::numeric>9007199254740991
            or (k ~ '_count$' or k='count') and trunc((v::text)::numeric)<>(v::text)::numeric
            or k='success_rate' and (v::text)::numeric>1 then
            raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_NUMBER';
          end if;
        elsif jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>500 or v#>>'{}' ~ '[[:cntrl:]]' then
          raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TEXT';
        end if;
      end loop;
      if nullif(btrim(row->>'system_name'),'') is null then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_ROW'; end if;
      if kind='workorder_daily_bundle' and not(row ?& (case when field='rows' then
        array['total_count','pending_count','in_progress_count','system_processing_count','completed_count','rejected_count','one_to_one_count',
          'total_conversation_count','total_conversation_rate_text','total_message_count','avg_conversation_duration_text','avg_first_response_time_text']
        else array['account_type','employee_id','employee_name','order_type','order_name','total_count','in_progress_count','completed_count','rejected_count',
          'one_to_one_work_order_count','total_conversation_count','total_conversation_rate_text','total_message_count','avg_conversation_duration_text',
          'avg_first_response_time_text','total_sation_duration_text','first_response_time_text'] end)) then
        raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_WORKORDER_FIELDS';
      end if;
      if kind='third_party_volume' then
        if not(row ?& array['biz_type','third_party','mapping_code','success_count','success_amount','total_count','total_amount','failed_count','success_rate','count','amount'])
          or row->>'biz_type' not in ('recharge','withdraw') or nullif(btrim(row->>'third_party'),'') is null
          or (row->>'success_count')::numeric>(row->>'total_count')::numeric
          or (row->>'failed_count')::numeric<>(row->>'total_count')::numeric-(row->>'success_count')::numeric
          or row->'count'<>row->'success_count' or row->'amount'<>row->'success_amount'
          or (row->>'success_amount')::numeric>(row->>'total_amount')::numeric then
          raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TOTALS';
        end if;
        identity:=jsonb_build_array(stat_date,row->>'biz_type',row->>'third_party',row->>'mapping_code')::text;
      elsif kind='auto_withdraw_bundle' and field='operator_rows' then
        if not(row ?& array['operator','processed_count','reject_count','total_handle_seconds','handle_count']) or nullif(btrim(row->>'operator'),'') is null then
          raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_OPERATOR';
        end if;
        identity:=jsonb_build_array(stat_date,row->>'operator')::text;
      elsif kind='workorder_daily_bundle' and field<>'rows' then
        if not(row ?& array['employee_name','order_type','order_name','total_count']) then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_EMPLOYEE_OR_TYPE'; end if;
        identity:=jsonb_build_array(stat_date,row->>'employee_name',row->>'order_type',row->>'order_name',row->>'account_type',row->>'employee_id')::text;
      else
        if not(row ? 'total_count') then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TOTALS'; end if;
        if kind='auto_withdraw_bundle' and not(row ?& array['success_count','reject_count','auto_count','manual_count','total_handle_seconds','handle_count']) then
          raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_TOTALS';
        end if;
        identity:=stat_date::text;
      end if;
      if identity=any(seen) then raise exception using errcode='22023',message='NEWAR_BUSINESS_DUPLICATE_ROW'; end if;
      seen:=array_append(seen,identity);
    end loop;
  end loop;
  if total not between 1 and 10000 then raise exception using errcode='22023',message='NEWAR_BUSINESS_INVALID_SIZE'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.newar_detail_assert_batch(p_batch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r jsonb; k text; v text; v_created timestamptz; v_captured timestamptz; v_time timestamptz;
  n integer; v_platform public.newar_detail_platforms%rowtype;
begin
  if p_batch is null or jsonb_typeof(p_batch)<>'object'
    or (p_batch-array['schema_version','batch_id','platform','dataset','records'])<>'{}'::jsonb
    or not (p_batch ?& array['schema_version','batch_id','platform','dataset','records'])
    or p_batch->'schema_version'<>'1'::jsonb
    or jsonb_typeof(p_batch->'batch_id')<>'string'
    or p_batch->>'batch_id' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    or jsonb_typeof(p_batch->'platform')<>'string'
    or jsonb_typeof(p_batch->'dataset')<>'string'
    or p_batch->>'dataset' not in ('charge','withdraw','workorder')
    or jsonb_typeof(p_batch->'records')<>'array'
    or octet_length(p_batch::text)>2097152 then
    raise exception using errcode='22023',message='NEWAR_INVALID_BATCH';
  end if;
  select * into v_platform from public.newar_detail_platforms where platform=p_batch->>'platform' and enabled;
  if not found then raise exception using errcode='22023',message='NEWAR_INVALID_PLATFORM'; end if;
  n:=jsonb_array_length(p_batch->'records');
  if n not between 1 and 500 then raise exception using errcode='22023',message='NEWAR_INVALID_BATCH_SIZE'; end if;
  for r in select value from jsonb_array_elements(p_batch->'records') loop
    if jsonb_typeof(r)<>'object'
      or not (r ?& array['source_id','amount','status_code','status_group','created_at','captured_at','raw'])
      or (r-array['source_id','member_id','order_number','third_party_order_number','provider','provider_id',
        'channel_type','currency','amount','actual_amount','fee','status_code','status_group','created_at',
        'success_at','processed_at','source_updated_at','captured_at','workorder_type','operator','followup_count','raw'])<>'{}'::jsonb then
      raise exception using errcode='22023',message='NEWAR_INVALID_RECORD_FIELDS';
    end if;
    foreach k in array array['source_id','member_id','order_number','third_party_order_number','provider',
        'provider_id','channel_type','status_code','workorder_type','operator'] loop
      if r->k is not null and r->k<>'null'::jsonb and
        (jsonb_typeof(r->k)<>'string' or length(r->>k) not between 1 and 200
          or btrim(r->>k)<>r->>k or r->>k ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='NEWAR_INVALID_TEXT';
      end if;
    end loop;
    if r->>'source_id' is null or (r->>'status_code' is null and r->>'status_group'<>'unknown')
      or jsonb_typeof(r->'status_group')<>'string'
      or r->>'status_group' not in ('success','pending','failed','rejected','unknown')
      or (r->'currency' is not null and r->'currency'<>'null'::jsonb and
        (jsonb_typeof(r->'currency')<>'string' or r->>'currency' !~ '^[A-Z0-9]{3,8}$')) then
      raise exception using errcode='22023',message='NEWAR_INVALID_STATUS_OR_CURRENCY';
    end if;
    foreach k in array array['amount','actual_amount','fee'] loop
      if (k='amount' and r->>k is null) or (r->k is not null and r->k<>'null'::jsonb and
        (jsonb_typeof(r->k)<>'string' or r->>k !~ '^[0-9]{1,16}([.][0-9]{1,8})?$')) then
        raise exception using errcode='22023',message='NEWAR_INVALID_AMOUNT';
      end if;
    end loop;
    if r->'followup_count' is not null and r->'followup_count'<>'null'::jsonb and
      (jsonb_typeof(r->'followup_count')<>'number' or r->>'followup_count' !~ '^[0-9]{1,9}$') then
      raise exception using errcode='22023',message='NEWAR_INVALID_FOLLOWUP_COUNT';
    end if;
    foreach k in array array['created_at','success_at','processed_at','source_updated_at','captured_at'] loop
      v:=r->>k;
      if (k in ('created_at','captured_at') and v is null) or (v is not null and
        (jsonb_typeof(r->k)<>'string' or v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+]00:00)$')) then
        raise exception using errcode='22023',message='NEWAR_INVALID_TIME';
      end if;
      begin v_time:=v::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode='22023',message='NEWAR_INVALID_TIME';
      end;
      if v_time is not null and (not isfinite(v_time) or v_time<'2020-01-01Z'::timestamptz
        or v_time>clock_timestamp()+interval '5 minutes') then
        raise exception using errcode='22023',message='NEWAR_INVALID_TIME';
      end if;
    end loop;
    v_created:=(r->>'created_at')::timestamptz;v_captured:=(r->>'captured_at')::timestamptz;
    if v_created>v_captured+interval '5 minutes'
      or (r->>'success_at' is not null and (r->>'status_group'<>'success' or (r->>'success_at')::timestamptz<v_created))
      or (r->>'processed_at' is not null and (r->>'processed_at')::timestamptz<v_created) then
      raise exception using errcode='22023',message='NEWAR_INVALID_TIME_SEMANTICS';
    end if;
    if jsonb_typeof(r->'raw')<>'object' or octet_length((r->'raw')::text)>16384
      or ((r->'raw')-private.newar_detail_raw_keys())<>'{}'::jsonb
      or exists(select 1 from jsonb_each(r->'raw') x where jsonb_typeof(x.value) not in ('string','number','boolean','null')
        or (jsonb_typeof(x.value)='string' and length(x.value#>>'{}')>256)) then
      raise exception using errcode='22023',message='NEWAR_INVALID_RAW';
    end if;
  end loop;
  if (select count(distinct value->>'source_id') from jsonb_array_elements(p_batch->'records'))<>n then
    raise exception using errcode='22023',message='NEWAR_DUPLICATE_SOURCE_ID';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.newar_detail_raw_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$select '{id,userId,memberId,orderNo,thirdOrderNo,thirdId,payId,createTime,created,originCreated,rechargeSuccessTime,submittedTime,lastUpdateTime,withdrawState,thirdState,rechargeState,state,amount,actualAmount,fee,rechargeChannelName,rechargeType,payMethod,withdrawChannelName,withdrawType,type,operator,followUpCount,followupCount,countryId,currency,currencyEvidence,workOrderId,workOrderTypeName,submissionTime,handledTime,payTypeId,thirdPaymentName,thirdPartyMappingCode,rechargeChannelId,reminderCount,lastUpdateMan,displayName,rechargeNumber,transactionId,rechargeChannelType,coinToFiatRate,uGold,sysCurrency,uRate,withdrawChannelId,withdrawCategoryId,withdrawCategoryName,depositOrderNo,utr,kycConnectState,utrMatched,workOrderTypeId,rechargeLevel,rechargeCount}'::text[];$function$
;

CREATE OR REPLACE FUNCTION private.newar_business_fields(p_kind text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_kind when 'third_party_volume' then array['rows'] when 'auto_withdraw_bundle' then array['rows','operator_rows']
    when 'workorder_daily_bundle' then array['rows','employee_rows','type_rows'] else array[]::text[] end;
$function$
;

CREATE OR REPLACE FUNCTION public.ar_order_valid_local_time(v jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE s text; t timestamp without time zone;
BEGIN
 IF v='null'::jsonb THEN RETURN true; END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 s:=v#>>'{}';
 IF s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN RETURN false; END IF;
 BEGIN t:=s::timestamp; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false; END;
 RETURN to_char(t,'YYYY-MM-DD HH24:MI:SS')=s;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ar_order_valid_text(v jsonb, lim integer, nullable boolean DEFAULT true, identifier boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
SELECT CASE WHEN v='null'::jsonb THEN nullable WHEN jsonb_typeof(v) IS DISTINCT FROM 'string' THEN false
  ELSE length(v#>>'{}')<=lim AND (NOT identifier OR (
    length(v#>>'{}')>0 AND v#>>'{}'=btrim(v#>>'{}') AND v#>>'{}' !~ '[[:cntrl:]]'
    AND v#>>'{}' !~* '^(-+|n/a|none|null|undefined)$')) END;
$function$
;

CREATE OR REPLACE FUNCTION public.collection_success_assert_snapshot(p_snapshot jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_coverage jsonb; v_totals jsonb; v_group jsonb; v_key text;
  v_date date; v_at timestamptz; v_identity text;
  v_seen text[] := array[]::text[];
  v_submitted numeric := 0; v_success numeric := 0;
begin
  if pg_catalog.jsonb_typeof(p_snapshot) is distinct from 'object'
    or pg_catalog.octet_length(p_snapshot::text) > 1048576
    or p_snapshot->'schema_version' is distinct from '1'::jsonb then
    raise exception using errcode='22023', message='CS_INVALID_SNAPSHOT';
  end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(p_snapshot) k where k <> all(array[
    'schema_version','source_system','country_code','platform','stat_date','timezone','snapshot_id','snapshot_at','coverage','totals','groups'])) then
    raise exception using errcode='22023', message='CS_INVALID_EXTRA_FIELDS';
  end if;
  foreach v_key in array array['source_system','country_code','platform','stat_date','timezone','snapshot_id','snapshot_at'] loop
    if pg_catalog.jsonb_typeof(p_snapshot->v_key) is distinct from 'string'
      or pg_catalog.length(p_snapshot->>v_key) not between 1 and 80
      or p_snapshot->>v_key <> pg_catalog.btrim(p_snapshot->>v_key)
      or p_snapshot->>v_key ~ '[[:cntrl:]]' then
      raise exception using errcode='22023', message='CS_INVALID_SNAPSHOT';
    end if;
  end loop;
  if p_snapshot->>'source_system' not in ('RECHARGE_REVIEW','WITHDRAW_REVIEW')
    or p_snapshot->>'country_code' !~ '^[A-Z]{2}$'
    or p_snapshot->>'stat_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_snapshot->>'snapshot_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_snapshot->>'snapshot_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    or not public.collection_success_safe_descriptor(p_snapshot->>'platform',80)
    or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_snapshot->>'timezone') then
    raise exception using errcode='22023', message='CS_INVALID_SNAPSHOT';
  end if;
  begin
    v_date := (p_snapshot->>'stat_date')::date;
    v_at := (p_snapshot->>'snapshot_at')::timestamptz;
    if v_date < date '2020-01-01'
      or v_date >= (pg_catalog.clock_timestamp() at time zone (p_snapshot->>'timezone'))::date
      or v_date >= (v_at at time zone (p_snapshot->>'timezone'))::date
      or v_at > pg_catalog.clock_timestamp() + interval '5 minutes'
      or pg_catalog.to_char(v_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS') <> pg_catalog.substring(p_snapshot->>'snapshot_at',1,19) then
      raise exception using errcode='22023', message='CS_INVALID_DATE';
    end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value or invalid_text_representation then
    raise exception using errcode='22023', message='CS_INVALID_DATE';
  end;
  v_coverage := p_snapshot->'coverage'; v_totals := p_snapshot->'totals';
  if pg_catalog.jsonb_typeof(v_coverage) is distinct from 'object' or pg_catalog.jsonb_typeof(v_totals) is distinct from 'object'
    or v_coverage->'complete' is distinct from 'true'::jsonb then
    raise exception using errcode='22023', message='CS_INVALID_COVERAGE';
  end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(v_coverage) k where k <> all(array['complete','expected_count','fetched_count','unique_count']))
    or exists (select 1 from pg_catalog.jsonb_object_keys(v_totals) k where k <> all(array['submitted_count','success_count'])) then
    raise exception using errcode='22023', message='CS_INVALID_EXTRA_FIELDS';
  end if;
  foreach v_key in array array['expected_count','fetched_count','unique_count'] loop
    if not public.collection_success_is_count(v_coverage->v_key) then
      raise exception using errcode='22023', message='CS_INVALID_COVERAGE';
    end if;
  end loop;
  foreach v_key in array array['submitted_count','success_count'] loop
    if not public.collection_success_is_count(v_totals->v_key) then
      raise exception using errcode='22023', message='CS_INVALID_TOTALS';
    end if;
  end loop;
  if v_coverage->'expected_count' <> v_coverage->'unique_count'
    or v_coverage->'expected_count' <> v_coverage->'fetched_count'
    or v_coverage->'expected_count' <> v_totals->'submitted_count'
    or (v_totals->>'success_count')::numeric > (v_totals->>'submitted_count')::numeric then
    raise exception using errcode='22023', message='CS_INVALID_COVERAGE';
  end if;
  if pg_catalog.jsonb_typeof(p_snapshot->'groups') is distinct from 'array' then
    raise exception using errcode='22023', message='CS_INVALID_GROUPS';
  end if;
  if pg_catalog.jsonb_array_length(p_snapshot->'groups') > 2000 then
    raise exception using errcode='22023', message='CS_INVALID_GROUPS';
  end if;
  for v_group in select value from pg_catalog.jsonb_array_elements(p_snapshot->'groups') loop
    if pg_catalog.jsonb_typeof(v_group) is distinct from 'object' then
      raise exception using errcode='22023', message='CS_INVALID_GROUPS';
    end if;
    if exists (select 1 from pg_catalog.jsonb_object_keys(v_group) k where k <> all(array['raw_channel','channel_type','submitted_count','success_count'])) then
      raise exception using errcode='22023', message='CS_INVALID_EXTRA_FIELDS';
    end if;
    if pg_catalog.jsonb_typeof(v_group->'raw_channel') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_group->'channel_type') is distinct from 'string'
      or not public.collection_success_safe_descriptor(v_group->>'raw_channel',96)
      or not public.collection_success_safe_descriptor(v_group->>'channel_type',48)
      or not public.collection_success_is_count(v_group->'submitted_count')
      or not public.collection_success_is_count(v_group->'success_count') then
      raise exception using errcode='22023', message='CS_INVALID_GROUPS';
    end if;
    v_identity := pg_catalog.jsonb_build_array(v_group->>'raw_channel',v_group->>'channel_type')::text;
    if v_identity = any(v_seen) then raise exception using errcode='22023', message='CS_INVALID_DUPLICATE_GROUP'; end if;
    v_seen := pg_catalog.array_append(v_seen,v_identity);
    if (v_group->>'submitted_count')::numeric <= 0 or (v_group->>'success_count')::numeric > (v_group->>'submitted_count')::numeric then
      raise exception using errcode='22023', message='CS_INVALID_GROUPS';
    end if;
    v_submitted := v_submitted + (v_group->>'submitted_count')::numeric;
    v_success := v_success + (v_group->>'success_count')::numeric;
  end loop;
  if v_submitted <> (v_totals->>'submitted_count')::numeric or v_success <> (v_totals->>'success_count')::numeric then
    raise exception using errcode='22023', message='CS_INVALID_TOTALS';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.collection_success_is_count(p_value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when pg_catalog.jsonb_typeof(p_value) = 'number'
    then (p_value::text)::numeric between 0 and 9007199254740991
      and pg_catalog.trunc((p_value::text)::numeric) = (p_value::text)::numeric
    else false end;
$function$
;

CREATE OR REPLACE FUNCTION public.collection_success_safe_descriptor(p_value text, p_max integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_value is not null and pg_catalog.length(p_value) between 1 and p_max
    and p_value = pg_catalog.btrim(p_value)
    and p_value !~ '[[:cntrl:]]' and p_value !~ '[0-9]{7}'
    and p_value ~ '^[[:alnum:]一-龥 ._/()+‐‑‒–—−-]+$'
    and p_value !~* '(https?[/]|www[.]|account[ _-]*number|member[ _-]*id|user[ _-]*id|order[ _-]*id|银行卡号|会员账号|会员姓名|真实姓名|手机号码|身份证)';
$function$
;

CREATE OR REPLACE FUNCTION public.workorder_issue_assert_snapshot(p_snapshot jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_coverage jsonb;
  v_totals jsonb;
  v_groups jsonb;
  v_row jsonb;
  v_key text;
  v_status_key text;
  v_status_value jsonb;
  v_date date;
  v_at timestamptz;
  v_identity text;
  v_seen text[] := array[]::text[];
  v_row_issue_count numeric;
  v_deposit_status_total numeric;
  v_withdraw_status_total numeric;
  v_sum_submitted_count numeric := 0;
  v_sum_submitted_amount numeric := 0;
  v_sum_success_count numeric := 0;
  v_sum_success_amount numeric := 0;
  v_sum_withdraw_not_received_count numeric := 0;
  v_sum_withdraw_not_received_amount numeric := 0;
  v_sum_withdraw_success_count numeric := 0;
  v_sum_withdraw_success_amount numeric := 0;
begin
  if pg_catalog.jsonb_typeof(p_snapshot) is distinct from 'object'
    or pg_catalog.octet_length(p_snapshot::text) > 1048576
    or p_snapshot->'schema_version' is distinct from '1'::jsonb then
    raise exception using errcode = '22023', message = 'WOI_INVALID_SNAPSHOT';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_snapshot) k
    where k <> all(array[
      'schema_version', 'source_system', 'country_code', 'country', 'platform',
      'stat_date', 'timezone', 'snapshot_id', 'snapshot_at', 'coverage',
      'totals', 'groups'
    ])
  ) then
    raise exception using errcode = '22023', message = 'WOI_INVALID_EXTRA_FIELDS';
  end if;

  foreach v_key in array array[
    'source_system', 'country_code', 'country', 'platform', 'stat_date',
    'timezone', 'snapshot_id', 'snapshot_at'
  ] loop
    if pg_catalog.jsonb_typeof(p_snapshot->v_key) is distinct from 'string'
      or pg_catalog.length(p_snapshot->>v_key) not between 1 and 80
      or p_snapshot->>v_key <> pg_catalog.btrim(p_snapshot->>v_key)
      or p_snapshot->>v_key ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'WOI_INVALID_SNAPSHOT';
    end if;
  end loop;

  if p_snapshot->>'source_system' <> 'AR_WORKORDER'
    or p_snapshot->>'stat_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_snapshot->>'snapshot_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_snapshot->>'snapshot_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    or not (
      (
        p_snapshot->>'country_code' = 'PK'
        and p_snapshot->>'country' = '巴基斯坦'
        and p_snapshot->>'platform' in ('POPZAR', '92BLAZE')
        and p_snapshot->>'timezone' = 'Asia/Karachi'
      )
      or
      (
        p_snapshot->>'country_code' = 'IN'
        and p_snapshot->>'country' = '印度'
        and p_snapshot->>'platform' = 'DhaniWin'
        and p_snapshot->>'timezone' = 'Asia/Kolkata'
      )
    ) then
    raise exception using errcode = '22023', message = 'WOI_INVALID_SCOPE';
  end if;

  begin
    v_date := (p_snapshot->>'stat_date')::date;
    v_at := (p_snapshot->>'snapshot_at')::timestamptz;

    if v_date < date '2020-01-01'
      or v_date >= (pg_catalog.clock_timestamp() at time zone (p_snapshot->>'timezone'))::date
      or v_date >= (v_at at time zone (p_snapshot->>'timezone'))::date
      or v_at > pg_catalog.clock_timestamp() + interval '5 minutes'
      or pg_catalog.to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
        <> pg_catalog.substring(p_snapshot->>'snapshot_at', 1, 19) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_DATE';
    end if;
  exception
    when invalid_datetime_format
      or datetime_field_overflow
      or invalid_parameter_value
      or invalid_text_representation then
      raise exception using errcode = '22023', message = 'WOI_INVALID_DATE';
  end;

  -- 92BLAZE opens at 2026-09-22 00:00 Asia/Karachi. Its first
  -- complete business-day snapshot is September 22, published September 23.
  if p_snapshot->>'platform' = '92BLAZE' and (
    v_date < date '2026-09-22'
    or v_at < timestamptz '2026-09-21 19:00:00+00'
    or pg_catalog.clock_timestamp() < timestamptz '2026-09-21 19:00:00+00'
  ) then
    raise exception using errcode = '22023', message = 'WOI_INVALID_LAUNCH_DATE';
  end if;

  v_coverage := p_snapshot->'coverage';
  v_totals := p_snapshot->'totals';
  v_groups := p_snapshot->'groups';

  if pg_catalog.jsonb_typeof(v_coverage) is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_totals) is distinct from 'object'
    or v_coverage->'complete' is distinct from 'true'::jsonb
    or pg_catalog.jsonb_typeof(v_groups) is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_groups) > 2000 then
    raise exception using errcode = '22023', message = 'WOI_INVALID_COVERAGE';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_coverage) k
    where k <> all(array[
      'complete', 'expected_count', 'fetched_count', 'unique_count',
      'target_count', 'ignored_count', 'unmapped_count'
    ])
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_totals) k
    where k <> all(array[
      'submitted_count', 'submitted_amount', 'success_count', 'success_amount',
      'withdraw_not_received_count', 'withdraw_not_received_amount',
      'withdraw_success_count', 'withdraw_success_amount'
    ])
  ) then
    raise exception using errcode = '22023', message = 'WOI_INVALID_EXTRA_FIELDS';
  end if;

  foreach v_key in array array[
    'expected_count', 'fetched_count', 'unique_count', 'target_count',
    'ignored_count', 'unmapped_count'
  ] loop
    if not public.workorder_issue_is_count(v_coverage->v_key) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_COVERAGE';
    end if;
  end loop;

  foreach v_key in array array[
    'submitted_count', 'success_count', 'withdraw_not_received_count',
    'withdraw_success_count'
  ] loop
    if not public.workorder_issue_is_count(v_totals->v_key) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_TOTALS';
    end if;
  end loop;

  foreach v_key in array array[
    'submitted_amount', 'success_amount', 'withdraw_not_received_amount',
    'withdraw_success_amount'
  ] loop
    if not public.workorder_issue_is_money(v_totals->v_key) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_TOTALS';
    end if;
  end loop;

  if v_coverage->'expected_count' <> v_coverage->'fetched_count'
    or v_coverage->'expected_count' <> v_coverage->'unique_count'
    or (v_coverage->>'target_count')::numeric
      + (v_coverage->>'ignored_count')::numeric
      <> (v_coverage->>'unique_count')::numeric
    or (v_coverage->>'unmapped_count')::numeric <> 0
    or (v_totals->>'submitted_count')::numeric
      + (v_totals->>'withdraw_not_received_count')::numeric
      + (v_coverage->>'unmapped_count')::numeric
      <> (v_coverage->>'target_count')::numeric
    or (v_totals->>'success_count')::numeric > (v_totals->>'submitted_count')::numeric
    or (v_totals->>'success_amount')::numeric > (v_totals->>'submitted_amount')::numeric
    or (v_totals->>'withdraw_success_count')::numeric > (v_totals->>'withdraw_not_received_count')::numeric
    or (v_totals->>'withdraw_success_amount')::numeric > (v_totals->>'withdraw_not_received_amount')::numeric then
    raise exception using errcode = '22023', message = 'WOI_INVALID_COVERAGE';
  end if;

  for v_row in
    select value from pg_catalog.jsonb_array_elements(v_groups)
  loop
    if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_row) k
        where k <> all(array[
          'third_party', 'channel_type', 'submitted_count', 'submitted_amount',
          'success_count', 'success_amount', 'withdraw_not_received_count',
          'withdraw_not_received_amount', 'withdraw_success_count',
          'withdraw_success_amount', 'status_counts'
        ])
      ) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_ROW';
    end if;

    if pg_catalog.jsonb_typeof(v_row->'third_party') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_row->'channel_type') is distinct from 'string'
      or not public.workorder_issue_safe_descriptor(v_row->>'third_party', 96)
      or not public.workorder_issue_safe_descriptor(v_row->>'channel_type', 80) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_ROW';
    end if;

    foreach v_key in array array[
      'submitted_count', 'success_count', 'withdraw_not_received_count',
      'withdraw_success_count'
    ] loop
      if not public.workorder_issue_is_count(v_row->v_key) then
        raise exception using errcode = '22023', message = 'WOI_INVALID_ROW';
      end if;
    end loop;

    foreach v_key in array array[
      'submitted_amount', 'success_amount', 'withdraw_not_received_amount',
      'withdraw_success_amount'
    ] loop
      if not public.workorder_issue_is_money(v_row->v_key) then
        raise exception using errcode = '22023', message = 'WOI_INVALID_ROW';
      end if;
    end loop;

    if pg_catalog.jsonb_typeof(v_row->'status_counts') is distinct from 'object'
      or (v_row->>'success_count')::numeric > (v_row->>'submitted_count')::numeric
      or (v_row->>'success_amount')::numeric > (v_row->>'submitted_amount')::numeric
      or (v_row->>'withdraw_success_count')::numeric > (v_row->>'withdraw_not_received_count')::numeric
      or (v_row->>'withdraw_success_amount')::numeric > (v_row->>'withdraw_not_received_amount')::numeric then
      raise exception using errcode = '22023', message = 'WOI_INVALID_ROW';
    end if;

    v_row_issue_count :=
      (v_row->>'submitted_count')::numeric
      + (v_row->>'withdraw_not_received_count')::numeric;

    if v_row_issue_count <= 0 then
      raise exception using errcode = '22023', message = 'WOI_INVALID_EMPTY_ROW';
    end if;

    v_identity := pg_catalog.jsonb_build_array(
      v_row->>'third_party', v_row->>'channel_type'
    )::text;
    if v_identity = any(v_seen) then
      raise exception using errcode = '22023', message = 'WOI_INVALID_DUPLICATE_ROW';
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_identity);

    for v_status_key, v_status_value in
      select key, value from pg_catalog.jsonb_each(v_row->'status_counts')
    loop
      if v_status_key <> all(array[
          '存款/待处理', '存款/处理中', '存款/已驳回', '存款/已处理', '存款/系统处理中',
          '提款/待处理', '提款/处理中', '提款/已驳回', '提款/已处理', '提款/系统处理中'
        ])
        or not public.workorder_issue_is_count(v_status_value) then
        raise exception using errcode = '22023', message = 'WOI_INVALID_STATUS_COUNTS';
      end if;
    end loop;

    v_deposit_status_total :=
      coalesce((v_row#>>'{status_counts,存款/待处理}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,存款/处理中}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,存款/已驳回}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,存款/已处理}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,存款/系统处理中}')::numeric, 0);
    v_withdraw_status_total :=
      coalesce((v_row#>>'{status_counts,提款/待处理}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,提款/处理中}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,提款/已驳回}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,提款/已处理}')::numeric, 0)
      + coalesce((v_row#>>'{status_counts,提款/系统处理中}')::numeric, 0);

    if v_deposit_status_total <> (v_row->>'submitted_count')::numeric
      or v_withdraw_status_total <> (v_row->>'withdraw_not_received_count')::numeric
      or coalesce((v_row#>>'{status_counts,存款/已处理}')::numeric, 0)
        <> (v_row->>'success_count')::numeric
      or coalesce((v_row#>>'{status_counts,提款/已处理}')::numeric, 0)
        <> (v_row->>'withdraw_success_count')::numeric then
      raise exception using errcode = '22023', message = 'WOI_INVALID_STATUS_COUNTS';
    end if;

    v_sum_submitted_count := v_sum_submitted_count + (v_row->>'submitted_count')::numeric;
    v_sum_submitted_amount := v_sum_submitted_amount + (v_row->>'submitted_amount')::numeric;
    v_sum_success_count := v_sum_success_count + (v_row->>'success_count')::numeric;
    v_sum_success_amount := v_sum_success_amount + (v_row->>'success_amount')::numeric;
    v_sum_withdraw_not_received_count := v_sum_withdraw_not_received_count
      + (v_row->>'withdraw_not_received_count')::numeric;
    v_sum_withdraw_not_received_amount := v_sum_withdraw_not_received_amount
      + (v_row->>'withdraw_not_received_amount')::numeric;
    v_sum_withdraw_success_count := v_sum_withdraw_success_count
      + (v_row->>'withdraw_success_count')::numeric;
    v_sum_withdraw_success_amount := v_sum_withdraw_success_amount
      + (v_row->>'withdraw_success_amount')::numeric;
  end loop;

  if v_sum_submitted_count <> (v_totals->>'submitted_count')::numeric
    or v_sum_submitted_amount <> (v_totals->>'submitted_amount')::numeric
    or v_sum_success_count <> (v_totals->>'success_count')::numeric
    or v_sum_success_amount <> (v_totals->>'success_amount')::numeric
    or v_sum_withdraw_not_received_count <> (v_totals->>'withdraw_not_received_count')::numeric
    or v_sum_withdraw_not_received_amount <> (v_totals->>'withdraw_not_received_amount')::numeric
    or v_sum_withdraw_success_count <> (v_totals->>'withdraw_success_count')::numeric
    or v_sum_withdraw_success_amount <> (v_totals->>'withdraw_success_amount')::numeric then
    raise exception using errcode = '22023', message = 'WOI_INVALID_TOTALS';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.workorder_issue_is_count(p_value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when pg_catalog.jsonb_typeof(p_value) = 'number' then
      (p_value::text)::numeric between 0 and 9007199254740991
      and pg_catalog.trunc((p_value::text)::numeric) = (p_value::text)::numeric
    else false
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.workorder_issue_safe_descriptor(p_value text, p_max integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_value is not null
    and p_max between 1 and 256
    and pg_catalog.length(p_value) between 1 and p_max
    and p_value = pg_catalog.btrim(p_value)
    and p_value !~ '[[:cntrl:]]'
    and p_value !~ '[0-9]{7}'
    and p_value ~ '^[[:alnum:]一-龥 ._/:,+()&#''‐‑‒–—−-]+$'
    and p_value !~* '(https?:|www[.]|account[ _-]*number|member[ _-]*id|user[ _-]*id|order[ _-]*id|银行卡号|会员账号|会员姓名|真实姓名|手机号码|身份证)';
$function$
;

CREATE OR REPLACE FUNCTION private.newar_business_row_keys(p_kind text, p_field text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select array['stat_date','system_name','country','country_code','platform']::text[] || case
  when p_kind='third_party_volume' and p_field='rows' then array['biz_type','biz_label','type','third_party','mapping_code','mappingCode','map_code','mapping','pay_method','payMethod','映射码','success_count','success_amount','total_count','total_amount','failed_count','success_rate','count','amount','updated_at']
  when p_kind='auto_withdraw_bundle' and p_field='rows' then array['total_count','success_count','reject_count','auto_count','manual_count','total_handle_seconds','handle_count']
  when p_kind='auto_withdraw_bundle' and p_field='operator_rows' then array['operator','processed_count','reject_count','total_handle_seconds','handle_count']
  when p_kind='workorder_daily_bundle' then array['total_count','pending_count','in_progress_count','system_processing_count','completed_count','rejected_count','one_to_one_count','total_conversation_count','total_conversation_rate_text','total_message_count','avg_conversation_duration_text','avg_first_response_time_text','account_type','employee_id','employee_name','order_type','order_name','one_to_one_work_order_count','total_sation_duration_text','first_response_time_text']
  else array[]::text[] end;
$function$
;

CREATE OR REPLACE FUNCTION public.workorder_issue_is_money(p_value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when pg_catalog.jsonb_typeof(p_value) = 'number' then
      (p_value::text)::numeric between 0 and 90071992547409.91
      and pg_catalog.scale((p_value::text)::numeric) <= 2
    else false
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.workorder_issue_scopes_are_allowed(p_scopes jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb;
  v_seen text[] := array[]::text[];
  v_identity text;
begin
  if pg_catalog.jsonb_typeof(p_scopes) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_scopes) not between 1 and 3 then
    return false;
  end if;

  for v_scope in
    select value from pg_catalog.jsonb_array_elements(p_scopes)
  loop
    if v_scope <> '{"country_code":"PK","platform":"POPZAR","timezone":"Asia/Karachi"}'::jsonb
      and v_scope <> '{"country_code":"IN","platform":"DhaniWin","timezone":"Asia/Kolkata"}'::jsonb
      and v_scope <> '{"country_code":"PK","platform":"92BLAZE","timezone":"Asia/Karachi"}'::jsonb then
      return false;
    end if;

    v_identity := v_scope::text;
    if v_identity = any(v_seen) then
      return false;
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_identity);
  end loop;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.ingest_newar_business_batch(p_token_hash text, p_batch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  credential private.newar_business_credentials%rowtype; receipt private.newar_business_batches%rowtype;
  old public.newar_business_snapshots%rowtype; v_id uuid; v_hash text; v_kind text; v_platform text;
  v_at timestamptz; field text; part jsonb; body jsonb; clocks jsonb; counts jsonb:='{}'; scope record;
  existing_at timestamptz; changed boolean; writes integer:=0; ack jsonb; country text; country_code text;
begin
  select * into credential from private.newar_business_credentials where token_hash=p_token_hash for share;
  if not found or credential.revoked or credential.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='NEWAR_BUSINESS_AUTH_INVALID'; end if;
  perform private.newar_business_assert_batch(p_batch);
  v_kind:=p_batch->>'kind';v_platform:=p_batch->>'platform';v_at:=(p_batch->>'captured_at')::timestamptz;
  if not credential.allowed_scopes @> jsonb_build_array(jsonb_build_object('platform',v_platform,'kind',v_kind)) then
    raise exception using errcode='42501',message='NEWAR_BUSINESS_SCOPE_DENIED';
  end if;
  v_id:=(p_batch->>'batch_id')::uuid;v_hash:=encode(sha256(convert_to(p_batch::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('newar-business-batch:'||v_id::text,0));
  select * into receipt from private.newar_business_batches where batch_id=v_id;
  if found then
    if receipt.payload_hash<>v_hash then raise exception using errcode='23505',message='NEWAR_BUSINESS_BATCH_CONFLICT'; end if;
    return receipt.receipt||jsonb_build_object('status','unchanged');
  end if;
  country:=case v_platform when 'DhaniWin' then '印度' else '巴基斯坦' end;
  country_code:=case v_platform when 'DhaniWin' then 'IN' else 'PK' end;
  foreach field in array array['rows','operator_rows','employee_rows','type_rows'] loop
    counts:=counts||jsonb_build_object(field,case when p_batch->'payload' ? field then jsonb_array_length(p_batch->'payload'->field) else 0 end);
  end loop;
  for scope in
    select distinct (r.value->>'stat_date')::date as day,
      case when v_kind='third_party_volume' then case r.value->>'biz_type' when 'recharge' then 'charge' else 'withdraw' end else 'all' end as direction
    from unnest(private.newar_business_fields(v_kind)) f cross join lateral jsonb_array_elements(p_batch->'payload'->f) r
    order by 1,2
  loop
    perform pg_advisory_xact_lock(hashtextextended('newar-business-scope:'||jsonb_build_array(v_kind,v_platform,scope.day,scope.direction)::text,0));
    select * into old from public.newar_business_snapshots s where s.kind=v_kind and s.platform=v_platform and s.stat_date=scope.day and s.direction=scope.direction for update;
    body:=coalesce(old.payload,'{}');clocks:=coalesce(old.component_captured_at,'{}');changed:=false;
    foreach field in array private.newar_business_fields(v_kind) loop
      select coalesce(jsonb_agg(value),'[]') into part from jsonb_array_elements(p_batch->'payload'->field)
        where (value->>'stat_date')::date=scope.day and (v_kind<>'third_party_volume' or
          case value->>'biz_type' when 'recharge' then 'charge' else 'withdraw' end=scope.direction);
      -- A day-level primary row makes its empty auxiliary arrays authoritative.
      -- An operator-only repair never erases the already collected daily row.
      if jsonb_array_length(part)=0 and (field='rows' or not exists(
        select 1 from jsonb_array_elements(p_batch#>'{payload,rows}') r where (r->>'stat_date')::date=scope.day)) then continue; end if;
      existing_at:=(clocks->>field)::timestamptz;
      if existing_at=v_at and body->field is distinct from part then raise exception using errcode='23505',message='NEWAR_BUSINESS_SNAPSHOT_CONFLICT'; end if;
      if existing_at is null or existing_at<v_at then
        body:=body||jsonb_build_object(field,part);clocks:=clocks||jsonb_build_object(field,v_at);changed:=true;
      end if;
    end loop;
    if changed then
      if old.captured_at is null or v_at>=old.captured_at then
        body:=body||((p_batch->'payload')-array['rows','third_party_rows','operator_rows','employee_rows','type_rows']);
      end if;
      if v_kind='third_party_volume' then body:=body||jsonb_build_object('third_party_rows',body->'rows'); end if;
      insert into public.newar_business_snapshots(kind,platform,country_code,country,stat_date,direction,captured_at,payload,component_captured_at)
        values(v_kind,v_platform,country_code,country,scope.day,scope.direction,greatest(old.captured_at,v_at),body,clocks)
        on conflict(kind,platform,stat_date,direction) do update set captured_at=excluded.captured_at,payload=excluded.payload,component_captured_at=excluded.component_captured_at,updated_at=clock_timestamp();
      writes:=writes+1;
    end if;
  end loop;
  ack:=jsonb_build_object('ok',true,'batch_id',v_id,'kind',v_kind,'platform',v_platform,
    'status',case when writes>0 then 'accepted' else 'unchanged' end,'counts',counts,'operator_insert',0,'operator_update',counts->'operator_rows');
  insert into private.newar_business_batches(batch_id,payload_hash,platform,kind,receipt) values(v_id,v_hash,v_platform,v_kind,ack);
  return ack;
end;
$function$
;

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
  insert into private.newar_detail_batches values(v_batch_id,v_payload_hash,p_batch->>'platform',p_batch->>'dataset',received,written,received-written,clock_timestamp());
  return jsonb_build_object('ok',true,'batch_id',v_batch_id,'status','accepted',
    'received_count',received,'written_count',written,'stale_count',received-written);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_ar_collected_orders(p_token_hash text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 cred jsonb; scope_count integer; allowed constant jsonb := '[{"country_code":"PK","platform":"92PKR"},{"country_code":"PK","platform":"92R"},{"country_code":"PK","platform":"92DADU"},{"country_code":"PK","platform":"92GO"},{"country_code":"PK","platform":"92COCO"},{"country_code":"PK","platform":"92GLORY"},{"country_code":"PK","platform":"92STRIKE"},{"country_code":"PK","platform":"92STAR"},{"country_code":"PK","platform":"92.GAME"},{"country_code":"PK","platform":"YAYWIN"},{"country_code":"BR","platform":"POPBRA"},{"country_code":"BR","platform":"POPPG"},{"country_code":"BR","platform":"POP555"},{"country_code":"BR","platform":"POP678"},{"country_code":"BR","platform":"POP888"},{"country_code":"BR","platform":"POPLUA"},{"country_code":"BR","platform":"POPBEM"},{"country_code":"BR","platform":"POPCEU"},{"country_code":"VN","platform":"92LOTTERY"},{"country_code":"VN","platform":"VN168"},{"country_code":"VN","platform":"66CLUB"},{"country_code":"VN","platform":"82VN"},{"country_code":"ID","platform":"55FIVE"},{"country_code":"MY","platform":"MZPLAY"},{"country_code":"MM","platform":"6LOTTERY"},{"country_code":"NG","platform":"FB999"},{"country_code":"IN","platform":"91CLUB"},{"country_code":"IN","platform":"55CLUB"},{"country_code":"IN","platform":"IN999"},{"country_code":"IN","platform":"OKWIN"},{"country_code":"IN","platform":"JALWA"},{"country_code":"IN","platform":"BIGMUMBAI"},{"country_code":"IN","platform":"82LOTTERY"},{"country_code":"IN","platform":"LOTTERY7"},{"country_code":"IN","platform":"51GAME"},{"country_code":"IN","platform":"6CLUB"},{"country_code":"IN","platform":"TPPLAY"},{"country_code":"IN","platform":"RAJA"},{"country_code":"IN","platform":"JAICLUB"},{"country_code":"IN","platform":"Shree.Win"},{"country_code":"IN","platform":"Veer.Game"}]'::jsonb;
 r jsonb; k text; bid uuid; stamp timestamptz; fingerprint text; prior_hash text; n integer;
BEGIN
 SELECT allowed_scopes INTO cred FROM public.ar_business_direct_credentials
 WHERE token_hash=p_token_hash AND NOT revoked AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='ARO_AUTH_INVALID'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>1048576 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD';
 END IF;
 SELECT count(*) INTO scope_count FROM jsonb_array_elements(allowed) a
 WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(cred) c WHERE c->>'country_code'=a->>'country_code' AND c->>'platform'=a->>'platform');
 IF scope_count=0 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ARO_SCOPE_DENIED'; END IF;
 IF p_payload->>'action'='check' THEN
   IF p_payload<>jsonb_build_object('action','check') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD'; END IF;
   RETURN jsonb_build_object('ok',true,'source_system','AR','details_version',1,'scope_count',scope_count);
 END IF;
 IF p_payload->>'action' IS DISTINCT FROM 'ingest' OR p_payload->>'source_system' IS DISTINCT FROM 'AR'
   OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>8
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) f(key) WHERE f.key<>ALL(ARRAY['action','batch_id','source_system','country_code','platform','order_kind','observed_at','orders'])) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD';
 END IF;
 FOREACH k IN ARRAY ARRAY['action','batch_id','source_system','country_code','platform','order_kind','observed_at'] LOOP
   IF jsonb_typeof(p_payload->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_PAYLOAD'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(allowed) a WHERE a->>'country_code'=p_payload->>'country_code' AND a->>'platform'=p_payload->>'platform')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cred) c WHERE c->>'country_code'=p_payload->>'country_code' AND c->>'platform'=p_payload->>'platform') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ARO_SCOPE_DENIED';
 END IF;
 IF p_payload->>'batch_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR p_payload->>'order_kind' NOT IN ('recharge','withdraw')
   OR p_payload->>'observed_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_IDENTITY';
 END IF;
 BEGIN
   stamp:=(p_payload->>'observed_at')::timestamptz;
   IF stamp<timestamptz '2020-01-01 00:00:00+00' OR stamp>clock_timestamp()+interval '5 minutes'
      OR to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(p_payload->>'observed_at',19) THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_OBSERVED_AT';
   END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_OBSERVED_AT'; END;
 IF jsonb_typeof(p_payload->'orders') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'orders')>500 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_ORDERS';
 END IF;
 n:=jsonb_array_length(p_payload->'orders');
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'orders') LOOP
   IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(r))<>12
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) f(key) WHERE f.key<>ALL(ARRAY['order_no','member_id','amount','amount_text','status','applied_at','completed_at','operator','raw_channel','channel_type','remark','manual_remark'])) THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_ORDER';
   END IF;
   IF NOT public.ar_order_valid_text(r->'order_no',160,false,true) OR NOT public.ar_order_valid_text(r->'member_id',80,true,true)
     OR NOT public.ar_order_valid_text(r->'amount_text',100) OR NOT public.ar_order_valid_text(r->'status',160)
     OR NOT public.ar_order_valid_local_time(r->'applied_at') OR NOT public.ar_order_valid_local_time(r->'completed_at')
     OR NOT public.ar_order_valid_text(r->'operator',240) OR NOT public.ar_order_valid_text(r->'raw_channel',240)
     OR NOT public.ar_order_valid_text(r->'channel_type',240) OR NOT public.ar_order_valid_text(r->'remark',8000)
     OR NOT public.ar_order_valid_text(r->'manual_remark',8000) THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_ORDER';
   END IF;
   IF r->'amount' IS DISTINCT FROM 'null'::jsonb THEN
     IF jsonb_typeof(r->'amount') IS DISTINCT FROM 'string' OR r->>'amount' !~ '^(0|[1-9][0-9]{0,13})[.][0-9]{2}$' THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_AMOUNT';
     END IF;
     IF (r->>'amount')::numeric>90071992547409.91 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_AMOUNT'; END IF;
   END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'order_no') FROM jsonb_array_elements(p_payload->'orders'))<>n THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_DUPLICATE';
 END IF;
 bid:=(p_payload->>'batch_id')::uuid; fingerprint:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('ar-order-batch:'||bid::text,0));
 SELECT payload_hash INTO prior_hash FROM public.ar_collected_order_receipts WHERE batch_id=bid;
 IF FOUND THEN
   IF prior_hash<>fingerprint THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='ARO_BATCH_CONFLICT'; END IF;
   RETURN jsonb_build_object('ok',true,'batch_id',p_payload->>'batch_id','order_count',n,'status','unchanged');
 END IF;
 -- Stable scope lock avoids overlapping-page upsert deadlocks; different scopes remain independent.
 PERFORM pg_advisory_xact_lock(hashtextextended('ar-order-scope:'||jsonb_build_array(p_payload->>'country_code',p_payload->>'platform',p_payload->>'order_kind')::text,0));
 INSERT INTO public.ar_collected_order_receipts(batch_id,payload_hash,order_count) VALUES(bid,fingerprint,n);
 INSERT INTO public.ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,amount_text,status,applied_at,completed_at,operator,raw_channel,channel_type,remark,manual_remark,observed_at,batch_id)
 SELECT 'AR',p_payload->>'country_code',p_payload->>'platform',p_payload->>'order_kind',value->>'order_no',value->>'member_id',(value->>'amount')::numeric,value->>'amount_text',value->>'status',
   (value->>'applied_at')::timestamp,(value->>'completed_at')::timestamp,value->>'operator',value->>'raw_channel',value->>'channel_type',value->>'remark',value->>'manual_remark',stamp,bid
 FROM jsonb_array_elements(p_payload->'orders') ORDER BY value->>'order_no'
 ON CONFLICT(source_system,country_code,platform,order_kind,order_no) DO UPDATE SET
   member_id=excluded.member_id,amount=excluded.amount,amount_text=excluded.amount_text,status=excluded.status,
   applied_at=excluded.applied_at,completed_at=excluded.completed_at,operator=excluded.operator,raw_channel=case
     when excluded.order_kind='withdraw' and excluded.status='已通过'
       and nullif(btrim(excluded.raw_channel),'') is null
       and public.ar_collected_orders.raw_channel='人工确认'
     then public.ar_collected_orders.raw_channel else excluded.raw_channel end,channel_type=excluded.channel_type,
   remark=excluded.remark,manual_remark=excluded.manual_remark,observed_at=excluded.observed_at,batch_id=excluded.batch_id,updated_at=clock_timestamp()
 WHERE public.ar_collected_orders.observed_at<excluded.observed_at;
 RETURN jsonb_build_object('ok',true,'batch_id',p_payload->>'batch_id','order_count',n,'status','accepted');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_collection_success_snapshot(p_token_hash text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_credential public.collection_success_credentials%rowtype;
  v_receipt public.collection_success_snapshot_receipts%rowtype;
  v_id uuid; v_current_id uuid; v_written_id uuid; v_hash text; v_replay boolean := false;
begin
  -- Lock credential until commit, making revoke/publication ordering explicit.
  select * into v_credential from public.collection_success_credentials where token_hash=p_token_hash for share;
  if not found or v_credential.revoked or v_credential.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode='28000', message='CS_AUTH_INVALID';
  end if;
  perform public.collection_success_assert_snapshot(p_snapshot);
  if not ((p_snapshot->>'source_system') = any(v_credential.allowed_source_systems))
    or not v_credential.allowed_scopes @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'country_code',p_snapshot->>'country_code','platform',p_snapshot->>'platform','timezone',p_snapshot->>'timezone')) then
    raise exception using errcode='42501', message='CS_SCOPE_DENIED';
  end if;
  v_id := (p_snapshot->>'snapshot_id')::uuid;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_snapshot::text,'UTF8')),'hex');
  -- Consistent order: id lock, then day lock. Id reuse across days cannot deadlock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collection-success-id:' || v_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collection-success-day:' ||
    pg_catalog.jsonb_build_array(p_snapshot->>'source_system',p_snapshot->>'country_code',p_snapshot->>'platform',p_snapshot->>'stat_date')::text,0));
  select * into v_receipt from public.collection_success_snapshot_receipts where snapshot_id=v_id;
  if found then
    if v_receipt.payload_hash <> v_hash then raise exception using errcode='23505', message='CS_ID_CONFLICT'; end if;
    v_replay := true;
  else
    insert into public.collection_success_snapshot_receipts(snapshot_id,payload_hash) values(v_id,v_hash);
    insert into public.collection_success_daily as current_day(source_system,country_code,platform,stat_date,snapshot_id,snapshot_at,snapshot)
    values(p_snapshot->>'source_system',p_snapshot->>'country_code',p_snapshot->>'platform',(p_snapshot->>'stat_date')::date,v_id,(p_snapshot->>'snapshot_at')::timestamptz,p_snapshot)
    on conflict(source_system,country_code,platform,stat_date) do update
      set snapshot_id=excluded.snapshot_id,snapshot_at=excluded.snapshot_at,snapshot=excluded.snapshot,updated_at=pg_catalog.clock_timestamp()
      where excluded.snapshot_at > current_day.snapshot_at
    returning snapshot_id into v_written_id;
  end if;
  select snapshot_id into v_current_id from public.collection_success_daily where source_system=p_snapshot->>'source_system'
    and country_code=p_snapshot->>'country_code' and platform=p_snapshot->>'platform' and stat_date=(p_snapshot->>'stat_date')::date;
  if v_current_id is null then raise exception using errcode='55000', message='CS_STORAGE_INCONSISTENT'; end if;
  return pg_catalog.jsonb_build_object('ok',true,'status',case when v_current_id<>v_id then 'stale'
    when v_replay then 'unchanged' when v_written_id is not null then 'accepted' else 'stale' end,
    'snapshot_id',p_snapshot->>'snapshot_id','current_snapshot_id',v_current_id::text);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_workorder_issue_snapshot(p_token_hash text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_credential public.workorder_issue_credentials%rowtype;
  v_receipt public.workorder_issue_snapshot_receipts%rowtype;
  v_id uuid;
  v_hash text;
  v_date date;
  v_snapshot_at timestamptz;
  v_country text;
  v_groups jsonb;
  v_current_id uuid;
  v_current_at timestamptz;
  v_replay boolean := false;
  v_accepted boolean := false;
begin
  -- Hold the credential row until commit so revoke/publication ordering is
  -- explicit and a credential cannot change during publication.
  select *
  into v_credential
  from public.workorder_issue_credentials
  where token_hash = p_token_hash
  for share;

  if not found
    or v_credential.revoked
    or v_credential.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '28000', message = 'WOI_AUTH_INVALID';
  end if;

  perform public.workorder_issue_assert_snapshot(p_snapshot);

  if v_credential.source_system <> p_snapshot->>'source_system'
    or not ((p_snapshot->>'source_system') = any(v_credential.allowed_source_systems))
    or not v_credential.allowed_scopes @> pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'country_code', p_snapshot->>'country_code',
        'platform', p_snapshot->>'platform',
        'timezone', p_snapshot->>'timezone'
      )
    ) then
    raise exception using errcode = '42501', message = 'WOI_SCOPE_DENIED';
  end if;

  v_id := (p_snapshot->>'snapshot_id')::uuid;
  v_date := (p_snapshot->>'stat_date')::date;
  v_snapshot_at := (p_snapshot->>'snapshot_at')::timestamptz;
  v_country := case p_snapshot->>'country_code'
    when 'PK' then '巴基斯坦'
    when 'IN' then '印度'
    else null
  end;
  v_groups := p_snapshot->'groups';
  v_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_snapshot::text, 'UTF8')),
    'hex'
  );

  -- Always lock in this order. Reusing an ID across scopes cannot deadlock a
  -- concurrent publisher for either scope.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workorder-issue-id:' || v_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'workorder-issue-day:' || pg_catalog.jsonb_build_array(
        p_snapshot->>'source_system',
        p_snapshot->>'country_code',
        p_snapshot->>'platform',
        p_snapshot->>'stat_date'
      )::text,
      0
    )
  );

  select *
  into v_receipt
  from public.workorder_issue_snapshot_receipts
  where snapshot_id = v_id;

  if found then
    if v_receipt.payload_hash <> v_hash then
      raise exception using errcode = '23505', message = 'WOI_ID_CONFLICT';
    end if;
    v_replay := true;
  else
    insert into public.workorder_issue_snapshot_receipts (
      snapshot_id, payload_hash
    ) values (
      v_id, v_hash
    );

    select h.current_snapshot_id, h.snapshot_at
    into v_current_id, v_current_at
    from public.workorder_issue_snapshot_heads h
    where h.source_system = p_snapshot->>'source_system'
      and h.country_code = p_snapshot->>'country_code'
      and h.platform = p_snapshot->>'platform'
      and h.stat_date = v_date;

    if v_current_id is null or v_snapshot_at > v_current_at then
      insert into public.workorder_deposit_daily as current_row (
        system_name,
        source_system,
        stat_date,
        country_code,
        country,
        platform,
        third_party,
        channel_type,
        submitted_count,
        submitted_amount,
        success_count,
        success_amount,
        status_counts,
        withdraw_not_received_count,
        withdraw_not_received_amount,
        withdraw_success_count,
        withdraw_success_amount,
        source_updated_at,
        updated_at
      )
      select
        'AR',
        'AR_WORKORDER',
        v_date,
        p_snapshot->>'country_code',
        v_country,
        p_snapshot->>'platform',
        row_data.value->>'third_party',
        row_data.value->>'channel_type',
        (row_data.value->>'submitted_count')::bigint,
        (row_data.value->>'submitted_amount')::numeric(24, 2),
        (row_data.value->>'success_count')::bigint,
        (row_data.value->>'success_amount')::numeric(24, 2),
        row_data.value->'status_counts',
        (row_data.value->>'withdraw_not_received_count')::bigint,
        (row_data.value->>'withdraw_not_received_amount')::numeric(24, 2),
        (row_data.value->>'withdraw_success_count')::bigint,
        (row_data.value->>'withdraw_success_amount')::numeric(24, 2),
        v_snapshot_at,
        pg_catalog.clock_timestamp()
      from pg_catalog.jsonb_array_elements(v_groups) as row_data(value)
      on conflict (
        system_name, stat_date, country_code, platform, third_party, channel_type
      ) do update
      set
        source_system = excluded.source_system,
        country = excluded.country,
        submitted_count = excluded.submitted_count,
        submitted_amount = excluded.submitted_amount,
        success_count = excluded.success_count,
        success_amount = excluded.success_amount,
        status_counts = excluded.status_counts,
        withdraw_not_received_count = excluded.withdraw_not_received_count,
        withdraw_not_received_amount = excluded.withdraw_not_received_amount,
        withdraw_success_count = excluded.withdraw_success_count,
        withdraw_success_amount = excluded.withdraw_success_amount,
        source_updated_at = excluded.source_updated_at,
        updated_at = excluded.updated_at;

      -- A complete snapshot is authoritative only inside this exact
      -- system/source/platform/business-day scope. An empty groups array safely
      -- deletes every old row in that one scope and nothing else.
      delete from public.workorder_deposit_daily d
      where d.system_name = 'AR'
        and d.source_system = 'AR_WORKORDER'
        and d.stat_date = v_date
        and d.country_code = p_snapshot->>'country_code'
        and d.platform = p_snapshot->>'platform'
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_groups) as wanted(value)
          where wanted.value->>'third_party' = d.third_party
            and wanted.value->>'channel_type' = d.channel_type
        );

      insert into public.workorder_issue_snapshot_heads as current_head (
        source_system,
        country_code,
        platform,
        timezone,
        stat_date,
        current_snapshot_id,
        snapshot_at,
        updated_at
      ) values (
        p_snapshot->>'source_system',
        p_snapshot->>'country_code',
        p_snapshot->>'platform',
        p_snapshot->>'timezone',
        v_date,
        v_id,
        v_snapshot_at,
        pg_catalog.clock_timestamp()
      )
      on conflict (source_system, country_code, platform, stat_date)
      do update set
        timezone = excluded.timezone,
        current_snapshot_id = excluded.current_snapshot_id,
        snapshot_at = excluded.snapshot_at,
        updated_at = excluded.updated_at
      where excluded.snapshot_at > current_head.snapshot_at;

      v_accepted := true;
    end if;
  end if;

  select h.current_snapshot_id, h.snapshot_at
  into v_current_id, v_current_at
  from public.workorder_issue_snapshot_heads h
  where h.source_system = p_snapshot->>'source_system'
    and h.country_code = p_snapshot->>'country_code'
    and h.platform = p_snapshot->>'platform'
    and h.stat_date = v_date;

  if v_current_id is null then
    raise exception using errcode = '55000', message = 'WOI_STORAGE_INCONSISTENT';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'status', case
      when v_current_id <> v_id then 'stale'
      when v_replay then 'unchanged'
      when v_accepted then 'accepted'
      else 'stale'
    end,
    'snapshot_id', v_id::text,
    'current_snapshot_id', v_current_id::text,
    'current_snapshot_at', pg_catalog.to_char(
      v_current_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );
end;
$function$
;
