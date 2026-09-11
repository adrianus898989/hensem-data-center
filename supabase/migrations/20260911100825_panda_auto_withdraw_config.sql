-- Read-only snapshots from PANDA; no upstream administration capability.
create table public.panda_config_targets (
 country_code text not null, platform text not null, country_name text not null,
 timezone text not null, currency text, primary key(country_code,platform)
);
create table public.panda_config_credentials (
 token_hash text primary key check(length(token_hash)=64),
 allowed_targets text[] not null, active boolean not null default true,
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.panda_config_daily (
 country_code text not null, platform text not null, observed_local_date date not null,
 observed_at timestamptz not null, snapshot_id uuid not null unique,
 timezone text not null, parser_version text not null,
 configuration jsonb not null check(jsonb_typeof(configuration)='object'),
 configuration_hash text not null check(length(configuration_hash)=64),
 received_at timestamptz not null default now(),
 primary key(country_code,platform,observed_local_date),
 foreign key(country_code,platform) references public.panda_config_targets(country_code,platform),
 check(observed_local_date=(observed_at at time zone timezone)::date)
);
create index panda_config_latest_idx on public.panda_config_daily(country_code,platform,observed_at desc);
-- UUID receipts are immutable. The first successful capture of each local day is preserved.
create table public.panda_config_receipts (
 snapshot_id uuid primary key, country_code text not null, platform text not null,
 observed_at timestamptz not null, observed_local_date date not null,
 configuration_hash text not null check(length(configuration_hash)=64),
 received_at timestamptz not null default now()
);
alter table public.panda_config_targets enable row level security;
alter table public.panda_config_credentials enable row level security;
alter table public.panda_config_daily enable row level security;
alter table public.panda_config_receipts enable row level security;
revoke all on public.panda_config_targets,public.panda_config_credentials,public.panda_config_daily,public.panda_config_receipts from public,anon,authenticated,service_role;
grant select on public.panda_config_targets,public.panda_config_daily to authenticated;
grant select on public.panda_config_targets,public.panda_config_credentials to service_role;
grant select,insert on public.panda_config_daily,public.panda_config_receipts to service_role;
create policy panda_config_targets_read on public.panda_config_targets for select to authenticated
 using ((select public.dashboard_has_permission('auto_withdraw')));
create policy panda_config_daily_read on public.panda_config_daily for select to authenticated
 using ((select public.dashboard_has_permission('auto_withdraw')));
create view public.panda_config_latest with(security_invoker=true) as
 select distinct on(country_code,platform) * from public.panda_config_daily
 order by country_code,platform,observed_at desc;
revoke all on public.panda_config_latest from public,anon,authenticated,service_role;
grant select on public.panda_config_latest to authenticated,service_role;

create function public.ingest_panda_config(p_snapshot jsonb,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 c text:=p_snapshot->>'country_code';
 p text:=p_snapshot->>'platform';
 d date:=(p_snapshot->>'observed_local_date')::date;
 sid uuid:=(p_snapshot->>'snapshot_id')::uuid;
 observed timestamptz:=(p_snapshot->>'observed_at')::timestamptz;
 prev public.panda_config_daily;
 receipt public.panda_config_receipts;
begin
 if p_snapshot->>'source_system' is distinct from 'PANDA' or p_snapshot->>'parser_version' is distinct from 'panda-config-v1'
   or p_snapshot->>'schema_version' is distinct from '1' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
   raise exception 'config_contract_mismatch';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(sid::text,1));
 perform pg_advisory_xact_lock(hashtextextended('PANDA:'||c||':'||p||':'||d::text,0));
 if not exists(select 1 from public.panda_config_targets t where t.country_code=c and t.platform=p and t.timezone=p_snapshot->>'timezone') then
   raise exception 'config_target_mismatch';
 end if;
 if d is distinct from (observed at time zone (p_snapshot->>'timezone'))::date then
   raise exception 'config_date_mismatch';
 end if;
 select * into prev from public.panda_config_daily x where x.country_code=c and x.platform=p and x.observed_local_date=d;
 select * into receipt from public.panda_config_receipts r where r.snapshot_id=sid;
 if found then
   if receipt.country_code is distinct from c or receipt.platform is distinct from p
    or receipt.observed_at is distinct from observed or receipt.observed_local_date is distinct from d
    or receipt.configuration_hash is distinct from p_hash then raise exception 'config_snapshot_id_conflict'; end if;
   return jsonb_build_object('status','unchanged','snapshot_id',sid,'current_snapshot_id',coalesce(prev.snapshot_id,sid));
 end if;
 insert into public.panda_config_receipts(snapshot_id,country_code,platform,observed_at,observed_local_date,configuration_hash)
 values(sid,c,p,observed,d,p_hash);
 if prev.snapshot_id is not null then
   return jsonb_build_object('status','daily_exists','snapshot_id',sid,'current_snapshot_id',prev.snapshot_id);
 end if;
 insert into public.panda_config_daily(country_code,platform,observed_local_date,observed_at,snapshot_id,timezone,parser_version,configuration,configuration_hash)
 values(c,p,d,observed,sid,p_snapshot->>'timezone',p_snapshot->>'parser_version',p_snapshot->'configuration',p_hash);
 return jsonb_build_object('status','accepted','snapshot_id',sid,'current_snapshot_id',sid);
end;
$$;
revoke all on function public.ingest_panda_config(jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_panda_config(jsonb,text) to service_role;
insert into public.panda_config_targets(country_code,country_name,platform,timezone,currency) values
('BR','巴西','SSS55','Etc/GMT+3',null),
('BR','巴西','POPWB','Etc/GMT+3',null),
('BR','巴西','POPMEL','Etc/GMT+3',null),
('BR','巴西','POPDEZ','Etc/GMT+3',null),
('BR','巴西','POPBOA','Etc/GMT+3',null),
('BR','巴西','BOOMRIO','Etc/GMT+3',null),
('BR','巴西','POPN1','Etc/GMT+3',null),
('BR','巴西','POPBIS','Etc/GMT+3',null),
('BR','巴西','POPFLU','Etc/GMT+3',null),
('BR','巴西','POPVAI','Etc/GMT+3',null),
('BR','巴西','POPLUZ','Etc/GMT+3',null),
('BR','巴西','POPBEA','Etc/GMT+3',null),
('BR','巴西','POPFOI','Etc/GMT+3',null),
('PH','菲律宾','PH19','Asia/Manila',null),
('BR','巴西','POPZOE','Etc/GMT+3',null),
('BR','巴西','PLAYER BR','Etc/GMT+3',null),
('BR','巴西','POPSUR','Etc/GMT+3',null),
('BR','巴西','POPTIG','Etc/GMT+3',null),
('BR','巴西','POPSEN','Etc/GMT+3',null),
('BR','巴西','POPTAM','Etc/GMT+3',null),
('BR','巴西','56L','Etc/GMT+3',null),
('BR','巴西','559K','Etc/GMT+3',null),
('BR','巴西','2V222','Etc/GMT+3',null),
('BR','巴西','9596BET','Etc/GMT+3',null),
('BR','巴西','8599BET','Etc/GMT+3',null),
('BR','巴西','F75','Etc/GMT+3',null),
('BR','巴西','KK345','Etc/GMT+3',null),
('BR','巴西','AA45','Etc/GMT+3',null),
('BR','巴西','FF555','Etc/GMT+3',null),
('BR','巴西','VIP345','Etc/GMT+3',null),
('BR','巴西','25RR','Etc/GMT+3',null),
('BR','巴西','KKVIP','Etc/GMT+3',null),
('BR','巴西','5V555','Etc/GMT+3',null),
('BR','巴西','27FF','Etc/GMT+3',null),
('BR','巴西','58EE','Etc/GMT+3',null),
('BR','巴西','222O','Etc/GMT+3',null),
('BR','巴西','32QQ','Etc/GMT+3',null),
('BR','巴西','TPTP','Etc/GMT+3',null),
('BR','巴西','67VIP','Etc/GMT+3',null),
('BR','巴西','222VIP','Etc/GMT+3',null),
('BR','巴西','345F','Etc/GMT+3',null),
('BR','巴西','POPNOV','Etc/GMT+3',null),
('BR','巴西','POPFEZ','Etc/GMT+3',null),
('BR','巴西','POPCRA','Etc/GMT+3',null),
('BR','巴西','43R','Etc/GMT+3',null),
('BR','巴西','POPBUL','Etc/GMT+3',null),
('BR','巴西','234T','Etc/GMT+3',null),
('BR','巴西','888HH','Etc/GMT+3',null),
('BR','巴西','BET5697','Etc/GMT+3',null),
('BR','巴西','96F','Etc/GMT+3',null),
('BR','巴西','45FF','Etc/GMT+3',null),
('BR','巴西','76PP','Etc/GMT+3',null),
('BR','巴西','8566BET','Etc/GMT+3',null),
('BR','巴西','776F','Etc/GMT+3',null);
