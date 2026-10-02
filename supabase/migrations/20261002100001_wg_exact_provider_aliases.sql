-- Exact observed WG provider identities. Native orders/configuration remain immutable.
-- No generic currency-suffix/digit stripping, no new sites or pricing rules.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Verify the real native adapters and their existing selective indexes before
-- touching any resolver. A renamed/missing field must abort, not pass synthetic QA.
do $native_dependencies$
declare name text;relation regclass;expected record;source pg_class%rowtype;
begin
 foreach name in array array['wg_recharge_details','wg_withdraw_details'] loop
  relation:=to_regclass('public.'||name);
  if relation is null then raise exception 'wg_exact_native_relation_missing: %',name;end if;
  select * into source from pg_class where oid=relation;
  if source.relkind<>'r' or source.relowner<>'postgres'::regrole or not source.relrowsecurity
   then raise exception 'wg_exact_native_relation_contract: %',name;end if;
  for expected in select * from (values
   ('country','text'::regtype),('platform','text'::regtype),('site_code','text'::regtype),('provider','text'::regtype),
   ('created_at','timestamp with time zone'::regtype),('stored_at','timestamp with time zone'::regtype)) c(column_name,type_oid) loop
   if not exists(select 1 from pg_attribute a where a.attrelid=relation and a.attname=expected.column_name
     and a.atttypid=expected.type_oid and a.attnum>0 and not a.attisdropped)
    then raise exception 'wg_exact_native_column_contract: %.%',name,expected.column_name;end if;
  end loop;
  if not exists(select 1 from pg_index i join pg_class index_relation on index_relation.oid=i.indexrelid
    join pg_am am on am.oid=index_relation.relam
    where i.indrelid=relation and index_relation.relname=case name when 'wg_recharge_details' then 'wg_recharge_site_provider' else 'wg_withdraw_site_provider' end
     and i.indisvalid and i.indisready and am.amname='btree' and i.indnkeyatts=2
     and i.indexprs is null and i.indpred is null
     and (select array_agg(a.attname::text order by k.ordinality) from unnest(i.indkey) with ordinality k(attnum,ordinality)
       join pg_attribute a on a.attrelid=relation and a.attnum=k.attnum)=array['site_code','provider'])
   then raise exception 'wg_exact_native_index_contract: %',name;end if;
 end loop;
end;
$native_dependencies$;
do $guard$
declare r record;p pg_proc%rowtype;
begin
 for r in select * from (values
 ('private.dashboard_admin_live_provider_canonical(text,text,text)','920362d0597b6bbe93036bdb2f600063',true,'s'),
 ('private.dashboard_admin_live_provider_rows()','d8e9c5add9dc3cd0175eab49ad23643c',true,'s'),
 ('private.dashboard_admin_wg_sites()','839401f31117192068b395d1c9580230',false,'i'),
 ('private.dashboard_admin_wg_payout_config(jsonb,jsonb)','d7dec3b97a1738566bd5a34f7b2eb327',true,'s'))
 t(signature,body_hash,definer,volatility) loop
  select * into p from pg_proc where oid=to_regprocedure(r.signature);
  if not found or md5(p.prosrc) is distinct from r.body_hash then raise exception 'wg_exact_provider_baseline_drift: %',r.signature;end if;
  if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}'
   or p.prosecdef is distinct from r.definer or p.provolatile::text is distinct from r.volatility
   or p.proconfig is distinct from array['search_path=""'] then raise exception 'wg_exact_provider_metadata_drift: %',r.signature;end if;
 end loop;
end;
$guard$;

