-- Server-side unresolved-order filtering keeps totals, paging and amount uncertainty aligned.
-- Retains the authenticated dispatcher, private helper OID/ACL and original source evidence.
begin;
do $guard$
begin
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_deposit_sheet_statistics_v2(jsonb)'::regprocedure
  and md5(prosrc) in ('906e6963191ccceb4b31809773a6e0d5','404fa8425a9b578f9d0abbaa6dff7f9e') and not prosecdef and provolatile='s'
  and proconfig=array['search_path=""']::text[] and pg_get_userbyid(proowner)=current_user
  and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee<>proowner)) then
  raise exception 'deposit_sheet_statistics_definition_changed';
 end if;
end;$guard$;
create or replace function private.dashboard_admin_deposit_sheet_statistics_v2(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope(); v_section text:=coalesce(p_request->>'section','summary');
 v_dates text:=coalesce(p_request->>'dateMode','all');v_start date;v_end date;v_offset int:=0;v_limit int:=20;v_result jsonb;v_key text;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>12000
 or p_request-array['section','dateMode','startAt','endAt','country','platform','provider','status','match','confirmation','orderNumber','utr','upiId','kycUpiId','reply','utrMatch','kycCorrect','amountMin','amountMax','offset','limit','followupState']<>'{}'::jsonb then raise exception 'invalid_request';end if;
 if p_request ? 'section' and jsonb_typeof(p_request->'section')<>'string' or p_request ? 'dateMode' and jsonb_typeof(p_request->'dateMode')<>'string' then raise exception 'invalid_view';end if;
 if p_request ? 'followupState' and (jsonb_typeof(p_request->'followupState')<>'string' or p_request->>'followupState' not in ('all','unresolved','received')) then raise exception 'invalid_followup_state';end if;
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
   and (coalesce(p_request->>'followupState','all')='all' or p_request->>'followupState'='received' and r.statistics_status='received' or p_request->>'followupState'='unresolved' and r.statistics_status<>'received')
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
   'confirmation',confirmation,'statisticsStatus',statistics_status,'orderDate',order_date,'daysSinceOrder',age,'sourceSheet',case when source_row_count=1 then sources->0->>'sourceSheet' end,'sourceTab',case when source_row_count=1 then sources->0->>'sourceTab' end,'sourceRow',source_row,'sourceRows',source_rows,'sources',sources,'sourceCount',source_row_count,'sourcesTruncated',source_row_count>200,'sourceRowCount',source_row_count,'duplicateRows',source_row_count-variant_count,'collapsedRows',source_row_count-1,'conflict',variant_count>1,'variantCount',variant_count) item,
   row_number() over(order by order_date desc nulls last,display_platform,source_row,id) ord from filtered
 ), providers as (
  select jsonb_build_object('provider',display_provider,'matchStatus',match_status,'confirmation',confirmation,'count',count(*),'amount',case when count(*) filter(where amount is null)=0 then coalesce(sum(amount),0) end,'knownAmount',sum(amount),'unknownAmountCount',count(*) filter(where amount is null),'rawRowCount',coalesce(sum(source_row_count),0),'duplicateRows',coalesce(sum(source_row_count-variant_count),0),'collapsedRows',coalesce(sum(source_row_count-1),0),'conflictCount',count(*) filter(where statistics_status='conflict'),'conflictCases',count(*) filter(where statistics_status='conflict'),
   'otherOrderCount',count(*) filter(where statistics_status='other_order'),'otherOrderAmount',case when count(*) filter(where (statistics_status='other_order') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='other_order'),0) end,
   'otherProviderCount',count(*) filter(where statistics_status='other_provider'),'otherProviderAmount',case when count(*) filter(where (statistics_status='other_provider') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='other_provider'),0) end,
   'unclassifiedCount',count(*) filter(where statistics_status in ('unclassified','conflict')),'unclassifiedAmount',case when count(*) filter(where (statistics_status in ('unclassified','conflict')) and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status in ('unclassified','conflict')),0) end,
   'unresolvedCount',count(*) filter(where statistics_status<>'received'),'unresolvedAmount',case when count(*) filter(where statistics_status<>'received' and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status<>'received'),0) end,
   'receivedCount',count(*) filter(where statistics_status='received'),'receivedAmount',case when count(*) filter(where (statistics_status='received') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='received'),0) end,'unreceivedCount',count(*) filter(where statistics_status='unreceived'),
   'unreceivedAmount',case when count(*) filter(where (statistics_status='unreceived') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived'),0) end,'maxDays',max(age) filter(where statistics_status='unreceived')) item,
   row_number() over(order by case when count(*) filter(where (statistics_status='unreceived') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived'),0) end desc,display_provider,match_status,confirmation) ord
  from filtered group by display_provider,match_status,confirmation
 ), daily as (
  select jsonb_build_object('date',order_date,'count',count(*),'amount',case when count(*) filter(where amount is null)=0 then coalesce(sum(amount),0) end,'knownAmount',sum(amount),'unknownAmountCount',count(*) filter(where amount is null),'rawRowCount',coalesce(sum(source_row_count),0),'duplicateRows',coalesce(sum(source_row_count-variant_count),0),'collapsedRows',coalesce(sum(source_row_count-1),0),'conflictCount',count(*) filter(where statistics_status='conflict'),'conflictCases',count(*) filter(where statistics_status='conflict'),
   'otherOrderCount',count(*) filter(where statistics_status='other_order'),'otherOrderAmount',case when count(*) filter(where (statistics_status='other_order') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='other_order'),0) end,
   'otherProviderCount',count(*) filter(where statistics_status='other_provider'),'otherProviderAmount',case when count(*) filter(where (statistics_status='other_provider') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='other_provider'),0) end,
   'unclassifiedCount',count(*) filter(where statistics_status in ('unclassified','conflict')),'unclassifiedAmount',case when count(*) filter(where (statistics_status in ('unclassified','conflict')) and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status in ('unclassified','conflict')),0) end,
   'unresolvedCount',count(*) filter(where statistics_status<>'received'),'unresolvedAmount',case when count(*) filter(where statistics_status<>'received' and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status<>'received'),0) end,
   'receivedCount',count(*) filter(where statistics_status='received'),'receivedAmount',case when count(*) filter(where (statistics_status='received') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='received'),0) end,
   'unreceivedCount',count(*) filter(where statistics_status='unreceived'),'unreceivedAmount',case when count(*) filter(where (statistics_status='unreceived') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived'),0) end,
   'confirmedCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),
   'confirmedAmount',case when count(*) filter(where (statistics_status='unreceived' and match_status='对得上' and confirmation='已确认') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),0) end,
   'pendingVerificationCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),
   'pendingVerificationAmount',case when count(*) filter(where (statistics_status='unreceived' and match_status='对得上' and confirmation='待核实') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),0) end,
   'unmatchedCount',count(*) filter(where match_status='对不上'),'undatedCount',count(*) filter(where order_date is null)) item,
   row_number() over(order by order_date desc nulls last) ord from filtered group by order_date
 ), chosen as (select * from details where v_section='details' union all select * from providers where v_section='providers' union all select * from daily where v_section='daily')
 select jsonb_build_object('version',2,'followupState',coalesce(p_request->>'followupState','all'),'section',v_section,'source','sheet-reconciliation','coverage',jsonb_build_object('complete',false,'label','表格当前镜像；未保存同步批次完成回执'),'updatedAt',(select max(updated_at) from base),
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
   'unresolvedCount',count(*) filter(where statistics_status<>'received'),'unresolvedAmount',case when count(*) filter(where statistics_status<>'received' and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status<>'received'),0) end,
   'receivedCount',count(*) filter(where statistics_status='received'),'receivedAmount',case when count(*) filter(where (statistics_status='received') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='received'),0) end,
   'unreceivedCount',count(*) filter(where statistics_status='unreceived'),'unreceivedAmount',case when count(*) filter(where (statistics_status='unreceived') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived'),0) end,
   'confirmedCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),
   'confirmedAmount',case when count(*) filter(where (statistics_status='unreceived' and match_status='对得上' and confirmation='已确认') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),0) end,
   'pendingVerificationCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),
   'pendingVerificationAmount',case when count(*) filter(where (statistics_status='unreceived' and match_status='对得上' and confirmation='待核实') and amount is null)>0 then null else coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),0) end,
   'unmatchedCount',count(*) filter(where match_status='对不上'),'undatedCount',count(*) filter(where order_date is null)) from filtered)) into v_result;
 return v_result;
end;$$;

commit;
