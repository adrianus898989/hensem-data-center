-- Independent WG configuration snapshots. No upstream write capability and no
-- changes to withdrawal reports, Panda/AR tables, or existing functions.
create table public.wg_config_targets (
  country_code text not null check(country_code ~ '^[A-Z]{2}$'),
  platform text not null check(length(platform) between 1 and 80),
  country_name text not null, timezone text not null,
  site_code text not null check(site_code ~ '^[1-9][0-9]{0,15}$'),
  members jsonb not null check(jsonb_typeof(members)='array'),
  primary key(country_code,platform), unique(country_code,site_code)
);
create table public.wg_config_credentials (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  allowed_targets text[] not null check(cardinality(allowed_targets)>0),
  active boolean not null default true, expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.wg_config_daily (
  country_code text not null, platform text not null, site_code text not null,
  observed_local_date date not null, observed_at timestamptz not null,
  snapshot_id uuid not null unique, timezone text not null,
  parser_version text not null check(parser_version='wg-config-v1'),
  configuration jsonb not null check(jsonb_typeof(configuration)='object'),
  configuration_hash text not null check(configuration_hash ~ '^[a-f0-9]{64}$'),
  snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now(),
  primary key(country_code,platform,observed_local_date),
  foreign key(country_code,platform) references public.wg_config_targets(country_code,platform),
  check(observed_local_date=(observed_at at time zone timezone)::date),
  check(octet_length(configuration::text)<=2097152)
);
create index wg_config_latest_idx on public.wg_config_daily(country_code,platform,observed_at desc);
create table public.wg_config_receipts (
  snapshot_id uuid primary key, country_code text not null, platform text not null,
  observed_at timestamptz not null, observed_local_date date not null,
  snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now()
);
alter table public.wg_config_targets enable row level security;
alter table public.wg_config_credentials enable row level security;
alter table public.wg_config_daily enable row level security;
alter table public.wg_config_receipts enable row level security;
revoke all on public.wg_config_targets,public.wg_config_credentials,public.wg_config_daily,public.wg_config_receipts from public,anon,authenticated,service_role;
grant select on public.wg_config_targets,public.wg_config_daily to authenticated;
grant select on public.wg_config_targets,public.wg_config_credentials,public.wg_config_daily,public.wg_config_receipts to service_role;
grant insert on public.wg_config_daily,public.wg_config_receipts to service_role;
create policy wg_config_targets_read on public.wg_config_targets for select to authenticated
  using ((select public.dashboard_has_permission('auto_withdraw')));
create policy wg_config_daily_read on public.wg_config_daily for select to authenticated
  using ((select public.dashboard_has_permission('auto_withdraw')));
create view public.wg_config_latest with(security_invoker=true) as
  select distinct on(country_code,platform) * from public.wg_config_daily
  order by country_code,platform,observed_at desc;
revoke all on public.wg_config_latest from public,anon,authenticated,service_role;
grant select on public.wg_config_latest to authenticated,service_role;

create function public.ingest_wg_config(p_snapshot jsonb,p_configuration_hash text,p_snapshot_hash text,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  c text:=p_snapshot->>'country_code'; p text:=p_snapshot->>'platform';
  sid uuid; observed timestamptz; day date;
  target public.wg_config_targets; receipt public.wg_config_receipts;
  previous_id uuid; expected_sites text[]; supplied_sites text[];
begin
  if jsonb_typeof(p_snapshot) is distinct from 'object'
    or p_snapshot->>'schema_version' is distinct from '1'
    or p_snapshot->>'source_system' is distinct from 'WG'
    or p_snapshot->>'parser_version' is distinct from 'wg-config-v1'
    or p_configuration_hash is null or p_configuration_hash !~ '^[a-f0-9]{64}$'
    or p_snapshot_hash is null or p_snapshot_hash !~ '^[a-f0-9]{64}$'
    or octet_length(p_snapshot::text)>2097152
    or jsonb_typeof(p_snapshot->'configuration') is distinct from 'object'
    or jsonb_typeof(p_snapshot->'configuration'->'settings') is distinct from 'object' then
    raise exception 'wg_config_contract_mismatch';
  end if;
  sid:=(p_snapshot->>'snapshot_id')::uuid;
  observed:=(p_snapshot->>'observed_at')::timestamptz;
  day:=(p_snapshot->>'observed_local_date')::date;
  if sid is null or observed is null or day is null or observed>now()+interval '5 minutes'
    or observed<'2020-01-01'::timestamptz then raise exception 'wg_config_date_mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(sid::text,5));
  perform pg_advisory_xact_lock(hashtextextended('WG_CONFIG:'||c||':'||p||':'||day::text,5));
  if not exists(select 1 from public.wg_config_credentials k
    where k.token_hash=p_token_hash and k.active and k.expires_at>now()
      and c||':'||p=any(k.allowed_targets)) then raise exception 'wg_config_unauthorized'; end if;
  select * into target from public.wg_config_targets t where t.country_code=c and t.platform=p;
  if not found or target.site_code is distinct from p_snapshot->>'site_code'
    or target.timezone is distinct from p_snapshot->>'timezone' then raise exception 'wg_config_target_mismatch'; end if;
  if day is distinct from (observed at time zone target.timezone)::date then raise exception 'wg_config_date_mismatch'; end if;
  select array_agg(code order by code) into expected_sites from (
    select '0' as code union select item->>'site_code' from jsonb_array_elements(target.members) item
  ) expected;
  select array_agg(code order by code) into supplied_sites
    from jsonb_object_keys(p_snapshot->'configuration'->'settings') code;
  if expected_sites is distinct from supplied_sites then raise exception 'wg_config_members_mismatch'; end if;
  select snapshot_id into previous_id from public.wg_config_daily d
    where d.country_code=c and d.platform=p and d.observed_local_date=day;
  select * into receipt from public.wg_config_receipts r where r.snapshot_id=sid;
  if found then
    if receipt.snapshot_hash is distinct from p_snapshot_hash or receipt.country_code is distinct from c
      or receipt.platform is distinct from p or receipt.observed_at is distinct from observed
      or receipt.observed_local_date is distinct from day then raise exception 'wg_config_snapshot_id_conflict'; end if;
    return jsonb_build_object('status',case when previous_id is not null and previous_id<>sid then 'daily_exists' else 'unchanged' end,
      'snapshot_id',sid,'current_snapshot_id',coalesce(previous_id,sid));
  end if;
  insert into public.wg_config_receipts(snapshot_id,country_code,platform,observed_at,observed_local_date,snapshot_hash)
    values(sid,c,p,observed,day,p_snapshot_hash);
  if previous_id is not null then
    return jsonb_build_object('status','daily_exists','snapshot_id',sid,'current_snapshot_id',previous_id);
  end if;
  insert into public.wg_config_daily(country_code,platform,site_code,observed_local_date,observed_at,snapshot_id,
    timezone,parser_version,configuration,configuration_hash,snapshot_hash)
  values(c,p,target.site_code,day,observed,sid,target.timezone,p_snapshot->>'parser_version',
    p_snapshot->'configuration',p_configuration_hash,p_snapshot_hash);
  return jsonb_build_object('status','accepted','snapshot_id',sid,'current_snapshot_id',sid);
end;
$$;
revoke all on function public.ingest_wg_config(jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.ingest_wg_config(jsonb,text,text,text) to service_role;

insert into public.wg_config_targets(country_code,country_name,platform,site_code,timezone,members) values
  ('BR','巴西','26BET','278','America/Sao_Paulo',
   '[{"site_code":"278","name":"26bet"},{"site_code":"8311","name":"POPKKK"},{"site_code":"12588","name":"POPMIU"}]'),
  ('VN','越南','98VV','3257','Asia/Ho_Chi_Minh',
   '[{"site_code":"3257","name":"98VV"},{"site_code":"3605","name":"XX98"}]');

notify pgrst, 'reload schema';
