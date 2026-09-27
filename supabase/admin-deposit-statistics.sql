-- The four workbook views share one row source. Do not add their totals together.
-- AS classification takes priority over L: other-order/provider outcomes never
-- count as payment to this order, even when the old L formula says 已入款.
-- Preserve the original L/AS labels in details; an absent AS is not 待核实.
begin;
alter table public.admin_deposit_issue_rows add column if not exists canonical_provider text;
alter table public.admin_deposit_issue_rows add column if not exists confirmation_status text;
create or replace function private.dashboard_admin_deposit_statistics(p_request jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='20s' as $$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope(); v_section text:=coalesce(p_request->>'section','summary');
 v_dates text:=coalesce(p_request->>'dateMode','all');v_start date;v_end date;v_offset int:=0;v_limit int:=20;v_result jsonb;v_key text;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>12000
 or p_request-array['section','dateMode','startAt','endAt','country','platform','provider','status','match','confirmation','orderNumber','utr','upiId','kycUpiId','reply','utrMatch','kycCorrect','amountMin','amountMax','offset','limit']<>'{}'::jsonb then raise exception 'invalid_request';end if;
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
   case when r.confirmation_status='已入款' then 'received' when r.confirmation_status='入其他订单' then 'other_order'
    when r.confirmation_status='转其他三方' then 'other_provider' when r.status='未入款' then 'unreceived' else 'unclassified' end statistics_status
  from public.admin_deposit_issue_rows r
  where r.stale_at is null and r.country='印度' and private.dashboard_scope_allows(v_scope,'IN',r.platform)
   and (coalesce(p_request->>'country','') in ('','all','印度','IN'))
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
   'confirmation',confirmation,'statisticsStatus',statistics_status,'orderDate',order_date,'daysSinceOrder',age,'sourceRow',source_row) item,
   row_number() over(order by order_date desc nulls last,display_platform,source_row,id) ord from filtered
 ), providers as (
  select jsonb_build_object('provider',display_provider,'matchStatus',match_status,'confirmation',confirmation,'count',count(*),'amount',coalesce(sum(amount),0),
   'otherOrderCount',count(*) filter(where statistics_status='other_order'),'otherOrderAmount',coalesce(sum(amount) filter(where statistics_status='other_order'),0),
   'otherProviderCount',count(*) filter(where statistics_status='other_provider'),'otherProviderAmount',coalesce(sum(amount) filter(where statistics_status='other_provider'),0),
   'unclassifiedCount',count(*) filter(where statistics_status='unclassified'),'unclassifiedAmount',coalesce(sum(amount) filter(where statistics_status='unclassified'),0),
   'receivedCount',count(*) filter(where statistics_status='received'),'receivedAmount',coalesce(sum(amount) filter(where statistics_status='received'),0),'unreceivedCount',count(*) filter(where statistics_status='unreceived'),
   'unreceivedAmount',coalesce(sum(amount) filter(where statistics_status='unreceived'),0),'maxDays',max(age) filter(where statistics_status='unreceived')) item,
   row_number() over(order by coalesce(sum(amount) filter(where statistics_status='unreceived'),0) desc,display_provider,match_status,confirmation) ord
  from filtered group by display_provider,match_status,confirmation
 ), daily as (
  select jsonb_build_object('date',order_date,'count',count(*),'amount',coalesce(sum(amount),0),
   'otherOrderCount',count(*) filter(where statistics_status='other_order'),'otherOrderAmount',coalesce(sum(amount) filter(where statistics_status='other_order'),0),
   'otherProviderCount',count(*) filter(where statistics_status='other_provider'),'otherProviderAmount',coalesce(sum(amount) filter(where statistics_status='other_provider'),0),
   'unclassifiedCount',count(*) filter(where statistics_status='unclassified'),'unclassifiedAmount',coalesce(sum(amount) filter(where statistics_status='unclassified'),0),
   'receivedCount',count(*) filter(where statistics_status='received'),'receivedAmount',coalesce(sum(amount) filter(where statistics_status='received'),0),
   'unreceivedCount',count(*) filter(where statistics_status='unreceived'),'unreceivedAmount',coalesce(sum(amount) filter(where statistics_status='unreceived'),0),
   'confirmedCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),
   'confirmedAmount',coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),0),
   'pendingVerificationCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),
   'pendingVerificationAmount',coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),0),
   'unmatchedCount',count(*) filter(where match_status='对不上'),'undatedCount',count(*) filter(where order_date is null)) item,
   row_number() over(order by order_date desc nulls last) ord from filtered group by order_date
 ), chosen as (select * from details where v_section='details' union all select * from providers where v_section='providers' union all select * from daily where v_section='daily')
 select jsonb_build_object('section',v_section,'source','sheet-reconciliation','updatedAt',(select max(updated_at) from base),
  'total',(select count(*) from chosen),'rows',coalesce((select jsonb_agg(item order by ord) from chosen where ord>v_offset and ord<=v_offset+v_limit),'[]'::jsonb),
  'providerSummary',coalesce((select jsonb_agg(item order by ord) from providers where ord<=8),'[]'::jsonb),
  'dailySummary',coalesce((select jsonb_agg(item order by ord) from daily where ord<=8),'[]'::jsonb),
  'facets',jsonb_build_object('platforms',(select coalesce(jsonb_agg(x order by x),'[]') from(select distinct display_platform x from base)d),
   'providers',(select coalesce(jsonb_agg(x order by x),'[]') from(select distinct display_provider x from base)d),
   'confirmations',(select coalesce(jsonb_agg(x order by x),'[]') from(select distinct confirmation x from base)d)),
  'summary',(select jsonb_build_object('count',count(*),'amount',coalesce(sum(amount),0),
   'otherOrderCount',count(*) filter(where statistics_status='other_order'),'otherOrderAmount',coalesce(sum(amount) filter(where statistics_status='other_order'),0),
   'otherProviderCount',count(*) filter(where statistics_status='other_provider'),'otherProviderAmount',coalesce(sum(amount) filter(where statistics_status='other_provider'),0),
   'unclassifiedCount',count(*) filter(where statistics_status='unclassified'),'unclassifiedAmount',coalesce(sum(amount) filter(where statistics_status='unclassified'),0),
   'receivedCount',count(*) filter(where statistics_status='received'),'receivedAmount',coalesce(sum(amount) filter(where statistics_status='received'),0),
   'unreceivedCount',count(*) filter(where statistics_status='unreceived'),'unreceivedAmount',coalesce(sum(amount) filter(where statistics_status='unreceived'),0),
   'confirmedCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),
   'confirmedAmount',coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='已确认'),0),
   'pendingVerificationCount',count(*) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),
   'pendingVerificationAmount',coalesce(sum(amount) filter(where statistics_status='unreceived' and match_status='对得上' and confirmation='待核实'),0),
   'unmatchedCount',count(*) filter(where match_status='对不上'),'undatedCount',count(*) filter(where order_date is null)) from filtered)) into v_result;
 return v_result;
end;$$;
create or replace function public.dashboard_admin_deposit_statistics(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_deposit_statistics(p_request);$$;
revoke all on function private.dashboard_admin_deposit_statistics(jsonb),public.dashboard_admin_deposit_statistics(jsonb) from public,anon;
grant execute on function private.dashboard_admin_deposit_statistics(jsonb),public.dashboard_admin_deposit_statistics(jsonb) to authenticated;
commit;
