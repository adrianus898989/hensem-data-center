-- Names are an independent once-per-local-day capture; never overwrite core config.
alter table public.panda_config_targets
 add column source_tenant_id bigint check(source_tenant_id>0),
 add column source_region_id integer check(source_region_id in(1,2));

create table public.panda_config_dictionary_daily (
 country_code text not null, platform text not null, observed_local_date date not null,
 observed_at timestamptz not null, snapshot_id uuid not null unique,
 timezone text not null, dictionary jsonb not null check(jsonb_typeof(dictionary)='object'),
 dictionary_hash text not null check(dictionary_hash ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default now(),
 primary key(country_code,platform,observed_local_date),
 foreign key(country_code,platform) references public.panda_config_targets(country_code,platform),
 check(observed_local_date=(observed_at at time zone timezone)::date)
);
create index panda_config_dictionary_latest_idx on public.panda_config_dictionary_daily(country_code,platform,observed_at desc);
create table public.panda_config_dictionary_receipts (
 snapshot_id uuid primary key, country_code text not null, platform text not null,
 observed_at timestamptz not null, observed_local_date date not null,
 dictionary_hash text not null check(dictionary_hash ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default now()
);
alter table public.panda_config_dictionary_daily enable row level security;
alter table public.panda_config_dictionary_receipts enable row level security;
revoke all on public.panda_config_dictionary_daily,public.panda_config_dictionary_receipts from public,anon,authenticated,service_role;
grant select on public.panda_config_dictionary_daily to authenticated;
grant select,insert on public.panda_config_dictionary_daily,public.panda_config_dictionary_receipts to service_role;
create policy panda_config_dictionary_read on public.panda_config_dictionary_daily for select to authenticated
 using ((select public.dashboard_has_permission('auto_withdraw')));
create view public.panda_config_dictionary_latest with(security_invoker=true) as
 select distinct on(country_code,platform) * from public.panda_config_dictionary_daily
 order by country_code,platform,observed_at desc;
revoke all on public.panda_config_dictionary_latest from public,anon,authenticated,service_role;
grant select on public.panda_config_dictionary_latest to authenticated,service_role;

create function public.ingest_panda_config_dictionary(p_dictionary jsonb,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 c text:=p_dictionary->>'country_code';
 p text:=p_dictionary->>'platform';
 d date:=(p_dictionary->>'observed_local_date')::date;
 sid uuid:=(p_dictionary->>'snapshot_id')::uuid;
 observed timestamptz:=(p_dictionary->>'observed_at')::timestamptz;
 prev public.panda_config_dictionary_daily;
 receipt public.panda_config_dictionary_receipts;
begin
 if p_dictionary->>'source_system' is distinct from 'PANDA'
   or p_dictionary->>'schema_version' is distinct from '1'
   or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(p_dictionary->'channels') is distinct from 'array'
   or jsonb_typeof(p_dictionary->'levels') is distinct from 'array'
   or sid is null or observed is null or d is null then
   raise exception 'dictionary_contract_mismatch';
 end if;
 if jsonb_array_length(p_dictionary->'channels')>1000 or jsonb_array_length(p_dictionary->'levels')>2000
   or octet_length(p_dictionary::text)>300000 then raise exception 'dictionary_payload_too_large'; end if;
 perform pg_advisory_xact_lock(hashtextextended(sid::text,3));
 perform pg_advisory_xact_lock(hashtextextended('PANDA_DICT:'||c||':'||p||':'||d::text,2));
 if not exists(select 1 from public.panda_config_targets t where t.country_code=c and t.platform=p
   and t.timezone=p_dictionary->>'timezone'
   and t.source_tenant_id=(p_dictionary->>'tenant_id')::bigint
   and t.source_region_id=(p_dictionary->>'region_id')::integer) then
   raise exception 'dictionary_target_mismatch';
 end if;
 if d is distinct from (observed at time zone (p_dictionary->>'timezone'))::date then
   raise exception 'dictionary_date_mismatch';
 end if;
 select * into prev from public.panda_config_dictionary_daily x where x.country_code=c and x.platform=p and x.observed_local_date=d;
 select * into receipt from public.panda_config_dictionary_receipts r where r.snapshot_id=sid;
 if found then
   if receipt.country_code is distinct from c or receipt.platform is distinct from p
    or receipt.observed_at is distinct from observed or receipt.observed_local_date is distinct from d
    or receipt.dictionary_hash is distinct from p_hash then raise exception 'dictionary_snapshot_id_conflict'; end if;
   return jsonb_build_object('status','unchanged','snapshot_id',sid,'current_snapshot_id',coalesce(prev.snapshot_id,sid));
 end if;
 insert into public.panda_config_dictionary_receipts(snapshot_id,country_code,platform,observed_at,observed_local_date,dictionary_hash)
 values(sid,c,p,observed,d,p_hash);
 if prev.snapshot_id is not null then
   return jsonb_build_object('status','daily_exists','snapshot_id',sid,'current_snapshot_id',prev.snapshot_id);
 end if;
 insert into public.panda_config_dictionary_daily(country_code,platform,observed_local_date,observed_at,snapshot_id,timezone,dictionary,dictionary_hash)
 values(c,p,d,observed,sid,p_dictionary->>'timezone',p_dictionary,p_hash);
 return jsonb_build_object('status','accepted','snapshot_id',sid,'current_snapshot_id',sid);
end;
$$;
revoke all on function public.ingest_panda_config_dictionary(jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_panda_config_dictionary(jsonb,text) to service_role;
-- Bind names to the original registered source tenant, not a caller-supplied target.
update public.panda_config_targets t set source_tenant_id=b.tenant_id,source_region_id=b.region_id
from (values
 ('BR','SSS55',7752287::bigint,1,'Etc/GMT+3'),
 ('BR','POPWB',8985043::bigint,1,'Etc/GMT+3'),
 ('BR','POPMEL',4289004::bigint,1,'Etc/GMT+3'),
 ('BR','POPDEZ',6680705::bigint,1,'Etc/GMT+3'),
 ('BR','POPBOA',9797598::bigint,1,'Etc/GMT+3'),
 ('BR','BOOMRIO',6194693::bigint,1,'Etc/GMT+3'),
 ('BR','POPN1',4749728::bigint,1,'Etc/GMT+3'),
 ('BR','POPBIS',1672026::bigint,1,'Etc/GMT+3'),
 ('BR','POPFLU',1531005::bigint,1,'Etc/GMT+3'),
 ('BR','POPVAI',8256285::bigint,1,'Etc/GMT+3'),
 ('BR','POPLUZ',2730053::bigint,1,'Etc/GMT+3'),
 ('BR','POPBEA',2914229::bigint,1,'Etc/GMT+3'),
 ('BR','POPFOI',1239254::bigint,1,'Etc/GMT+3'),
 ('PH','PH19',2540123::bigint,2,'Asia/Manila'),
 ('BR','POPZOE',3200575::bigint,1,'Etc/GMT+3'),
 ('BR','PLAYER BR',6846137::bigint,1,'Etc/GMT+3'),
 ('BR','POPSUR',1859716::bigint,1,'Etc/GMT+3'),
 ('BR','POPTIG',2954683::bigint,1,'Etc/GMT+3'),
 ('BR','POPSEN',6106691::bigint,1,'Etc/GMT+3'),
 ('BR','POPTAM',8358361::bigint,1,'Etc/GMT+3'),
 ('BR','56L',1162561::bigint,1,'Etc/GMT+3'),
 ('BR','559K',6761204::bigint,1,'Etc/GMT+3'),
 ('BR','2V222',8602599::bigint,1,'Etc/GMT+3'),
 ('BR','9596BET',2473688::bigint,1,'Etc/GMT+3'),
 ('BR','8599BET',4753880::bigint,1,'Etc/GMT+3'),
 ('BR','F75',6594579::bigint,1,'Etc/GMT+3'),
 ('BR','KK345',4097783::bigint,1,'Etc/GMT+3'),
 ('BR','AA45',7515286::bigint,1,'Etc/GMT+3'),
 ('BR','FF555',8419440::bigint,1,'Etc/GMT+3'),
 ('BR','VIP345',7910097::bigint,1,'Etc/GMT+3'),
 ('BR','25RR',5821595::bigint,1,'Etc/GMT+3'),
 ('BR','KKVIP',2731434::bigint,1,'Etc/GMT+3'),
 ('BR','5V555',4965667::bigint,1,'Etc/GMT+3'),
 ('BR','27FF',5235420::bigint,1,'Etc/GMT+3'),
 ('BR','58EE',2332315::bigint,1,'Etc/GMT+3'),
 ('BR','222O',3298024::bigint,1,'Etc/GMT+3'),
 ('BR','32QQ',4415725::bigint,1,'Etc/GMT+3'),
 ('BR','TPTP',3801128::bigint,1,'Etc/GMT+3'),
 ('BR','67VIP',1499382::bigint,1,'Etc/GMT+3'),
 ('BR','222VIP',4203051::bigint,1,'Etc/GMT+3'),
 ('BR','345F',9569322::bigint,1,'Etc/GMT+3'),
 ('BR','POPNOV',5223676::bigint,1,'Etc/GMT+3'),
 ('BR','POPFEZ',5621308::bigint,1,'Etc/GMT+3'),
 ('BR','POPCRA',1930841::bigint,1,'Etc/GMT+3'),
 ('BR','43R',3582445::bigint,1,'Etc/GMT+3'),
 ('BR','POPBUL',6704993::bigint,1,'Etc/GMT+3'),
 ('BR','234T',7425762::bigint,1,'Etc/GMT+3'),
 ('BR','888HH',6202107::bigint,1,'Etc/GMT+3'),
 ('BR','BET5697',5819555::bigint,1,'Etc/GMT+3'),
 ('BR','96F',5037933::bigint,1,'Etc/GMT+3'),
 ('BR','45FF',2312575::bigint,1,'Etc/GMT+3'),
 ('BR','76PP',6475857::bigint,1,'Etc/GMT+3'),
 ('BR','8566BET',9235499::bigint,1,'Etc/GMT+3'),
 ('BR','776F',9582071::bigint,1,'Etc/GMT+3')
) as b(country_code,platform,tenant_id,region_id,timezone)
where t.country_code=b.country_code and t.platform=b.platform and t.timezone=b.timezone;

do $$ begin
 if (select count(*) from public.panda_config_targets where source_tenant_id is not null and source_region_id is not null)<>54 then
  raise exception 'dictionary_target_binding_incomplete';
 end if;
end $$;
