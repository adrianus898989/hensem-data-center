-- Bound provider resolution to authorized registry sites and equivalent current AR channel names.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
do $patch$
declare
  target constant regprocedure := 'private.dashboard_admin_live_provider_options(jsonb)'::regprocedure;
  previous pg_catalog.pg_proc%rowtype;
  installed pg_catalog.pg_proc%rowtype;
  definition text;
begin
  select * into strict previous from pg_catalog.pg_proc where oid=target;
  if previous.proowner::regrole::text <> 'postgres'
    or previous.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
    or previous.proconfig is distinct from array['search_path=""']
    or not previous.prosecdef or previous.provolatile <> 's' or previous.proparallel <> 'u'
  then raise exception 'provider_options_metadata_drift'; end if;
  if md5(previous.prosrc) = 'a0615762453645d15e11fc5b8e8308cb' then return; end if;
  if md5(previous.prosrc) <> '95b0912432e86ecec10e8422dcfc1fe5' then raise exception 'provider_options_body_drift'; end if;
  definition := pg_catalog.pg_get_functiondef(target);
  definition := replace(definition, $before$    select private.dashboard_admin_live_provider_canonical(country, source_name, raw_provider)
    from ar_channel_representatives$before$, $after$    select private.dashboard_admin_live_provider_canonical(country,source_name,raw_provider)
    from ar_channel_names$after$);
  definition := replace(definition, $before$  ), ar_channel_representatives as materialized (
    -- Keep the scalar canonical resolver authoritative. For the current India
    -- resolver, rows with the same raw name and the same platform-specific
    -- inputs always produce the same output. Resolve one real representative.
    select a.country, min(a.source_name) as source_name, a.raw_provider
    from ar_channel_names a
    left join private.dashboard_admin_provider_registry r
      on r.country=a.country and r.platform=a.source_name
      and r.raw_provider=case when a.raw_provider='未识别通道' then '' else a.raw_provider end
    left join private.dashboard_admin_provider_overrides o on o.country=r.country and o.platform=r.platform and o.raw_provider=r.raw_provider
    group by a.country, a.raw_provider, r.country is not null, r.canonical_values,
      o.canonical_provider, private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider),
      case when a.country <> '印度' or a.source_name in ('YASH.BET','YASHBET')
        or exists (select 1 from private.dashboard_admin_wg_provider_aliases() w
          where a.country in (w.country,w.country_code) and w.platform=a.source_name and w.raw_provider=a.raw_provider)
        or (select md5(prosrc) from pg_catalog.pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure)
           <> '008e5cee3a4f6ac9e90706c45bee56da'
        then a.source_name end
  ), lg_names as materialized ($before$, $after$  ), lg_names as materialized ($after$);
  definition := replace(definition, $before$  registry_sites as materialized (
    select distinct p.country, k.platform
    from platforms p cross join lateral (values (p.name), (p.source_name)) k(platform)
    where p.source not in ('lg','wg','duoli','kb','panda')
  ), authorized_registry_sites as materialized (
    select country, platform from registry_sites
    where private.dashboard_scope_allows(v_scope, country, platform)
  ), scoped as materialized (
    select r.country,r.platform,r.raw_provider,r.canonical_values
    from private.dashboard_admin_provider_registry r
    join authorized_registry_sites s using (country,platform)
    where$before$, $after$  scoped as materialized (
    select distinct r.country,r.platform,r.raw_provider,r.canonical_values
    from private.dashboard_admin_provider_registry r join platforms p on r.country=p.country and (r.platform=p.name or r.platform=p.source_name)
    where p.source not in('lg','wg','duoli','kb','panda') and private.dashboard_scope_allows(v_scope,r.country,r.platform)
      and$after$);
  execute definition;
  select * into strict installed from pg_catalog.pg_proc where oid=target;
  if md5(installed.prosrc) <> 'a0615762453645d15e11fc5b8e8308cb'
    or (to_jsonb(previous)-'prosrc') is distinct from (to_jsonb(installed)-'prosrc')
  then raise exception 'provider_options_installation_drift'; end if;
end
$patch$;
commit;
