-- Current Sheet mirror and explicitly published XLSX candidates are separate sources.
-- No employee/portal rows or derived workbook summaries are added to Sheet money.
-- The import tables contain only approved reconciliation projection fields, no raw workbook.
-- Apply after review; this file neither imports source data nor changes role grants.
begin;
do $guard$
begin
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure
  and md5(prosrc)='d14d3905f57ea3260fca2b47e119c81d' and prosecdef and provolatile='s' and not proretset
  and proconfig=array['search_path=""','statement_timeout=20s']::text[]
  and prolang=(select oid from pg_language where lanname='plpgsql') and pg_get_userbyid(proowner)=current_user) then
  raise exception 'deposit_statistics_definition_changed';
 end if;
end;$guard$;
create table private.admin_deposit_kyc_import_batches (
 id uuid primary key, file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
 source_name text not null, source_category text not null check(source_category in ('kyc','non_kyc')),
 adapter_version text not null, expected_rows integer not null check(expected_rows between 0 and 500000),
 imported_rows integer not null default 0 check(imported_rows between 0 and 500000),
 complete boolean not null default false, imported_at timestamptz not null default now(),
 check(not complete or expected_rows=imported_rows), unique(file_sha256,adapter_version)
);
create table private.admin_deposit_kyc_observations (
 batch_id uuid not null references private.admin_deposit_kyc_import_batches(id),
 source_sheet text not null, source_row integer not null check(source_row>0),
 country_code text not null check(country_code='IN'), country text not null check(country='印度'),
 platform text not null check(length(platform) between 1 and 100),
 source_system text not null check(source_system in ('ar_export','dhani_export')),
 workorder_id text not null check(length(workorder_id) between 1 and 200),
 payment_order_id text check(payment_order_id is null or length(payment_order_id) between 1 and 200),
 submitted_local text, submitted_date date, source_updated_local text,
 source_workorder_state text, processing text not null check(processing in ('processed','rejected','unprocessed','unknown')),
 kyc_status text not null check(kyc_status in ('connected','disconnected','unknown')),
 amount numeric(24,2) check(amount>=0 and amount::text not in ('NaN','Infinity','-Infinity')), currency text check(currency ~ '^[A-Z]{3,6}$'), provider text,
 source_deposit_state text, utr_digest text check(utr_digest ~ '^[a-f0-9]{64}$'), utr_present boolean,
 source_conflict boolean not null default false,
 all_source_sheet text, all_source_row integer check(all_source_row>0),
 derived_match_basis text not null default 'unmatched' check(derived_match_basis in ('full_payment_id','same_member_amount','unmatched')),
 derived_check_state text, primary key(batch_id,source_sheet,source_row)
);
create index admin_deposit_kyc_scope_date on private.admin_deposit_kyc_observations(batch_id,country_code,platform,submitted_date);
create index admin_deposit_kyc_payment on private.admin_deposit_kyc_observations(batch_id,platform,payment_order_id);
create index admin_deposit_kyc_workorder on private.admin_deposit_kyc_observations(batch_id,platform,workorder_id);
alter table private.admin_deposit_kyc_import_batches enable row level security;
alter table private.admin_deposit_kyc_observations enable row level security;
revoke all on private.admin_deposit_kyc_import_batches,private.admin_deposit_kyc_observations from public,anon,authenticated,service_role;

