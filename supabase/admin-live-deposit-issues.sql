-- Read model for the private detailed-admin deposit-not-received page.
-- Google Sheets is ingested by the sync-deposit-issue-sheet Edge Function;
-- the page itself reads this bounded Supabase table and never scans Google.
begin;

create table if not exists public.admin_deposit_issue_rows (
  id text primary key,
  source_sheet text not null,
  source_tab text not null default 'UPI核对',
  source_row integer not null check (source_row > 0),
  platform text,
  country text,
  order_number text,
  utr text,
  amount numeric(24,2),
  provider text,
  match_status text,
  status text,
  unreceived_days integer,
  record_date date,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (source_sheet, source_tab, source_row)
);

alter table public.admin_deposit_issue_rows add column if not exists provider_reply text;
alter table public.admin_deposit_issue_rows add column if not exists utr_match text;
alter table public.admin_deposit_issue_rows add column if not exists kyc_correct text;

create index if not exists admin_deposit_issue_rows_date_idx
  on public.admin_deposit_issue_rows(record_date desc, platform, provider, status);
create index if not exists admin_deposit_issue_rows_scope_idx
  on public.admin_deposit_issue_rows(country, platform, record_date desc);
create index if not exists admin_deposit_issue_rows_order_idx
  on public.admin_deposit_issue_rows(order_number, utr);

alter table public.admin_deposit_issue_rows enable row level security;
revoke all on public.admin_deposit_issue_rows from public, anon, authenticated;
grant all on public.admin_deposit_issue_rows to service_role;

-- Separate sources: input/follow-up rows must not be added to result totals.
create table if not exists public.admin_deposit_followup_rows (
  id text primary key, source_sheet text not null, source_tab text not null,
  source_gid bigint, source_row integer not null check(source_row>0),
  platform text, country text, order_number text, work_order_number text, utr text,
  amount numeric(24,2), provider text, provider_reply text, followup_status text,
  utr_match text, kyc_correct text, evidence text, followup_at text, followup_date date,
  receipt_text text, source_updated_at timestamptz, updated_at timestamptz not null default now(),
  unique(source_sheet,source_tab,source_row)
);
create index if not exists admin_deposit_followup_scope_idx on public.admin_deposit_followup_rows(country,platform,followup_date desc);
create index if not exists admin_deposit_followup_order_idx on public.admin_deposit_followup_rows(order_number,utr);
alter table public.admin_deposit_followup_rows enable row level security;
revoke all on public.admin_deposit_followup_rows from public,anon,authenticated;
grant all on public.admin_deposit_followup_rows to service_role;

create or replace function private.dashboard_admin_live_deposit_platform_key(p_country text,p_name text)
returns text language sql immutable set search_path='' as $$
 select case when p_country in ('印度','IN','India') and upper(btrim(p_name))='INDIA82' then '82LOTTERY'
 else private.dashboard_admin_live_withdraw_key(p_name) end;
