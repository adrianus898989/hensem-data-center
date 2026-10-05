-- User-confirmed business success: a reliable handled ticket for this full original.
-- Monetary/provider differences do not reopen a successfully handled original.
-- Explicit receipt queries and the legacy operation-date route remain unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $processed_success$
declare p record;h record;auth_role oid;definition text;before_meta jsonb;after_meta jsonb;router_meta jsonb;old_text text;new_text text;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_workorder_records(jsonb)');
 select oid into auth_role from pg_roles where rolname='authenticated';
 if p.oid is null or md5(p.prosrc)<>'2fb4df122737456d9d5bbd8307786183'
  or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s' or not p.prosecdef or p.pronargdefaults<>0
  or p.proconfig is distinct from array['search_path=""','statement_timeout=20s']::text[] then raise exception 'REGISTRATION_PROCESSED_ROUTER_CHANGED';end if;
 if auth_role is null or not exists(select 1 from aclexplode(p.proacl) a where a.grantee=auth_role and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,auth_role) or a.grantee=auth_role and a.is_grantable) then raise exception 'REGISTRATION_PROCESSED_ACL_CHANGED';end if;
 select * into h from pg_proc where oid=to_regprocedure('private.dashboard_admin_workorder_registration(jsonb)');
 if h.oid is null or md5(h.prosrc) not in ('2b9461f02a6850891f574899cdb326b0','f0cec4e43873303811948d00f12eb7bb') or h.prosecdef or h.provolatile<>'s' or h.prorettype<>'jsonb'::regtype or h.pronargdefaults<>0
  or h.proconfig is distinct from array['search_path=""']::text[] or h.proowner<>p.proowner
  or exists(select 1 from aclexplode(coalesce(h.proacl,acldefault('f',h.proowner))) a where a.grantee<>h.proowner) then raise exception 'REGISTRATION_PROCESSED_HELPER_CHANGED';end if;
 if md5(h.prosrc)='f0cec4e43873303811948d00f12eb7bb' then return;end if;
 before_meta:=to_jsonb(h)-'prosrc';router_meta:=to_jsonb(p);
 definition:=pg_get_functiondef(h.oid);
 old_text:=$old_0$v_basis text:=coalesce(nullif(f->>'successBasis',''),'receipt');v_result jsonb;$old_0$;
 new_text:=$new_0$v_basis text:=coalesce(nullif(f->>'successBasis',''),'processed');v_result jsonb;$new_0$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_PROCESSED_FRAGMENT_0_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_1$else not source_conflict and exists(select 1 from keyed w where w.case_key=e.case_key and w.processing='processed' and not w.source_conflict) end excluded_success$old_1$;
 new_text:=$new_1$else e.payment_id is not null and exists(select 1 from keyed w where w.case_key=e.case_key and w.processing='processed' and not w.identity_conflict) end excluded_success$new_1$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_PROCESSED_FRAGMENT_1_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_2$), evaluated as materialized ($old_2$;
 new_text:=$new_2$), processing_conflicts as materialized (
 select distinct case_key from keyed where processing='unknown' and source_workorder_state='源状态有变化'
), evaluated as materialized ($new_2$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_PROCESSED_FRAGMENT_2_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_3$  case when c.payment_id is null or c.source_conflict or coalesce(r.identifier_conflict,false) or coalesce(r.amount_conflict,false)
$old_3$;
 new_text:=$new_3$  case when c.payment_id is null or c.source_conflict or v_basis='processed' and p.case_key is not null or coalesce(r.identifier_conflict,false) or coalesce(r.amount_conflict,false)
$new_3$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_PROCESSED_FRAGMENT_3_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_4$  case when c.payment_id is null then 'no_identifiers' when c.source_conflict then 'source_conflict'
$old_4$;
 new_text:=$new_4$  case when c.payment_id is null then 'no_identifiers' when c.source_conflict then 'source_conflict'
   when v_basis='processed' and p.case_key is not null then 'processing_conflict'
$new_4$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_PROCESSED_FRAGMENT_4_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old_5$ from candidate_cases c left join registration_summary r using(case_key)
$old_5$;
 new_text:=$new_5$ from candidate_cases c left join registration_summary r using(case_key) left join processing_conflicts p using(case_key)
$new_5$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_PROCESSED_FRAGMENT_5_CHANGED';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
 select to_jsonb(f)-'prosrc' into after_meta from pg_proc f where f.oid=h.oid;
 if before_meta is distinct from after_meta or router_meta is distinct from (select to_jsonb(f) from pg_proc f where f.oid=p.oid) then raise exception 'REGISTRATION_PROCESSED_METADATA_CHANGED';end if;
 if (select md5(prosrc) from pg_proc where oid=h.oid)<>'f0cec4e43873303811948d00f12eb7bb' then raise exception 'REGISTRATION_PROCESSED_RESULT_CHANGED';end if;
end;$processed_success$;
notify pgrst,'reload schema';
commit;