-- Atomic publication barrier: incomplete uploads never appear in the reader.
create function private.dashboard_admin_deposit_kyc_publish(p_batch uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $publish$
declare b private.admin_deposit_kyc_import_batches; n integer;
begin
 select * into b from private.admin_deposit_kyc_import_batches where id=p_batch for update;
 if not found then raise exception 'import_batch_missing';end if;
 select count(*) into n from private.admin_deposit_kyc_observations where batch_id=p_batch;
 if n<>b.expected_rows then raise exception 'import_batch_incomplete';end if;
 update private.admin_deposit_kyc_import_batches set imported_rows=n,complete=true where id=p_batch;
 return jsonb_build_object('batch',p_batch,'rows',n,'complete',true);
end;$publish$;

-- Identity is authorized platform + full original payment order. An empty original
-- order never merges with a different row. Conflicting source rows are not picked first.
create function private.dashboard_admin_deposit_sheet_cases_v2(p_scope jsonb)
returns table(id text,source_row integer,platform text,country text,order_number text,utr text,amount numeric,
 provider text,canonical_provider text,match_status text,status text,confirmation_status text,upi_id text,kyc_upi_id text,
 kyc_correct text,utr_match text,provider_reply text,updated_at timestamptz,source_row_count bigint,variant_count bigint,source_rows integer[],sources jsonb)
language sql stable security invoker set search_path='' as $cases$
 with scoped as materialized (
  select r.*,private.dashboard_admin_live_deposit_platform_key('IN',r.platform) platform_key,
   coalesce(nullif(upper(btrim(r.order_number)),''),'ROW:'||r.id) order_key,
   jsonb_build_array(r.amount,r.provider,r.canonical_provider,r.utr,r.status,r.confirmation_status,
    r.match_status,r.kyc_correct,r.utr_match,r.provider_reply,r.upi_id,r.kyc_upi_id) semantic
  from public.admin_deposit_issue_rows r
  where r.stale_at is null and r.country='印度' and private.dashboard_scope_allows(p_scope,'IN',r.platform)
 ), positioned as materialized (select r.*,row_number() over(partition by platform_key,order_key order by source_sheet,source_tab,source_row,id) source_pos from scoped r),
 g as (
  select platform_key,order_key,min(id) row_id,count(*) n,count(distinct semantic) variants,
   array_agg(source_row order by source_row) filter(where source_pos<=200) source_rows,
   jsonb_agg(jsonb_build_object('sourceSheet',source_sheet,'sourceTab',source_tab,'sourceRow',source_row,'sourceId',id,
    'amount',amount,'provider',coalesce(nullif(canonical_provider,''),provider),'status',status,'confirmation',confirmation_status,'manualKyc',kyc_correct,'manualUtr',utr_match)
    order by source_sheet,source_tab,source_row) filter(where source_pos<=200) sources,max(updated_at) updated_at
  from positioned group by platform_key,order_key
 )
 select md5(jsonb_build_array(g.platform_key,g.order_key)::text),case when variants=1 then r.source_row end,
  g.platform_key,'印度',nullif(g.order_key,'ROW:'||r.id),case when variants=1 then r.utr end,
  case when variants=1 then r.amount end,case when variants=1 then r.provider else '来源冲突' end,
  case when variants=1 then r.canonical_provider else '来源冲突' end,
  case when variants=1 then r.match_status else '来源冲突' end,case when variants=1 then r.status else '来源冲突' end,
  case when variants=1 then r.confirmation_status else '来源冲突' end,
  case when variants=1 then r.upi_id end,case when variants=1 then r.kyc_upi_id end,
  case when variants=1 then r.kyc_correct end,case when variants=1 then r.utr_match end,
  case when variants=1 then r.provider_reply end,g.updated_at,n,variants,g.source_rows,g.sources
 from g join scoped r on r.id=g.row_id;
$cases$;

-- Counts use unique workorders; money uses original payment cases with explicit currency.
create function private.dashboard_admin_deposit_kyc_summary_v2(p_rows jsonb)
returns jsonb language sql stable security invoker set search_path='' as $summary$
 with w as materialized (
  select * from jsonb_to_recordset(p_rows) as r(wo_key text,case_key text,payment_id text,export_rows bigint,
   kyc text,processing text,case_processing text,amount numeric,currency text,match_status text,source_conflict boolean)
 ), c as materialized (select distinct case_key,payment_id,case_processing,amount,currency,match_status,source_conflict from w),
 m as (select count(*) n,count(*) filter(where amount is null or currency is null) missing,
  count(distinct currency) currencies,min(currency) currency,sum(amount) filter(where currency is not null) known_amount from c where payment_id is not null)
 select jsonb_build_object('exportRows',(select coalesce(sum(export_rows),0) from w),'uniqueWorkorders',(select count(*) from w),
  'uniquePaymentOrders',(select count(*) from c where payment_id is not null),
  'uniquePaymentAmount',case when m.missing=0 and m.currencies=1 then (select sum(amount) from c where payment_id is not null) end,
  'knownPaymentAmount',case when m.currencies=1 then m.known_amount end,'unknownAmountOrders',m.missing,
  'currency',case when m.currencies=1 and m.missing=0 then m.currency end,
  'duplicateExportRows',(select coalesce(sum(export_rows-1),0) from w),
  'multipleWorkorderPayments',(select count(*) from(select case_key from w where payment_id is not null group by case_key having count(*)>1)s),
  'processed',jsonb_build_object('count',(select count(*) from w where processing='processed'),'amount',case when m.missing=0 and m.currencies=1 then coalesce((select sum(amount) from c where case_processing='processed' and payment_id is not null),0) end),
  'rejected',jsonb_build_object('count',(select count(*) from w where processing='rejected'),'amount',case when m.missing=0 and m.currencies=1 then coalesce((select sum(amount) from c where case_processing='rejected' and payment_id is not null),0) end),
  'unprocessed',jsonb_build_object('count',(select count(*) from w where processing='unprocessed'),'amount',case when m.missing=0 and m.currencies=1 then coalesce((select sum(amount) from c where case_processing='unprocessed' and payment_id is not null),0) end),
  'unknownProcessing',jsonb_build_object('count',(select count(*) from w where processing='unknown')),
  'matchCounts',jsonb_build_object('exact_unique',(select count(*) from c where match_status='exact_unique'),
   'exact_duplicate',(select count(*) from c where match_status='exact_duplicate'),'amount_conflict',(select count(*) from c where match_status='amount_conflict'),
   'ambiguous_online',(select count(*) from c where match_status='ambiguous_online'),'online_amount_missing',(select count(*) from c where match_status='online_amount_missing'),
   'unmatched',(select count(*) from c where match_status='unmatched'),'platform_not_in_online_snapshot',(select count(*) from c where match_status='platform_not_in_online_snapshot'),
   'missing_rc',(select count(*) from c where match_status='missing_rc'),'source_conflict',(select count(*) from c where match_status='source_conflict')),
  'processingAmountBasis','unique_payment_orders_single_processing_state') from m;
$summary$;

create function private.dashboard_admin_deposit_kyc_statistics(p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $kyc$
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
 with batches as materialized (
  select distinct on (source_category) * from private.admin_deposit_kyc_import_batches
  where complete and imported_rows=expected_rows order by source_category,imported_at desc,id desc
 ), raw as materialized (
  select o.*,b.source_name,b.source_category,private.dashboard_admin_live_deposit_platform_key('IN',o.platform) platform_key,
   jsonb_build_array(o.country_code,private.dashboard_admin_live_deposit_platform_key('IN',o.platform),o.source_system,o.workorder_id)::text wo_key
  from private.admin_deposit_kyc_observations o join batches b on b.id=o.batch_id
  where private.dashboard_scope_allows(v_scope,o.country_code,o.platform)
 ), wo as materialized (
  select wo_key,min(platform_key) platform,min(workorder_id) workorder_id,count(*) export_rows,
   case when count(distinct coalesce(nullif(payment_order_id,''),'(missing)'))=1 then nullif(upper(btrim(min(payment_order_id))),'') end payment_id,
   case when count(distinct kyc_status)=1 then min(kyc_status) else 'unknown' end kyc,
   case when count(distinct processing)=1 and not bool_or(source_conflict) then min(processing) else 'unknown' end processing,
   case when count(distinct source_workorder_state)=1 then min(source_workorder_state) else '源状态有变化' end source_workorder_state,
   case when count(distinct coalesce(amount::text,'(missing)'))=1 then min(amount) end amount,
   case when count(distinct coalesce(currency,'(missing)'))=1 then min(currency) end currency,
   case when count(distinct coalesce(provider,'(missing)'))=1 then min(provider) else '来源冲突' end provider,
   case when count(distinct coalesce(submitted_date::text,'(missing)'))=1 then min(submitted_date) end submitted_date,min(source_name) source_file,min(source_sheet) source_tab,min(source_row) source_row,
   string_agg(distinct source_category,',' order by source_category) declared_file_kyc,
   count(distinct kyc_status)>1 or count(distinct source_category)>1 kyc_changed,
   bool_or(source_conflict) or count(distinct coalesce(amount::text,'(missing)'))<>1 or count(distinct coalesce(nullif(payment_order_id,''),'(missing)'))<>1 source_conflict,
   case when count(distinct source_deposit_state)=1 then min(source_deposit_state) end source_deposit_state,
   case when count(distinct utr_digest)=1 then min(utr_digest) end utr_digest,
   bool_or(utr_present) utr_present,count(distinct utr_digest)>1 utr_conflict,
   string_agg(distinct derived_match_basis,',' order by derived_match_basis) derived_match_basis,
   string_agg(distinct derived_check_state,',' order by derived_check_state) derived_check_state
  from raw group by wo_key
 ), keyed as materialized (select w.*,jsonb_build_array(platform,coalesce(payment_id,'WORKORDER:'||wo_key))::text case_key from wo w),
 cases as materialized (
  select case_key,min(platform) platform,min(payment_id) payment_id,
   case when count(distinct coalesce(amount::text,'(missing)'))=1 and not bool_or(source_conflict) then min(amount) end amount,
   case when count(distinct coalesce(currency,'(missing)'))=1 then min(currency) end currency,
   case when count(distinct coalesce(provider,'(missing)'))=1 then min(provider) else '来源冲突' end provider,
   case when count(distinct processing)=1 then min(processing) else 'unknown' end case_processing,
   bool_or(source_conflict) or count(distinct coalesce(amount::text,'(missing)'))<>1 source_conflict,
   case when count(distinct utr_digest)=1 then min(utr_digest) end utr_digest,
   bool_or(utr_present) utr_present,bool_or(utr_conflict) or count(distinct utr_digest)>1 utr_conflict
  from keyed group by case_key
 ), online as materialized (select * from private.dashboard_admin_deposit_sheet_cases_v2(v_scope)),
 online_platforms as (select distinct platform from online),
 followups as materialized (
  select private.dashboard_admin_live_deposit_platform_key('IN',f.platform) platform,upper(btrim(f.order_number)) payment_id,f.amount,count(*) followup_count,
   (array_agg(f.followup_at order by f.followup_date desc nulls last,f.source_row desc))[1] last_followup_at
  from public.admin_deposit_followup_rows f
  where f.country='印度' and f.stale_at is null and f.source_kind='sheet' and f.amount is not null and private.dashboard_scope_allows(v_scope,'IN',f.platform)
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
  from cases c left join online o on o.platform=c.platform and o.order_number=upper(btrim(c.payment_id))
   left join followups f on f.platform=c.platform and f.payment_id=upper(btrim(c.payment_id)) and c.amount is not null and f.amount=c.amount
 ), eligible as materialized (
  select w.wo_key,w.workorder_id,w.export_rows,w.kyc,w.processing,w.source_workorder_state,w.submitted_date,
   w.source_file,w.source_tab,w.source_row,w.declared_file_kyc,w.kyc_changed,w.source_deposit_state,w.derived_match_basis,w.derived_check_state,c.*
  from keyed w join matched c using(case_key)
  where (v_dates='all' or exists(select 1 from raw observed where observed.wo_key=w.wo_key and observed.submitted_date between v_start and v_end))
   and (coalesce(p_request->>'platform','') in ('','all') or c.platform=private.dashboard_admin_live_deposit_platform_key('IN',p_request->>'platform'))
   and (coalesce(p_request->>'provider','') in ('','all') or c.provider=p_request->>'provider')
   and (coalesce(p_request->>'query','')='' or strpos(lower(coalesce(c.payment_id,'')),lower(p_request->>'query'))>0 or strpos(lower(w.workorder_id),lower(p_request->>'query'))>0)
   and (v_processing='all' or w.processing=v_processing) and (v_match='all' or c.match_status=v_match)
 ), filtered as materialized (select * from eligible where v_kyc='all' or kyc=v_kyc),
 groups as (
  select case v_dimension when 'platform' then platform when 'provider' then coalesce(provider,'未提供') when 'date' then coalesce(submitted_date::text,'未提供') end key,
   jsonb_agg(jsonb_build_object('wo_key',wo_key,'case_key',case_key,'payment_id',payment_id,'export_rows',export_rows,
    'kyc',kyc,'processing',processing,'case_processing',case_processing,'amount',amount,'currency',currency,'match_status',match_status,'source_conflict',source_conflict)) items
  from filtered group by 1
 ), group_items as (select key,private.dashboard_admin_deposit_kyc_summary_v2(items)||jsonb_build_object('key',key,'label',key) item from groups),
 provenance as (select r.*,f.case_key,row_number() over(partition by f.case_key order by r.source_name,r.source_sheet,r.source_row) source_pos from raw r join filtered f on f.wo_key=r.wo_key),
 order_items as (
  select md5(case_key) key,jsonb_build_object('id',md5(case_key),'platform',min(platform),'paymentOrderId',min(payment_id),
   'workOrderId',string_agg(distinct workorder_id,', ' order by workorder_id),'workorderCount',count(*),'exportRows',sum(export_rows),
   'kycStatus',case when count(distinct kyc)=1 then min(kyc) else 'unknown' end,'declaredFileKyc',string_agg(distinct declared_file_kyc,', '),
   'hasKycCategoryChange',bool_or(kyc_changed) or count(distinct kyc)>1,'manualKyc',min(manual_kyc),'manualUtr',min(manual_utr),
   'provider',min(provider),'amount',min(amount),'currency',min(currency),'sourceWorkorderState',string_agg(distinct source_workorder_state,', '),
   'sourceDepositState',string_agg(distinct source_deposit_state,', '),'onlineState',min(online_state),'onlineSourceCount',max(online_source_count),'onlineSourcesTruncated',coalesce(max(online_source_count)>200,false),'onlineSources',(select m.online_sources from matched m where m.case_key=filtered.case_key),'matchStatus',min(match_status),
   'utrState',min(utr_state),'receiptState','unverified','sourceUtrPresent',bool_or(utr_present),'onlineUtrPresent',bool_or(online_utr_present),
   'sourceFile',string_agg(distinct source_file,', '),'sourceTab',case when count(distinct source_tab)=1 then min(source_tab) end,
   'sourceRow',case when sum(export_rows)=1 then min(source_row) end,
   'sources',(select jsonb_agg(jsonb_build_object('sourceFile',p.source_name,'sourceTab',p.source_sheet,'sourceRow',p.source_row,
    'allSourceTab',p.all_source_sheet,'allSourceRow',p.all_source_row,'sourceSystem',p.source_system,
    'workOrderId',p.workorder_id,'amount',p.amount,'currency',p.currency,'sourceWorkorderState',p.source_workorder_state,'kycStatus',p.kyc_status,'derivedMatchBasis',p.derived_match_basis,'derivedCheckState',p.derived_check_state)
    order by p.source_name,p.source_sheet,p.source_row) from provenance p where p.case_key=filtered.case_key and p.source_pos<=200),
   'sourceCount',sum(export_rows),'sourcesTruncated',sum(export_rows)>200,
   'derivedMatchBasis',string_agg(distinct derived_match_basis,', '),'derivedCheckState',string_agg(distinct derived_check_state,', '),
   'followupCount',max(followup_count),'lastFollowupAt',min(last_followup_at),'providerReply',min(provider_reply)) item
  from filtered group by case_key
 ), chosen as (select * from order_items where v_dimension='orders' union all select * from group_items where v_dimension<>'orders'),
 paged as (select * from chosen order by key offset v_offset limit v_limit),
 stats as (select private.dashboard_admin_deposit_kyc_summary_v2(coalesce(jsonb_agg(jsonb_build_object('wo_key',wo_key,'case_key',case_key,'payment_id',payment_id,'export_rows',export_rows,
  'kyc',kyc,'processing',processing,'case_processing',case_processing,'amount',amount,'currency',currency,'match_status',match_status,'source_conflict',source_conflict)),'[]'::jsonb)) value from filtered)
 select jsonb_build_object('version',2,'section','kyc','source','imported-workorder-candidates','dimension',v_dimension,'summary',stats.value,
  'kycSummary',jsonb_build_object('connected',jsonb_build_object('count',(select count(*) from eligible where kyc='connected')),
   'disconnected',jsonb_build_object('count',(select count(*) from eligible where kyc='disconnected')),'unknown',jsonb_build_object('count',(select count(*) from eligible where kyc='unknown'))),
  'rows',coalesce((select jsonb_agg(item order by key) from paged),'[]'::jsonb),'total',(select count(*) from chosen),'offset',v_offset,'limit',v_limit,
  'currency',stats.value->'currency','scopeLabel','三方未补候选 · 原工单连接状态','kycBasisLabel','按原导出连接字段及唯一工单分类',
  'updatedAt',(select max(imported_at) from batches),'coverage',jsonb_build_object('complete',(select count(*)=2 from batches),
   'label',case when (select count(*) from batches)=2 then '两份已发布候选；金额币种与实际到账仍待核实' else '缺少已完成候选导入；缺失来源不按零计' end),
  'sourceManifest',jsonb_build_object('batches',coalesce((select jsonb_agg(jsonb_build_object('label',b.source_name,'category',b.source_category,'rowCount',(select count(*) from raw r where r.batch_id=b.id),'complete',b.complete) order by b.source_category) from batches b),'[]'::jsonb)),
  'options',jsonb_build_object('platforms',coalesce((select jsonb_agg(x order by x) from(select distinct platform x from wo)s),'[]'::jsonb),
   'providers',coalesce((select jsonb_agg(x order by x) from(select distinct provider x from cases where provider is not null)s),'[]'::jsonb))
 ) into v_result from stats;
 if not exists(select 1 from private.admin_deposit_kyc_import_batches where complete) then
  v_result:=jsonb_set(v_result,'{summary}',jsonb_build_object('exportRows',null,'uniqueWorkorders',null,'uniquePaymentOrders',null,
   'uniquePaymentAmount',null,'duplicateExportRows',null,'multipleWorkorderPayments',null,'processed',jsonb_build_object('count',null,'amount',null),
   'rejected',jsonb_build_object('count',null,'amount',null),'unprocessed',jsonb_build_object('count',null,'amount',null),
   'unknownProcessing',jsonb_build_object('count',null),'matchCounts','{}'::jsonb));
  v_result:=jsonb_set(v_result,'{total}','null'::jsonb);
  v_result:=jsonb_set(v_result,'{kycSummary}',jsonb_build_object('connected',jsonb_build_object('count',null),'disconnected',jsonb_build_object('count',null),'unknown',jsonb_build_object('count',null)));
 end if;
 return v_result;
end;$kyc$;

create function private.dashboard_admin_deposit_sheet_statistics_v2(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope(); v_section text:=coalesce(p_request->>'section','summary');
 v_dates text:=coalesce(p_request->>'dateMode','all');v_start date;v_end date;v_offset int:=0;v_limit int:=20;v_result jsonb;v_key text;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>12000
 or p_request-array['section','dateMode','startAt','endAt','country','platform','provider','status','match','confirmation','orderNumber','utr','upiId','kycUpiId','reply','utrMatch','kycCorrect','amountMin','amountMax','offset','limit']<>'{}'::jsonb then raise exception 'invalid_request';end if;
 if p_request ? 'section' and jsonb_typeof(p_request->'section')<>'string' or p_request ? 'dateMode' and jsonb_typeof(p_request->'dateMode')<>'string' then raise exception 'invalid_view';end if;
 if v_section not in ('summary','details','providers','daily') or v_dates not in ('all','range') then raise exception 'invalid_view';end if;
 foreach v_key in array array['country','platform','provider','status','match','confirmation','orderNumber','utr','upiId','kycUpiId','reply','utrMatch','kycCorrect'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then raise exception 'invalid_filter';end if;
 end loop;
 foreach v_key in array array['amountMin','amountMax'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or (p_request->>v_key)::numeric<0) then raise exception 'invalid_amount';end if;
 end loop;
 if (p_request->>'amountMin')::numeric>(p_request->>'amountMax')::numeric then raise exception 'invalid_amount';end if;
 foreach v_key in array array['offset','limit'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then raise exception 'invalid_pagination';end if;
 end loop;
 v_offset:=coalesce((p_request->>'offset')::int,0);v_limit:=coalesce((p_request->>'limit')::int,20);
 if v_offset>1000000 or v_limit not in (20,50,100) then raise exception 'invalid_pagination';end if;
 if v_dates='range' then
  if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T' or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T' then raise exception 'invalid_dates';end if;
  v_start:=left(p_request->>'startAt',10)::date;v_end:=left(p_request->>'endAt',10)::date;
  if v_start>v_end or v_end-v_start>366 then raise exception 'invalid_dates';end if;
 end if;
 with base as materialized (
  select r.*,case upper(trim(r.platform)) when 'RAJA' then 'RAJALOTTERY' when 'INDIA82' then '82LOTTERY' else r.platform end display_platform,
   coalesce(nullif(r.canonical_provider,''),nullif(r.provider,''),'未填写') display_provider,
   case when private.workorder_receipt_date(r.order_number)<=(now() at time zone 'Asia/Kolkata')::date then private.workorder_receipt_date(r.order_number) end order_date,
   private.workorder_receipt_days(r.order_number) age,
   coalesce(nullif(r.confirmation_status,''),'未分类') confirmation,
   case when r.variant_count>1 then 'conflict' when r.confirmation_status='已入款' then 'received' when r.confirmation_status='入其他订单' then 'other_order'
    when r.confirmation_status='转其他三方' then 'other_provider' when r.status='未入款' then 'unreceived' else 'unclassified' end statistics_status
  from private.dashboard_admin_deposit_sheet_cases_v2(v_scope) r
  where (coalesce(p_request->>'country','') in ('','all','印度','IN'))
 ), filtered as materialized (
  select * from base r where (v_dates='all' or r.order_date between v_start and v_end)
   and (coalesce(p_request->>'platform','') in ('','all') or r.display_platform=p_request->>'platform')
   and (coalesce(p_request->>'provider','') in ('','all') or r.display_provider=p_request->>'provider')
   and (coalesce(p_request->>'status','') in ('','all') or r.status=p_request->>'status')
   and (coalesce(p_request->>'match','') in ('','all') or r.match_status=case p_request->>'match' when 'matched' then '对得上' when 'unmatched' then '对不上' else p_request->>'match' end)
   and (coalesce(p_request->>'confirmation','') in ('','all') or r.confirmation=p_request->>'confirmation')
   and (coalesce(p_request->>'orderNumber','')='' or strpos(lower(coalesce(r.order_number,'')),lower(p_request->>'orderNumber'))>0)
   and (coalesce(p_request->>'utr','')='' or strpos(lower(coalesce(r.utr,'')),lower(p_request->>'utr'))>0)
   and (coalesce(p_request->>'upiId','')='' or strpos(lower(coalesce(r.upi_id,'')),lower(p_request->>'upiId'))>0)
   and (coalesce(p_request->>'kycUpiId','')='' or strpos(lower(coalesce(r.kyc_upi_id,'')),lower(p_request->>'kycUpiId'))>0)
   and (coalesce(p_request->>'reply','')='' or strpos(lower(coalesce(r.provider_reply,'')),lower(p_request->>'reply'))>0)
   and (coalesce(p_request->>'utrMatch','') in ('','all') or upper(r.utr_match)=upper(p_request->>'utrMatch'))
   and (coalesce(p_request->>'kycCorrect','') in ('','all') or upper(r.kyc_correct)=upper(p_request->>'kycCorrect'))
   and (not p_request ? 'amountMin' or r.amount>=(p_request->>'amountMin')::numeric)
   and (not p_request ? 'amountMax' or r.amount<=(p_request->>'amountMax')::numeric)
 ), details as (
  select jsonb_build_object('id',id,'platform',display_platform,'provider',display_provider,'rawProvider',provider,'orderNumber',order_number,'utr',utr,'amount',amount,
   'upiId',upi_id,'kycUpiId',kyc_upi_id,'kycCorrect',kyc_correct,'utrMatch',utr_match,'providerReply',provider_reply,'matchStatus',match_status,'status',status,
   'confirmation',confirmation,'statisticsStatus',statistics_status,'orderDate',order_date,'daysSinceOrder',age,'sourceRow',source_row,'sourceRows',source_rows,'sources',sources,'sourceCount',source_row_count,'sourcesTruncated',source_row_count>200,'sourceRowCount',source_row_count,'duplicateRows',source_row_count-variant_count,'collapsedRows',source_row_count-1,'conflict',variant_count>1,'variantCount',variant_count) item,
   row_number() over(order by order_date desc nulls last,display_platform,source_row,id) ord from filtered
 ), providers as (
  select jsonb_build_object('provider',display_provider,'matchStatus',match_status,'confirmation',confirmation,'count',count(*),'amount',case when count(*) filter(where amount is null)=0 then coalesce(sum(amount),0) end,'knownAmount',sum(amount),'unknownAmountCount',count(*) filter(where amount is null),'rawRowCount',coalesce(sum(source_row_count),0),'duplicateRows',coalesce(sum(source_row_count-variant_count),0),'collapsedRows',coalesce(sum(source_row_count-1),0),'conflictCount',count(*) filter(where statistics_status='conflict'),'conflictCases',count(*) filter(where statistics_status='conflict'),
   'otherOrderCount',count(*) filter(where statistics_status='other_order'),'otherOrderAmount',case when count(*) filter(where (statistics_status='other_order') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='other_order'),0) end,
   'otherProviderCount',count(*) filter(where statistics_status='other_provider'),'otherProviderAmount',case when count(*) filter(where (statistics_status='other_provider') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='other_provider'),0) end,
   'unclassifiedCount',count(*) filter(where statistics_status in ('unclassified','conflict')),'unclassifiedAmount',case when count(*) filter(where (statistics_status in ('unclassified','conflict')) and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status in ('unclassified','conflict')),0) end,
   'receivedCount',count(*) filter(where statistics_status='received'),'receivedAmount',case when count(*) filter(where (statistics_status='received') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='received'),0) end,'unreceivedCount',count(*) filter(where statistics_status='unreceived'),
   'unreceivedAmount',case when count(*) filter(where (statistics_status='unreceived') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived'),0) end,'maxDays',max(age) filter(where statistics_status='unreceived')) item,
   row_number() over(order by case when count(*) filter(where (statistics_status='unreceived') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived'),0) end desc,display_provider,match_status,confirmation) ord
  from filtered group by display_provider,match_status,confirmation
 ), daily as (
  select jsonb_build_object('date',order_date,'count',count(*),'amount',case when count(*) filter(where amount is null)=0 then coalesce(sum(amount),0) end,'knownAmount',sum(amount),'unknownAmountCount',count(*) filter(where amount is null),'rawRowCount',coalesce(sum(source_row_count),0),'duplicateRows',coalesce(sum(source_row_count-variant_count),0),'collapsedRows',coalesce(sum(source_row_count-1),0),'conflictCount',count(*) filter(where statistics_status='conflict'),'conflictCases',count(*) filter(where statistics_status='conflict'),
   'otherOrderCount',count(*) filter(where statistics_status='other_order'),'otherOrderAmount',case when count(*) filter(where (statistics_status='other_order') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='other_order'),0) end,
   'otherProviderCount',count(*) filter(where statistics_status='other_provider'),'otherProviderAmount',case when count(*) filter(where (statistics_status='other_provider') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='other_provider'),0) end,
   'unclassifiedCount',count(*) filter(where statistics_status in ('unclassified','conflict')),'unclassifiedAmount',case when count(*) filter(where (statistics_status in ('unclassified','conflict')) and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status in ('unclassified','conflict')),0) end,
   'receivedCount',count(*) filter(where statistics_status='received'),'receivedAmount',case when count(*) filter(where (statistics_status='received') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='received'),0) end,
   'unreceivedCount',count(*) filter(where statistics_status='unreceived'),'unreceivedAmount',case when count(*) filter(where (statistics_status='unreceived') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived'),0) end,
   'confirmedCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),
   'confirmedAmount',case when count(*) filter(where (statistics_status='unreceived' and match_status='对得上' and confirmation='已确认') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),0) end,
   'pendingVerificationCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),
   'pendingVerificationAmount',case when count(*) filter(where (statistics_status='unreceived' and match_status='对得上' and confirmation='待核实') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),0) end,
   'unmatchedCount',count(*) filter(where match_status='对不上'),'undatedCount',count(*) filter(where order_date is null)) item,
   row_number() over(order by order_date desc nulls last) ord from filtered group by order_date
 ), chosen as (select * from details where v_section='details' union all select * from providers where v_section='providers' union all select * from daily where v_section='daily')
 select jsonb_build_object('version',2,'section',v_section,'source','sheet-reconciliation','coverage',jsonb_build_object('complete',false,'label','表格当前镜像；未保存同步批次完成回执'),'updatedAt',(select max(updated_at) from base),
  'total',(select count(*) from chosen),'rows',coalesce((select jsonb_agg(item order by ord) from chosen where ord>v_offset and ord<=v_offset+v_limit),'[]'::jsonb),
  'providerSummary',coalesce((select jsonb_agg(item order by ord) from providers where ord<=8),'[]'::jsonb),
  'dailySummary',coalesce((select jsonb_agg(item order by ord) from daily where ord<=8),'[]'::jsonb),
  'facets',jsonb_build_object('platforms',(select coalesce(jsonb_agg(x order by x),'[]') from(select distinct display_platform x from base)d),
   'providers',(select coalesce(jsonb_agg(x order by x),'[]') from(select distinct display_provider x from base)d),
   'confirmations',(select coalesce(jsonb_agg(x order by x),'[]') from(select distinct confirmation x from base)d)),
  'summary',(select jsonb_build_object('count',count(*),'amount',case when count(*) filter(where amount is null)=0 then coalesce(sum(amount),0) end,'knownAmount',sum(amount),'unknownAmountCount',count(*) filter(where amount is null),'rawRowCount',coalesce(sum(source_row_count),0),'duplicateRows',coalesce(sum(source_row_count-variant_count),0),'collapsedRows',coalesce(sum(source_row_count-1),0),'conflictCount',count(*) filter(where statistics_status='conflict'),'conflictCases',count(*) filter(where statistics_status='conflict'),
   'otherOrderCount',count(*) filter(where statistics_status='other_order'),'otherOrderAmount',case when count(*) filter(where (statistics_status='other_order') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='other_order'),0) end,
   'otherProviderCount',count(*) filter(where statistics_status='other_provider'),'otherProviderAmount',case when count(*) filter(where (statistics_status='other_provider') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='other_provider'),0) end,
   'unclassifiedCount',count(*) filter(where statistics_status in ('unclassified','conflict')),'unclassifiedAmount',case when count(*) filter(where (statistics_status in ('unclassified','conflict')) and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status in ('unclassified','conflict')),0) end,
   'receivedCount',count(*) filter(where statistics_status='received'),'receivedAmount',case when count(*) filter(where (statistics_status='received') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='received'),0) end,
   'unreceivedCount',count(*) filter(where statistics_status='unreceived'),'unreceivedAmount',case when count(*) filter(where (statistics_status='unreceived') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived'),0) end,
   'confirmedCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),
   'confirmedAmount',case when count(*) filter(where (statistics_status='unreceived' and match_status='对得上' and confirmation='已确认') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),0) end,
   'pendingVerificationCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),
   'pendingVerificationAmount',case when count(*) filter(where (statistics_status='unreceived' and match_status='对得上' and confirmation='待核实') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),0) end,
   'unmatchedCount',count(*) filter(where match_status='对不上'),'undatedCount',count(*) filter(where order_date is null)) from filtered)) into v_result;
 return v_result;