create function private.dashboard_admin_wg_provider_aliases()
 returns table(country_code text,country text,platform text,raw_provider text,canonical_provider text,display_label text)
 language sql immutable set search_path='' as $aliases$
 values
 ('BR','巴西','26BET','BetcatPay&BCPay','BetCatPay','BetCatPay'),
 ('BR','巴西','POPKKK','BetcatPay&BCPay','BetCatPay','BetCatPay'),
 ('BR','巴西','POPMIU','BetcatPay&BCPay3','BetCatPay','BetCatPay'),
 ('BR','巴西','26BET','NaNaPay(BRL)','NanaPay','NanaPay'),
 ('BR','巴西','POPKKK','NaNaPay(BRL)','NanaPay','NanaPay'),
 ('BR','巴西','POPMIU','NaNaPay(BRL)3','NanaPay','NanaPay'),
 ('BR','巴西','26BET','Pay4Z(BRL)','Pay4z','Pay4z'),
 ('BR','巴西','POPKKK','Pay4Z(BRL)','Pay4z','Pay4z'),
 ('BR','巴西','POPMIU','Pay4Z(BRL)3','Pay4z','Pay4z'),
 ('BR','巴西','26BET','TranSafePay(BRL)','TransafePay','TransafePay'),
 ('BR','巴西','POPKKK','TranSafePay(BRL)','TransafePay','TransafePay'),
 ('BR','巴西','POPMIU','TranSafePay(BRL)3','TransafePay','TransafePay'),
 ('BR','巴西','26BET','U2CPay','U2CPay','U2CPay'),
 ('BR','巴西','POPKKK','U2CPay','U2CPay','U2CPay'),
 ('BR','巴西','POPMIU','U2CPay3','U2CPay','U2CPay'),
 ('VN','越南','98VV','1VNPay(VND)','1VNPay','1VNPay'),
 ('VN','越南','XX98','1VNPay(VND)','1VNPay','1VNPay'),
 ('VN','越南','98VV','FastPay(VND)','FASTPay','FASTPay'),
 ('VN','越南','XX98','FastPay(VND)','FASTPay','FASTPay'),
 ('VN','越南','98VV','MegiPay(VND)','MegiPay','MegiPay'),
 ('VN','越南','XX98','MegiPay(VND)','MegiPay','MegiPay'),
 ('VN','越南','98VV','TronPay(USDT)','TronPayUSDT','TronPay'),
 ('VN','越南','XX98','TronPay(USDT)','TronPayUSDT','TronPay'),
 ('VN','越南','98VV','V8Pay(VND)','V8Pay','V8Pay'),
 ('VN','越南','XX98','V8Pay(VND)','V8Pay','V8Pay'),
 ('VN','越南','98VV','VNSPay(VND)','VnsPay','VnsPay'),
 ('VN','越南','XX98','VNSPay(VND)','VnsPay','VnsPay'),
 ('VN','越南','98VV','WorldPay','WorldPay','WorldPay'),
 ('VN','越南','XX98','WorldPay','WorldPay','WorldPay'),
 ('VN','越南','98VV','YesPay(VND)','YesPay','YesPay'),
 ('VN','越南','XX98','YesPay(VND)','YesPay','YesPay'),
 ('VN','越南','98VV','YesPay(VND)(二)(已删除:821329)','YesPay','YesPay'),
 ('VN','越南','98VV','YesPay(VND)(已删除:731329)','YesPay','YesPay'),
 ('VN','越南','XX98','YesPay(VND)(已删除:731329)','YesPay','YesPay'),
 ('VN','越南','98VV','YesPay(VND)(已删除:791329)','YesPay','YesPay'),
 ('VN','越南','XX98','YesPay(VND)(已删除:791329)','YesPay','YesPay'),
 ('VN','越南','98VV','YesPay(VND)(已删除:851329)','YesPay','YesPay');
$aliases$;
revoke all on function private.dashboard_admin_wg_provider_aliases() from public,anon,authenticated,service_role;

-- Keep existing manual classifications first; unlisted tuples retain the old resolver.
do $canonical_patch$
declare target regprocedure:='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure;p pg_proc%rowtype;metadata jsonb;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';
 execute $candidate$create or replace function private.dashboard_admin_live_provider_canonical(p_country text,p_platform text,p_raw text)
 returns text language sql stable security definer set search_path='' as $function$
 select private.dashboard_admin_live_provider_alias(p_country,coalesce(
  (select coalesce(o.canonical_provider,a.canonical_provider)
   from private.dashboard_admin_wg_provider_aliases() a
   left join private.dashboard_admin_provider_overrides o on o.country=a.country and o.platform=a.platform and o.raw_provider=a.raw_provider
   where p_country in (a.country_code,a.country) and p_platform=a.platform and btrim(p_raw)=a.raw_provider),
  (select coalesce(o.canonical_provider,private.dashboard_admin_live_confirmed_usdt_provider(r.country,r.raw_provider),case when cardinality(n.names)=1 then n.names[1] end)
    from private.dashboard_admin_provider_registry r left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
    cross join lateral (select private.dashboard_admin_live_provider_alias_values(r.country,r.canonical_values) names)n
    where r.country=p_country and r.platform=p_platform and r.raw_provider=case when p_raw='未识别通道' then '' else coalesce(btrim(p_raw),'') end),p_raw));
