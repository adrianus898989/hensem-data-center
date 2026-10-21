-- Scope publications by the countries actually requested, while retaining the
-- exact authorization scope, native records, platform filters and both clocks.
-- No worker, expiry, retry budget or calculation kernel is replaced.
create temporary table withdraw_country_install_guard as
 select 'dependency'::text name,to_jsonb(private.withdraw_prepared_dependency())value
 union all select p.proname,to_jsonb(p)-'prosrc'from pg_proc p where p.oid in(
 'private.withdraw_prepared_read(jsonb)'::regprocedure,
 'private.withdraw_prepared_prewarm()'::regprocedure,
 'private.withdraw_prepared_admit_default_template(uuid,jsonb,jsonb,jsonb)'::regprocedure);

create or replace function private.dashboard_withdraw_country_catalog(q jsonb,c jsonb)
returns jsonb language sql immutable set search_path='' as $function$
 -- Preserve every native record for the real country, including the existing
 -- report-team source aliases used by withdraw_prepared_validate. The original
 -- request/scope still selects teams and platforms; neither is rewritten here.
 with targets as(
  select case t->>'country'when'胖虎巴西'then'巴西'when'香港'then'印度'
   when'红膏蟹'then'印度'when'LG'then'菲律宾'else t->>'country'end country
  from jsonb_array_elements(case when q?'scopeTargets'then q->'scopeTargets'
   else jsonb_build_array(jsonb_build_object('country',q->>'country'))end)t)
 select coalesce(jsonb_agg(p order by p->>'id'),'[]'::jsonb)
 from jsonb_array_elements(c)p
 where exists(select 1 from targets t where t.country=case p->>'country'
  when'胖虎巴西'then'巴西'when'香港'then'印度'when'红膏蟹'then'印度'
  when'LG'then'菲律宾'else p->>'country'end);
$function$;
revoke all on function private.dashboard_withdraw_country_catalog(jsonb,jsonb)from public,anon,authenticated,service_role;

-- A retained global-catalog publication may bridge to the new country job only
-- if every relevant native record, every query field and authority scope match.
-- Return its original immutable generation/time; never extend an expiry.
create or replace function private.dashboard_withdraw_country_last_complete(q jsonb,r jsonb,s jsonb,c jsonb,dep text,refresh text)
returns jsonb language plpgsql set search_path='' as $function$
declare a private.withdraw_prepared_artifacts%rowtype;v jsonb;at timestamptz:=clock_timestamp();
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='withdraw_prepared_worker_denied';end if;
 with same_request as materialized(
  select j.id,j.catalog,j.revision,j.request_key,j.fingerprint from private.withdraw_prepared_jobs j
  where j.request=r and j.scope=s and j.dependency=dep),
 candidates as materialized(
  select j.id,j.catalog,j.revision from same_request j
  where j.request_key->>0='withdraw-independent-windows-v2'and j.catalog<>c
   and j.request_key=jsonb_build_array('withdraw-independent-windows-v2',s,j.catalog,r)
   and j.fingerprint=md5(j.request_key::text)
   and private.dashboard_withdraw_country_catalog(r,j.catalog)=c)
 select x.*into a from candidates j
 join private.withdraw_prepared_heads h on h.job_id=j.id
 join private.withdraw_prepared_artifacts x on x.id=h.artifact_id and x.job_id=j.id
 where x.dependency=dep and x.revision=j.revision and x.computed_at<=at
  and isfinite(x.computed_at)and isfinite(x.expires_at)and x.expires_at>x.computed_at
  and x.payload->>'contract'='withdraw-independent-windows-v2'
  and x.payload->'request'=r and x.payload->'scope'=s and x.payload->'catalog'=j.catalog
  and jsonb_typeof(x.payload->'secondary')='object'and jsonb_typeof(x.payload->'game66')='object'
  and not exists(select 1 from unnest(array['wg','yash','newar','ar','duoli','arHistory'])part
   where jsonb_typeof(x.payload->part)is distinct from'array')
 order by x.computed_at desc,x.id limit 1;
 if not found then return null;end if;
 v:=private.withdraw_window_result(r,private.withdraw_prepared_render(private.withdraw_window_legacy(q),a.payload),a.payload)
  ||jsonb_build_object('prepared',jsonb_build_object('status','ready','contract','withdraw-independent-windows-v2',
   'publicationVersion',2,'generation',a.id,'computedAt',a.computed_at,'expiresAt',a.expires_at,
   'calculationComplete',true,'freshness',case when a.expires_at>at then'fresh'else'refresh_due'end,
   'refreshState',case when refresh in('queued','running','failed')then refresh else'idle'end));
 return private.auto_team_previous_projection(q,a.payload,v,r);
