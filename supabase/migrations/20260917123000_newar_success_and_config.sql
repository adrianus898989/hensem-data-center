begin;

alter table public.collection_success_daily
  drop constraint if exists collection_success_daily_source_system_check;
alter table public.collection_success_daily
  add constraint collection_success_daily_source_system_check
  check (source_system in ('RECHARGE_REVIEW','WITHDRAW_REVIEW'));

alter table public.collection_success_credentials
  add column if not exists allowed_source_systems text[];
update public.collection_success_credentials
set allowed_source_systems = array[source_system]
where allowed_source_systems is null;
alter table public.collection_success_credentials
  alter column allowed_source_systems set not null;
alter table public.collection_success_credentials
  drop constraint if exists collection_success_credentials_allowed_sources_check;
alter table public.collection_success_credentials
  add constraint collection_success_credentials_allowed_sources_check
  check (
    cardinality(allowed_source_systems) between 1 and 4
    and allowed_source_systems <@ array['RECHARGE_REVIEW','WITHDRAW_REVIEW']::text[]
  );

do $migration$
declare
  definition text;
begin
  select pg_catalog.pg_get_functiondef(p.oid) into definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='collection_success_assert_snapshot'
  limit 1;
  definition := pg_catalog.replace(
    definition,
    'p_snapshot->>''source_system'' <> ''RECHARGE_REVIEW''',
    'p_snapshot->>''source_system'' not in (''RECHARGE_REVIEW'',''WITHDRAW_REVIEW'')'
  );
  execute definition;

  select pg_catalog.pg_get_functiondef(p.oid) into definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='publish_collection_success_snapshot'
  limit 1;
  definition := pg_catalog.replace(
    definition,
    'v_credential.source_system <> p_snapshot->>''source_system''',
    'not ((p_snapshot->>''source_system'') = any(v_credential.allowed_source_systems))'
  );
  execute definition;
end
$migration$;

alter table public.ar_config_targets
  add column if not exists source_system text not null default 'AR';
alter table public.ar_config_targets
  drop constraint if exists ar_config_targets_source_system_check;
alter table public.ar_config_targets
  add constraint ar_config_targets_source_system_check
  check (source_system in ('AR','NEW_AR'));

insert into public.ar_config_targets(country_code,platform,country_name,timezone,currency,source_system)
values
  ('IN','DhaniWin','印度','Asia/Kolkata','INR','NEW_AR'),
  ('PK','POPZAR','巴基斯坦','Asia/Karachi','PKR','NEW_AR')
on conflict(country_code,platform) do update set
  country_name=excluded.country_name,
  timezone=excluded.timezone,
  currency=excluded.currency,
  source_system=excluded.source_system;

commit;