$function$;$candidate$;
 if (select to_jsonb(x)-'prosrc' from pg_proc x where x.oid=target) is distinct from metadata then raise exception 'wg_exact_provider_metadata_changed';end if;
end;
$canonical_patch$;

-- Add only actually observed WG raw providers absent from the retained registry.
-- EXISTS uses retained site/provider indexes. Native counts/max timestamps are
-- unknown unless already retained in the registry; do not rescan order history.
do $rows_patch$
declare target regprocedure:='private.dashboard_admin_live_provider_rows()'::regprocedure;p pg_proc%rowtype;metadata jsonb;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';
 execute $candidate$create or replace function private.dashboard_admin_live_provider_rows()
 returns table(country text,platform text,raw_provider text,canonical_provider text,canonical_values text[],directions text[],charge_count bigint,withdraw_count bigint,matched_count bigint,last_data_date date,updated_at timestamptz,status text,version text,manual boolean)
 language plpgsql stable security definer set search_path='' as $function$
declare v_scope jsonb:=private.dashboard_admin_live_scope();
begin
 return query with approved as materialized (select * from private.dashboard_admin_wg_provider_aliases()),
 observed as materialized (
  select a.country,a.platform,a.raw_provider,a.canonical_provider,
   exists(select 1 from public.wg_recharge_details r where r.country=s.country_code and r.platform=s.platform
    and r.site_code=s.site_code and r.provider=a.raw_provider) has_charge,
   exists(select 1 from public.wg_withdraw_details w where w.country=s.country_code and w.platform=s.platform
    and w.site_code=s.site_code and w.provider=a.raw_provider) has_withdraw
  from approved a join private.dashboard_admin_wg_sites() s on s.country_code=a.country_code and s.country=a.country and s.platform=a.platform
  where private.dashboard_scope_allows(v_scope,a.country,a.platform) and private.dashboard_scope_allows(v_scope,s.country_code,s.platform)
   and not exists(select 1 from private.dashboard_admin_provider_registry stored where stored.country=a.country and stored.platform=a.platform and stored.raw_provider=a.raw_provider)
 ),
 normalized as materialized (
  select stored.country,stored.platform,stored.raw_provider,
   case when a.canonical_provider is not null then array[a.canonical_provider]
    when private.dashboard_admin_live_confirmed_usdt_provider(stored.country,stored.raw_provider) is not null
     then array[private.dashboard_admin_live_confirmed_usdt_provider(stored.country,stored.raw_provider)]
    else private.dashboard_admin_live_provider_alias_values(stored.country,stored.canonical_values) end canonical_values,
   stored.directions,stored.charge_count,stored.withdraw_count,stored.matched_count,stored.last_data_date,stored.updated_at
  from private.dashboard_admin_provider_registry stored
  left join approved a on a.country=stored.country and a.platform=stored.platform and a.raw_provider=stored.raw_provider
  where private.dashboard_scope_allows(v_scope,stored.country,stored.platform)
  union all
  select n.country,n.platform,n.raw_provider,array[n.canonical_provider],
   array_remove(array[case when n.has_withdraw then '代付'::text end,case when n.has_charge then '代收'::text end],null),
   case when n.has_charge then null::bigint else 0::bigint end,
   case when n.has_withdraw then null::bigint else 0::bigint end,
   null::bigint,null::date,null::timestamptz
  from observed n where n.has_charge or n.has_withdraw
 ) select r.country,r.platform,r.raw_provider,
  coalesce(private.dashboard_admin_live_provider_alias(r.country,o.canonical_provider),case when cardinality(r.canonical_values)=1 then r.canonical_values[1] end),
  r.canonical_values,r.directions,r.charge_count,r.withdraw_count,r.matched_count,r.last_data_date,
  coalesce(o.updated_at,r.updated_at),case when o.canonical_provider is not null or cardinality(r.canonical_values)=1 then 'assigned'
   when cardinality(r.canonical_values)>1 then 'conflict' else 'unassigned' end,
  md5(jsonb_build_array(r.canonical_values,coalesce(o.version,0))::text),o.canonical_provider is not null
 from normalized r left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider);