end;$function$;
revoke all on function private.dashboard_withdraw_country_last_complete(jsonb,jsonb,jsonb,jsonb,text,text)from public,anon,authenticated,service_role;

-- NPG's report-only identities are deliberately absent from the order catalog.
-- Admit only the three mappings proven by the pinned, deployed report reader;
-- its original receipt/coverage checks remain on every actual report read.
create or replace function private.dashboard_withdraw_npg_template_zone(q jsonb,s jsonb,c jsonb)
returns text language plpgsql stable set search_path='' as $function$
declare platform text;zone text;target jsonb;
begin
 if s is distinct from'{"mode":"all","countries":[]}'::jsonb or c is distinct from'[]'::jsonb
  or not private.withdraw_prepared_source_contract_current()
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.npg_withdraw_report_snapshots(date,date,jsonb,jsonb,jsonb)')
   and md5(p.prosrc)='4bff210f543ca27aabe118d34903070d'and pg_get_userbyid(p.proowner)='postgres'
   and p.proacl::text='{postgres=X/postgres}'and p.proconfig=array['search_path=""']
   and not p.prosecdef and p.provolatile='s'and p.proretset
   and not p.proisstrict and not p.proleakproof and p.proparallel='u'and p.procost=100 and p.prorows=1000
   and p.prorettype='public.newar_business_snapshots'::regtype
   and(select lanname from pg_language where oid=p.prolang)='sql')then return null;end if;
 select m.platform,m.zone into platform,zone from(values
  ('哥伦比亚','NPG-COLOMBIA','America/Bogota'),
  ('墨西哥','NPG-MEXICO','America/Mexico_City'),
  ('智利','NPG-CHILE','America/Santiago'))m(country,platform,zone)where m.country=q->>'country';
 if not found or not private.dashboard_scope_allows(s,q->>'country',platform)then return null;end if;
 if q?'scopeTargets'then
  if jsonb_array_length(q->'scopeTargets')<>1 then return null;end if;
  target:=q->'scopeTargets'->0;
  if target->>'country'is distinct from q->>'country'or target->'platforms'is distinct from jsonb_build_array(platform)then return null;end if;
 end if;
 if nullif(q->>'platform','')is not null and q->>'platform'<>platform then return null;end if;
 if q?'platforms'and q->'platforms'not in('[]'::jsonb,jsonb_build_array(platform))then return null;end if;
 return zone;
end;$function$;
revoke all on function private.dashboard_withdraw_npg_template_zone(jsonb,jsonb,jsonb)from public,anon,authenticated,service_role;

