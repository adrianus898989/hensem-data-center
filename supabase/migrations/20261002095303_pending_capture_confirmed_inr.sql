-- Owner-confirmed currency for exactly thirteen already archived M8/AR/IN captures.
-- The immutable source archive and all order rows remain unchanged. No country-wide
-- currency inference, future-capture inheritance, collector change or API write.
begin;
set local lock_timeout='3s';set local statement_timeout='15s';
set local timezone='UTC';
do $preflight$
declare r record;p pg_proc%rowtype;
begin
 for r in select *from(values
    ('private.dashboard_admin_live_pending_orders(jsonb)','01c6ec44536c426665b4fdb1cd6da8ac','f48ec20e4457fa569d0e774ac60dcbcc',true,'s','{postgres=X/postgres,authenticated=X/postgres}'),
    ('private.dashboard_admin_pending_capture_day(jsonb,jsonb,jsonb)','41d8c6e59d25ecd5e9a97d030d08109b','60a64a8aebff15a221861868d02274b7',false,'s','{postgres=X/postgres}'),
    ('private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date)','9b99610741fe8053101b73f3bfd8bd62','cbc5b4588074a7e821dcbe7a4a03f1e2',false,'s','{postgres=X/postgres}')
 )v(signature,body_hash,definition_hash,secdef,volatility,acl)loop
  select *into p from pg_proc where oid=to_regprocedure(r.signature);
  if not found or md5(p.prosrc)<>r.body_hash or md5(pg_get_functiondef(p.oid))<>r.definition_hash
   or p.proowner<>'postgres'::regrole or p.prosecdef<>r.secdef or p.provolatile::text<>r.volatility
   or p.proacl::text is distinct from r.acl or p.proconfig is distinct from array['search_path=""']then
   raise exception 'pending_currency_reader_baseline_drift: %',r.signature;end if;
 end loop;
 if to_regclass('private.withdraw_pending_capture_archive')is null
  or to_regclass('private.withdraw_pending_capture_currency_confirmations')is not null
  or to_regprocedure('private.dashboard_admin_pending_archive_currency(uuid)')is not null
  or to_regprocedure('private.withdraw_pending_capture_immutable()')is null then
  raise exception 'pending_currency_schema_drift';end if;
end $preflight$;

create table private.withdraw_pending_capture_currency_confirmations(
 archive_id uuid primary key references private.withdraw_pending_capture_archive(id),
 source_system text not null check(source_system='WITHDRAW_REVIEW'),
 country_code text not null check(country_code='IN'),
 platform text not null check(platform in('51GAME','55CLUB','6CLUB','82LOTTERY','91CLUB','BIGMUMBAI','IN999','JAICLUB','JALWA','LOTTERY7','OKWIN','RAJA','TPPLAY')),
 stat_date date not null check(stat_date=date '2026-10-01'),
 snapshot_at timestamptz not null check(isfinite(snapshot_at)),
 window_start date not null,window_end date not null,
 snapshot_id uuid not null,platform_id uuid not null,
 native_source_system text not null check(native_source_system='AR'),
 team_name text not null check(team_name='M8'),
 timezone text not null check(timezone='Asia/Kolkata'),
 archive_content_sha256 text not null check(archive_content_sha256~'^[a-f0-9]{64}$'),
 currency text not null check(currency='INR'),
 confirmation_basis text not null check(confirmation_basis='owner_confirmation'),
 confirmed_at timestamptz not null default clock_timestamp()
);
alter table private.withdraw_pending_capture_currency_confirmations enable row level security;
revoke all on private.withdraw_pending_capture_currency_confirmations from public,anon,authenticated,service_role;
create trigger pending_currency_confirmation_immutable before update or delete
 on private.withdraw_pending_capture_currency_confirmations for each row execute function private.withdraw_pending_capture_immutable();

