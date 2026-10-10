-- Report-only withdrawal platforms already have a scoped withdrawal directory,
-- but the reason reader previously searched the native order directory only.
-- Use that existing exact country/platform identity after current scope checks.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $patch$
declare
 p record;catalog_proc record;before_meta jsonb;definition text;
 old_text text:=$old$ v_code:=coalesce(v_meta.scope_group,(select country_code from public.dashboard_platform_team_map m where m.country_name=v_country and m.active limit 1));$old$;
 new_text text:=$new$ -- Report-only metadata is resolved by the existing freshly scoped directory.
 -- Keep native AR precedence and the source-country identity used by snapshots.
 if not found then
  select * into v_meta from private.dashboard_admin_live_withdraw_platforms() p where p.country=v_country
   and (private.dashboard_admin_live_withdraw_key(p.name)=private.dashboard_admin_live_withdraw_key(v_platform)
    or private.dashboard_admin_live_withdraw_key(p.source_name)=private.dashboard_admin_live_withdraw_key(v_platform))
   and (v_country<>'胖虎巴西' or p.scope_group='BR_PANGHU')
   order by p.source,p.id limit 1;
 end if;
 v_code:=coalesce(v_meta.scope_group,(select country_code from public.dashboard_platform_team_map m where m.country_name=v_country and m.active limit 1));$new$;
begin
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q
  where q.oid=to_regprocedure('private.dashboard_admin_live_withdraw_reasons(jsonb)');
 if not found or p.owner_name<>'postgres' or p.prosecdef is not true or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then
  raise exception 'withdraw_reasons_report_catalog_metadata_drift';
 end if;
 if md5(p.prosrc) not in ('2148081a9d792a23e994763d75ac3a41','47d5a425eebe03f4150f6b9657f0dac6') then
  raise exception 'withdraw_reasons_report_catalog_body_drift';
 end if;
 select q.*,pg_get_userbyid(q.proowner) owner_name into catalog_proc from pg_proc q
  where q.oid=to_regprocedure('private.dashboard_admin_live_withdraw_platforms()');
 if not found or md5(catalog_proc.prosrc)<>'ca2897d0e2e76182e61256bdfaccf089'
  or catalog_proc.owner_name<>'postgres' or catalog_proc.prosecdef is not true or catalog_proc.provolatile<>'s'
  or catalog_proc.proconfig is distinct from array['search_path=""']::text[]
  or catalog_proc.proacl::text is distinct from '{postgres=X/postgres}' then
  raise exception 'withdraw_reasons_report_catalog_directory_drift';
 end if;
 if md5(p.prosrc)='47d5a425eebe03f4150f6b9657f0dac6' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc'-'owner_name';
 definition:=pg_get_functiondef(p.oid);
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'withdraw_reasons_report_catalog_anchor_drift';
 end if;
 execute replace(definition,old_text,new_text);
 if (select md5(q.prosrc)<>'47d5a425eebe03f4150f6b9657f0dac6' or to_jsonb(q)-'prosrc' is distinct from before_meta
  from pg_proc q where q.oid=p.oid) then
  raise exception 'withdraw_reasons_report_catalog_result_drift';
 end if;
end;
$patch$;
commit;
