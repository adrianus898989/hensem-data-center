-- Keep observed prior AR daily values with their original duration basis.
-- AR source completeness and formal comparison remain unverified. No row is
-- fabricated and no cross-basis duration delta is evaluated or sorted.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $patch$
declare f oid:=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');
 definition text;body_hash text;before_meta jsonb;after_meta jsonb;
begin
 if f is null then raise exception 'AR_PREVIOUS_BASELINE_MISSING';end if;
 select md5(prosrc),pg_get_functiondef(oid),to_jsonb(p)-'prosrc' into body_hash,definition,before_meta from pg_proc p where oid=f;
 if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang
   where p.oid=f and r.rolname='postgres' and l.lanname='plpgsql' and p.provolatile='s' and p.prosecdef
    and p.proconfig=array['search_path=""']::text[]
    and p.proacl=array['postgres=X/postgres','authenticated=X/postgres']::aclitem[]
    and p.proparallel='u' and not p.proretset and p.prorettype='jsonb'::regtype
    and pg_get_function_identity_arguments(p.oid)='p_request jsonb' and pg_get_function_result(p.oid)='jsonb') then
  raise exception 'AR_PREVIOUS_METADATA_MISMATCH';end if;
 if body_hash='4130899363f159f93450b2915311aa6f' then return;end if;
 if body_hash<>'f9ac67304f2b5fae66a8b35f080ab981' then raise exception 'AR_PREVIOUS_BODY_MISMATCH';end if;
 if (length(definition)-length(replace(definition,$old1$    then jsonb_set(p.item,'{previous}','null'::jsonb)
   when exists(select 1 from newar_days$old1$,'')))/length($old1$    then jsonb_set(p.item,'{previous}','null'::jsonb)
   when exists(select 1 from newar_days$old1$)<>1 then raise exception 'AR_PREVIOUS_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old1$    then jsonb_set(p.item,'{previous}','null'::jsonb)
   when exists(select 1 from newar_days$old1$,$new1$    then p.item||jsonb_build_object('comparisonComparable',false,'comparisonBasis','unverified_source_continuity')
   when exists(select 1 from newar_days$new1$);
 if (length(definition)-length(replace(definition,$old2$     'durationBasis','applied_to_completed','previous',null);$old2$,'')))/length($old2$     'durationBasis','applied_to_completed','previous',null);$old2$)<>1 then raise exception 'AR_PREVIOUS_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old2$     'durationBasis','applied_to_completed','previous',null);$old2$,$new2$     'durationBasis','applied_to_completed','comparisonComparable',false,'comparisonBasis','unverified_source_continuity');$new2$);
 if (length(definition)-length(replace(definition,$old3$    when 'durationChange' then (item->>'avgSeconds')::numeric/nullif((item->'previous'->>'avgSeconds')::numeric,0)-1$old3$,'')))/length($old3$    when 'durationChange' then (item->>'avgSeconds')::numeric/nullif((item->'previous'->>'avgSeconds')::numeric,0)-1$old3$)<>1 then raise exception 'AR_PREVIOUS_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old3$    when 'durationChange' then (item->>'avgSeconds')::numeric/nullif((item->'previous'->>'avgSeconds')::numeric,0)-1$old3$,$new3$    when 'durationChange' then case when coalesce((item->>'comparisonComparable')::boolean,true)
      then (item->>'avgSeconds')::numeric/nullif((item->'previous'->>'avgSeconds')::numeric,0)-1 end$new3$);
 execute definition;
 select to_jsonb(p)-'prosrc' into after_meta from pg_proc p where oid=f;
 if before_meta is distinct from after_meta or (select md5(prosrc) from pg_proc where oid=f)<>'4130899363f159f93450b2915311aa6f' then
  raise exception 'AR_PREVIOUS_POSTCHECK_MISMATCH';end if;
end;
$patch$;
commit;