-- The manifest pins the actual original content, not a reusable country/platform rule.
do $confirm_manifest$
declare n integer;orders bigint;
begin
 with expected(platform,snapshot_at,content_hash)as(values
    ('51GAME',timestamptz '2026-10-01 18:32:31+00','835e296eb6afef85e3372698b3bbdaa268e2946c7513a4c28e6447bc7b786757'),
    ('55CLUB',timestamptz '2026-10-01 18:31:03+00','c7dbe0b89d914379b07abd77a90ad9a6a91adfebe6ce13efff05db2f18893c6c'),
    ('6CLUB',timestamptz '2026-10-01 18:32:43+00','26321c55317827e18afa14b9603b7388b434f515b93916f86881127834b50d29'),
    ('82LOTTERY',timestamptz '2026-10-01 18:32:03+00','c1415f966cd7ff282ef2e65f1a855cc05194259c899c14381d82592504ce3ef9'),
    ('91CLUB',timestamptz '2026-10-01 18:30:45+00','c00f0f6ab624a559236be113c3ab692957995f5a8011cf37e0d6618c0b2aa171'),
    ('BIGMUMBAI',timestamptz '2026-10-01 18:31:52+00','c3a0a85be14987e61225147636c1b897e8dc30adfb8d8af4924aa2c6b5cf1099'),
    ('IN999',timestamptz '2026-10-01 18:31:12+00','4aefea35436cf334ed209d43db16519e23fcc81bbcb46744d609a1e373a71da5'),
    ('JAICLUB',timestamptz '2026-10-01 18:33:44+00','cc081cad1a9ec598cfb97abc6249cf6e46b83ebcc7eada69494044cbdbb91854'),
    ('JALWA',timestamptz '2026-10-01 18:31:39+00','a3313dbdf240e73cdc68370d15ecdaea1e50c0729ac8630e484173069e6221b5'),
    ('LOTTERY7',timestamptz '2026-10-01 18:32:16+00','bc4d9545f59b34d462c1c813c71e909d464ccd9e6bbf45b610c1d883db085323'),
    ('OKWIN',timestamptz '2026-10-01 18:31:24+00','89433f8dd80148d343aadebdc75d84442304b4e9115a5419fc271174cf185660'),
    ('RAJA',timestamptz '2026-10-01 18:33:07+00','b4a80d02c990993d722130f9dd231d04387ad7f4595ebb506a0022b555c27692'),
    ('TPPLAY',timestamptz '2026-10-01 18:32:54+00','4b2126a838bfc90abd3f5a0fe616f398819540b40dbfbcd00c5a44e970e24239')
 ),matched as(
 select a.* from private.withdraw_pending_capture_archive a join expected e
  on a.platform=e.platform and a.snapshot_at=e.snapshot_at
   and encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')=e.content_hash
 where a.source_system='WITHDRAW_REVIEW'and a.country_code='IN'and a.stat_date=date '2026-10-01'
  and a.identity_status='resolved'and a.native_source_system='AR'and a.team_name='M8'
  and a.currency is null and a.platform_id is not null and a.timezone='Asia/Kolkata'
 ),confirmed as(
 insert into private.withdraw_pending_capture_currency_confirmations
 (archive_id,source_system,country_code,platform,stat_date,snapshot_at,window_start,window_end,snapshot_id,
  platform_id,native_source_system,team_name,timezone,archive_content_sha256,currency,confirmation_basis)
 select id,source_system,country_code,platform,stat_date,snapshot_at,window_start,window_end,snapshot_id,
  platform_id,native_source_system,team_name,timezone,encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex'),'INR','owner_confirmation'
 from matched m returning archive_id
 )select count(*),sum(m.pending_count)into n,orders from confirmed c join matched m on m.id=c.archive_id;
 if n<>13 or orders is distinct from 3945::bigint then raise exception 'pending_currency_confirmation_manifest_drift';end if;
end $confirm_manifest$;

