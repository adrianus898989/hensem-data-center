-- Exact rollback of the two function-local settings; source/body stays unchanged.
-- Only two reason-reader function-local planning settings. Bodies, ACLs and all other metadata stay exact.
begin;set local lock_timeout='3s';set local statement_timeout='15s';
do $guard$declare d record;target_proc pg_proc%rowtype;begin
 if current_user<>'postgres'then raise exception 'OWNER_REQUIRED';end if;
 for d in select *from(values ('public.dashboard_admin_live_withdraw_reasons(jsonb)','def823ac54ece8b4ea74213daacabd40','013628a726790c5096fe4f37cde73078'),('private.ar_withdraw_detail_evidence_generation()','393978c9146ae30019a87632d4d51998','2faf3014abf50db358400b4fff3001fd'),('private.dashboard_admin_live_blocking_details_cleaned(text)','17122a5ed74374c036bd19b073088031','9b368a8dee1bee462c24b8bd9b97b760'),('private.dashboard_admin_live_clean_note(text)','0a8b5a2afd3753a51127a1bd4e0baede','afd000c394fb25788e5413d286d45528'),('private.dashboard_admin_live_withdraw_reasons(jsonb)','bbd30a9d84eb96e7e9c82886f92656e0','6fa3e518df4900294a31dc6c9ee65438'),('private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)','7c63b8220cd8be35423a1f3d93039447','5701546be4265b198eeb45b823717c6c'))x(signature,body_md5,definition_md5)loop
  select *into target_proc from pg_proc where oid=to_regprocedure(d.signature);
  if target_proc.oid is null or target_proc.proowner<>'postgres'::regrole or md5(target_proc.prosrc)<>d.body_md5 or md5(pg_get_functiondef(target_proc.oid))<>d.definition_md5
   then raise exception 'WITHDRAW_FUNCTION_PLAN_BASELINE_DRIFT';end if;
 end loop;
 for d in select *from(values ('private.dashboard_admin_live_withdraw_reasons(jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true),('private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)','{postgres=X/postgres}',false))x(signature,acl,definer)loop
  select *into target_proc from pg_proc where oid=to_regprocedure(d.signature);
  if target_proc.proconfig is distinct from array['search_path=""','plan_cache_mode=force_custom_plan']::text[] or target_proc.proacl::text is distinct from d.acl or target_proc.prosecdef is distinct from d.definer
   then raise exception 'WITHDRAW_FUNCTION_PLAN_METADATA_DRIFT';end if;
 end loop;
 perform set_config('audit.withdraw_function_plan_before',(select jsonb_object_agg(p.oid::regprocedure::text,to_jsonb(p))::text from pg_proc p where p.oid in('public.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.ar_withdraw_detail_evidence_generation()'::regprocedure,'private.dashboard_admin_live_blocking_details_cleaned(text)'::regprocedure,'private.dashboard_admin_live_clean_note(text)'::regprocedure,'private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)'::regprocedure)),true);
end;$guard$;
alter function private.dashboard_admin_live_withdraw_reasons(jsonb) reset plan_cache_mode;
alter function private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb) reset plan_cache_mode;
do $verify$declare p pg_proc%rowtype;sig text;snapshot jsonb:=current_setting('audit.withdraw_function_plan_before')::jsonb;begin
 for p in select *from pg_proc where oid in('public.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.ar_withdraw_detail_evidence_generation()'::regprocedure,'private.dashboard_admin_live_blocking_details_cleaned(text)'::regprocedure,'private.dashboard_admin_live_clean_note(text)'::regprocedure,'private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)'::regprocedure)loop
  sig:=p.oid::regprocedure::text;
  if p.oid in('private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)'::regprocedure)then
   if (to_jsonb(p)-'proconfig')is distinct from((snapshot->sig)-'proconfig')or p.proconfig is distinct from array['search_path=""']::text[]then raise exception 'WITHDRAW_FUNCTION_PLAN_NONCONFIG_CHANGED';end if;
  elsif to_jsonb(p)is distinct from snapshot->sig then raise exception 'WITHDRAW_FUNCTION_PLAN_UNRELATED_CHANGED';end if;
 end loop;
end;$verify$;
commit;