$$;
revoke all on function private.dashboard_admin_live_deposit_platform_key(text,text) from public,anon,authenticated;

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
 v_key text; v_result jsonb;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
  or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
   'startAt','endAt','country','platform','provider','status','query','offset','limit','view','dateMode','match','followupStatus'])) then
  raise exception using errcode='22023',message='invalid_request';
 end if;
 foreach v_key in array array['country','platform','provider','status','query','view','dateMode','match','followupStatus'] loop
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
 if v_view not in ('results','entries') or v_dates not in ('range','all') or v_match not in ('all','matched','unmatched','unknown') then
  raise exception using errcode='22023',message='invalid_filter';
 end if;
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
 if v_status not in ('all','未入款','已入款','待核对') then raise exception using errcode='22023',message='invalid_status';end if;

 with catalog as materialized (
  select p.name,p.country,private.dashboard_admin_live_deposit_platform_key(p.country,p.name) as platform_key
  from private.dashboard_admin_live_platforms() p
 ), source_names as materialized (
  select distinct coalesce(nullif(btrim(country),''),case when source_sheet='1Y110H-E0ny6Yj6ZEhn7tRLgCuRrSE5iDeFwaZ8-aCqg' then '印度' end,'') as raw_country,
   coalesce(platform,'') as raw_platform from public.admin_deposit_issue_rows
  union
  select distinct coalesce(nullif(btrim(country),''),''),coalesce(platform,'') from public.admin_deposit_followup_rows
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
 ), entries as materialized (
  select e.*,n.display_country,n.display_platform,n.platform_key,upper(btrim(order_number)) as order_key
  from public.admin_deposit_followup_rows e join scoped_names n on n.raw_platform=coalesce(e.platform,'')
   and n.raw_country=coalesce(nullif(btrim(e.country),''),'')
 ), result_keys as materialized (
  select display_country,platform_key,order_key,count(*) as n,min(id) as id from results
  where nullif(order_key,'') is not null group by display_country,platform_key,order_key
 ), entry_keys as materialized (
  select display_country,platform_key,order_key,count(*) as n,min(id) as id from entries
  where nullif(order_key,'') is not null group by display_country,platform_key,order_key
 ), joined as materialized (
  select r.id,r.source_row,r.source_sheet,r.source_tab,null::bigint as source_gid,r.display_country,r.display_platform,
   r.order_number,r.utr,r.amount,r.provider as raw_provider,r.record_date,r.unreceived_days,r.match_status,
   coalesce(nullif(btrim(r.status),''),'待核对') as status,r.provider_reply,r.utr_match,r.kyc_correct,
   e.work_order_number,e.followup_status,e.provider_reply as linked_reply,e.evidence,e.followup_at,e.receipt_text,
   r.record_date as result_date,r.source_row as result_source_row,e.source_row as entry_source_row,
   case when ek.n is null then 'unlinked' when e.id is null then 'review' else 'matched' end as link_status,
   coalesce(r.source_updated_at,r.updated_at) as updated_at
  from results r left join result_keys self on self.display_country=r.display_country and self.platform_key=r.platform_key and self.order_key=r.order_key
  left join entry_keys ek on ek.display_country=r.display_country and ek.platform_key=r.platform_key and ek.order_key=r.order_key
  left join entries e on e.id=ek.id and ek.n=1 and self.n=1
   and nullif(btrim(e.utr),'') is not null and btrim(e.utr)=btrim(r.utr)
   and (e.amount is null or r.amount is null or e.amount=r.amount)
  where v_view='results'
  union all
  select e.id,e.source_row,e.source_sheet,e.source_tab,e.source_gid,e.display_country,e.display_platform,
   e.order_number,e.utr,e.amount,e.provider,e.followup_date,r.unreceived_days,r.match_status,
   coalesce(nullif(btrim(r.status),''),'待核对'),e.provider_reply,e.utr_match,e.kyc_correct,
   e.work_order_number,e.followup_status,r.provider_reply,e.evidence,e.followup_at,e.receipt_text,
   r.record_date,r.source_row,e.source_row,
   case when rk.n is null then 'unlinked' when r.id is null then 'review' else 'matched' end,
   coalesce(e.source_updated_at,e.updated_at)
  from entries e left join entry_keys self on self.display_country=e.display_country and self.platform_key=e.platform_key and self.order_key=e.order_key
  left join result_keys rk on rk.display_country=e.display_country and rk.platform_key=e.platform_key and rk.order_key=e.order_key
  left join results r on r.id=rk.id and rk.n=1 and self.n=1
   and nullif(btrim(r.utr),'') is not null and btrim(e.utr)=btrim(r.utr)
   and (e.amount is null or r.amount is null or e.amount=r.amount)
  where v_view='entries'
 ), names as materialized (
  select distinct coalesce(display_country,'') as display_country,coalesce(display_platform,'') as display_platform,coalesce(raw_provider,'') as raw_provider from joined
 ), canonical as materialized (
  select n.*,coalesce(private.dashboard_admin_live_provider_canonical(display_country,display_platform,raw_provider),'未标记三方') as provider from names n
 ), windowed as materialized (
  select j.*,c.provider from joined j join canonical c on c.display_country=coalesce(j.display_country,'')
   and c.display_platform=coalesce(j.display_platform,'') and c.raw_provider=coalesce(j.raw_provider,'')
  where v_dates='all' or j.record_date between v_start and v_end
 ), filtered as materialized (
  select * from windowed r where (v_provider is null or r.provider=v_provider)
   and (v_status='all' or r.status=v_status)
   and (v_match='all' or v_match='matched' and r.match_status='对得上' or v_match='unmatched' and r.match_status='对不上' or v_match='unknown' and coalesce(r.match_status,'') not in('对得上','对不上'))
   and (v_followup is null or coalesce(nullif(lower(btrim(r.followup_status)),''),'未填写')=lower(v_followup))
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
   count(*) filter(where lower(followup_status) like '%pdf/video%') as evidence_count,
   count(*) filter(where lower(followup_status) like '%refund%' and lower(followup_status) not like '%no refund%') as refund_count,
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
   count(*) filter(where link_status<>'matched') as unlinked_count,
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
   'reviewCount',review_count,'undatedCount',undated_count,'evidenceCount',evidence_count,'refundCount',refund_count) from totals),
  'facets',jsonb_build_object(
   'providers',coalesce((select jsonb_agg(provider order by provider) from(select distinct provider from windowed) x),'[]'::jsonb),
   'platforms',coalesce((select jsonb_agg(display_platform order by display_platform) from(select distinct display_platform from joined) x),'[]'::jsonb),
   'followupStatuses',coalesce((select jsonb_agg(status order by status) from(select distinct coalesce(nullif(lower(btrim(followup_status)),''),'未填写') as status from windowed) x),'[]'::jsonb)),
  'providerSummary',coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'matchStatus',match_status,'count',count,'unreceivedCount',unreceived_count,'unreceivedAmount',unreceived_amount,'maxDays',max_days,'receivedCount',received_count) order by unreceived_amount desc,provider,match_status) from provider_summary),'[]'::jsonb),
  'dailySummary',coalesce((select jsonb_agg(jsonb_build_object('date',record_date,'count',count,'matchedCount',matched_count,'unmatchedCount',unmatched_count,'receivedCount',received_count,'unreceivedCount',unreceived_count,'unreceivedAmount',unreceived_amount,'unresolvedCount',unresolved_count) order by record_date desc nulls last) from daily_summary),'[]'::jsonb),
  'platformSummary',coalesce((select jsonb_agg(jsonb_build_object('platform',display_platform,'count',count,'amount',amount,'linkedCount',linked_count,'unlinkedCount',unlinked_count,'unreceivedCount',unreceived_count,'unreceivedAmount',unreceived_amount) order by count desc,display_platform) from platform_summary),'[]'::jsonb),
  'statusSummary',coalesce((select jsonb_agg(jsonb_build_object('status',status,'count',count,'amount',amount) order by count desc,status) from status_summary),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
   'recordDate',p.record_date,'country',p.display_country,'platform',p.display_platform,'provider',p.provider,'rawProvider',p.raw_provider,
   'orderNumber',p.order_number,'workOrderNumber',p.work_order_number,'utr',p.utr,'amount',p.amount,'unreceivedDays',p.unreceived_days,
   'matchStatus',p.match_status,'status',p.status,'providerReply',p.provider_reply,'utrMatch',p.utr_match,'kycCorrect',p.kyc_correct,
   'followupStatus',p.followup_status,'followupAt',p.followup_at,'linkedReply',p.linked_reply,'evidence',p.evidence,'receiptText',p.receipt_text,
   'linkStatus',p.link_status,'resultDate',p.result_date,'sourceRow',p.source_row,'sourceTab',p.source_tab,'sourceGid',p.source_gid,
   'resultSourceRow',p.result_source_row,'entrySourceRow',p.entry_source_row,'updatedAt',p.updated_at)
   order by p.record_date desc nulls last,p.display_platform,p.source_row,p.id) from page p),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;
$$;
revoke all on function private.dashboard_admin_live_deposit_issues(jsonb) from public,anon;
grant execute on function private.dashboard_admin_live_deposit_issues(jsonb) to authenticated;
create or replace function public.dashboard_admin_live_deposit_issues(p_request jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.dashboard_admin_live_deposit_issues(p_request);
$$;
revoke all on function public.dashboard_admin_live_deposit_issues(jsonb) from public,anon;
grant execute on function public.dashboard_admin_live_deposit_issues(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