end;
$function$;$candidate$;
 if (select to_jsonb(x)-'prosrc' from pg_proc x where x.oid=target) is distinct from metadata then raise exception 'wg_exact_rows_metadata_changed';end if;
end;
$rows_patch$;

-- Annotate sanitized dictionary objects without changing native merchant IDs/values.
-- The target members have already been filtered by the existing scoped reader.
create function private.dashboard_admin_wg_merchant_associations(p_target jsonb,p_merchants jsonb)
 returns jsonb language sql stable set search_path='' as $merchants$
 select case when jsonb_typeof(p_merchants) is distinct from 'array' then p_merchants else
  coalesce((select jsonb_agg(case when n.canonical_provider is not null and jsonb_typeof(m.value)='object' then
   (m.value-array['canonicalProvider','displayLabel','memberPlatforms'])||jsonb_build_object(
   'canonicalProvider',n.canonical_provider,'displayLabel',n.display_label,'memberPlatforms',n.members)
   else case when jsonb_typeof(m.value)='object' then m.value-array['canonicalProvider','displayLabel','memberPlatforms'] else m.value end end order by m.ordinality)
   from jsonb_array_elements(p_merchants) with ordinality m
   left join lateral (
    select min(c.provider) canonical_provider,
     case when min(c.provider)=min(a.canonical_provider) then min(a.display_label) else min(c.provider) end display_label,
     jsonb_agg(jsonb_build_object('site_code',s.site_code,'name',s.platform) order by s.site_code) members
    from private.dashboard_admin_wg_provider_aliases() a
    join private.dashboard_admin_wg_sites() s on s.country_code=a.country_code and s.country=a.country and s.platform=a.platform
    cross join lateral(select private.dashboard_admin_live_provider_canonical(a.country,a.platform,a.raw_provider) provider)c
    where a.country_code=p_target->>'country_code' and m.value->>'value'=a.raw_provider
     and ((a.country_code='BR' and p_target->>'platform'='26BET') or (a.country_code='VN' and p_target->>'platform'='98VV'))
     and exists(select 1 from jsonb_array_elements(coalesce(p_target->'members','[]'::jsonb)) member
       where member->>'site_code'=s.site_code and member->>'name'=s.platform)
    having count(*)>0 and count(distinct c.provider)=1
   ) n on true),'[]'::jsonb) end;
$merchants$;
revoke all on function private.dashboard_admin_wg_merchant_associations(jsonb,jsonb) from public,anon,authenticated,service_role;

