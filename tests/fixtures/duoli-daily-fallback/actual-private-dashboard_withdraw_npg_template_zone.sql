CREATE OR REPLACE FUNCTION private.dashboard_withdraw_npg_template_zone(q jsonb, s jsonb, c jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
end;$function$
