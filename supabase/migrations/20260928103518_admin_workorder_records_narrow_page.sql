-- Keep monthly workorder queries narrow until the final page is chosen.
-- Request validation, authorization, all-history metadata and response fields stay unchanged.
-- No business data writes, grants, new helper entrypoints or timeout increases.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare definition text; old_part text; new_part text;
begin
 select pg_get_functiondef('private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure) into definition;
 if position('records_narrow_page_v1' in definition)>0 then return;end if;
 if position('records_scope_first_v1' in definition)=0 then raise exception 'Collected-workorder scope-first optimization is required';end if;
 old_part:=$old_0$ ), filtered as materialized (
  select * from scoped d where$old_0$;
 new_part:=$new_0$ ), filtered as materialized (
  -- records_narrow_page_v1: retain only the key and fields used by counts/matching until pagination.
  select d.system_name,d.country_code,d.platform,d.work_order_id,d.work_order_no,d.payment_order_no,d.amount,
   d.display_platform,d.display_team,d.operated_at,d.operator_account,d.issue_kind,d.status_code,d.sort_at from scoped d where$new_0$;
 if (length(definition)-length(replace(definition,old_part,'')))/length(old_part)<>1 then raise exception 'Collected-workorder narrow-page baseline changed at fragment 0; review before applying';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old_1$  from filtered d
  left join lateral ($old_1$;
 new_part:=$new_1$  from (select * from filtered where v_view='missing') d
  left join lateral ($new_1$;
 if (length(definition)-length(replace(definition,old_part,'')))/length(old_part)<>1 then raise exception 'Collected-workorder narrow-page baseline changed at fragment 1; review before applying';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old_2$ ), selected as (select * from matches where coalesce(f->>'registrationStatus','')='' or registration_status=f->>'registrationStatus'),
 records_page as (select * from selected order by sort_at desc nulls last,platform,work_order_id limit page_limit offset page_offset),$old_2$;
 new_part:=$new_2$ ), selected as not materialized (
  select * from matches where coalesce(f->>'registrationStatus','')='' or registration_status=f->>'registrationStatus'
  union all
  -- Registration matching is only meaningful on the missing-registration view.
  -- Its filter is validated as empty for records/workload before reaching this query.
  select d.*,0::bigint registration_count,false workorder_match,false order_match,false amount_conflict,null::text registration_status
   from filtered d where v_view<>'missing'
 ),
 page_keys as (select * from selected order by sort_at desc nulls last,platform,work_order_id limit page_limit offset page_offset),
 records_page as (
  -- Rehydrate only this page, through the complete unique key of already-authorized rows.
  select d.*,p.display_platform,p.display_team,p.sort_at,p.registration_count,p.workorder_match,p.order_match,p.amount_conflict,p.registration_status
  from page_keys p join public.ar_workorder_issue_details d
   on d.system_name=p.system_name and d.country_code=p.country_code and d.platform=p.platform and d.work_order_id=p.work_order_id
 ),$new_2$;
 if (length(definition)-length(replace(definition,old_part,'')))/length(old_part)<>1 then raise exception 'Collected-workorder narrow-page baseline changed at fragment 2; review before applying';end if;
 definition:=replace(definition,old_part,new_part);
 execute definition;
end;
$patch$;
notify pgrst,'reload schema';
commit;
