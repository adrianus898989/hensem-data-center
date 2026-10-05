-- Preserve full-month, all-platform reconciliation without quadratic CTE rejoins.
-- Carry exact-match evidence and per-original sort/count facts forward once.
-- No source, authorization, success, range, pagination, or timeout changes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $set_matching$
declare p record;h record;auth_role oid;definition text;before_meta jsonb;after_meta jsonb;router_meta jsonb;old_text text;new_text text;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_workorder_records(jsonb)');
 select oid into auth_role from pg_roles where rolname='authenticated';
 if p.oid is null or md5(p.prosrc)<>'2fb4df122737456d9d5bbd8307786183'
  or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s' or not p.prosecdef or p.pronargdefaults<>0
  or p.proconfig is distinct from array['search_path=""','statement_timeout=20s']::text[] then raise exception 'REGISTRATION_SET_MATCHING_ROUTER_CHANGED';end if;
 if auth_role is null or not exists(select 1 from aclexplode(p.proacl) a where a.grantee=auth_role and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,auth_role) or a.grantee=auth_role and a.is_grantable) then raise exception 'REGISTRATION_SET_MATCHING_ACL_CHANGED';end if;
 select * into h from pg_proc where oid=to_regprocedure('private.dashboard_admin_workorder_registration(jsonb)');
 if h.oid is null or md5(h.prosrc) not in ('f0cec4e43873303811948d00f12eb7bb','82332dfe28f2103981addfc26c95f12d') or h.prosecdef or h.provolatile<>'s' or h.prorettype<>'jsonb'::regtype or h.pronargdefaults<>0
  or h.proconfig is distinct from array['search_path=""']::text[] or h.proowner<>p.proowner
  or exists(select 1 from aclexplode(coalesce(h.proacl,acldefault('f',h.proowner))) a where a.grantee<>h.proowner) then raise exception 'REGISTRATION_SET_MATCHING_HELPER_CHANGED';end if;
 if md5(h.prosrc)='82332dfe28f2103981addfc26c95f12d' then return;end if;
 before_meta:=to_jsonb(h)-'prosrc';router_meta:=to_jsonb(p);
 definition:=pg_get_functiondef(h.oid);
 old_text:=$old_0$utr_conflict,count(*) related_workorders,sum(export_rows) related_records
$old_0$;
 new_text:=$new_0$utr_conflict,count(*) related_workorders,sum(export_rows) related_records,
   count(*) workorder_count,max(submitted_at) submitted_at,max(observed_at) collected_at
