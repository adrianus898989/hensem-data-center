-- Add exact server-owned lineage to NEW receipts. Existing collector requests,
-- payload fingerprints, authorization, writes and acknowledgements stay intact.
-- A source instance is a credential channel, NOT proof of a running machine or
-- a physical source backend. Unconfirmed aliases remain legacy_unbound.

do $preflight$
declare r record; f pg_proc%rowtype;
begin
  for r in select * from (values
    ('public.publish_ar_collected_orders(text,jsonb)','6376228303e83fbe6699dbdb2dc0036d','dc3ce8aee630f7ee00d281b5222074fc'),
    ('public.publish_collection_success_snapshot(text,jsonb)','2230830960f27f566d28c7f014284ac0','2c9df3c513749e5be85071b2f50d85b4'),
    ('public.publish_workorder_issue_snapshot(text,jsonb)','d9a138408c83410af0299896f166ce83','febbc2605e33e6a23f083ae1ac83f949'),
    ('private.ingest_newar_detail_batch(text,jsonb)','e6e5a917174291dbcb0393f62b1eca43','09a1f187359f3f495c1d59d6213579b8'),
    ('private.ingest_newar_business_batch(text,jsonb)','4df5984dead112cdd816e669e015b488','4999574f7f198f8f4e1378d4c3763391')
  ) x(signature,definition_hash,body_hash) loop
    select * into f from pg_proc where oid=to_regprocedure(r.signature);
    if not found or md5(pg_get_functiondef(f.oid))<>r.definition_hash
      or md5(f.prosrc)<>r.body_hash or pg_get_userbyid(f.proowner)<>'postgres'
      or f.proconfig is distinct from array['search_path=""']::text[]
      or f.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
      then raise exception 'collector_identity_source_contract_drift: %',r.signature; end if;
  end loop;
end $preflight$;

create table private.collector_source_instances (
  id uuid primary key default gen_random_uuid(),
  credential_kind text not null check(credential_kind in
    ('ar_business_direct','collection_success','workorder_issue','newar_detail','newar_business')),
  credential_token_hash text not null check(credential_token_hash ~ '^[a-f0-9]{64}$'),
  identity_basis text not null default 'credential_channel' check(identity_basis='credential_channel'),
  enrolled_at timestamptz not null default clock_timestamp(),
  active boolean not null default true,
  unique(credential_kind,credential_token_hash)
);
create table private.collector_platform_identities (
  platform_id uuid primary key,
  -- Snapshot reference, not an FK: historical lineage must not block registry edits.
  mapping_id uuid not null unique,
  source_system text not null check(source_system in ('AR','NEW_AR')),
  source_country text not null,
  source_platform text not null,
  team_name text not null,
  country_code text not null check(country_code ~ '^[A-Z]{2}$'),
  timezone text not null,
  -- Unknown native currency remains NULL; it is not guessed from the country.
  currency text check(currency ~ '^[A-Z0-9]{3,8}$'),
  verified_at timestamptz not null default clock_timestamp(),
  verification_basis text not null default 'registry_exact_tuple'
    check(verification_basis='registry_exact_tuple')
);
create table private.collector_exact_scope_bindings (
  source_instance_id uuid not null references private.collector_source_instances(id),
  scope_key jsonb not null check(jsonb_typeof(scope_key)='object'),
  platform_id uuid not null references private.collector_platform_identities(platform_id),
  verified_at timestamptz not null default clock_timestamp(),
  active boolean not null default true,
  primary key(source_instance_id,scope_key)
);
create table private.collector_receipt_routes (
  receipt_kind text not null check(receipt_kind in
    ('ar_order','collection_success','workorder_issue','newar_detail','newar_business')),
  receipt_id uuid not null,
  source_instance_id uuid references private.collector_source_instances(id),
  platform_id uuid references private.collector_platform_identities(platform_id),
  routing_status text not null check(routing_status in ('resolved','legacy_unbound')),
  reason_code text not null check(reason_code in
    ('registry_exact_tuple','credential_channel_unenrolled','binding_missing','mapping_changed','mapping_ambiguous','native_registry_changed')),
  source_system text,
  team_name text,
  country_code text,
  timezone text,
  currency text,
  received_at timestamptz not null default clock_timestamp(),
  primary key(receipt_kind,receipt_id),
  check((routing_status='resolved' and platform_id is not null and source_instance_id is not null
    and source_system is not null and team_name is not null and country_code is not null and timezone is not null)
    or (routing_status='legacy_unbound' and platform_id is null and source_system is null
      and team_name is null and country_code is null and timezone is null and currency is null))
);
alter table private.collector_source_instances enable row level security;
alter table private.collector_platform_identities enable row level security;
alter table private.collector_exact_scope_bindings enable row level security;
alter table private.collector_receipt_routes enable row level security;
revoke all on private.collector_source_instances,private.collector_platform_identities,
  private.collector_exact_scope_bindings,private.collector_receipt_routes from public,anon,authenticated,service_role;

