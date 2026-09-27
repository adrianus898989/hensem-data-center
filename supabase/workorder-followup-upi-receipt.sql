-- Additive release: preserve existing histories, scope checks and function ACLs.
begin;
-- Owner authorized the two UPI columns; other payment-identity columns stay excluded.
alter table public.admin_deposit_issue_rows add column if not exists stale_at timestamptz;
alter table public.admin_deposit_followup_rows add column if not exists stale_at timestamptz;
alter table public.admin_deposit_issue_rows add column if not exists upi_id text;
alter table public.admin_deposit_issue_rows add column if not exists kyc_upi_id text;
alter table public.admin_deposit_followup_rows add column if not exists upi_id text;
alter table public.admin_deposit_followup_rows add column if not exists kyc_upi_id text;
create or replace function private.workorder_receipt_date(p_order text)
returns date language plpgsql immutable set search_path='' as $$
declare value text:=upper(btrim(coalesce(p_order,''))); parsed date;
begin
 if value !~ '^RC[0-9]{8}' then return null; end if;
 begin parsed:=make_date(substring(value,3,4)::integer,substring(value,7,2)::integer,substring(value,9,2)::integer);
 exception when others then return null; end;
 return parsed;
end;
$$;
create or replace function private.workorder_receipt_days(p_order text,p_now timestamptz default now())
returns integer language sql stable set search_path='' as $$
 select case when private.workorder_receipt_date(p_order)<=(p_now at time zone 'Asia/Kolkata')::date
 then (p_now at time zone 'Asia/Kolkata')::date-private.workorder_receipt_date(p_order) end;
$$;
revoke all on function private.workorder_receipt_date(text),private.workorder_receipt_days(text,timestamptz) from public,anon,authenticated;
grant execute on function private.workorder_receipt_date(text),private.workorder_receipt_days(text,timestamptz) to service_role;

