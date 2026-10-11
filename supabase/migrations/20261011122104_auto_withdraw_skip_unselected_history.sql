-- Skip unused operator metrics in the auto view without dropping operator-only directory platforms.
-- Non-Brazil scopes skip the Panghu history only under the reviewed country mapping;
-- shared mapping drift automatically retains the original history path. Prior facts are preserved.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $patch$
declare f oid:=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');
 definition text;body_hash text;before_meta jsonb;after_meta jsonb;
begin
 if f is null then raise exception 'AR_AUTO_PRUNE_BASELINE_MISSING';end if;
 select md5(prosrc),pg_get_functiondef(oid),to_jsonb(p)-'prosrc' into body_hash,definition,before_meta from pg_proc p where oid=f;
 if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang
   where p.oid=f and r.rolname='postgres' and l.lanname='plpgsql' and p.provolatile='s' and p.prosecdef
    and p.proconfig=array['search_path=""']::text[]
    and p.proacl=array['postgres=X/postgres','authenticated=X/postgres']::aclitem[]
    and p.proparallel='u' and not p.proretset and p.prorettype='jsonb'::regtype
    and pg_get_function_identity_arguments(p.oid)='p_request jsonb' and pg_get_function_result(p.oid)='jsonb') then
  raise exception 'AR_AUTO_PRUNE_METADATA_MISMATCH';end if;
 if body_hash='2938e5c2257e166c2c98f607de7b51e0' then return;end if;
 if body_hash<>'ff95fdfb022b8c4e6696697829372a19' then raise exception 'AR_AUTO_PRUNE_BODY_MISMATCH';end if;
 if (length(definition)-length(replace(definition,$old1$prior_operator_source as materialized ($old1$,'')))/length($old1$prior_operator_source as materialized ($old1$)<>1 then raise exception 'AR_AUTO_PRUNE_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old1$prior_operator_source as materialized ($old1$,$new1$prior_operator_source as not materialized ($new1$);
 if (length(definition)-length(replace(definition,$old2$operator_source as materialized ($old2$,'')))/length($old2$operator_source as materialized ($old2$)<>1 then raise exception 'AR_AUTO_PRUNE_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old2$operator_source as materialized ($old2$,$new2$operator_source as not materialized ($new2$);
 if (length(definition)-length(replace(definition,$old3$select o.* from operator_source o where (v_platforms$old3$,'')))/length($old3$select o.* from operator_source o where (v_platforms$old3$)<>1 then raise exception 'AR_AUTO_PRUNE_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old3$select o.* from operator_source o where (v_platforms$old3$,$new3$select o.* from operator_source o where v_view='operators' and (v_platforms$new3$);
 if (length(definition)-length(replace(definition,$old4$ select array_agg(distinct upper(btrim(platform))) into v_panghu from (
  select platform from public.auto_withdraw_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.withdraw_operator_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.newar_business_snapshots where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
 ) confirmed;
$old4$,'')))/length($old4$ select array_agg(distinct upper(btrim(platform))) into v_panghu from (
  select platform from public.auto_withdraw_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.withdraw_operator_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.newar_business_snapshots where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
 ) confirmed;
$old4$)<>1 then raise exception 'AR_AUTO_PRUNE_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old4$ select array_agg(distinct upper(btrim(platform))) into v_panghu from (
  select platform from public.auto_withdraw_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.withdraw_operator_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.newar_business_snapshots where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
 ) confirmed;
$old4$,$new4$ -- Brazil-labelled rows can only enter the Brazil/Panghu targets under this
 -- exact mapping. If that shared mapping changes, retain the original path.
 if exists(select 1 from jsonb_array_elements(v_targets)t where t->>'country' in('巴西','胖虎巴西'))
  or (select md5(prosrc) from pg_catalog.pg_proc where oid='private.dashboard_admin_live_report_country(text,text)'::regprocedure)
     is distinct from '74d85bb2dba1eb0789225883caa922b1' then
 select array_agg(distinct upper(btrim(platform))) into v_panghu from (
  select platform from public.auto_withdraw_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.withdraw_operator_daily where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
  union select platform from public.newar_business_snapshots where country in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
 ) confirmed;
 else v_panghu:=null;end if;
$new4$);
 execute definition;
 select to_jsonb(p)-'prosrc' into after_meta from pg_proc p where oid=f;
 if before_meta is distinct from after_meta or (select md5(prosrc) from pg_proc where oid=f)<>'2938e5c2257e166c2c98f607de7b51e0' then
  raise exception 'AR_AUTO_PRUNE_POSTCHECK_MISMATCH';end if;
end;
$patch$;
commit;
