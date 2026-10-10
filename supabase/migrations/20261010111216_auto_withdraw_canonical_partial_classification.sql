-- Canonicalize the registered MAAN alias before source exclusion/grouping.
-- Keep NewAR detail as the sole source for its registered scope: no snapshot
-- fallback, no inferred processing times, no classification remapping.
-- Mixed-source totals expose only classifications actually observed by SUM;
-- their remaining orders stay unclassified and their classification is not
-- comparable to another period without a verified identical source cohort.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare p record;after_metadata jsonb;definition text;authenticated_id oid;
 before_metadata jsonb;name text;before_hash text;after_hash text;
begin
 select oid into authenticated_id from pg_catalog.pg_roles where rolname='authenticated';
 if authenticated_id is null then raise exception 'auto_withdraw_identity_auth_role_missing';end if;
 foreach name in array array['private.dashboard_admin_live_withdraw_key(text)','private.dashboard_admin_live_auto_withdraw(jsonb)'] loop
  select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
   where f.oid=pg_catalog.to_regprocedure(name);
  if not found then raise exception 'auto_withdraw_identity_baseline_missing';end if;
  before_hash:=case name when 'private.dashboard_admin_live_withdraw_key(text)' then '40951d8743777deafdd64153820fd473' else 'b9d0f3c8a83881b530505afc94a46a53' end;
  after_hash:=case name when 'private.dashboard_admin_live_withdraw_key(text)' then '440671f01a670ad05695e9b8692888a3' else '61e38bb57247818d83fa694efffab91d' end;
  if pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' or md5(p.prosrc) not in(before_hash,after_hash) or p.proconfig is distinct from array['search_path=""']
    or (case name when 'private.dashboard_admin_live_withdraw_key(text)' then
      p.prorettype<>'text'::regtype or p.provolatile<>'i' or p.prosecdef or p.pronargdefaults<>0 or p.lanname<>'sql'
     else p.prorettype<>'jsonb'::regtype or p.provolatile<>'s' or not p.prosecdef or p.pronargdefaults<>1 or p.lanname<>'plpgsql' end)
   then raise exception 'auto_withdraw_identity_definition_drift';end if;
  if p.proacl is null or exists(select 1 from pg_catalog.aclexplode(p.proacl) a
    where a.privilege_type='EXECUTE' and (a.is_grantable or (a.grantee<>p.proowner and
     (name<>'private.dashboard_admin_live_auto_withdraw(jsonb)' or a.grantee<>authenticated_id))))
    or (name='private.dashboard_admin_live_auto_withdraw(jsonb)' and not exists(
     select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=authenticated_id and a.privilege_type='EXECUTE' and not a.is_grantable))
   then raise exception 'auto_withdraw_identity_acl_drift';end if;
  select to_jsonb(f)-'prosrc' into before_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
  if md5(p.prosrc)=before_hash then
   definition:=pg_catalog.pg_get_functiondef(p.oid);
   if name='private.dashboard_admin_live_withdraw_key(text)' then
    if (length(definition)-length(replace(definition,$old_key$when 'VEER.GAME' then 'VEERGAME' else upper(btrim(p_name)) end;$old_key$,'')))/length($old_key$when 'VEER.GAME' then 'VEERGAME' else upper(btrim(p_name)) end;$old_key$)<>1 then
     raise exception 'auto_withdraw_identity_key_fragment_drift';end if;
    definition:=replace(definition,$old_key$when 'VEER.GAME' then 'VEERGAME' else upper(btrim(p_name)) end;$old_key$,$new_key$when 'VEER.GAME' then 'VEERGAME' when 'MAAN.WIN' then 'MAANWIN' else upper(btrim(p_name)) end;$new_key$);
   else
    if (length(definition)-length(replace(definition,$old_reader$    v_yash_meta:=jsonb_build_object('classificationAvailable',false,'reasonAvailable',false,'autoCount',null,'manualCount',null);$old_reader$,'')))/length($old_reader$    v_yash_meta:=jsonb_build_object('classificationAvailable',false,'reasonAvailable',false,'autoCount',null,'manualCount',null);$old_reader$)<>1 then
     raise exception 'auto_withdraw_identity_reader_fragment_drift';end if;
    definition:=replace(definition,$old_reader$    v_yash_meta:=jsonb_build_object('classificationAvailable',false,'reasonAvailable',false,'autoCount',null,'manualCount',null);$old_reader$,$new_reader$    -- SUM above includes only observed classifications. Preserve that known
    -- subset; an all-unknown source set still has NULL counts, never zero.
    v_yash_meta:=jsonb_build_object('classificationAvailable',false,
     'classificationPartial',coalesce(jsonb_typeof(v_result->v_yash_period->'autoCount')='number'
       or jsonb_typeof(v_result->v_yash_period->'manualCount')='number',false),
     'classificationComparable',false,'reasonAvailable',false,
     'autoCount',v_result->v_yash_period->'autoCount','manualCount',v_result->v_yash_period->'manualCount');$new_reader$);
   end if;
   execute definition;
  end if;
  select to_jsonb(f)-'prosrc' into after_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
  if (select md5(f.prosrc) from pg_catalog.pg_proc f where f.oid=p.oid)<>after_hash or after_metadata is distinct from before_metadata
   then raise exception 'auto_withdraw_identity_postcondition_failed';end if;
 end loop;
end;
$migration$;
notify pgrst,'reload schema';
commit;
