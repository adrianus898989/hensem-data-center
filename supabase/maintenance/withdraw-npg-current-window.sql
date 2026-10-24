-- Exact NPG template compatibility migration; no queue, source, artifact or selector changes.
-- Requires the separately reviewed DUOLI renderer and current secondary-opt-in DTO.
begin;
set local lock_timeout='500ms';
set local statement_timeout='8s';
do $npg_current_window$
declare v_proc record;before_meta jsonb;before_dep text;definition text;
 old_pin text:='(''withdraw_window_result(jsonb,jsonb,jsonb)'',''5399e6d1730498e5ab35099ed0e369ea'')';
 new_pin text:='(''withdraw_window_result(jsonb,jsonb,jsonb)'',''f5097173ef6236c708c1199d7507fd27'')';
begin
 -- Share the original DUOLI maintenance lock; bounded by the transaction lock timeout.
 perform pg_advisory_xact_lock(hashtext('withdraw_duoli_daily_fallback_v1'));
 if exists(select 1 from(values ('dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)','475f9232fed36cd7b1b053f78802dc70','jsonb'),('dashboard_withdraw_npg_template_zone(jsonb,jsonb,jsonb)','f6c5005c9d895fa2e76586fbf54ff4ee','text'),('withdraw_prepared_render(jsonb,jsonb)','06baadf5408d14fd71b12e93c7ee8b68','jsonb'),('withdraw_window_result(jsonb,jsonb,jsonb)','f5097173ef6236c708c1199d7507fd27','jsonb'),('auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)','13092e904fca6d7cef7ec75052e0abb7','jsonb'))x(signature,body_hash,result_type)
  left join pg_proc p on p.oid=to_regprocedure('private.'||x.signature)
  where p.oid is null or md5(p.prosrc)<>x.body_hash or pg_get_userbyid(p.proowner)<>'postgres'
   or p.proacl::text is distinct from '{postgres=X/postgres}' or p.proconfig is distinct from array['search_path=""']
   or p.prosecdef or p.provolatile<>'s' or p.proretset or p.proparallel<>'u' or p.proisstrict or p.proleakproof
   or p.procost<>100 or p.prorows<>0 or p.prorettype<>x.result_type::regtype
   or p.prolang<>(select oid from pg_language where lanname='plpgsql'))
 then raise exception 'npg_current_window_install_contract_drift';end if;
 select *into v_proc from pg_proc where oid='private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)'::regprocedure;
 before_meta:=to_jsonb(v_proc)-'prosrc';before_dep:=private.withdraw_prepared_dependency();
 if before_dep is null then raise exception 'npg_current_window_dependency_unavailable';end if;
 definition:=pg_get_functiondef(v_proc.oid);
 if(length(definition)-length(replace(definition,old_pin,'')))/length(old_pin)<>1
 then raise exception 'npg_current_window_install_anchor';end if;
 execute replace(definition,old_pin,new_pin);
 select *into v_proc from pg_proc where oid=v_proc.oid;
 if md5(v_proc.prosrc)<>'ce1baf7d1ec8999a8a4646485b3aac9f' or to_jsonb(v_proc)-'prosrc' is distinct from before_meta
  or private.withdraw_prepared_dependency()is distinct from before_dep
 then raise exception 'npg_current_window_install_changed_contract';end if;
end;$npg_current_window$;
commit;
