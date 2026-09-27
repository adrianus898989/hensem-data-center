-- Frozen storage-only extraction; no evidence storage, retention or cleanup is installed.
-- AR V44 optional detail storage. Installation script only: NOT yet deployed.
-- Run as the database owner after review. Only the two named NEW objects are
-- created; no legacy aggregate table, collector, policy or frontend is changed.
-- The collector must keep its service credential off browsers and public code.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $install$
declare
  v_table regclass := to_regclass('public.ar_workorder_issue_details');
  v_function regprocedure := to_regprocedure('public.ingest_ar_workorder_issue_details_v2(jsonb)');
  v_signature text;
  v_marker constant text := 'AR_WORKORDER_ISSUE_DETAILS_V2_20260927:';
  v_rpc_body constant text := $rpc_body$
declare
  r jsonb; k text; val text; n numeric; ts timestamptz; qd date;
  v_count integer; v_written integer := 0; v_one integer; v_key text;
  v_seen text[] := array[]::text[];
  v_text_keys constant text[] := array[
    'system_name','country_code','country','platform','tenant_id','work_order_id',
    'source_record_id','work_order_no','source_order_no','payment_order_no','utr',
    'issue_kind','work_order_type_name','work_order_name','third_party',
    'third_party_source_name','third_party_mapping_code','third_party_channel_id',
    'channel_type','kyc_status_source','operator_account','last_updated_by','query_basis','operation_time_source','source_vip_level'];
  v_time_keys constant text[] := array['submitted_at','operated_at','source_updated_at','observed_at'];
  v_int_keys constant text[] := array['work_order_type_id','status_code','reminder_count','schema_version','source_form_id','source_type_code','kyc_link_status_code','source_pay_type_id'];
  v_allowed constant text[] := array[
    'system_name','country_code','country','platform','tenant_id','work_order_id',
    'source_record_id','work_order_no','source_order_no','payment_order_no','utr',
    'issue_kind','work_order_type_id','work_order_type_name','work_order_name','status_code',
    'amount','third_party','third_party_source_name','third_party_mapping_code',
    'third_party_channel_id','channel_type','kyc_connected','kyc_status_source','utr_matched',
    'reminder_count','attachment_types','submitted_at','operated_at','operator_account',
    'source_updated_at','observed_at','query_date','schema_version','query_basis','submitted_date',
    'last_updated_by','attachment_type_codes','operation_time_source','field_gaps',
    'source_form_id','source_type_code','kyc_link_status_code','is_locked_by_current_user','source_vip_level','source_pay_type_id'];