do $install$
declare d text;patched text;
begin
 if exists(select 1 from pg_proc p where p.oid in(
  'private.withdraw_prepared_read(jsonb)'::regprocedure,
  'private.withdraw_prepared_prewarm()'::regprocedure,
  'private.withdraw_prepared_admit_default_template(uuid,jsonb,jsonb,jsonb)'::regprocedure)
  and(pg_get_userbyid(p.proowner)<>'postgres'or p.proacl::text is distinct from'{postgres=X/postgres}'
   or p.proconfig is distinct from array['search_path=""']or p.prosecdef is distinct from(p.proname='withdraw_prepared_read')
   or p.provolatile<>'v'or p.proparallel<>'u'or p.proisstrict or p.proleakproof or p.proretset
   or p.procost<>100 or p.prorows<>0 or(select lanname from pg_language where oid=p.prolang)<>'plpgsql'))
 then raise exception'withdraw_country_security_drift';end if;
 if not exists(select 1 from pg_proc p where p.oid='private.withdraw_prepared_read(jsonb)'::regprocedure and md5(prosrc)='48d8fab1f0162728454c98241e9bfa53')
  or not exists(select 1 from pg_proc p where p.oid='private.withdraw_prepared_prewarm()'::regprocedure and md5(prosrc)='19db9b3a87af44cc674a6f7cc0a31eb4')
  or not exists(select 1 from pg_proc p where p.oid='private.withdraw_prepared_admit_default_template(uuid,jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='9ff2a584135e9cf7fc0dbc6a545d12c1')then raise exception'withdraw_country_entry_drift';end if;
 select pg_get_functiondef('private.withdraw_prepared_read(jsonb)'::regprocedure)into d;
 patched:=replace(d,'r:=private.withdraw_prepared_canonical(q);k:=',
  'r:=private.withdraw_prepared_canonical(q);c:=private.dashboard_withdraw_country_catalog(r,c);k:=');
 if patched=d then raise exception'withdraw_country_read_anchor';end if;d:=patched;
 patched:=replace(d,'progress jsonb;', 'progress jsonb;last_complete jsonb;');
 if patched=d then raise exception'withdraw_country_declare_anchor';end if;d:=patched;
 patched:=replace(d,E' RETURN jsonb_build_object(''prepared'',jsonb_build_object(''status'',v_status,',
  E' last_complete:=private.dashboard_withdraw_country_last_complete(q,r,s,c,dep,j.status);\n IF last_complete IS NOT NULL THEN RETURN last_complete;END IF;\n RETURN jsonb_build_object(''prepared'',jsonb_build_object(''status'',v_status,');
 if patched=d then raise exception'withdraw_country_fallback_anchor';end if;execute patched;

 select pg_get_functiondef('private.withdraw_prepared_prewarm()'::regprocedure)into d;
 patched:=replace(d,'DECLARE t private.withdraw_prepared_templates%rowtype;', 'DECLARE t record;');
 if patched=d then raise exception'withdraw_country_prewarm_declare';end if;d:=patched;
 patched:=replace(d,'FOR t IN SELECT *FROM private.withdraw_prepared_templates WHERE enabled ORDER BY id LIMIT 100 LOOP',
  E'FOR t IN SELECT DISTINCT ON(request,scope,catalog,timezone)request,scope,catalog,timezone FROM(\n   SELECT request,scope,private.dashboard_withdraw_country_catalog(request,catalog)catalog,timezone\n   FROM private.withdraw_prepared_templates WHERE enabled)x\n   ORDER BY request,scope,catalog,timezone LIMIT 100 LOOP');
 if patched=d then raise exception'withdraw_country_prewarm_anchor';end if;execute patched;

 select pg_get_functiondef('private.withdraw_prepared_admit_default_template(uuid,jsonb,jsonb,jsonb)'::regprocedure)into d;
 patched:=replace(d,' -- Explicit target countries survive team combinations.',
  E' -- Known report-only NPG defaults have no order-native catalog entries.\n tz:=private.dashboard_withdraw_npg_template_zone(j.request,j.scope,j.catalog);\n if tz is not null then\n  d:=left(j.request->>''startAt'',10)::date;\n  if d in((clock_timestamp()at time zone tz)::date,(clock_timestamp()at time zone tz)::date-1)then\n   begin\n    perform set_config(''lock_timeout'',''100ms'',true);\n    tid:=private.withdraw_prepared_register_template(j.id,tz);\n   exception when lock_not_available then tid:=null;\n   when raise_exception then\n    if sqlerrm not in(''withdraw_prepared_template_capacity'',''withdraw_prepared_template_invalid'',''withdraw_prepared_timezone_invalid'')then raise;end if;\n    tid:=null;\n   end;\n   perform set_config(''lock_timeout'',old_lock,true);return tid;\n  end if;\n  return null;\n end if;\n -- Explicit target countries survive team combinations.');
 if patched=d then raise exception'withdraw_country_npg_anchor';end if;execute patched;
end;$install$;

do $verify$
begin
 if(select value from pg_temp.withdraw_country_install_guard where name='dependency')is distinct from to_jsonb(private.withdraw_prepared_dependency())then raise exception'withdraw_country_dependency_changed';end if;
 if exists(select 1 from pg_temp.withdraw_country_install_guard g join pg_proc p on p.proname=g.name and p.pronamespace='private'::regnamespace
  where g.name<>'dependency'and g.value is distinct from to_jsonb(p)-'prosrc')then raise exception'withdraw_country_security_metadata_changed';end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role'])r cross join unnest(array[
 'private.dashboard_withdraw_country_catalog(jsonb,jsonb)',
 'private.dashboard_withdraw_country_last_complete(jsonb,jsonb,jsonb,jsonb,text,text)',
 'private.dashboard_withdraw_npg_template_zone(jsonb,jsonb,jsonb)'])f where has_function_privilege(r,f,'EXECUTE'))then raise exception'withdraw_country_external_grant';end if;
end;$verify$;
drop table pg_temp.withdraw_country_install_guard;
