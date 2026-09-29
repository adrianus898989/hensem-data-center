-- Add full-scope provider breakdown to the existing read-only summary only.
-- Reuse classified provider identities; keep original-order scope and totals intact.
-- Conflicting original attribution is separate so provider totals never double count.
begin;
set local lock_timeout='3s';
do $patch$
declare definition text; change record;
begin
 select pg_get_functiondef('private.dashboard_admin_live_workorder_analysis(jsonb)'::regprocedure) into definition;
 if position('analysis_provider_metrics_v1' in definition)>0 then return;end if;
 for change in select * from (values
($old$   case when requested_operation='summary' then null when f->>'dateBasis'='operation' then d.operated_at else coalesce(d.submitted_at,d.submitted_date::timestamp at time zone v_timezone) end sort_at$old$,$new$   case when requested_operation='summary' and rtrim(d.third_party) is not null then d.third_party end provider_raw,
   case when requested_operation='summary' then d.platform end provider_platform,
   case when requested_operation='summary' then nullif(d.channel_type,'未识别通道') end provider_channel,
   case when requested_operation='summary' then null when f->>'dateBasis'='operation' then d.operated_at else coalesce(d.submitted_at,d.submitted_date::timestamp at time zone v_timezone) end sort_at$new$),
($old$ ), orders_page as ($old$,$new$ ), analysis_provider_names_v1 as materialized (
  select * from private.dashboard_admin_live_workorder_provider_batch((select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb)
   from (select distinct v_country country,provider_platform platform,coalesce(nullif(btrim(provider_raw),''),'未填写三方') raw_provider,provider_channel channel_type
    from filtered where period='current' and requested_operation='summary') n))
 ), analysis_provider_details_v1 as materialized (
  select d.*,coalesce(nullif(p.provider,''),'未填写三方') provider from filtered d
  join analysis_provider_names_v1 p on p.platform=d.provider_platform
   and p.raw_provider=coalesce(nullif(btrim(d.provider_raw),''),'未填写三方') and p.channel_type is not distinct from d.provider_channel
  where d.period='current' and requested_operation='summary'
 ), analysis_provider_originals_v1 as (
  select o.*,case when cardinality(p.providers)=1 then p.providers[1] else '三方归属待核对' end provider
  from originals o join (select platform_key,issue_kind,original_order_no,array_agg(distinct provider) providers
   from analysis_provider_details_v1 where original_order_no is not null group by platform_key,issue_kind,original_order_no) p
   using(platform_key,issue_kind,original_order_no) where o.period='current'
 ), analysis_provider_tickets_v1 as (
  select issue_kind,provider,count(*) ticket_count,
   case when count(*) filter(where amount is null)=0 then sum(amount) end ticket_amount,
   count(*) filter(where status_code=4) processed_ticket_count,count(*) filter(where status_code=3) rejected_ticket_count,
   count(*) filter(where status_code=1) pending_ticket_count,count(*) filter(where status_code=2) processing_ticket_count,
   count(*) filter(where status_code=5) system_processing_ticket_count,count(*) filter(where status_code is null or status_code not in(1,2,3,4,5)) unknown_ticket_count,
   count(*) filter(where original_order_no is null) missing_order_number_count,
   count(*) filter(where kyc_connected is true) kyc_yes_count,count(*) filter(where kyc_connected is false) kyc_no_count,count(*) filter(where kyc_connected is null) kyc_unknown_count,
   count(*) filter(where utr_matched is true) utr_yes_count,count(*) filter(where utr_matched is false) utr_no_count,count(*) filter(where utr_matched is null) utr_unknown_count
  from analysis_provider_details_v1 group by issue_kind,provider
 ), analysis_provider_orders_v1 as (
  select issue_kind,provider,count(*) order_count,
   case when count(*) filter(where amount is null)=0 then sum(amount) end order_amount,
   count(*) filter(where processed) processed_count,
   case when count(*) filter(where processed and amount is null)=0 then coalesce(sum(amount) filter(where processed),0) end processed_amount,
   count(*) filter(where amount_variants>1) amount_conflict_count,count(*) filter(where amount_variants=0) missing_amount_count
  from analysis_provider_originals_v1 group by issue_kind,provider
 ), analysis_provider_metrics_v1 as (
  select coalesce(t.issue_kind,o.issue_kind) issue_kind,coalesce(t.provider,o.provider) provider,jsonb_build_object(
   'issueKind',coalesce(t.issue_kind,o.issue_kind),'provider',coalesce(t.provider,o.provider),
   'ticketCount',coalesce(t.ticket_count,0),'ticketAmount',case when t.provider is null then '0' else t.ticket_amount::text end,
   'processedTicketCount',coalesce(t.processed_ticket_count,0),'rejectedTicketCount',coalesce(t.rejected_ticket_count,0),
   'statusCounts',jsonb_build_object('1',coalesce(t.pending_ticket_count,0),'2',coalesce(t.processing_ticket_count,0),'3',coalesce(t.rejected_ticket_count,0),'4',coalesce(t.processed_ticket_count,0),'5',coalesce(t.system_processing_ticket_count,0),'unknown',coalesce(t.unknown_ticket_count,0)),
   'uniqueOrderCount',case when o.provider is null and t.missing_order_number_count=t.ticket_count and t.ticket_count>0 then null else coalesce(o.order_count,0) end,'uniqueOrderAmount',case when o.provider is null and t.missing_order_number_count=t.ticket_count and t.ticket_count>0 then null when o.provider is null then '0' else o.order_amount::text end,
   'uniqueProcessedCount',coalesce(o.processed_count,0),'uniqueProcessedAmount',case when o.provider is null then '0' else o.processed_amount::text end,
   'kycCounts',jsonb_build_object('yes',coalesce(t.kyc_yes_count,0),'no',coalesce(t.kyc_no_count,0),'unknown',coalesce(t.kyc_unknown_count,0)),
   'utrCounts',jsonb_build_object('yes',coalesce(t.utr_yes_count,0),'no',coalesce(t.utr_no_count,0),'unknown',coalesce(t.utr_unknown_count,0)),
   'coverage',jsonb_build_object('missingOrderNumberCount',coalesce(t.missing_order_number_count,0),'amountConflictCount',coalesce(o.amount_conflict_count,0),'missingAmountCount',coalesce(o.missing_amount_count,0))
  ) value from analysis_provider_tickets_v1 t full join analysis_provider_orders_v1 o using(issue_kind,provider)
 ), orders_page as ($new$),
($old$  'current',(select value from metrics where period='current'),$old$,$new$  'byProvider',case when requested_operation='summary' then (select coalesce(jsonb_agg(value order by issue_kind,(value->>'ticketCount')::bigint desc,provider),'[]'::jsonb) from analysis_provider_metrics_v1) end,
  'current',(select value from metrics where period='current'),$new$)
 ) changes(old_text,new_text) loop
  if (length(definition)-length(replace(definition,change.old_text,'')))/length(change.old_text)<>1 then
   raise exception 'Workorder provider analysis baseline changed: %',left(change.old_text,100);
  end if;
  definition:=replace(definition,change.old_text,change.new_text);
 end loop;
 execute definition;
end;
$patch$;
notify pgrst,'reload schema';
commit;