create or replace function private.dashboard_admin_live_deposit_issues(p_request jsonb default '{}'::jsonb)
-- Scoped CTEs can be estimated as one row despite holding thousands of sheet
-- records. Prefer hash/merge joins for this one RPC to avoid quadratic matching.
-- Function-local settings are restored on return; other reports are unchanged.
returns jsonb language plpgsql stable security definer set search_path='' set enable_nestloop=off set jit=off as $$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();
 v_start date; v_end date; v_country text; v_platform text; v_provider text;
 v_status text:='all'; v_query text; v_offset integer:=0; v_limit integer:=20;
 v_view text:=coalesce(p_request->>'view','results');
 v_dates text:=coalesce(p_request->>'dateMode','range');
 v_match text:=coalesce(p_request->>'match','all');
 v_followup text:=nullif(btrim(p_request->>'followupStatus'),'');
 v_source_kind text:=coalesce(p_request->>'sourceKind','all');
 v_order text; v_workorder text; v_utr text; v_reply text; v_utr_match text; v_kyc text; v_staff text; v_upi text; v_kyc_upi text;
 v_amount_min numeric; v_amount_max numeric;
 v_key text; v_result jsonb;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
  or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
   'startAt','endAt','country','platform','provider','status','query','offset','limit','view','dateMode','match','followupStatus',
   'orderNumber','workOrderNumber','utr','reply','utrMatch','kycCorrect','staffCode','upiId','kycUpiId','sourceKind','amountMin','amountMax'])) then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 foreach v_key in array array['country','platform','provider','status','query','view','dateMode','match','followupStatus','orderNumber','workOrderNumber','utr','reply','utrMatch','kycCorrect','staffCode','upiId','kycUpiId','sourceKind'] loop
  if p_request ? v_key and p_request->v_key<>'null'::jsonb and
   (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
   raise exception using errcode='22023',message='invalid_filter';
  end if;
 end loop;
 foreach v_key in array array['offset','limit'] loop
  if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,7}$') then
   raise exception using errcode='22023',message='invalid_pagination';
  end if;
 end loop;
 if v_view not in ('results','entries') or v_dates not in ('range','all') or v_match not in ('all','matched','unmatched','unknown') or v_source_kind not in ('all','sheet','portal') then
  raise exception using errcode='22023',message='invalid_filter';
 end if;
 foreach v_key in array array['amountMin','amountMax'] loop
  if p_request ? v_key then
   if jsonb_typeof(p_request->v_key)<>'number' then raise exception using errcode='22023',message='invalid_amount';end if;
   if (p_request->>v_key)::numeric<0 or (p_request->>v_key)::numeric>1e18 then raise exception using errcode='22023',message='invalid_amount';end if;
  end if;
 end loop;
 v_amount_min:=(p_request->>'amountMin')::numeric;v_amount_max:=(p_request->>'amountMax')::numeric;
 if v_amount_min>v_amount_max then raise exception using errcode='22023',message='invalid_amount_range';end if;
 begin
  if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
   or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
   raise exception using errcode='22023',message='invalid_time';
  end if;
  v_start:=left(p_request->>'startAt',10)::date;v_end:=left(p_request->>'endAt',10)::date;
  v_offset:=coalesce((p_request->>'offset')::integer,0);v_limit:=coalesce((p_request->>'limit')::integer,20);
 exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='invalid_time';
 end;
 if v_start is null or v_end is null or v_start>v_end or (v_dates='range' and v_end-v_start>31)
  or v_offset<0 or v_offset>1000000 or v_limit not in(20,30,50,100,500) then
  raise exception using errcode='22023',message='invalid_range';
 end if;
 v_country:=nullif(btrim(p_request->>'country'),'');v_platform:=nullif(btrim(p_request->>'platform'),'');
 v_provider:=nullif(btrim(p_request->>'provider'),'');v_status:=coalesce(nullif(btrim(p_request->>'status'),''),'all');
 v_query:=nullif(btrim(p_request->>'query'),'');
 v_order:=nullif(btrim(p_request->>'orderNumber'),'');v_workorder:=nullif(btrim(p_request->>'workOrderNumber'),'');
 v_utr:=nullif(btrim(p_request->>'utr'),'');v_reply:=nullif(btrim(p_request->>'reply'),'');
 v_utr_match:=nullif(btrim(p_request->>'utrMatch'),'');v_kyc:=nullif(btrim(p_request->>'kycCorrect'),'');v_staff:=nullif(btrim(p_request->>'staffCode'),'');v_upi:=nullif(btrim(p_request->>'upiId'),'');v_kyc_upi:=nullif(btrim(p_request->>'kycUpiId'),'');
 if v_status not in ('all','未入款','已入款','待核对') then raise exception using errcode='22023',message='invalid_status';end if;

 with catalog as materialized (
  select p.name,p.country,private.dashboard_admin_live_deposit_platform_key(p.country,p.name) as platform_key
  from private.dashboard_admin_live_platforms() p
 ), source_names as materialized (
  select distinct coalesce(nullif(btrim(country),''),case when source_sheet='1Y110H-E0ny6Yj6ZEhn7tRLgCuRrSE5iDeFwaZ8-aCqg' then '印度' end,'') as raw_country,
   coalesce(platform,'') as raw_platform from public.admin_deposit_issue_rows where stale_at is null
  union
  select distinct coalesce(nullif(btrim(country),''),''),coalesce(platform,'') from public.admin_deposit_followup_rows where stale_at is null
 ), platform_names as materialized (
  select n.*,coalesce(nullif(n.raw_country,''),c.country) as display_country,
   coalesce(c.name,n.raw_platform) as display_platform,
   private.dashboard_admin_live_deposit_platform_key(coalesce(nullif(n.raw_country,''),c.country),n.raw_platform) as platform_key
  from source_names n
  left join lateral (select c.country,c.name from catalog c
   where c.platform_key=private.dashboard_admin_live_deposit_platform_key(n.raw_country,n.raw_platform)
    and (n.raw_country='' or c.country=n.raw_country) order by c.country,c.name limit 1) c on true
 ), scoped_names as materialized (
  select * from platform_names where private.dashboard_scope_allows(v_scope,coalesce(display_country,''),coalesce(display_platform,''))
   and (v_country is null or display_country=v_country)
   and (v_platform is null or platform_key=private.dashboard_admin_live_deposit_platform_key(display_country,v_platform))
 ), results as materialized (
  select r.*,n.display_country,n.display_platform,n.platform_key,upper(btrim(order_number)) as order_key
  from public.admin_deposit_issue_rows r join scoped_names n on n.raw_platform=coalesce(r.platform,'')
   and n.raw_country=coalesce(nullif(btrim(r.country),''),case when r.source_sheet='1Y110H-E0ny6Yj6ZEhn7tRLgCuRrSE5iDeFwaZ8-aCqg' then '印度' end,'')
  where r.stale_at is null
 ), entries as materialized (
  select e.*,n.display_country,n.display_platform,n.platform_key,upper(btrim(order_number)) as order_key
  from public.admin_deposit_followup_rows e join scoped_names n on n.raw_platform=coalesce(e.platform,'')
   and n.raw_country=coalesce(nullif(btrim(e.country),''),'')
  where e.stale_at is null
 ), result_keys as materialized (
  select display_country,platform_key,order_key,count(*) as n,min(id) as id from results
  where nullif(order_key,'') is not null group by display_country,platform_key,order_key
 ), entry_keys as materialized (
  select display_country,platform_key,order_key,count(*) as n,min(id) as id from entries
  where nullif(order_key,'') is not null and source_kind='sheet' group by display_country,platform_key,order_key
 ), joined as materialized (
  select r.id,r.source_row,r.source_sheet,r.source_tab,null::bigint as source_gid,r.display_country,r.display_platform,
   r.order_number,r.utr,r.amount,r.provider as raw_provider,r.record_date,r.unreceived_days,r.match_status,
   coalesce(nullif(btrim(r.status),''),'待核对') as status,r.provider_reply,r.utr_match,r.kyc_correct,
   e.work_order_number,e.followup_status,e.provider_reply as linked_reply,e.evidence,e.followup_at,e.receipt_text,
   r.record_date as result_date,r.source_row as result_source_row,e.source_row as entry_source_row,
   case when ek.n is null then 'unlinked' when e.id is null then 'review' else 'matched' end as link_status,
   coalesce(r.source_updated_at,r.updated_at) as updated_at,
   'sheet'::text as source_kind,e.first_actor,e.last_actor,null::text as portal_case_id,null::bigint as portal_version,e.staff_code,e.source_date_text,r.upi_id,r.kyc_upi_id
  from results r left join result_keys self on self.display_country=r.display_country and self.platform_key=r.platform_key and self.order_key=r.order_key
  left join entry_keys ek on ek.display_country=r.display_country and ek.platform_key=r.platform_key and ek.order_key=r.order_key
  left join entries e on e.id=ek.id and e.source_kind='sheet' and ek.n=1 and self.n=1
   and nullif(btrim(e.utr),'') is not null and btrim(e.utr)=btrim(r.utr)
   and (e.amount is null or r.amount is null or e.amount=r.amount)
  where v_view='results'
  union all
  select e.id,e.source_row,e.source_sheet,e.source_tab,e.source_gid,e.display_country,e.display_platform,
   e.order_number,e.utr,e.amount,e.provider,e.followup_date,r.unreceived_days,r.match_status,
   coalesce(nullif(btrim(r.status),''),'待核对'),e.provider_reply,e.utr_match,e.kyc_correct,
   e.work_order_number,e.followup_status,r.provider_reply,e.evidence,e.followup_at,e.receipt_text,
   r.record_date,r.source_row,e.source_row,
   case when e.source_kind='portal' then 'independent' when rk.n is null then 'unlinked' when r.id is null then 'review' else 'matched' end,
   coalesce(e.source_updated_at,e.updated_at),e.source_kind,e.first_actor,e.last_actor,e.portal_case_id,e.portal_version,e.staff_code,e.source_date_text,e.upi_id,e.kyc_upi_id
  from entries e left join entry_keys self on self.display_country=e.display_country and self.platform_key=e.platform_key and self.order_key=e.order_key
  left join result_keys rk on rk.display_country=e.display_country and rk.platform_key=e.platform_key and rk.order_key=e.order_key
  left join results r on r.id=rk.id and e.source_kind='sheet' and rk.n=1 and self.n=1
   and nullif(btrim(r.utr),'') is not null and btrim(e.utr)=btrim(r.utr)
   and (e.amount is null or r.amount is null or e.amount=r.amount)
  where v_view='entries'
 ), names as materialized (
  select distinct coalesce(display_country,'') as display_country,coalesce(display_platform,'') as display_platform,coalesce(raw_provider,'') as raw_provider from joined
 ), canonical as materialized (
  select n.*,coalesce(private.dashboard_admin_live_provider_canonical(display_country,display_platform,raw_provider),'未标记三方') as provider from names n
 ), windowed as materialized (
  select j.*,c.provider,case when private.workorder_receipt_days(j.order_number) is not null then private.workorder_receipt_date(j.order_number) end as receipt_date,private.workorder_receipt_days(j.order_number) as days_since_order from joined j join canonical c on c.display_country=coalesce(j.display_country,'')
   and c.display_platform=coalesce(j.display_platform,'') and c.raw_provider=coalesce(j.raw_provider,'')
  where v_dates='all' or j.record_date between v_start and v_end
 ), filtered as materialized (
  select * from windowed r where (v_provider is null or r.provider=v_provider)
   and (v_status='all' or r.status=v_status)
   and (v_match='all' or v_match='matched' and r.match_status='对得上' or v_match='unmatched' and r.match_status='对不上' or v_match='unknown' and coalesce(r.match_status,'') not in('对得上','对不上'))
   and (v_followup is null or coalesce(nullif(lower(btrim(r.followup_status)),''),'未填写')=lower(v_followup))
   and (v_source_kind='all' or r.source_kind=v_source_kind)
   and (v_order is null or strpos(lower(coalesce(r.order_number,'')),lower(v_order))>0)
   and (v_workorder is null or strpos(lower(coalesce(r.work_order_number,'')),lower(v_workorder))>0)
   and (v_utr is null or strpos(lower(coalesce(r.utr,'')),lower(v_utr))>0)
   and (v_reply is null or strpos(lower(coalesce(r.provider_reply,'')),lower(v_reply))>0)
   and (v_utr_match is null or coalesce(nullif(lower(btrim(r.utr_match)),''),'未填写')=lower(v_utr_match))
   and (v_kyc is null or coalesce(nullif(lower(btrim(r.kyc_correct)),''),'未填写')=lower(v_kyc))
   and (v_upi is null or strpos(lower(coalesce(r.upi_id,'')),lower(v_upi))>0)
   and (v_kyc_upi is null or strpos(lower(coalesce(r.kyc_upi_id,'')),lower(v_kyc_upi))>0)
   and (v_staff is null or strpos(lower(coalesce(r.staff_code,'')),lower(v_staff))>0)
   and (v_amount_min is null or r.amount>=v_amount_min) and (v_amount_max is null or r.amount<=v_amount_max)
   and (v_query is null or strpos(lower(concat_ws(' ',r.order_number,r.utr,r.work_order_number,r.provider_reply,r.linked_reply,r.followup_status)),lower(v_query))>0)
 ), totals as (
  select count(*) as count,coalesce(sum(amount),0) as amount,
   count(*) filter(where status='未入款') as unreceived_count,coalesce(sum(amount) filter(where status='未入款'),0) as unreceived_amount,
   count(*) filter(where status='已入款') as received_count,coalesce(sum(amount) filter(where status='已入款'),0) as received_amount,
   count(*) filter(where status not in('未入款','已入款')) as unresolved_count,
   coalesce(max(unreceived_days) filter(where status='未入款'),0) as max_days,
   count(*) filter(where match_status='对得上') as matched_count,count(*) filter(where match_status='对不上') as unmatched_count,
   count(*) filter(where link_status='matched') as linked_count,count(*) filter(where link_status='unlinked') as unlinked_count,
   count(*) filter(where link_status='review') as review_count,count(*) filter(where record_date is null) as undated_count,
   count(*) filter(where source_kind='portal') as portal_count,
   count(*) filter(where lower(followup_status) like '%pdf/video%' or lower(followup_status)='need_evidence') as evidence_count,
   count(*) filter(where lower(followup_status) in('over15','over30') or lower(followup_status) like '%refund%' and lower(followup_status) not like '%no refund%' and lower(followup_status)<>'no_refund') as refund_count,
   max(updated_at) as updated_at from filtered
 ), provider_summary as (
  select provider,coalesce(nullif(match_status,''),'待核对') as match_status,count(*) as count,
   count(*) filter(where status='未入款') as unreceived_count,coalesce(sum(amount) filter(where status='未入款'),0) as unreceived_amount,
   coalesce(max(unreceived_days) filter(where status='未入款'),0) as max_days,
   count(*) filter(where status='已入款') as received_count from filtered group by provider,coalesce(nullif(match_status,''),'待核对')
 ), daily_summary as (
  select record_date,count(*) as count,count(*) filter(where match_status='对得上') as matched_count,
   count(*) filter(where match_status='对不上') as unmatched_count,
   count(*) filter(where status='已入款') as received_count,count(*) filter(where status='未入款') as unreceived_count,
   coalesce(sum(amount) filter(where status='未入款'),0) as unreceived_amount,
   count(*) filter(where status not in('已入款','未入款')) as unresolved_count from filtered group by record_date
 ), platform_summary as (
  select display_platform,count(*) as count,coalesce(sum(amount),0) as amount,
   count(*) filter(where link_status='matched') as linked_count,
   count(*) filter(where link_status in('unlinked','review')) as unlinked_count,
   count(*) filter(where source_kind='portal') as portal_count,
   count(*) filter(where status='未入款') as unreceived_count,coalesce(sum(amount) filter(where status='未入款'),0) as unreceived_amount
  from filtered group by display_platform
 ), status_summary as (
  select lower(coalesce(nullif(btrim(followup_status),''),'未填写')) as status,count(*) as count,coalesce(sum(amount),0) as amount
  from filtered group by lower(coalesce(nullif(btrim(followup_status),''),'未填写'))
 ), page as (
  select * from filtered order by record_date desc nulls last,display_platform,source_row,id offset v_offset limit v_limit
 )
 select jsonb_build_object('version',3,'view',v_view,'dateMode',v_dates,'startDate',v_start,'endDate',v_end,
  'offset',v_offset,'limit',v_limit,'total',(select count from totals),'hasMore',(select count from totals)>v_offset::bigint+v_limit,
  'updatedAt',(select updated_at from totals),
  'summary',(select jsonb_build_object('count',count,'amount',amount,'unreceivedCount',unreceived_count,'unreceivedAmount',unreceived_amount,
   'receivedCount',received_count,'receivedAmount',received_amount,'unresolvedStatusCount',unresolved_count,'maxUnreceivedDays',max_days,
   'matchedCount',matched_count,'unmatchedCount',unmatched_count,'linkedCount',linked_count,'unlinkedCount',unlinked_count,
   'reviewCount',review_count,'undatedCount',undated_count,'evidenceCount',evidence_count,'refundCount',refund_count,'portalCount',portal_count) from totals),
  'facets',jsonb_build_object(
   'providers',coalesce((select jsonb_agg(provider order by provider) from(select distinct provider from windowed) x),'[]'::jsonb),
   'platforms',coalesce((select jsonb_agg(display_platform order by display_platform) from(select distinct display_platform from joined) x),'[]'::jsonb),
   'followupStatuses',coalesce((select jsonb_agg(status order by status) from(select distinct coalesce(nullif(lower(btrim(followup_status)),''),'未填写') as status from windowed) x),'[]'::jsonb),
   'utrMatches',coalesce((select jsonb_agg(value order by value) from(select distinct coalesce(nullif(btrim(utr_match),''),'未填写') as value from windowed) x),'[]'::jsonb),
   'kycCorrectValues',coalesce((select jsonb_agg(value order by value) from(select distinct coalesce(nullif(btrim(kyc_correct),''),'未填写') as value from windowed) x),'[]'::jsonb)),
  'providerSummary',coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'matchStatus',match_status,'count',count,'unreceivedCount',unreceived_count,'unreceivedAmount',unreceived_amount,'maxDays',max_days,'receivedCount',received_count) order by unreceived_amount desc,provider,match_status) from provider_summary),'[]'::jsonb),
  'dailySummary',coalesce((select jsonb_agg(jsonb_build_object('date',record_date,'count',count,'matchedCount',matched_count,'unmatchedCount',unmatched_count,'receivedCount',received_count,'unreceivedCount',unreceived_count,'unreceivedAmount',unreceived_amount,'unresolvedCount',unresolved_count) order by record_date desc nulls last) from daily_summary),'[]'::jsonb),
  'platformSummary',coalesce((select jsonb_agg(jsonb_build_object('platform',display_platform,'count',count,'amount',amount,'linkedCount',linked_count,'unlinkedCount',unlinked_count,'portalCount',portal_count,'unreceivedCount',unreceived_count,'unreceivedAmount',unreceived_amount) order by count desc,display_platform) from platform_summary),'[]'::jsonb),
  'statusSummary',coalesce((select jsonb_agg(jsonb_build_object('status',status,'count',count,'amount',amount) order by count desc,status) from status_summary),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
   'recordDate',p.record_date,'country',p.display_country,'platform',p.display_platform,'provider',p.provider,'rawProvider',p.raw_provider,
   'orderNumber',p.order_number,'workOrderNumber',p.work_order_number,'utr',p.utr,'amount',p.amount,'unreceivedDays',p.unreceived_days,
   'matchStatus',p.match_status,'status',p.status,'providerReply',p.provider_reply,'utrMatch',p.utr_match,'kycCorrect',p.kyc_correct,
   'followupStatus',p.followup_status,'followupAt',p.followup_at,'linkedReply',p.linked_reply,'evidence',p.evidence,'receiptText',p.receipt_text,
   'linkStatus',p.link_status,'resultDate',p.result_date,'sourceRow',p.source_row,'sourceTab',p.source_tab,'sourceGid',p.source_gid,
   'resultSourceRow',p.result_source_row,'entrySourceRow',p.entry_source_row,'updatedAt',p.updated_at,
   'sourceKind',p.source_kind,'firstActor',p.first_actor,'lastActor',p.last_actor,'portalCaseId',p.portal_case_id,'portalVersion',p.portal_version,'staffCode',p.staff_code,'sourceDateText',p.source_date_text,'upiId',p.upi_id,'kycUpiId',p.kyc_upi_id,'orderDate',p.receipt_date,'daysSinceOrder',p.days_since_order)
   order by p.record_date desc nulls last,p.display_platform,p.source_row,p.id) from page p),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_deposit_issues(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_deposit_issues(jsonb) to authenticated;
create or replace function public.workorder_followup_list(p_account jsonb,p_filters jsonb default '{}',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;
begin
 if coalesce(p_account->>'role','') not in ('agent','supervisor','auditor') or p_account->>'active' is distinct from 'true'
 or coalesce(p_account->>'team','')='' or jsonb_typeof(p_account->'platforms') is distinct from 'array'
 or p_offset<0 or p_offset>1000000 or p_limit<1 or p_limit>100 or jsonb_typeof(p_filters) is distinct from 'object' then
 raise exception using errcode='22023',message='invalid_request'; end if;
 with scoped as materialized (
 select r.*,case when private.workorder_receipt_days(r.order_number) is not null then private.workorder_receipt_date(r.order_number) end as receipt_date,private.workorder_receipt_days(r.order_number) as days_since_order,case when upper(btrim(r.platform))='INDIA82' then '82LOTTERY' else r.platform end as display_platform,
 case when r.source_kind='portal' then coalesce(r.portal_payload->'entry'->>'outcome','unknown') else private.workorder_followup_outcome(r.followup_status) end as normalized_outcome,
 case when r.source_kind='portal' then coalesce(r.portal_payload->'entry'->>'kycCheck','unknown') else private.workorder_followup_check(r.kyc_correct) end as normalized_kyc,
 case when r.source_kind='portal' then coalesce(r.portal_payload->'entry'->>'utrMatch','unknown') else private.workorder_followup_check(r.utr_match) end as normalized_utr
 from public.admin_deposit_followup_rows r
 where r.stale_at is null and r.country='印度'
 and (p_account->'platforms') ? (case when upper(btrim(r.platform))='INDIA82' then '82LOTTERY' else r.platform end)
 and (r.source_kind='sheet' or r.source_kind='portal' and r.portal_team=p_account->>'team'
   and (p_account->>'role'<>'agent' or r.portal_owner_id=p_account->>'auth_user_id'))
 ), filtered as materialized (
 select * from scoped r where
 (coalesce(p_filters->>'source','all')='all' or r.source_kind=p_filters->>'source')
 and (coalesce(p_filters->>'platform','') in ('','all') or r.display_platform=p_filters->>'platform')
 and (coalesce(p_filters->>'provider','') in ('','all') or strpos(lower(coalesce(r.provider,'')),lower(p_filters->>'provider'))>0)
 and (coalesce(p_filters->>'creator','') in ('','all') or strpos(lower(coalesce(r.first_actor,'')),lower(p_filters->>'creator'))>0)
 and (coalesce(p_filters->>'follower','') in ('','all') or strpos(lower(coalesce(r.last_actor,'')),lower(p_filters->>'follower'))>0)
 and (coalesce(p_filters->>'outcome','') in ('','all') or r.normalized_outcome=p_filters->>'outcome')
 and (coalesce(p_filters->>'kyc','') in ('','all') or r.normalized_kyc=p_filters->>'kyc')
 and (coalesce(p_filters->>'utrMatch','') in ('','all') or r.normalized_utr=p_filters->>'utrMatch')
 and (coalesce(p_filters->>'orderNo','')='' or strpos(lower(coalesce(r.order_number,'')),lower(p_filters->>'orderNo'))>0)
 and (coalesce(p_filters->>'workorder','')='' or strpos(lower(coalesce(r.work_order_number,'')),lower(p_filters->>'workorder'))>0)
 and (coalesce(p_filters->>'utr','')='' or strpos(lower(coalesce(r.utr,'')),lower(p_filters->>'utr'))>0)
 and (coalesce(p_filters->>'reply','')='' or strpos(lower(coalesce(r.provider_reply,'')),lower(p_filters->>'reply'))>0)
 and (coalesce(p_filters->>'upiId','')='' or strpos(lower(coalesce(r.upi_id,'')),lower(p_filters->>'upiId'))>0)
 and (coalesce(p_filters->>'kycUpiId','')='' or strpos(lower(coalesce(r.kyc_upi_id,'')),lower(p_filters->>'kycUpiId'))>0)
 and (coalesce(p_filters->>'staffCode','')='' or strpos(lower(coalesce(r.staff_code,'')),lower(p_filters->>'staffCode'))>0)
 and (coalesce(p_filters->>'from','')='' or r.followup_date >= (p_filters->>'from')::date)
 and (coalesce(p_filters->>'to','')='' or r.followup_date <= (p_filters->>'to')::date)
 and (coalesce(p_filters->>'minAmount','')='' or r.amount >= (p_filters->>'minAmount')::numeric)
 and (coalesce(p_filters->>'maxAmount','')='' or r.amount <= (p_filters->>'maxAmount')::numeric)
 ), page as (select * from filtered order by followup_date desc nulls last,source_row desc,id limit p_limit offset p_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb),
 'total',(select count(*) from filtered),'offset',p_offset,'limit',p_limit,
 'facets',jsonb_build_object(
 'platforms',p_account->'platforms',
 'providers',coalesce((select jsonb_agg(x.provider order by x.provider) from(select distinct provider from scoped where nullif(provider,'') is not null) x),'[]'::jsonb),
 'creators',coalesce((select jsonb_agg(x.first_actor order by x.first_actor) from(select distinct first_actor from scoped where nullif(first_actor,'') is not null) x),'[]'::jsonb),
 'followers',coalesce((select jsonb_agg(x.last_actor order by x.last_actor) from(select distinct last_actor from scoped where nullif(last_actor,'') is not null) x),'[]'::jsonb))) into v;
 return v;
end;
$$;
revoke all on function public.workorder_followup_list(jsonb,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.workorder_followup_list(jsonb,jsonb,integer,integer) to service_role;

create or replace function public.workorder_followup_mirror(p_record jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v public.admin_deposit_followup_rows; current_kind text;
begin
 v:=jsonb_populate_record(null::public.admin_deposit_followup_rows,p_record);
 if v.source_kind is distinct from 'portal' or v.source_sheet is distinct from 'PORTAL'
 or v.portal_case_id is null or v.portal_case_id !~ '^[a-f0-9-]{36}$'
 or v.id is distinct from 'PORTAL:'||v.portal_case_id or v.source_tab is distinct from v.portal_case_id
 or v.source_row is distinct from 1 or v.portal_version is null or v.portal_version<1
 or coalesce(v.portal_owner_id,'')='' or coalesce(v.portal_team,'')='' or v.country is distinct from '印度' then
 raise exception using errcode='22023',message='invalid_mirror'; end if;
 select r.source_kind into current_kind from public.admin_deposit_followup_rows r where r.id=v.id;
 if found and current_kind<>'portal' then raise exception using errcode='42501',message='history_read_only'; end if;
 insert into public.admin_deposit_followup_rows as target
 (id,source_sheet,source_tab,source_row,platform,country,order_number,work_order_number,utr,upi_id,kyc_upi_id,amount,provider,provider_reply,
 followup_status,utr_match,kyc_correct,evidence,followup_at,followup_date,receipt_text,source_updated_at,updated_at,
 source_kind,first_actor,last_actor,portal_case_id,portal_version,portal_owner_id,portal_team,portal_payload)
 values(v.id,v.source_sheet,v.source_tab,v.source_row,v.platform,v.country,v.order_number,v.work_order_number,v.utr,v.upi_id,v.kyc_upi_id,v.amount,v.provider,v.provider_reply,
 v.followup_status,v.utr_match,v.kyc_correct,v.evidence,v.followup_at,v.followup_date,v.receipt_text,v.source_updated_at,now(),
 v.source_kind,v.first_actor,v.last_actor,v.portal_case_id,v.portal_version,v.portal_owner_id,v.portal_team,v.portal_payload)
 on conflict(id) do update set order_number=excluded.order_number,work_order_number=excluded.work_order_number,utr=excluded.utr,upi_id=excluded.upi_id,kyc_upi_id=excluded.kyc_upi_id,amount=excluded.amount,
 provider=excluded.provider,provider_reply=excluded.provider_reply,followup_status=excluded.followup_status,utr_match=excluded.utr_match,
 kyc_correct=excluded.kyc_correct,evidence=excluded.evidence,followup_at=excluded.followup_at,followup_date=excluded.followup_date,receipt_text=excluded.receipt_text,
 source_updated_at=excluded.source_updated_at,updated_at=now(),last_actor=excluded.last_actor,portal_version=excluded.portal_version,
 portal_owner_id=excluded.portal_owner_id,portal_payload=excluded.portal_payload
 where target.source_kind='portal' and target.portal_version<excluded.portal_version;
 return true;
end;
$$;
revoke all on function public.workorder_followup_mirror(jsonb) from public,anon,authenticated;
grant execute on function public.workorder_followup_mirror(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
