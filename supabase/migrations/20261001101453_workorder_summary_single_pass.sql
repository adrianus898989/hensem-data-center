-- Restore predictable summary latency without changing original identities or
-- existing financial metrics. Add explicit not-processed statistics and changes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $install$
declare
  target regprocedure:='private.dashboard_admin_live_workorder_analysis(jsonb)'::regprocedure;
  p record; authenticated_role oid; candidate text; change record;
begin
  perform pg_advisory_xact_lock(hashtext('WORKORDER_SUMMARY_SINGLE_PASS_V2'));
  select * into p from pg_proc where oid=target;
  select oid into authenticated_role from pg_roles where rolname='authenticated';
  if authenticated_role is null or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
    or p.pronargdefaults<>0 or not p.prosecdef
    or p.proconfig is distinct from array['search_path=""','statement_timeout=20s']
    or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
    raise exception 'Workorder summary execution metadata changed; review before applying';
  end if;
  if not exists(select 1 from aclexplode(p.proacl) a where a.grantee=authenticated_role and a.privilege_type='EXECUTE' and not a.is_grantable)
    or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.privilege_type='EXECUTE' and (a.grantee not in(p.proowner,authenticated_role) or a.grantee=authenticated_role and a.is_grantable)) then
    raise exception 'Workorder summary ACL changed; review before applying';
  end if;
  if md5(p.prosrc)='f61cb5749b6d091f50383ac53d35a71c' then return;end if;
  if md5(p.prosrc)<>'e0128157a7ec8618c19155a8939833a2' then
    raise exception 'Workorder summary baseline changed; review before applying';
  end if;
  candidate:=p.prosrc;
  for change in select * from (values
($old$ ), analysis_provider_originals_v1 as (
  select o.*,case when cardinality(p.providers)=1 then p.providers[1] else '三方归属待核对' end provider
  from originals o join (select platform_key,issue_kind,original_order_no,array_agg(distinct provider) providers
   from analysis_provider_details_v1 where original_order_no is not null group by platform_key,issue_kind,original_order_no) p
   using(platform_key,issue_kind,original_order_no) where o.period='current'
$old$,$new$ ), analysis_provider_originals_v1 as (
  -- WORKORDER_SUMMARY_SINGLE_PASS_V2: aggregate the same classified current
  -- tickets directly. The previous join between two original-order aggregates
  -- was estimated as one row and repeatedly scanned thousands of originals.
  select platform_key,issue_kind,original_order_no,
   case when count(distinct provider)=1 then min(provider) else '三方归属待核对' end provider,
   bool_or(status_code=4) processed,
   case when min(amount) is null then 0 when min(amount)=max(amount) then 1 else 2 end amount_variants,
   case when min(amount)=max(amount) then min(amount) end amount
  from analysis_provider_details_v1 where original_order_no is not null
  group by platform_key,issue_kind,original_order_no
$new$),
($old$   case when count(*) filter(where status_code=4 and amount is null)=0 then coalesce(sum(amount) filter(where status_code=4),0) end processed_ticket_amount
  from filtered group by period$old$,$new$   case when count(*) filter(where status_code=4 and amount is null)=0 then coalesce(sum(amount) filter(where status_code=4),0) end processed_ticket_amount,
   count(*) filter(where status_code is distinct from 4) unprocessed_ticket_count,
   case when count(*) filter(where status_code is distinct from 4 and amount is null)=0
     then coalesce(sum(amount) filter(where status_code is distinct from 4),0) end unprocessed_ticket_amount
  from filtered group by period$new$),
($old$   count(*) filter(where amount_variants>1) amount_conflict_count,count(*) filter(where amount_variants=0) missing_amount_count
  from originals group by period$old$,$new$   count(*) filter(where amount_variants>1) amount_conflict_count,count(*) filter(where amount_variants=0) missing_amount_count,
   count(*) filter(where processed is not true) unprocessed_count,
   case when count(*) filter(where processed is not true and amount is null)=0
     then coalesce(sum(amount) filter(where processed is not true),0) end unprocessed_amount
  from originals group by period$new$),
($old$   'processedTicketCount',coalesce(t.processed_ticket_count,0),'processedTicketAmount',case when t.period is null then '0' else t.processed_ticket_amount::text end,
   'rejectedTicketCount',coalesce(t.rejected_ticket_count,0),$old$,$new$   'processedTicketCount',coalesce(t.processed_ticket_count,0),'processedTicketAmount',case when t.period is null then '0' else t.processed_ticket_amount::text end,
   'unprocessedTicketCount',coalesce(t.unprocessed_ticket_count,0),'unprocessedTicketAmount',case when t.period is null then '0' else t.unprocessed_ticket_amount::text end,
   'rejectedTicketCount',coalesce(t.rejected_ticket_count,0),$new$),
($old$   'uniqueProcessedAmount',case when coalesce(o.order_count,0)=0 and coalesce(t.ticket_count,0)>0 then null when o.period is null then '0' else o.processed_amount::text end,
   'coverage',$old$,$new$   'uniqueProcessedAmount',case when coalesce(o.order_count,0)=0 and coalesce(t.ticket_count,0)>0 then null when o.period is null then '0' else o.processed_amount::text end,
   'uniqueUnprocessedCount',case when coalesce(o.order_count,0)=0 and coalesce(t.ticket_count,0)>0 then null else coalesce(o.unprocessed_count,0) end,
   'uniqueUnprocessedAmount',case when coalesce(o.order_count,0)=0 and coalesce(t.ticket_count,0)>0 then null when o.period is null then '0' else o.unprocessed_amount::text end,
   'coverage',$new$),
($old$array['ticketCount','ticketAmount','processedTicketCount','processedTicketAmount','uniqueOrderCount','uniqueOrderAmount','uniqueProcessedCount','uniqueProcessedAmount']$old$,$new$array['ticketCount','ticketAmount','processedTicketCount','processedTicketAmount','unprocessedTicketCount','unprocessedTicketAmount','uniqueOrderCount','uniqueOrderAmount','uniqueProcessedCount','uniqueProcessedAmount','uniqueUnprocessedCount','uniqueUnprocessedAmount','kycYesCount','kycNoCount','kycUnknownCount','utrYesCount','utrNoCount','utrUnknownCount']$new$)
  ) changes(old_text,new_text) loop
    if (length(candidate)-length(replace(candidate,change.old_text,'')))/length(change.old_text)<>1 then
      raise exception 'Workorder summary fragment changed: %',left(change.old_text,100);
    end if;
    candidate:=replace(candidate,change.old_text,change.new_text);
  end loop;
  if md5(candidate)<>'f61cb5749b6d091f50383ac53d35a71c' then raise exception 'Workorder summary candidate changed';end if;
  execute 'create or replace function private.dashboard_admin_live_workorder_analysis(p_query jsonb) returns jsonb language plpgsql stable security definer set search_path='''' set statement_timeout=''20s'' as '||quote_literal(candidate);
  if (select proacl is distinct from p.proacl from pg_proc where oid=target) then
    raise exception 'Workorder summary ACL unexpectedly changed';
  end if;
end;
$install$;
notify pgrst,'reload schema';
commit;