-- Patch the reachable WG reader, not the obsolete wrapper branch.
do $payout_patch$
declare target regprocedure:='private.dashboard_admin_wg_payout_config(jsonb,jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;
begin
 select * into p from pg_proc where oid=target;metadata:=to_jsonb(p)-'prosrc';
 execute $candidate$CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_payout_config(p_request jsonb, p_scope jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare targets jsonb; target jsonb; summaries jsonb:='[]'::jsonb; snap jsonb; cfg jsonb; chosen jsonb; result_snapshot jsonb;
begin
 -- Only the five collector sites, never an obsolete sibling from wg_config_targets.
 select coalesce(jsonb_agg(t order by t->>'country_code'),'[]'::jsonb) into targets from (
  select jsonb_build_object('country_code',s.country_code,'country_name',s.country,'platform',case s.country_code when 'BR' then '26BET' else '98VV' end,
   'timezone',s.timezone,'site_code',case s.country_code when 'BR' then '278' else '3257' end,'display_group',s.country_code,'display_name',s.country,
   'members',jsonb_agg(jsonb_build_object('site_code',s.site_code,'name',s.platform) order by s.site_code)) t
  from private.dashboard_admin_wg_sites() s where private.dashboard_scope_allows(p_scope,s.country_code,s.platform)
  group by s.country_code,s.country,s.timezone
 ) q;
 for target in select value from jsonb_array_elements(targets) loop
  select jsonb_build_object('country_code',d.country_code,'platform',d.platform,'timezone',d.timezone,'observed_at',d.observed_at,
   'observed_local_date',d.observed_local_date,'received_at',d.received_at,'parser_version',d.parser_version,'configuration',d.configuration,'source','WG 实时每日配置')
   into snap from public.wg_realtime_config_daily d where d.site_code=target->>'site_code' order by d.observed_at desc limit 1;
  if snap is null then
   select jsonb_build_object('country_code',d.country_code,'platform',d.platform,'timezone',d.timezone,'observed_at',d.observed_at,
    'observed_local_date',d.observed_local_date,'received_at',d.received_at,'parser_version',d.parser_version,'configuration',d.configuration,'source','WG 历史配置快照')
    into snap from public.wg_config_daily d where d.country_code=target->>'country_code' and d.platform=target->>'platform' order by d.observed_at desc limit 1;
  end if;
  if snap is not null then
   summaries:=summaries||jsonb_build_array(snap-'configuration'-'received_at'-'parser_version');
  end if;
  if target->>'country_code'=p_request->>'country' and target->>'platform'=p_request->>'platform' then
   chosen:=target;
   if snap is not null then
    if jsonb_typeof(snap#>'{configuration,settings}') is distinct from 'object'
     or jsonb_typeof(snap#>'{configuration,dictionaries}') is distinct from 'object'
     or jsonb_typeof(snap#>'{configuration,completeness}') is distinct from 'object' then
     raise exception using errcode='22023',message='config_snapshot_incomplete';end if;
    cfg:=private.dashboard_admin_config_projection('WG',snap->'configuration');
    cfg:=jsonb_set(cfg,'{settings}',coalesce((select jsonb_object_agg(k,v) from jsonb_each(cfg->'settings') e(k,v)
     where k='0' or exists(select 1 from jsonb_array_elements(target->'members') m where m->>'site_code'=k)),'{}'::jsonb));
    if jsonb_typeof(cfg#>'{dictionaries,merchants}')='array' then
     cfg:=jsonb_set(cfg,'{dictionaries,merchants}',private.dashboard_admin_wg_merchant_associations(target,cfg#>'{dictionaries,merchants}'));
    end if;
    result_snapshot:=snap||jsonb_build_object('configuration',cfg);
   end if;
  end if;
 end loop;
 if coalesce(p_request->>'operation','index')='index' then
  return jsonb_build_object('version',1,'system','WG','targets',targets,'summaries',summaries,'readOnly',true);
 end if;
 if chosen is null then raise exception using errcode='42501',message='config_target_denied';end if;
 return jsonb_build_object('version',1,'system','WG','target',chosen,'snapshot',result_snapshot,'readOnly',true);
end;
$function$
$candidate$;
 if (select to_jsonb(x)-'prosrc' from pg_proc x where x.oid=target) is distinct from metadata then raise exception 'wg_exact_payout_metadata_changed';end if;
end;
$payout_patch$;
do $candidate_hashes$
declare r record;p pg_proc%rowtype;
begin
 for r in select * from (values
  ('private.dashboard_admin_live_provider_canonical(text,text,text)','a785d9016309de404b385eb700637247',true,'s'),
  ('private.dashboard_admin_live_provider_rows()','ae6365c65e66cbb1f9caf637e918564e',true,'s'),
  ('private.dashboard_admin_wg_payout_config(jsonb,jsonb)','55d0f6c74ea490b5c1344228a4967137',true,'s'),
  ('private.dashboard_admin_wg_provider_aliases()','5dedf6cf8a430e21b69ca81069db8b3b',false,'i'),
  ('private.dashboard_admin_wg_merchant_associations(jsonb,jsonb)','31164f07731ecd7e4ff756c2fe8c9f09',false,'s'))
  t(signature,body_hash,definer,volatility) loop
  select * into p from pg_proc where oid=to_regprocedure(r.signature);
  if not found or md5(p.prosrc) is distinct from r.body_hash then raise exception 'wg_exact_candidate_hash: %',r.signature;end if;
  if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}'
   or p.prosecdef is distinct from r.definer or p.provolatile::text is distinct from r.volatility
   or p.proconfig is distinct from array['search_path=""'] then raise exception 'wg_exact_candidate_metadata: %',r.signature;end if;
 end loop;
end;
$candidate_hashes$;
commit;