-- Enroll only current credential channels. Values are selected inside PostgreSQL
-- and are never emitted, returned, copied to receipts or embedded in this file.
insert into private.collector_source_instances(credential_kind,credential_token_hash)
select 'ar_business_direct',token_hash from public.ar_business_direct_credentials where not revoked and expires_at>clock_timestamp()
union all select 'collection_success',token_hash from public.collection_success_credentials where not revoked and expires_at>clock_timestamp()
union all select 'workorder_issue',token_hash from public.workorder_issue_credentials where not revoked and expires_at>clock_timestamp()
union all select 'newar_detail',token_hash from private.newar_detail_credentials where not revoked and expires_at>clock_timestamp()
union all select 'newar_business',token_hash from private.newar_business_credentials where not revoked and expires_at>clock_timestamp();

-- Native country/platform keys are exact. No upper(), fuzzy match, name-only
-- join, country fallback, or alias expansion is allowed during enrollment.
-- IDs preserve the existing live catalog ID ONCE, then live in this registry.
with native as (
  select 'AR'::text source_system,t.country_code,t.platform,t.timezone,t.currency,
    md5('ar:'||t.country_code||':'||t.platform)::uuid platform_id from public.ar_config_targets t where t.source_system='AR'
  union all select 'NEW_AR',n.country_code,n.platform,n.timezone,n.currency,
    md5('newar:'||n.country_code||':'||n.platform)::uuid from public.newar_detail_platforms n where n.enabled
), candidates as (
  select n.*,m.id mapping_id,m.team_name,m.source_country,
    count(*) over(partition by n.source_system,n.country_code,n.platform) matches
  from native n join public.dashboard_platform_team_map m on m.active and m.source_system=n.source_system
    and m.country_code=n.country_code and m.source_platform=n.platform
)
insert into private.collector_platform_identities(platform_id,mapping_id,source_system,source_country,source_platform,team_name,country_code,timezone,currency)
select platform_id,mapping_id,source_system,source_country,platform,team_name,country_code,timezone,currency
from candidates where matches=1 and country_code ~ '^[A-Z]{2}$'
  and nullif(btrim(team_name),'') is not null and nullif(btrim(timezone),'') is not null
  and (currency is null or currency ~ '^[A-Z0-9]{3,8}$')
  and exists(select 1 from pg_timezone_names z where z.name=timezone);

with raw_scopes as (
  select i.id source_instance_id,i.credential_kind,s.value scope_key from private.collector_source_instances i
    join public.ar_business_direct_credentials c on i.credential_kind='ar_business_direct' and c.token_hash=i.credential_token_hash
    cross join lateral jsonb_array_elements(c.allowed_scopes)s
  union all select i.id,i.credential_kind,s.value from private.collector_source_instances i
    join public.collection_success_credentials c on i.credential_kind='collection_success' and c.token_hash=i.credential_token_hash
    cross join lateral jsonb_array_elements(c.allowed_scopes)s
  union all select i.id,i.credential_kind,s.value from private.collector_source_instances i
    join public.workorder_issue_credentials c on i.credential_kind='workorder_issue' and c.token_hash=i.credential_token_hash
    cross join lateral jsonb_array_elements(c.allowed_scopes)s
  union all select i.id,i.credential_kind,s.value from private.collector_source_instances i
    join private.newar_detail_credentials c on i.credential_kind='newar_detail' and c.token_hash=i.credential_token_hash
    cross join lateral jsonb_array_elements(c.allowed_scopes)s
  union all select i.id,i.credential_kind,s.value from private.collector_source_instances i
    join private.newar_business_credentials c on i.credential_kind='newar_business' and c.token_hash=i.credential_token_hash
    cross join lateral jsonb_array_elements(c.allowed_scopes)s
), scopes as (
  -- Match exactly the selector consumed by the original RPC. AR credentials
  -- contain a display-only country field that the original authorizer ignores.
  select source_instance_id,credential_kind,case credential_kind
    when 'ar_business_direct' then jsonb_build_object('country_code',scope_key->>'country_code','platform',scope_key->>'platform')
    when 'newar_detail' then jsonb_build_object('platform',scope_key->>'platform','dataset',scope_key->>'dataset')
    when 'newar_business' then jsonb_build_object('platform',scope_key->>'platform','kind',scope_key->>'kind')
    else jsonb_build_object('country_code',scope_key->>'country_code','platform',scope_key->>'platform','timezone',scope_key->>'timezone') end scope_key
  from raw_scopes
), matches as (
  select distinct s.source_instance_id,s.scope_key,p.platform_id from scopes s
    join private.collector_platform_identities p on p.source_platform=s.scope_key->>'platform'
      and (s.credential_kind in ('newar_detail','newar_business') or p.country_code=s.scope_key->>'country_code')
      and (not(s.scope_key?'timezone') or p.timezone=s.scope_key->>'timezone')
      and case s.credential_kind when 'ar_business_direct' then p.source_system='AR'
        when 'collection_success' then p.source_system in ('AR','NEW_AR') else p.source_system='NEW_AR' end
), unique_matches as (
  select source_instance_id,scope_key,min(platform_id::text)::uuid platform_id
    from matches group by 1,2 having count(*)=1
)
insert into private.collector_exact_scope_bindings(source_instance_id,scope_key,platform_id)
select source_instance_id,scope_key,platform_id from unique_matches;