-- Owner-only lookup. Existing non-null source currency always wins. The complete
-- original archive hash plus every identity/time key must still match evidence.
create function private.dashboard_admin_pending_archive_currency(p_archive_id uuid)
returns text language sql stable security invoker set search_path='' set timezone='UTC' as $currency$
 select coalesce(a.currency,case when e.archive_id is not null
  and e.source_system=a.source_system and e.country_code=a.country_code and e.platform=a.platform
  and e.stat_date=a.stat_date and e.snapshot_at=a.snapshot_at
  and e.window_start=a.window_start and e.window_end=a.window_end and e.snapshot_id=a.snapshot_id
  and a.identity_status='resolved'and e.platform_id=a.platform_id
  and e.native_source_system=a.native_source_system and e.team_name=a.team_name and e.timezone=a.timezone
  and e.confirmation_basis='owner_confirmation'
  and e.archive_content_sha256=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')then e.currency end)
 from private.withdraw_pending_capture_archive a
 left join private.withdraw_pending_capture_currency_confirmations e on e.archive_id=a.id
 where a.id=p_archive_id;
$currency$;
revoke all on function private.dashboard_admin_pending_archive_currency(uuid)from public,anon,authenticated,service_role;

-- Narrow read projection replacement; all gateway, live role, exact native
-- identity, authorized scope and actual midnight-window predicates remain.
do $patch$
declare target regprocedure:='private.dashboard_admin_live_pending_orders(jsonb)'::regprocedure;original_metadata jsonb;v_definition text;
begin
 select to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid)into original_metadata,v_definition from pg_proc p where p.oid=target;
  if (length(v_definition)-length(replace(v_definition,$old0$x.currency is not distinct from y->>'currency'$old0$,'')))/length($old0$x.currency is not distinct from y->>'currency'$old0$)<>2 then raise exception 'pending_currency_patch_shape_drift';end if;
  v_definition:=replace(v_definition,$old0$x.currency is not distinct from y->>'currency'$old0$,$new0$private.dashboard_admin_pending_archive_currency(x.id) is not distinct from y->>'currency'$new0$);
 execute v_definition;
 if(select to_jsonb(p)-'prosrc'from pg_proc p where p.oid=target)is distinct from original_metadata
  or(select md5(prosrc)from pg_proc where oid=target)<>'37facf3525b77b8cf2479e61c557c216'then raise exception 'pending_currency_reader_metadata_drift';end if;
end $patch$;
do $patch$
declare target regprocedure:='private.dashboard_admin_pending_capture_day(jsonb,jsonb,jsonb)'::regprocedure;original_metadata jsonb;v_definition text;
begin
 select to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid)into original_metadata,v_definition from pg_proc p where p.oid=target;
  if (length(v_definition)-length(replace(v_definition,$old0$  if r->>'timingState'='on_time'then$old0$,'')))/length($old0$  if r->>'timingState'='on_time'then$old0$)<>1 then raise exception 'pending_currency_patch_shape_drift';end if;
  v_definition:=replace(v_definition,$old0$  if r->>'timingState'='on_time'then$old0$,$new0$  if verified then r:=r||jsonb_build_object('currency',private.dashboard_admin_pending_archive_currency((h->>'archive_id')::uuid));end if;
  if r->>'timingState'='on_time'then$new0$);
 execute v_definition;
 if(select to_jsonb(p)-'prosrc'from pg_proc p where p.oid=target)is distinct from original_metadata
  or(select md5(prosrc)from pg_proc where oid=target)<>'6fa40fa54d1483f06df4d4f92710e06f'then raise exception 'pending_currency_reader_metadata_drift';end if;
end $patch$;
do $patch$
declare target regprocedure:='private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date)'::regprocedure;original_metadata jsonb;v_definition text;
begin
 select to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid)into original_metadata,v_definition from pg_proc p where p.oid=target;
  if (length(v_definition)-length(replace(v_definition,$old0$to_jsonb(a)||jsonb_build_object('archive_id',a.id,'captureVerified',true)$old0$,'')))/length($old0$to_jsonb(a)||jsonb_build_object('archive_id',a.id,'captureVerified',true)$old0$)<>1 then raise exception 'pending_currency_patch_shape_drift';end if;
  v_definition:=replace(v_definition,$old0$to_jsonb(a)||jsonb_build_object('archive_id',a.id,'captureVerified',true)$old0$,$new0$to_jsonb(a)||jsonb_build_object('currency',private.dashboard_admin_pending_archive_currency(a.id),'archive_id',a.id,'captureVerified',true)$new0$);
  if (length(v_definition)-length(replace(v_definition,$old1$a.currency is not distinct from t.currency$old1$,'')))/length($old1$a.currency is not distinct from t.currency$old1$)<>1 then raise exception 'pending_currency_patch_shape_drift';end if;
  v_definition:=replace(v_definition,$old1$a.currency is not distinct from t.currency$old1$,$new1$private.dashboard_admin_pending_archive_currency(a.id) is not distinct from t.currency$new1$);
 execute v_definition;
 if(select to_jsonb(p)-'prosrc'from pg_proc p where p.oid=target)is distinct from original_metadata
  or(select md5(prosrc)from pg_proc where oid=target)<>'9b7e0bc4551884b54f01a5ca0134f6a5'then raise exception 'pending_currency_reader_metadata_drift';end if;
end $patch$;
notify pgrst,'reload schema';
commit;