begin
  if jsonb_typeof(p_rows) is distinct from 'array'
    or octet_length(p_rows::text) > 4194304 then
    raise exception using errcode='22023', message='AR_DETAIL_INVALID_BATCH';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count > 500 then
    raise exception using errcode='22023', message='AR_DETAIL_BATCH_SIZE_0_TO_500';
  end if;
  -- Validate every row before any upsert. One bad record rejects the full batch.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) is distinct from 'object' or (r-v_allowed) <> '{}'::jsonb then
      raise exception using errcode='22023', message='AR_DETAIL_UNKNOWN_OR_INVALID_FIELDS';
    end if;
    if not (r ?& array['system_name','country_code','country','platform','work_order_id',
      'issue_kind','observed_at','query_date','schema_version','query_basis','field_gaps']) then
      raise exception using errcode='22023', message='AR_DETAIL_REQUIRED_FIELD_MISSING';
    end if;
    foreach k in array v_text_keys loop
      if r ? k and r->k <> 'null'::jsonb then
        val := r->>k;
        if jsonb_typeof(r->k)<>'string' or length(val) not between 1 and 200
          or val<>btrim(val) or val ~ '[[:cntrl:]]' or (k='source_vip_level' and length(val)>32) then
          raise exception using errcode='22023', message='AR_DETAIL_INVALID_TEXT_FIELD', detail=k;
        end if;
      end if;
    end loop;
    if (r->>'system_name') is distinct from 'AR'
      or coalesce(r->>'country_code','') !~ '^[A-Z]{2}$'
      or coalesce(r->>'country','')='' or coalesce(r->>'platform','')=''
      or coalesce(r->>'work_order_id','')=''
      or coalesce(r->>'issue_kind','') not in ('deposit','withdraw') then
      raise exception using errcode='22023', message='AR_DETAIL_INVALID_IDENTITY';
    end if;
    foreach k in array v_int_keys loop
      if r ? k and r->k <> 'null'::jsonb then
        if jsonb_typeof(r->k)<>'number' or (r->>k) !~ (case when k='source_type_code' then '^(-1|[0-9]+)$' else '^[0-9]+$' end)
          or length(r->>k)>10 or (r->>k)::numeric>2147483647 then
          raise exception using errcode='22023', message='AR_DETAIL_INVALID_INTEGER', detail=k;
        end if;
      end if;
    end loop;
    if r->'schema_version' is distinct from '2'::jsonb
      or (r->'status_code' <> 'null'::jsonb and (r->>'status_code')::integer not between 1 and 5) then
      raise exception using errcode='22023', message='AR_DETAIL_INVALID_VERSION_OR_STATUS';
    end if;
    foreach k in array array['kyc_connected','utr_matched','is_locked_by_current_user'] loop
      if r ? k and r->k <> 'null'::jsonb and jsonb_typeof(r->k)<>'boolean' then
        raise exception using errcode='22023', message='AR_DETAIL_INVALID_BOOLEAN', detail=k;
      end if;
    end loop;
    if r ? 'amount' and r->'amount'<>'null'::jsonb then
      val := r->>'amount';
      if jsonb_typeof(r->'amount') not in ('number','string') or length(val)>80
        or val !~ '^[0-9]+([.][0-9]+)?$' then
        raise exception using errcode='22023', message='AR_DETAIL_INVALID_AMOUNT';
      end if;
      n:=val::numeric;
      if n>=10000000000000000 or n<>round(n,8) then
        raise exception using errcode='22023', message='AR_DETAIL_AMOUNT_PRECISION';
      end if;
    end if;
    if r ? 'attachment_types' and r->'attachment_types'<>'null'::jsonb then
      if jsonb_typeof(r->'attachment_types')<>'array' then
        raise exception using errcode='22023', message='AR_DETAIL_INVALID_ATTACHMENT_TYPES';
      end if;
      if jsonb_array_length(r->'attachment_types')>16 or exists (
        select 1 from jsonb_array_elements(r->'attachment_types') a
        where jsonb_typeof(a)<>'string' or (a#>>'{}') not in ('image','pdf','video')) then
        raise exception using errcode='22023', message='AR_DETAIL_INVALID_ATTACHMENT_TYPES';
      end if;
    end if;
    if coalesce(r->>'query_basis','') not in ('submission','operation') then
      raise exception using errcode='22023', message='AR_DETAIL_INVALID_QUERY_BASIS';
    end if;
    if (r->>'operation_time_source') is not null
      and r->>'operation_time_source' not in ('operationTime','operateTime','lastUpdateTime') then
      raise exception using errcode='22023', message='AR_DETAIL_INVALID_OPERATION_SOURCE';
    end if;
    if ((r->>'operated_at') is null) <> ((r->>'operation_time_source') is null) then
      raise exception using errcode='22023', message='AR_DETAIL_OPERATION_SOURCE_REQUIRED';
    end if;
    if jsonb_typeof(r->'field_gaps') is distinct from 'array' then
      raise exception using errcode='22023', message='AR_DETAIL_INVALID_FIELD_GAPS';
    end if;
    if jsonb_array_length(r->'field_gaps')>11 or exists (
      select 1 from jsonb_array_elements(r->'field_gaps') a where jsonb_typeof(a)<>'string'
      or (a#>>'{}') not in ('payment_order_no_missing','work_order_no_missing','utr_missing',
        'kyc_unknown','utr_match_unknown','operator_missing','operation_time_missing',
        'attachment_type_unmapped','json_data_unmapped','remark_omitted','source_update_time_missing')) then
      raise exception using errcode='22023', message='AR_DETAIL_INVALID_FIELD_GAPS';
    end if;
    if r ? 'attachment_type_codes' and r->'attachment_type_codes'<>'null'::jsonb then
      if jsonb_typeof(r->'attachment_type_codes')<>'array' then
        raise exception using errcode='22023', message='AR_DETAIL_INVALID_ATTACHMENT_CODES';
      end if;
      if jsonb_array_length(r->'attachment_type_codes')>32 then
        raise exception using errcode='22023', message='AR_DETAIL_INVALID_ATTACHMENT_CODES';
      end if;
      for val in select value::text from jsonb_array_elements(r->'attachment_type_codes') loop
        if val !~ '^[0-9]+$' or length(val)>10 or val::numeric>2147483647 then
          raise exception using errcode='22023', message='AR_DETAIL_INVALID_ATTACHMENT_CODES';
        end if;
      end loop;
    end if;
    if r ? 'submitted_date' and r->'submitted_date'<>'null'::jsonb then
      if jsonb_typeof(r->'submitted_date')<>'string' or r->>'submitted_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode='22023', message='AR_DETAIL_INVALID_SUBMITTED_DATE';
      end if;
      begin qd:=(r->>'submitted_date')::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode='22023', message='AR_DETAIL_INVALID_SUBMITTED_DATE';
      end;
    end if;
    foreach k in array v_time_keys loop
      if r ? k and r->k <> 'null'::jsonb then
        val:=r->>k;
        if jsonb_typeof(r->k)<>'string' or val !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
          raise exception using errcode='22023', message='AR_DETAIL_INVALID_TIMESTAMP', detail=k;
        end if;
        begin ts:=val::timestamptz;
        exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then
          raise exception using errcode='22023', message='AR_DETAIL_INVALID_TIMESTAMP', detail=k;
        end;
        if not isfinite(ts) then
          raise exception using errcode='22023', message='AR_DETAIL_INVALID_TIMESTAMP', detail=k;
        end if;
      elsif k='observed_at' then
        raise exception using errcode='22023', message='AR_DETAIL_OBSERVED_AT_REQUIRED';
      end if;
    end loop;
    if jsonb_typeof(r->'query_date') is distinct from 'string'
      or (r->>'query_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='22023', message='AR_DETAIL_INVALID_QUERY_DATE';
    end if;
    begin qd:=(r->>'query_date')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023', message='AR_DETAIL_INVALID_QUERY_DATE';
    end;
    v_key:=jsonb_build_array(r->>'system_name',r->>'country_code',r->>'platform',r->>'work_order_id')::text;
    if v_key=any(v_seen) then
      raise exception using errcode='22023', message='AR_DETAIL_DUPLICATE_IDENTITY_IN_BATCH';
    end if;
    v_seen:=array_append(v_seen,v_key);
  end loop;

  for r in select value from jsonb_array_elements(p_rows) loop
    insert into public.ar_workorder_issue_details as target
      select (jsonb_populate_record(null::public.ar_workorder_issue_details,r)).*
    on conflict (system_name,country_code,platform,work_order_id) do update set
      country=excluded.country,
      tenant_id=coalesce(excluded.tenant_id,target.tenant_id),
      source_record_id=coalesce(excluded.source_record_id,target.source_record_id),
      work_order_no=coalesce(excluded.work_order_no,target.work_order_no),
      source_order_no=coalesce(excluded.source_order_no,target.source_order_no),
      payment_order_no=coalesce(excluded.payment_order_no,target.payment_order_no),
      utr=coalesce(excluded.utr,target.utr),
      issue_kind=excluded.issue_kind,
      work_order_type_id=coalesce(excluded.work_order_type_id,target.work_order_type_id),
      work_order_type_name=coalesce(excluded.work_order_type_name,target.work_order_type_name),
      work_order_name=coalesce(excluded.work_order_name,target.work_order_name),
      status_code=coalesce(excluded.status_code,target.status_code),
      amount=coalesce(excluded.amount,target.amount),
      third_party=coalesce(excluded.third_party,target.third_party),
      third_party_source_name=coalesce(excluded.third_party_source_name,target.third_party_source_name),
      third_party_mapping_code=coalesce(excluded.third_party_mapping_code,target.third_party_mapping_code),
      third_party_channel_id=coalesce(excluded.third_party_channel_id,target.third_party_channel_id),
      channel_type=coalesce(excluded.channel_type,target.channel_type),
      kyc_connected=coalesce(excluded.kyc_connected,target.kyc_connected),
      kyc_status_source=coalesce(excluded.kyc_status_source,target.kyc_status_source),
      utr_matched=coalesce(excluded.utr_matched,target.utr_matched),
      reminder_count=coalesce(excluded.reminder_count,target.reminder_count),
      attachment_types=coalesce(excluded.attachment_types,target.attachment_types),
      submitted_at=coalesce(excluded.submitted_at,target.submitted_at),
      operated_at=coalesce(excluded.operated_at,target.operated_at),
      operator_account=coalesce(excluded.operator_account,target.operator_account),
      source_updated_at=coalesce(excluded.source_updated_at,target.source_updated_at),
      query_basis=excluded.query_basis,
      submitted_date=coalesce(excluded.submitted_date,target.submitted_date),
      last_updated_by=coalesce(excluded.last_updated_by,target.last_updated_by),
      attachment_type_codes=coalesce(excluded.attachment_type_codes,target.attachment_type_codes),
      operation_time_source=coalesce(excluded.operation_time_source,target.operation_time_source),
      field_gaps=excluded.field_gaps,
      source_form_id=coalesce(excluded.source_form_id,target.source_form_id),
      source_type_code=coalesce(excluded.source_type_code,target.source_type_code),
      kyc_link_status_code=coalesce(excluded.kyc_link_status_code,target.kyc_link_status_code),
      is_locked_by_current_user=coalesce(excluded.is_locked_by_current_user,target.is_locked_by_current_user),
      source_vip_level=coalesce(excluded.source_vip_level,target.source_vip_level),
      source_pay_type_id=coalesce(excluded.source_pay_type_id,target.source_pay_type_id),
      observed_at=excluded.observed_at,query_date=excluded.query_date,schema_version=excluded.schema_version
    where excluded.observed_at>target.observed_at
      and (excluded.source_updated_at is null or target.source_updated_at is null
        or excluded.source_updated_at>=target.source_updated_at)
      -- Missing/null optional values preserve existing values. JSON false and 0
      -- are NOT null and must remain real updates. Equal replays do no writes.
      and to_jsonb(target) is distinct from
        (to_jsonb(target)||jsonb_strip_nulls(to_jsonb(excluded)));
    get diagnostics v_one=row_count;
    v_written:=v_written+v_one;
  end loop;
  return jsonb_build_object('accepted',v_count,'written',v_written);
end;
$rpc_body$;
begin
  -- Serialize installers without locking or modifying any existing business table.
  perform pg_advisory_xact_lock(hashtext('AR_WORKORDER_ISSUE_DETAILS_V2_20260927'));
  v_table:=to_regclass('public.ar_workorder_issue_details');
  v_function:=to_regprocedure('public.ingest_ar_workorder_issue_details_v2(jsonb)');
  if to_regprocedure('public.ingest_ar_workorder_issue_details_v1(jsonb)') is not null then
    raise exception 'AR_DETAIL_V1_REQUIRES_EXPLICIT_UPGRADE';
  end if;
  if (v_table is null) <> (v_function is null) then
    raise exception 'AR_DETAIL_INSTALL_INCOMPATIBLE_PARTIAL_OBJECTS';
  end if;
  if v_table is not null then
    select md5(jsonb_build_object(
      'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by a.attnum)
        from pg_attribute a where a.attrelid=v_table and a.attnum>0 and not a.attisdropped),
      'constraints',(select jsonb_agg(pg_get_constraintdef(c.oid) order by c.conname) from pg_constraint c where c.conrelid=v_table),
      'acl',(select relacl::text from pg_class where oid=v_table),
      'rls',(select relrowsecurity from pg_class where oid=v_table))::text) into v_signature;
    if obj_description(v_table,'pg_class') is distinct from v_marker||v_signature
      or obj_description(v_function,'pg_proc') is distinct from v_marker||md5(v_rpc_body)
      or not exists(select 1 from pg_proc where oid=v_function and prosrc=v_rpc_body
        and not prosecdef and prorettype='jsonb'::regtype and proargnames=array['p_rows']::text[]
        and proconfig=array['search_path=""']::text[])
      or has_function_privilege('anon',v_function,'execute')
      or has_function_privilege('authenticated',v_function,'execute')
      or not has_function_privilege('service_role',v_function,'execute') then
      raise exception 'AR_DETAIL_INSTALL_INCOMPATIBLE_EXISTING_OBJECTS';
    end if;
    return; -- Exact compatible reinstall is a no-op, never overwrites a function.
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ingest_ar_workorder_issue_details_v2') then
    raise exception 'AR_DETAIL_INSTALL_INCOMPATIBLE_FUNCTION_OVERLOAD';
  end if;
  execute $table$
    create table public.ar_workorder_issue_details (
      system_name text not null check(system_name='AR'),
      country_code text not null check(country_code ~ '^[A-Z]{2}$'),
      country text not null check(length(btrim(country)) between 1 and 200),
      platform text not null check(length(btrim(platform)) between 1 and 200),
      tenant_id text,
      work_order_id text not null check(length(btrim(work_order_id)) between 1 and 200),
      source_record_id text,work_order_no text,source_order_no text,payment_order_no text,utr text,
      issue_kind text not null check(issue_kind in ('deposit','withdraw')),
      work_order_type_id integer check(work_order_type_id>=0),
      work_order_type_name text,work_order_name text,
      status_code integer check(status_code between 1 and 5),
      amount numeric(24,8) check(amount>=0 and amount::text not in ('NaN','Infinity','-Infinity')),
      third_party text,third_party_source_name text,third_party_mapping_code text,
      third_party_channel_id text,channel_type text,
      kyc_connected boolean,kyc_status_source text,utr_matched boolean,
      reminder_count integer check(reminder_count>=0),attachment_types text[],
      submitted_at timestamptz check(isfinite(submitted_at)),
      operated_at timestamptz check(isfinite(operated_at)),operator_account text,
      source_updated_at timestamptz check(isfinite(source_updated_at)),
      observed_at timestamptz not null check(isfinite(observed_at)),
      query_date date not null check(isfinite(query_date)),
      schema_version integer not null check(schema_version=2),
      query_basis text not null check(query_basis in ('submission','operation')),
      submitted_date date check(isfinite(submitted_date)),
      last_updated_by text,
      attachment_type_codes integer[],
      operation_time_source text check(operation_time_source in ('operationTime','operateTime','lastUpdateTime')),
      field_gaps text[] not null,
      source_form_id integer check(source_form_id>=0),
      source_type_code integer check(source_type_code>=-1),
      kyc_link_status_code integer check(kyc_link_status_code>=0),
      is_locked_by_current_user boolean,
      source_vip_level text check(length(source_vip_level) between 1 and 32),
      source_pay_type_id integer check(source_pay_type_id>=0),
      check((operated_at is null)=(operation_time_source is null)),
      primary key(system_name,country_code,platform,work_order_id)
    )
  $table$;
  execute 'alter table public.ar_workorder_issue_details enable row level security';
  execute 'revoke all on public.ar_workorder_issue_details from public,anon,authenticated,service_role';
  execute 'grant select,insert,update on public.ar_workorder_issue_details to service_role';
  execute 'create index ar_workorder_issue_details_submitted_idx on public.ar_workorder_issue_details(country_code,platform,submitted_at desc) where submitted_at is not null';
  execute format('create function public.ingest_ar_workorder_issue_details_v2(p_rows jsonb) returns jsonb language plpgsql volatile security invoker set search_path=%L as %L','',v_rpc_body);
  execute 'revoke all on function public.ingest_ar_workorder_issue_details_v2(jsonb) from public,anon,authenticated,service_role';
  execute 'grant execute on function public.ingest_ar_workorder_issue_details_v2(jsonb) to service_role';
  v_table:='public.ar_workorder_issue_details'::regclass;
  select md5(jsonb_build_object(
    'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by a.attnum)
      from pg_attribute a where a.attrelid=v_table and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_agg(pg_get_constraintdef(c.oid) order by c.conname) from pg_constraint c where c.conrelid=v_table),
    'acl',(select relacl::text from pg_class where oid=v_table),
    'rls',(select relrowsecurity from pg_class where oid=v_table))::text) into v_signature;
  execute format('comment on table public.ar_workorder_issue_details is %L',v_marker||v_signature);
  execute format('comment on function public.ingest_ar_workorder_issue_details_v2(jsonb) is %L',v_marker||md5(v_rpc_body));
end;
$install$;
notify pgrst, 'reload schema';
commit;

