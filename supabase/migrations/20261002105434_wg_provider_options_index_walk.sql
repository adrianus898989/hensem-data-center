-- Read-only provider directory optimization. No source data, identity or grant changes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $native_dependencies$
declare relation regclass; name text; expected record;
begin
 foreach name in array array['wg_recharge_details','wg_withdraw_details'] loop
  relation:=to_regclass('public.'||name);
  if relation is null or not exists(select 1 from pg_class c where c.oid=relation and c.relkind='r'
    and c.relowner='postgres'::regrole and c.relrowsecurity)
   then raise exception 'wg_provider_options_relation_contract: %',name;end if;
  for expected in select * from (values ('site_code','text'::regtype),('provider','text'::regtype)) c(column_name,type_oid) loop
   if not exists(select 1 from pg_attribute a where a.attrelid=relation and a.attname=expected.column_name
      and a.atttypid=expected.type_oid and a.attnum>0 and not a.attisdropped
      and exists(select 1 from pg_collation c where c.oid=a.attcollation and c.collisdeterministic))
    then raise exception 'wg_provider_options_column_contract: %.%',name,expected.column_name;end if;
  end loop;
  if not exists(select 1 from pg_index i join pg_class ix on ix.oid=i.indexrelid join pg_am am on am.oid=ix.relam
    where i.indrelid=relation and am.amname='btree' and i.indisvalid and i.indisready
      and i.indnkeyatts=2 and i.indexprs is null and i.indpred is null
      and not exists(select 1 from unnest(i.indkey,i.indcollation) with ordinality k(attnum,collation_oid,ordinality)
        join pg_attribute a on a.attrelid=relation and a.attnum=k.attnum
        where k.ordinality<=2 and k.collation_oid is distinct from a.attcollation)
      and (select array_agg(a.attname::text order by k.ordinality) from unnest(i.indkey) with ordinality k(attnum,ordinality)
       join pg_attribute a on a.attrelid=relation and a.attnum=k.attnum)=array['site_code','provider'])
    then raise exception 'wg_provider_options_index_contract: %',name;end if;
 end loop;
end;
$native_dependencies$;
do $helper_guard$
begin
 if to_regprocedure('private.dashboard_admin_wg_provider_names(text,text,text)') is not null
  then raise exception 'wg_provider_names_already_exists';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.dashboard_admin_wg_sites()')
  and md5(p.prosrc)='839401f31117192068b395d1c9580230' and p.proowner='postgres'::regrole
  and p.proacl::text='{postgres=X/postgres}' and not p.prosecdef and p.provolatile='i'
  and p.proconfig=array['search_path=""']) then raise exception 'wg_provider_names_site_contract';end if;
end;
$helper_guard$;
-- The trusted site registry is the existing native source identity. Preserve its
-- site-only row predicate: historical country/platform fields may be blank.
-- Callers retain authorization; this helper has no client-role EXECUTE grant.
create function private.dashboard_admin_wg_provider_names(p_country_code text,p_platform text,p_direction text)
 returns table(provider text)
 language sql stable security invoker set search_path='' as $names$
 select distinct coalesce(nullif(btrim(n.provider),''),'未识别通道') provider
 from private.dashboard_admin_wg_sites() s cross join lateral (
 select provider from (
 with recursive distinct_names(provider) as (
  (select r.provider from public.wg_recharge_details r
   where p_direction in ('all','charge') and r.site_code=s.site_code and r.provider is not null
   order by r.provider limit 1)
  union all
  select next_name.provider from distinct_names prev cross join lateral (
   select r.provider from public.wg_recharge_details r
   where r.site_code=s.site_code and r.provider>prev.provider order by r.provider limit 1
  ) next_name
 ) select provider from distinct_names
 union all select null::text where p_direction in ('all','charge') and exists(
  select 1 from public.wg_recharge_details r where r.site_code=s.site_code and r.provider is null)
) native_names
 union all
 select provider from (
 with recursive distinct_names(provider) as (
  (select r.provider from public.wg_withdraw_details r
   where p_direction in ('all','withdraw') and r.site_code=s.site_code and r.provider is not null
   order by r.provider limit 1)
  union all
  select next_name.provider from distinct_names prev cross join lateral (
   select r.provider from public.wg_withdraw_details r
   where r.site_code=s.site_code and r.provider>prev.provider order by r.provider limit 1
  ) next_name
 ) select provider from distinct_names
 union all select null::text where p_direction in ('all','withdraw') and exists(
  select 1 from public.wg_withdraw_details r where r.site_code=s.site_code and r.provider is null)
) native_names
 ) n
 where s.country_code=p_country_code and s.platform=p_platform;
$names$;
revoke all on function private.dashboard_admin_wg_provider_names(text,text,text) from public,anon,authenticated,service_role;
do $patch$
declare target regprocedure:='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure;
 p pg_proc%rowtype; metadata jsonb; definition text;
 old_fragment text:=$old$      select distinct coalesce(nullif(btrim(provider),''),'未识别通道') provider from public.wg_recharge_details where site_code=s.site_code and coalesce(p_request->>'direction','all') in('all','charge')
      union select distinct coalesce(nullif(btrim(provider),''),'未识别通道') from public.wg_withdraw_details where site_code=s.site_code and coalesce(p_request->>'direction','all') in('all','withdraw')$old$;
 new_fragment text:=$new$      select provider from private.dashboard_admin_wg_provider_names(
        s.country_code,s.platform,coalesce(p_request->>'direction','all'))$new$;
begin
 select * into p from pg_proc where oid=target;
 if md5(p.prosrc) is distinct from 'a3f285b547cdf076e6e6fc4b32187426'
  then raise exception 'wg_provider_options_baseline_drift';end if;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
  then raise exception 'wg_provider_options_metadata_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';
 definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  then raise exception 'wg_provider_options_patch_anchor_drift';end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata
  then raise exception 'wg_provider_options_metadata_changed';end if;
end;
$patch$;
commit;