-- Indexed conflict checks use source/country/platform, not a scan of other teams.
create index dashboard_platform_exact_collector_tuple_idx
  on public.dashboard_platform_team_map(source_system,country_code,source_platform) where active;

create function private.collector_resolve_exact_route_v1(p_credential_kind text,p_token_hash text,p_scope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $route$
declare instance_id uuid; identity private.collector_platform_identities%rowtype; mapping public.dashboard_platform_team_map%rowtype;
begin
  select i.id into instance_id from private.collector_source_instances i
    where i.credential_kind=p_credential_kind and i.credential_token_hash=p_token_hash and i.active;
  if instance_id is null then return jsonb_build_object('routing_status','legacy_unbound','reason_code','credential_channel_unenrolled'); end if;
  select p.* into identity from private.collector_exact_scope_bindings b
    join private.collector_platform_identities p on p.platform_id=b.platform_id
    where b.source_instance_id=instance_id and b.scope_key=p_scope and b.active;
  if not found then return jsonb_build_object('routing_status','legacy_unbound','reason_code','binding_missing','source_instance_id',instance_id); end if;
  select * into mapping from public.dashboard_platform_team_map m where m.id=identity.mapping_id for share;
  if not found or not mapping.active or mapping.source_system is distinct from identity.source_system
    or mapping.source_country is distinct from identity.source_country or mapping.source_platform is distinct from identity.source_platform
    or mapping.country_code is distinct from identity.country_code or mapping.team_name is distinct from identity.team_name then
    return jsonb_build_object('routing_status','legacy_unbound','reason_code','mapping_changed','source_instance_id',instance_id);
  end if;
  if (select count(*) from public.dashboard_platform_team_map m where m.active and m.source_system=identity.source_system
      and m.country_code=identity.country_code and m.source_platform=identity.source_platform)<>1 then
    return jsonb_build_object('routing_status','legacy_unbound','reason_code','mapping_ambiguous','source_instance_id',instance_id);
  end if;
  if identity.source_system='AR' then
    if not exists(select 1 from public.ar_config_targets t where t.country_code=identity.country_code and t.platform=identity.source_platform
      and t.source_system='AR' and t.timezone=identity.timezone and t.currency is not distinct from identity.currency) then
      return jsonb_build_object('routing_status','legacy_unbound','reason_code','native_registry_changed','source_instance_id',instance_id);
    end if;
  else
    if not exists(select 1 from public.newar_detail_platforms n where n.platform=identity.source_platform and n.country_code=identity.country_code
      and n.enabled and n.timezone=identity.timezone and n.currency is not distinct from identity.currency) then
      return jsonb_build_object('routing_status','legacy_unbound','reason_code','native_registry_changed','source_instance_id',instance_id);
    end if;
  end if;
  return jsonb_build_object('routing_status','resolved','reason_code','registry_exact_tuple','source_instance_id',instance_id,
    'platform_id',identity.platform_id,'source_system',identity.source_system,'team_name',identity.team_name,
    'country_code',identity.country_code,'timezone',identity.timezone,'currency',identity.currency);
end $route$;

create function private.collector_record_receipt_route_v1(p_credential_kind text,p_token_hash text,p_scope jsonb,p_receipt_kind text,p_receipt_id uuid)
returns void language plpgsql security definer set search_path='' as $receipt$
declare route jsonb;
begin
  route:=private.collector_resolve_exact_route_v1(p_credential_kind,p_token_hash,p_scope);
  insert into private.collector_receipt_routes(receipt_kind,receipt_id,source_instance_id,platform_id,routing_status,reason_code,
    source_system,team_name,country_code,timezone,currency)
  values(p_receipt_kind,p_receipt_id,(route->>'source_instance_id')::uuid,(route->>'platform_id')::uuid,route->>'routing_status',
    route->>'reason_code',route->>'source_system',route->>'team_name',route->>'country_code',route->>'timezone',route->>'currency')
  on conflict(receipt_kind,receipt_id) do nothing;
end $receipt$;
revoke all on function private.collector_resolve_exact_route_v1(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.collector_record_receipt_route_v1(text,text,jsonb,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.collector_record_receipt_route_v1(text,text,jsonb,text,uuid) to service_role;

-- Inject only at the original successful receipt insertion, after the unchanged
-- original validation and scope authorization. Replays return before this hook.
-- pg_get_functiondef CREATE OR REPLACE keeps original signatures/security/ACL.
do $hooks$
declare r record; original text; patched text; before_meta jsonb; after_meta jsonb;
begin
  for r in select * from (values
    ('public.publish_ar_collected_orders(text,jsonb)',
      ' INSERT INTO public.ar_collected_order_receipts(batch_id,payload_hash,order_count) VALUES(bid,fingerprint,n);',
      ' PERFORM private.collector_record_receipt_route_v1(''ar_business_direct'',p_token_hash,jsonb_build_object(''country_code'',p_payload->>''country_code'',''platform'',p_payload->>''platform''),''ar_order'',bid);'),
    ('public.publish_collection_success_snapshot(text,jsonb)',
      '    insert into public.collection_success_snapshot_receipts(snapshot_id,payload_hash) values(v_id,v_hash);',
      '    perform private.collector_record_receipt_route_v1(''collection_success'',p_token_hash,jsonb_build_object(''country_code'',p_snapshot->>''country_code'',''platform'',p_snapshot->>''platform'',''timezone'',p_snapshot->>''timezone''),''collection_success'',v_id);'),
    ('public.publish_workorder_issue_snapshot(text,jsonb)',
      '    insert into public.workorder_issue_snapshot_receipts (',
      '    perform private.collector_record_receipt_route_v1(''workorder_issue'',p_token_hash,jsonb_build_object(''country_code'',p_snapshot->>''country_code'',''platform'',p_snapshot->>''platform'',''timezone'',p_snapshot->>''timezone''),''workorder_issue'',v_id);'),
    ('private.ingest_newar_detail_batch(text,jsonb)',
      '  insert into private.newar_detail_batches values(v_batch_id,v_payload_hash,p_batch->>''platform'',p_batch->>''dataset'',received,written,received-written,clock_timestamp());',
      '  perform private.collector_record_receipt_route_v1(''newar_detail'',p_token_hash,jsonb_build_object(''platform'',p_batch->>''platform'',''dataset'',p_batch->>''dataset''),''newar_detail'',v_batch_id);'),
    ('private.ingest_newar_business_batch(text,jsonb)',
      '  insert into private.newar_business_batches(batch_id,payload_hash,platform,kind,receipt) values(v_id,v_hash,v_platform,v_kind,ack);',
      '  perform private.collector_record_receipt_route_v1(''newar_business'',p_token_hash,jsonb_build_object(''platform'',p_batch->>''platform'',''kind'',p_batch->>''kind''),''newar_business'',v_id);')
  ) x(signature,needle,hook) loop
    select pg_get_functiondef(oid),jsonb_build_object('owner',proowner,'acl',proacl::text,'definer',prosecdef,
      'volatile',provolatile,'config',proconfig) into original,before_meta from pg_proc where oid=to_regprocedure(r.signature);
    if (length(original)-length(replace(original,r.needle,'')))/length(r.needle)<>1 then
      raise exception 'collector_identity_hook_contract_drift: %',r.signature; end if;
    patched:=replace(original,r.needle,r.hook||chr(10)||r.needle);
    execute patched;
    select jsonb_build_object('owner',proowner,'acl',proacl::text,'definer',prosecdef,
      'volatile',provolatile,'config',proconfig) into after_meta from pg_proc where oid=to_regprocedure(r.signature);
    if before_meta is distinct from after_meta then raise exception 'collector_identity_rpc_security_changed: %',r.signature; end if;
  end loop;
end $hooks$;
comment on table private.collector_source_instances is 'Private credential channel enrollment; not confirmation of external collector host/version. Never expose credential reference.';
comment on table private.collector_receipt_routes is 'Safe metadata for newly accepted receipts only. legacy_unbound never supplies guessed team/country/platform identity. No original payload or credential reference.';
