-- Retain only observed NEWAR/YASH prior facts; coverage still forbids comparison.
-- No source data, counts, scope, date predicates, or scan shape are changed.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $patch$
declare f oid:=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');
 definition text;body_hash text;before_meta jsonb;after_meta jsonb;
begin
 if f is null then raise exception 'WITHDRAW_PREVIOUS_BASELINE_MISSING';end if;
 select md5(prosrc),pg_get_functiondef(oid),to_jsonb(p)-'prosrc' into body_hash,definition,before_meta from pg_proc p where oid=f;
 if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang
  where p.oid=f and r.rolname='postgres' and l.lanname='plpgsql' and p.provolatile='s' and p.prosecdef
   and p.proconfig=array['search_path=""']::text[]
   and p.proacl=array['postgres=X/postgres','authenticated=X/postgres']::aclitem[]
   and p.proparallel='u' and not p.proretset and p.prorettype='jsonb'::regtype
   and pg_get_function_identity_arguments(p.oid)='p_request jsonb' and pg_get_function_result(p.oid)='jsonb') then
  raise exception 'WITHDRAW_PREVIOUS_METADATA_MISMATCH';end if;
 if body_hash='ff95fdfb022b8c4e6696697829372a19' then return;end if;
 if body_hash<>'4130899363f159f93450b2915311aa6f' then raise exception 'WITHDRAW_PREVIOUS_BODY_MISMATCH';end if;
 if (length(definition)-length(replace(definition,$old0$    then jsonb_set(p.item,'{previous}','null'::jsonb)
   when exists(select 1 from yash_days$old0$,'')))/length($old0$    then jsonb_set(p.item,'{previous}','null'::jsonb)
   when exists(select 1 from yash_days$old0$)<>1 then raise exception 'WITHDRAW_PREVIOUS_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old0$    then jsonb_set(p.item,'{previous}','null'::jsonb)
   when exists(select 1 from yash_days$old0$,$new0$    then p.item||jsonb_build_object('comparisonComparable',false,'comparisonBasis','source_coverage_not_aligned')
   when exists(select 1 from yash_days$new0$);
 if (length(definition)-length(replace(definition,$old1$    then jsonb_set(p.item,'{previous}','null'::jsonb) else p.item end item$old1$,'')))/length($old1$    then jsonb_set(p.item,'{previous}','null'::jsonb) else p.item end item$old1$)<>1 then raise exception 'WITHDRAW_PREVIOUS_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old1$    then jsonb_set(p.item,'{previous}','null'::jsonb) else p.item end item$old1$,$new1$    then p.item||jsonb_build_object('comparisonComparable',false,'comparisonBasis','source_coverage_not_aligned') else p.item end item$new1$);
 if (length(definition)-length(replace(definition,$old2$     if (v_yash_meta->>'complete')::boolean and (v_yash_prior->>'complete')::boolean then
      v_yash_item:=jsonb_set(v_yash_item,'{previous}',(v_yash_item->'previous')||v_yash_prior);
     else v_yash_item:=jsonb_set(v_yash_item,'{previous}','null'::jsonb);end if;$old2$,'')))/length($old2$     if (v_yash_meta->>'complete')::boolean and (v_yash_prior->>'complete')::boolean then
      v_yash_item:=jsonb_set(v_yash_item,'{previous}',(v_yash_item->'previous')||v_yash_prior);
     else v_yash_item:=jsonb_set(v_yash_item,'{previous}','null'::jsonb);end if;$old2$)<>1 then raise exception 'WITHDRAW_PREVIOUS_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old2$     if (v_yash_meta->>'complete')::boolean and (v_yash_prior->>'complete')::boolean then
      v_yash_item:=jsonb_set(v_yash_item,'{previous}',(v_yash_item->'previous')||v_yash_prior);
     else v_yash_item:=jsonb_set(v_yash_item,'{previous}','null'::jsonb);end if;$old2$,$new2$     v_yash_item:=jsonb_set(v_yash_item,'{previous}',(v_yash_item->'previous')||v_yash_prior);
     if not ((v_yash_meta->>'complete')::boolean and (v_yash_prior->>'complete')::boolean) then
      v_yash_item:=v_yash_item||jsonb_build_object('comparisonComparable',false,'comparisonBasis','source_coverage_not_aligned');
     end if;$new2$);
 execute definition;
 select to_jsonb(p)-'prosrc' into after_meta from pg_proc p where oid=f;
 if before_meta is distinct from after_meta or (select md5(prosrc) from pg_proc where oid=f)<>'ff95fdfb022b8c4e6696697829372a19' then
  raise exception 'WITHDRAW_PREVIOUS_POSTCHECK_MISMATCH';end if;
end;
$patch$;
commit;