$new_0$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_0_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_1$reference_conflict_workorders
  from case_base$old_1$;
 new_text:=$new_1$reference_conflict_workorders,
   c.workorder_count,c.submitted_at,c.collected_at
  from case_base$new_1$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_1_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_2$select c.case_key,c.platform,'order'::text kind,c.payment_id identifier$old_2$;
 new_text:=$new_2$select c.case_key,c.platform,c.amount case_amount,c.payment_id case_payment_id,'order'::text kind,c.payment_id identifier$new_2$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_2_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_3$select c.case_key,c.platform,'workorder',upper(btrim(w.workorder_id))$old_3$;
 new_text:=$new_3$select c.case_key,c.platform,c.amount,c.payment_id,'workorder',upper(btrim(w.workorder_id))$new_3$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_3_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_4$select c.case_key,c.platform,'workorder',upper(btrim(m.workorder_no))$old_4$;
 new_text:=$new_4$select c.case_key,c.platform,c.amount,c.payment_id,'workorder',upper(btrim(m.workorder_no))$new_4$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_4_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_5$ select r.source_kind,r.source_id,r.platform,'order'::text kind,r.order_no identifier$old_5$;
 new_text:=$new_5$ -- Carry already-scoped evidence through exact-key matching. Rejoining the
 -- small-estimate CTE by source id can compare every registration to every case.
 select r.*,'order'::text kind,r.order_no identifier$new_5$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_5_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_6$ select r.source_kind,r.source_id,r.platform,'workorder',ref$old_6$;
 new_text:=$new_6$ select r.*,'workorder',ref$new_6$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_6_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_7$ select distinct c.case_key,r.source_kind,r.source_id from candidate_identifiers c join registration_keys r using(platform,kind,identifier)$old_7$;
 new_text:=$new_7$ select distinct c.case_key,c.case_amount,c.case_payment_id,
  r.source_id,r.source_kind,r.platform,r.source_sheet,r.source_tab,r.source_gid,r.source_row,
  r.order_no,r.workorder_no,r.amount,r.currency,r.status,r.outcome,r.updated_at,r.workorder_refs
 from candidate_identifiers c join registration_keys r using(platform,kind,identifier)$new_7$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_7_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_8$ select c.case_key,r.*,c.amount is not null and r.amount is not null and c.amount<>r.amount amount_conflict,
  c.payment_id is not null and r.order_no is not null and c.payment_id<>r.order_no identifier_conflict,$old_8$;
 new_text:=$new_8$ select r.*,r.case_amount is not null and r.amount is not null and r.case_amount<>r.amount amount_conflict,
  r.case_payment_id is not null and r.order_no is not null and r.case_payment_id<>r.order_no identifier_conflict,$new_8$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_8_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_9$row_number() over(partition by c.case_key order by r.updated_at desc nulls last,r.source_kind,r.source_id) evidence_pos
 from registration_links l join registration_rows r using(source_kind,source_id) join candidate_cases c using(case_key)$old_9$;
 new_text:=$new_9$row_number() over(partition by r.case_key order by r.updated_at desc nulls last,r.source_kind,r.source_id) evidence_pos
 from registration_links r$new_9$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_9_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_10$ case_workorders as materialized (
  -- Count and sort with narrow fields; detailed evidence is assembled only after pagination.
 select c.case_key,count(*) workorder_count,max(w.submitted_at) submitted_at,max(w.observed_at) collected_at
 from candidate_cases c join keyed w using(case_key) group by c.case_key
), paged_keys as materialized (
 select c.*,w.workorder_count,w.submitted_at,w.collected_at from selected c join case_workorders w using(case_key)
 order by w.submitted_at desc nulls last,c.platform,c.case_key offset v_offset limit v_limit
), page_workorder_rows as ($old_10$;
 new_text:=$new_10$ paged_keys as materialized (
 -- These fields were aggregated once with the original case. Paginate without
 -- rejoining the entire workorder population when cardinality is underestimated.
 select c.* from selected c
 order by c.submitted_at desc nulls last,c.platform,c.case_key offset v_offset limit v_limit
), page_workorder_rows as materialized ($new_10$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_10_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_11$), page_workorders as ($old_11$;
 new_text:=$new_11$), page_workorders as materialized ($new_11$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_11_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_12$), page_evidence as ($old_12$;
 new_text:=$new_12$), page_evidence as materialized ($new_12$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_12_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_13$'latestCollectedAt',(select max(collected_at) from case_workorders)$old_13$;
 new_text:=$new_13$'latestCollectedAt',(select max(collected_at) from candidate_cases)$new_13$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_SET_MATCHING_FRAGMENT_13_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
 select to_jsonb(f)-'prosrc' into after_meta from pg_proc f where f.oid=h.oid;
 if before_meta is distinct from after_meta or router_meta is distinct from (select to_jsonb(f) from pg_proc f where f.oid=p.oid) then raise exception 'REGISTRATION_SET_MATCHING_METADATA_CHANGED';end if;
 if (select md5(prosrc) from pg_proc where oid=h.oid)<>'82332dfe28f2103981addfc26c95f12d' then raise exception 'REGISTRATION_SET_MATCHING_RESULT_CHANGED';end if;
end;$set_matching$;
notify pgrst,'reload schema';
commit;