end;$$;

-- Existing authenticated entry and session/scope chain are retained.
create or replace function private.dashboard_admin_deposit_statistics(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='20s' as $route$
begin
 if p_request->>'section'='kyc' then return private.dashboard_admin_deposit_kyc_statistics(p_request);end if;
 return private.dashboard_admin_deposit_sheet_statistics_v2(p_request);
end;$route$;

-- The assigned-role gateway enforces order detail permission server-side too.
do $gateway$
declare d text;old_predicate constant text := $predicate$or action='depositStatistics' and p_request->>'section'='details'$predicate$;
 new_predicate constant text := $predicate$or action='depositStatistics' and (p_request->>'section'='details' or p_request->>'section'='kyc' and p_request->>'dimension'='orders')$predicate$;
begin
 if not exists(select 1 from pg_proc where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure
  and md5(prosrc)='58412f1681b8e151d8e1f603bcbaec85' and prosecdef and provolatile='v' and not proretset
  and proconfig=array['search_path=""']::text[] and prolang=(select oid from pg_language where lanname='plpgsql')
  and pg_get_userbyid(proowner)=current_user) then
  raise exception 'deposit_gateway_definition_changed';
 end if;
 d:=pg_get_functiondef('public.dashboard_admin_execute(text,jsonb)'::regprocedure);
 if length(d)-length(replace(d,old_predicate,''))<>length(old_predicate) then raise exception 'deposit_gateway_predicate_changed';end if;
 execute replace(d,old_predicate,new_predicate);
end;$gateway$;

-- New internal tables/functions are owner-only even under nonstandard defaults.
do $acl$
declare r record;a record;
begin
 for r in select c.oid,c.oid::regclass::text object,c.relowner owner from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('admin_deposit_kyc_import_batches','admin_deposit_kyc_observations') loop
  for a in select distinct x.grantee from aclexplode(coalesce((select relacl from pg_class where oid=r.oid),acldefault('r',r.owner))) x where x.grantee<>r.owner loop
   execute format('revoke all on table %s from %s',r.object,case when a.grantee=0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end);
  end loop;
 end loop;
 for r in select p.oid,p.oid::regprocedure::text object,p.proowner owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in ('dashboard_admin_deposit_kyc_publish','dashboard_admin_deposit_sheet_cases_v2','dashboard_admin_deposit_kyc_summary_v2','dashboard_admin_deposit_kyc_statistics','dashboard_admin_deposit_sheet_statistics_v2') loop
  for a in select distinct x.grantee from aclexplode(coalesce((select proacl from pg_proc where oid=r.oid),acldefault('f',r.owner))) x where x.grantee<>r.owner loop
   execute format('revoke all on function %s from %s',r.object,case when a.grantee=0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end);
  end loop;
 end loop;
end;$acl$;
commit;
