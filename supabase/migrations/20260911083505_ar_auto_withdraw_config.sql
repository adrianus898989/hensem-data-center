-- Configuration snapshots only. No permissions to change upstream AR settings.
create table public.ar_config_targets (
  country_code text not null,
  platform text not null,
  country_name text not null,
  timezone text not null,
  currency text,
  primary key(country_code, platform)
);
create table public.ar_config_credentials (
  token_hash text primary key check (length(token_hash) = 64),
  allowed_targets text[] not null,
  active boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.ar_config_daily (
  country_code text not null,
  platform text not null,
  observed_local_date date not null,
  observed_at timestamptz not null,
  snapshot_id uuid not null unique,
  timezone text not null,
  parser_version text not null,
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  configuration_hash text not null check(length(configuration_hash) = 64),
  received_at timestamptz not null default now(),
  primary key(country_code, platform, observed_local_date),
  foreign key(country_code, platform) references public.ar_config_targets(country_code, platform),
  check(observed_local_date = (observed_at at time zone timezone)::date)
);
create index ar_config_latest_idx on public.ar_config_daily(country_code, platform, observed_at desc);
-- Durable, immutable receipts also protect IDs after a newer capture replaces a day row.
create table public.ar_config_receipts (
  snapshot_id uuid primary key,
  country_code text not null,
  platform text not null,
  observed_at timestamptz not null,
  observed_local_date date not null,
  configuration_hash text not null,
  received_at timestamptz not null default now()
);
alter table public.ar_config_receipts enable row level security;
revoke all on public.ar_config_receipts from public, anon, authenticated, service_role;
grant select, insert on public.ar_config_receipts to service_role;
alter table public.ar_config_targets enable row level security;
alter table public.ar_config_credentials enable row level security;
alter table public.ar_config_daily enable row level security;
revoke all on public.ar_config_targets, public.ar_config_credentials, public.ar_config_daily from public, anon, authenticated;
grant select on public.ar_config_targets, public.ar_config_daily to authenticated;
grant all on public.ar_config_targets, public.ar_config_credentials, public.ar_config_daily to service_role;
create policy ar_config_targets_read on public.ar_config_targets for select to authenticated
 using ((select public.dashboard_has_permission('auto_withdraw')));
create policy ar_config_daily_read on public.ar_config_daily for select to authenticated
 using ((select public.dashboard_has_permission('auto_withdraw')));
create view public.ar_config_latest with (security_invoker = true) as
 select distinct on (country_code, platform) * from public.ar_config_daily
 order by country_code, platform, observed_at desc;
revoke all on public.ar_config_latest from public, anon, authenticated;
grant select on public.ar_config_latest to authenticated, service_role;

-- Invoker runs as the Edge service role; never callable by dashboard users.
create function public.ingest_ar_config(p_snapshot jsonb, p_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 c text := p_snapshot->>'country_code';
 p text := p_snapshot->>'platform';
 d date := (p_snapshot->>'observed_local_date')::date;
 sid uuid := (p_snapshot->>'snapshot_id')::uuid;
 observed timestamptz := (p_snapshot->>'observed_at')::timestamptz;
 prev public.ar_config_daily;
 receipt public.ar_config_receipts;
 result_status text;
begin
 perform pg_advisory_xact_lock(hashtextextended(sid::text, 1));
 perform pg_advisory_xact_lock(hashtextextended(c || ':' || p || ':' || d::text, 0));
 if not exists (select 1 from public.ar_config_targets t where t.country_code=c and t.platform=p and t.timezone=p_snapshot->>'timezone') then
   raise exception 'config_target_mismatch';
 end if;
 select * into prev from public.ar_config_daily x
 where x.country_code=c and x.platform=p and x.observed_local_date=d;
 select * into receipt from public.ar_config_receipts r where r.snapshot_id=sid;
 if found then
   if receipt.country_code<>c or receipt.platform<>p or receipt.observed_at<>observed
     or receipt.observed_local_date<>d or receipt.configuration_hash<>p_hash then
     raise exception 'config_snapshot_id_conflict';
   end if;
   return jsonb_build_object('status','unchanged','snapshot_id',sid,'current_snapshot_id',coalesce(prev.snapshot_id,sid));
 end if;
 insert into public.ar_config_receipts(snapshot_id,country_code,platform,observed_at,observed_local_date,configuration_hash)
 values(sid,c,p,observed,d,p_hash);
 if prev.snapshot_id is not null and observed < prev.observed_at then
   return jsonb_build_object('status','stale','snapshot_id',sid,'current_snapshot_id',prev.snapshot_id);
 end if;
 if prev.snapshot_id is not null and observed = prev.observed_at then
   if p_hash <> prev.configuration_hash then raise exception 'config_capture_conflict'; end if;
   return jsonb_build_object('status','unchanged','snapshot_id',sid,'current_snapshot_id',prev.snapshot_id);
 end if;
 result_status := case when prev.configuration_hash=p_hash then 'unchanged' else 'accepted' end;
 insert into public.ar_config_daily(country_code,platform,observed_local_date,observed_at,snapshot_id,timezone,parser_version,configuration,configuration_hash)
 values(c,p,d,observed,sid,p_snapshot->>'timezone',p_snapshot->>'parser_version',p_snapshot->'configuration',p_hash)
 on conflict(country_code,platform,observed_local_date) do update set
 observed_at=excluded.observed_at, snapshot_id=excluded.snapshot_id,
 timezone=excluded.timezone, parser_version=excluded.parser_version,
 configuration=excluded.configuration, configuration_hash=excluded.configuration_hash, received_at=now();
 return jsonb_build_object('status',result_status,'snapshot_id',sid,'current_snapshot_id',sid);
end;
$$;
revoke all on function public.ingest_ar_config(jsonb,text) from public, anon, authenticated;
grant execute on function public.ingest_ar_config(jsonb,text) to service_role;
insert into public.ar_config_targets(country_code,country_name,platform,timezone,currency) values
('PK','巴基斯坦','92PKR','Asia/Karachi',null),
('PK','巴基斯坦','92R','Asia/Karachi',null),
('PK','巴基斯坦','92DADU','Asia/Karachi',null),
('PK','巴基斯坦','92GO','Asia/Karachi',null),
('PK','巴基斯坦','92COCO','Asia/Karachi',null),
('PK','巴基斯坦','92GLORY','Asia/Karachi',null),
('PK','巴基斯坦','92STRIKE','Asia/Karachi',null),
('PK','巴基斯坦','92STAR','Asia/Karachi',null),
('PK','巴基斯坦','92.GAME','Asia/Karachi',null),
('PK','巴基斯坦','YAYWIN','Asia/Karachi',null),
('BR','巴西','POPBRA','America/Sao_Paulo',null),
('BR','巴西','POPPG','America/Sao_Paulo',null),
('BR','巴西','POP555','America/Sao_Paulo',null),
('BR','巴西','POP678','America/Sao_Paulo',null),
('BR','巴西','POP888','America/Sao_Paulo',null),
('BR','巴西','POPLUA','America/Sao_Paulo',null),
('BR','巴西','POPBEM','America/Sao_Paulo',null),
('BR','巴西','POPCEU','America/Sao_Paulo',null),
('VN','越南','92LOTTERY','Asia/Ho_Chi_Minh',null),
('VN','越南','VN168','Asia/Ho_Chi_Minh',null),
('VN','越南','66CLUB','Asia/Ho_Chi_Minh',null),
('VN','越南','82VN','Asia/Ho_Chi_Minh',null),
('ID','印尼','55FIVE','Asia/Jakarta',null),
('MY','马来','MZPLAY','Asia/Kuala_Lumpur',null),
('MM','缅甸','6LOTTERY','Asia/Yangon',null),
('NG','尼日利亚','FB999','Africa/Lagos',null),
('IN','印度','91CLUB','Asia/Kolkata',null),
('IN','印度','55CLUB','Asia/Kolkata',null),
('IN','印度','IN999','Asia/Kolkata',null),
('IN','印度','OKWIN','Asia/Kolkata',null),
('IN','印度','JALWA','Asia/Kolkata',null),
('IN','印度','BIGMUMBAI','Asia/Kolkata',null),
('IN','印度','82LOTTERY','Asia/Kolkata',null),
('IN','印度','LOTTERY7','Asia/Kolkata',null),
('IN','印度','51GAME','Asia/Kolkata',null),
('IN','印度','6CLUB','Asia/Kolkata',null),
('IN','印度','TPPLAY','Asia/Kolkata',null),
('IN','印度','RAJA','Asia/Kolkata',null),
('IN','印度','JAICLUB','Asia/Kolkata',null),
('IN','印度','Shree.Win','Asia/Kolkata',null),
('IN','印度','Veer.Game','Asia/Kolkata',null);
