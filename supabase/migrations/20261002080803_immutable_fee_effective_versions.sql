-- Explicit source effective times, immutable fee versions, atomic current projections.
-- No historical backfill and no use of observed_at / updated_at as effective time.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
create table private.fee_rate_generations(
 id uuid primary key,source_key text not null,observed_at timestamptz not null,
 published_at timestamptz not null default statement_timestamp(),payload_hash text not null,
 receipt jsonb not null,check(isfinite(observed_at))
);
create table private.fee_rate_versions(
 id uuid primary key default gen_random_uuid(),rule_key text not null,source_key text not null,
 sheet_id bigint not null,sheet_name text not null,country text not null,provider text not null,category text not null,
 direction text not null check(direction in ('charge','withdraw')),currency text,
 effective_from timestamptz not null check(isfinite(effective_from)),
 percent_rate numeric,fixed_fee numeric,pricing_state text not null,
 semantic_rule jsonb not null,provenance jsonb not null,generation_id uuid not null references private.fee_rate_generations(id),
 unique(rule_key,effective_from),check(percent_rate>=0 and percent_rate<=1),check(fixed_fee>=0),
 check(currency is null or currency~'^[A-Z]{3,6}$')
);
create index fee_rate_versions_match on private.fee_rate_versions(country,provider,direction,effective_from);
create table private.fee_rate_current_evidence(
 source_id text not null,direction text not null,rule_key text not null,state text not null,
 version_id uuid references private.fee_rate_versions(id),effective_from timestamptz,provenance jsonb not null,
 generation_id uuid not null references private.fee_rate_generations(id),primary key(source_id,direction)
);
create table private.fee_rate_head(source_key text primary key,generation_id uuid not null references private.fee_rate_generations(id),observed_at timestamptz not null);
alter table private.fee_rate_generations enable row level security;
alter table private.fee_rate_versions enable row level security;
alter table private.fee_rate_current_evidence enable row level security;
alter table private.fee_rate_head enable row level security;
revoke all on private.fee_rate_generations,private.fee_rate_versions,private.fee_rate_current_evidence,private.fee_rate_head from public,anon,authenticated,service_role;

create function private.fee_rate_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'fee_version_immutable';end $$;
revoke all on function private.fee_rate_immutable() from public,anon,authenticated,service_role;
create trigger fee_rate_versions_immutable before update or delete on private.fee_rate_versions for each row execute function private.fee_rate_immutable();
create trigger fee_rate_generations_immutable before update or delete on private.fee_rate_generations for each row execute function private.fee_rate_immutable();

create function public.fee_rate_publish_generation(p_generation_id uuid,p_source_key text,p_observed_at timestamptz,
 p_rates jsonb,p_platform_statuses jsonb,p_evidence jsonb,p_manifest jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $function$
declare
 hash text;old private.fee_rate_generations%rowtype;r jsonb;e jsonb;d text;fee text;single_fee text;
 key text;country text;currency text;effective timestamptz;state text;percent numeric;fixed numeric;semantic jsonb;proof jsonb;
 prior private.fee_rate_versions%rowtype;v_id uuid;latest timestamptz;inserted integer:=0;known integer:=0;unknown integer:=0;
 evidence_rows jsonb:='[]';receipt jsonb;v_now timestamptz:=statement_timestamp();
begin
 if p_generation_id is null or length(coalesce(p_source_key,'')) not between 1 and 200
 or p_observed_at is null or not isfinite(p_observed_at) or p_observed_at>v_now+interval '5 minutes'
 or jsonb_typeof(p_rates) is distinct from 'array' or jsonb_array_length(p_rates) not between 1 and 10000
 or jsonb_typeof(p_platform_statuses) is distinct from 'array' or jsonb_array_length(p_platform_statuses) not between 1 and 100000
 or jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence)<>jsonb_array_length(p_rates)
 or jsonb_typeof(p_manifest) is distinct from 'object' or p_manifest->'complete' is distinct from 'true'::jsonb
 or jsonb_typeof(p_manifest->'sheets') is distinct from 'array' or jsonb_array_length(p_manifest->'sheets')=0
 then raise exception 'invalid_fee_generation';end if;
 if exists(select 1 from jsonb_array_elements(p_rates) x group by x->>'id' having count(*)<>1)
 or exists(select 1 from jsonb_array_elements(p_platform_statuses) x group by x->>'id' having count(*)<>1)
 or exists(select 1 from jsonb_array_elements(p_evidence) x group by x->>'id' having count(*)<>1)
 or exists(select 1 from jsonb_array_elements(p_rates) x where nullif(x->>'id','') is null or nullif(x->>'third_party','') is null
   or not (p_manifest->'sheets' ? (x->>'sheet_name')) or not exists(select 1 from jsonb_array_elements(p_evidence) y where y->>'id'=x->>'id'))
 then raise exception 'incomplete_fee_generation';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_source_key,p_observed_at,p_rates,p_platform_statuses,p_evidence,p_manifest)::text,'UTF8')),'hex');
 -- Both projections are one shared source: serialize globally and reject stale captures.
 perform pg_advisory_xact_lock(735273521);
 select * into old from private.fee_rate_generations where id=p_generation_id;
 if found then if old.payload_hash<>hash then raise exception 'fee_generation_replay_conflict';end if;return old.receipt;end if;
 if exists(select 1 from private.fee_rate_head where source_key<>p_source_key) then raise exception 'fee_source_identity_changed';end if;
 if exists(select 1 from private.fee_rate_head where observed_at>=p_observed_at) then raise exception 'stale_fee_generation';end if;
 -- Insert the generation only after validation; the final receipt is immutable.
 -- Its versions reference this deferred FK so a receipt never needs updating.

 for r in select value from jsonb_array_elements(p_rates) loop
   select value into e from jsonb_array_elements(p_evidence) where value->>'id'=r->>'id';
   foreach d in array array['charge','withdraw'] loop
     fee:=btrim(coalesce(r->>case when d='charge' then 'collect_fee' else 'payout_fee' end,''));
     single_fee:=btrim(coalesce(r->>case when d='charge' then 'collect_single_fee' else 'payout_single_fee' end,''));
     country:=private.dashboard_data_group(r->>'country','');currency:=nullif(e->>'currency','');
     effective:=null;state:=coalesce(e->>(d||'State'),e->>'state','missing_effective_time');percent:=null;fixed:=null;v_id:=null;
     if state='ready' and coalesce(e->>'effectiveFrom','')~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
       begin effective:=(e->>'effectiveFrom')::timestamptz;
       exception when invalid_datetime_format or datetime_field_overflow then state:='invalid_effective_time';end;
     elsif state='ready' then state:='invalid_effective_time';end if;
     if effective is not null and (not isfinite(effective) or extract(year from effective) not between 2000 and 2200) then effective:=null;state:='invalid_effective_time';end if;
     if country is null or country='' or e->>'sheetId' is null then state:='unknown_source_identity';end if;
     if currency is not null and currency!~'^[A-Z]{3,6}$' then state:='unknown_currency';end if;
     key:=encode(sha256(convert_to(jsonb_build_array(p_source_key,e->>'sheetId',country,r->>'third_party',coalesce(r->>'category',''),d)::text,'UTF8')),'hex');
     if fee~'^\d+([.]\d+)?\s*%$' then percent:=replace(fee,'%','')::numeric/100;
     elsif fee~'^\d+([.]\d+)?\s*/\s*笔$' then percent:=0;fixed:=regexp_replace(fee,'\s*/\s*笔$','')::numeric;end if;
     if single_fee in ('','没有','无','0','0%') then fixed:=coalesce(fixed,0);
     elsif single_fee~'^\d+([.]\d+)?(\s*/\s*笔)?$' and fixed is null then fixed:=regexp_replace(single_fee,'\s*/\s*笔$','')::numeric;
     else fixed:=null;end if;
     if percent is null or fixed is null or percent>1 or fixed>1000000000 then percent:=null;fixed:=null;end if;
     semantic:=jsonb_build_object('percent',percent,'fixed',fixed,'currency',currency,
       'unsupportedFee',case when percent is null then fee end,'unsupportedSingle',case when percent is null then single_fee end);
     proof:=jsonb_build_object('sheetName',r->>'sheet_name','sheetId',e->'sheetId','sourceRow',r->'source_row',
       'effectiveCell',e->'effectiveCell','currencyCell',e->'currencyCell','observedAt',p_observed_at,'basis','explicit_source_effective_time');
     -- Two different source rows claiming the same semantic identity cannot
     -- become first-row-wins, even inside a single complete publication.
     if state='ready' and exists(select 1 from jsonb_array_elements(p_rates) other
       join jsonb_array_elements(p_evidence) oe on oe->>'id'=other->>'id'
       where other->>'id'<>r->>'id' and oe->>'sheetId'=e->>'sheetId'
       and private.dashboard_data_group(other->>'country','')=country
       and other->>'third_party'=r->>'third_party' and coalesce(other->>'category','')=coalesce(r->>'category','')
       and jsonb_build_array(oe->>'effectiveFrom',oe->>'currency',other->>case when d='charge' then 'collect_fee' else 'payout_fee' end,
         other->>case when d='charge' then 'collect_single_fee' else 'payout_single_fee' end)
         is distinct from jsonb_build_array(e->>'effectiveFrom',e->>'currency',r->>case when d='charge' then 'collect_fee' else 'payout_fee' end,
         r->>case when d='charge' then 'collect_single_fee' else 'payout_single_fee' end)) then state:='ambiguous_source_rule';end if;
     if state='ready' then
       select * into prior from private.fee_rate_versions where rule_key=key and effective_from=effective;
       if found then
         if prior.semantic_rule=semantic then v_id:=prior.id;else state:='same_effective_time_conflict';end if;
       else
         select max(effective_from) into latest from private.fee_rate_versions where rule_key=key;
         if latest>effective then state:='backdated_version_rejected';
         else
           insert into private.fee_rate_versions(rule_key,source_key,sheet_id,sheet_name,country,provider,category,direction,currency,
             effective_from,percent_rate,fixed_fee,pricing_state,semantic_rule,provenance,generation_id)
           values(key,p_source_key,(e->>'sheetId')::bigint,r->>'sheet_name',country,r->>'third_party',coalesce(r->>'category',''),d,currency,
             effective,percent,fixed,case when percent is null then 'unsupported_rule' when fixed>0 and currency is null then 'currency_unknown' else 'ready' end,semantic,proof,p_generation_id)
           returning id into v_id;inserted:=inserted+1;
         end if;
       end if;
     end if;
     if v_id is not null then known:=known+1;else unknown:=unknown+1;end if;
     evidence_rows:=evidence_rows||jsonb_build_array(jsonb_build_object('source_id',r->>'id','direction',d,'rule_key',key,'state',state,'version_id',v_id,'effective_from',effective,'provenance',proof,'generation_id',p_generation_id));
   end loop;
 end loop;
 receipt:=jsonb_build_object('ok',true,'generationId',p_generation_id,'rates',jsonb_array_length(p_rates),'platformStatuses',jsonb_array_length(p_platform_statuses),
 'feeVersions',jsonb_build_object('basis','order_created_at','inserted',inserted,'versionedRules',known,'unversionedRules',unknown,'state',case when unknown=0 then 'complete' when known=0 then 'unknown' else 'partial' end));
 insert into private.fee_rate_generations values(p_generation_id,p_source_key,p_observed_at,v_now,hash,receipt);
 delete from private.fee_rate_current_evidence;
 insert into private.fee_rate_current_evidence select * from jsonb_populate_recordset(null::private.fee_rate_current_evidence,evidence_rows);
 -- Both projections remain readable in their old shape; partial publication is impossible.
 insert into public.third_party_rates select (jsonb_populate_record(null::public.third_party_rates,x||jsonb_build_object('created_at',v_now,'updated_at',v_now))).* from jsonb_array_elements(p_rates) x
 on conflict(id) do update set sheet_name=excluded.sheet_name,country=excluded.country,category=excluded.category,third_party=excluded.third_party,collect_fee=excluded.collect_fee,payout_fee=excluded.payout_fee,total_fee=excluded.total_fee,collect_single_fee=excluded.collect_single_fee,payout_single_fee=excluded.payout_single_fee,collect_limit=excluded.collect_limit,payout_limit=excluded.payout_limit,channel_info=excluded.channel_info,leak=excluded.leak,whitelist=excluded.whitelist,status=excluded.status,source_row=excluded.source_row,updated_at=excluded.updated_at;
 delete from public.third_party_rates where id not in(select x->>'id' from jsonb_array_elements(p_rates) x);
 insert into public.third_party_platform_status select (jsonb_populate_record(null::public.third_party_platform_status,x||jsonb_build_object('created_at',v_now,'updated_at',v_now))).* from jsonb_array_elements(p_platform_statuses) x
 on conflict(id) do update set sheet_name=excluded.sheet_name,country=excluded.country,platform=excluded.platform,category=excluded.category,third_party=excluded.third_party,collect_fee=excluded.collect_fee,payout_fee=excluded.payout_fee,total_fee=excluded.total_fee,collect_single_fee=excluded.collect_single_fee,payout_single_fee=excluded.payout_single_fee,collect_limit=excluded.collect_limit,payout_limit=excluded.payout_limit,status=excluded.status,raw_status=excluded.raw_status,source_row=excluded.source_row,source_column=excluded.source_column,updated_at=excluded.updated_at;
 delete from public.third_party_platform_status where id not in(select x->>'id' from jsonb_array_elements(p_platform_statuses) x);
 insert into private.fee_rate_head values(p_source_key,p_generation_id,p_observed_at) on conflict(source_key) do update set generation_id=excluded.generation_id,observed_at=excluded.observed_at;
 insert into public.sync_status(module,last_sync_at,status,message,updated_at) values('third_party_rates',v_now,'success','完整费率同步；历史版本：'||(receipt#>>'{feeVersions,state}'),v_now)
 on conflict(module) do update set last_sync_at=excluded.last_sync_at,status=excluded.status,message=excluded.message,updated_at=excluded.updated_at;
 return receipt;
end $function$;
alter table private.fee_rate_versions alter constraint fee_rate_versions_generation_id_fkey deferrable initially deferred;
revoke all on function public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb) to service_role;

-- Called only after the original query's active account/scope/catalog checks.
-- Resolve once per distinct provider/direction/currency, not once per order.
create function private.dashboard_admin_fee_intervals(p_country text,p_platform text,p_provider text,p_direction text,p_currency text)
 returns table(effective_from timestamptz,effective_until timestamptz,percent_rate numeric,fixed_fee numeric,version_ids jsonb)
 language sql stable security definer set search_path='' as $function$
 with versions as materialized (
   select v.*,lead(v.effective_from) over(partition by v.rule_key order by v.effective_from) until_at
   from private.fee_rate_versions v where v.country=p_country and v.direction=p_direction
   and private.dashboard_admin_live_provider_canonical(p_country,p_platform,v.provider)=private.dashboard_admin_live_provider_canonical(p_country,p_platform,p_provider)
 ), eligible as materialized (
   select v.* from versions v where nullif(p_currency,'') is not null and v.pricing_state='ready'
   and (v.currency=p_currency or (v.currency is null and v.fixed_fee=0))
   -- An invalid/removed current source cannot extend the last open interval.
   and (v.until_at is not null or exists(select 1 from private.fee_rate_current_evidence e join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready' and r.updated_at=g.published_at))
   and (v.until_at is not null or not exists(
     select 1 from private.fee_rate_current_evidence bad join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where bad.direction=p_direction and (bad.version_id is null or bad.state<>'ready' or r.updated_at is distinct from generation.published_at)
     and private.dashboard_data_group(r.country,'')=p_country
     and private.dashboard_admin_live_provider_canonical(p_country,p_platform,r.third_party)=private.dashboard_admin_live_provider_canonical(p_country,p_platform,p_provider)))
 ), boundaries as (select effective_from t from versions union select until_at from versions where until_at is not null),
 segments as (select t,lead(t) over(order by t) until_at from boundaries), priced as (
   select s.t,s.until_at,count(distinct jsonb_build_array(e.percent_rate,e.fixed_fee)) rule_count,
    min(e.percent_rate) percent,min(e.fixed_fee) fixed,jsonb_agg(e.id order by e.id) ids
   from segments s join eligible e on e.effective_from<=s.t and (e.until_at is null or s.t<e.until_at)
   -- An overlapping unpriceable category makes this provider ambiguous too.
   where not exists(select 1 from versions b where b.effective_from<=s.t and (b.until_at is null or s.t<b.until_at)
     and (b.currency is null or b.currency=p_currency)
     and not exists(select 1 from eligible good where good.id=b.id))
   group by s.t,s.until_at
 ) select t,until_at,percent,fixed,ids from priced where rule_count=1;
$function$;
revoke all on function private.dashboard_admin_fee_intervals(text,text,text,text,text) from public,anon,authenticated,service_role;

create function private.dashboard_admin_fee_quote(p_country text,p_platform text,p_provider text,p_direction text,p_currency text,p_created_at timestamptz,p_amount numeric)
 returns jsonb language sql stable security definer set search_path='' as $function$
 select coalesce((select jsonb_build_object('fee_version_state','complete','fee_version_ids',v.version_ids,
 'fee_version_effective_from',v.effective_from,'fee_version_effective_until',v.effective_until,
 'fee_version_estimated_amount',(p_amount*v.percent_rate+v.fixed_fee)::text,'fee_version_basis','order_created_at')
 from private.dashboard_admin_fee_intervals(p_country,p_platform,p_provider,p_direction,p_currency) v
 where isfinite(p_created_at) and p_created_at>=v.effective_from and (v.effective_until is null or p_created_at<v.effective_until)
 and p_amount>=0 and p_amount::text not in ('NaN','Infinity','-Infinity')),
 jsonb_build_object('fee_version_state','unknown','fee_version_ids','[]'::jsonb,'fee_version_effective_from',null,
 'fee_version_effective_until',null,'fee_version_estimated_amount',null,'fee_version_basis','order_created_at'));
$function$;
revoke all on function private.dashboard_admin_fee_quote(text,text,text,text,text,timestamptz,numeric) from public,anon,authenticated,service_role;

do $patch_0$
declare target regprocedure:='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;
begin
 select * into p from pg_proc where oid=target;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}' or not p.prosecdef
 or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""','jit=off'] then raise exception 'fee_function_metadata_drift';end if;
 if md5(p.prosrc)<>'f2d53370957a4149b790198192d90df6' then raise exception 'fee_function_baseline_drift: private.dashboard_admin_live_query_raw(jsonb)';end if;
 metadata:=to_jsonb(p)-'prosrc';
 execute $definition_0$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_query_raw(p_request jsonb DEFAULT '{"action": "catalog"}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  v_fee_country text; v_fee_currency_proven boolean := false;
  -- aggregate_exclusive_amount_max_v1: one parsed boolean, never epsilon math.
  v_max_exclusive boolean := false;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];
begin
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.scope_group,p.name,p.source),'[]'::jsonb)
    into v_options from private.dashboard_admin_live_platforms() p;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','amountBands','durationVersion','durationRange','offset','limit','view'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request);
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;
  if p_request ? 'view' and (jsonb_typeof(p_request->'view')<>'string' or p_request->>'view' not in ('full','providers') or v_action<>'aggregate') then
    raise exception using errcode='22023',message='invalid_view';
  end if;
  if v_action not in ('catalog','query','aggregate','details') then raise exception using errcode='22023',message='invalid_action'; end if;
  if v_action='catalog' then
    if p_request-array['action']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_catalog_request'; end if;
    return jsonb_build_object('version',1,'asOf',v_asof,'platforms',(
      select coalesce(jsonb_agg((p-array['scope_group','source_name'])||jsonb_build_object('scopeGroup',p->'scope_group','sourceName',p->'source_name',
        'capabilities',jsonb_build_object('systemOrderId',p->>'source'='newar','thirdPartyOrderNumber',p->>'source' in ('newar','game66'),'utr',false,
          'historicalFees',true,'actualAmount',p->>'source'<>'ar','recordedFee',p->>'source' in ('newar','game66'),'scopeGroupIsGeographicCountry',p->>'source'<>'game66')||case when p->>'source'='wg' then private.dashboard_admin_wg_capabilities() else '{}'::jsonb end)),'[]'::jsonb)
      from jsonb_array_elements(v_options) p));
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz; v_end:=(p_request->>'endAt')::timestamptz;
    v_offset:=coalesce((p_request->>'offset')::integer,0); v_limit:=coalesce((p_request->>'limit')::integer,20);
    v_min:=nullif(p_request->>'amountMin','')::numeric; v_max:=nullif(p_request->>'amountMax','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  if p_request?'amountMaxExclusive' then
    if v_action<>'aggregate' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then
      raise exception using errcode='22023',message='invalid_range';
    end if;
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  -- Fee evidence is stricter than the legacy display projection. In particular
  -- a country-default AR currency is not source currency proof.
  v_fee_country:=v_platform.scope_group;
  if v_platform.source='ar' then
    v_fee_currency_proven:=exists(select 1 from public.ar_config_targets t
      where t.source_system='AR' and t.country_code=v_platform.scope_group and t.platform=v_platform.source_name
        and nullif(btrim(t.currency),'') is not null and t.currency=v_platform.currency);
  elsif v_platform.source in ('newar','wg') then
    -- These adapters project each order's explicit native currency.
    v_fee_currency_proven:=true;
  elsif v_platform.source='lg' then
    -- Existing confirmed LG adapters have an explicit currency contract; no
    -- generic country fallback or unknown-country adapter may price orders.
    v_fee_currency_proven:=case v_platform.scope_group when 'PH' then v_platform.currency='PHP'
      when 'ID' then v_platform.currency='IDR' when 'PK' then v_platform.currency='PKR' else false end;
  elsif v_platform.source='game66' then
    -- GAME66's source scope identifies the owning team, while its native
    -- monetary unit is explicitly INR. Authorization still uses that scope.
    v_fee_country:='IN';
    v_fee_currency_proven:=v_platform.scope_group in ('HK_TEAM','RED_CRAB') and v_platform.currency='INR';
  end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit not in (20,30,50,100,500)
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status not in ('all','success','pending','failed','rejected','unknown') then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg')) then
    raise exception using errcode='22023',message='unsupported_filter';
  end if;
  foreach v_key in array array['providers','channelTypes'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb then
      if jsonb_typeof(p_request->v_key)<>'array' or jsonb_array_length(p_request->v_key)>2000 then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
      if exists(select 1 from jsonb_array_elements(p_request->v_key) a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_request->'providers')='array' then select array_agg(value) into v_providers from jsonb_array_elements_text(p_request->'providers'); end if;
  if jsonb_typeof(p_request->'channelTypes')='array' then select array_agg(value) into v_types from jsonb_array_elements_text(p_request->'channelTypes'); end if;
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source in ('newar','game66'),'utr',false,'historicalFees',true,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source in ('newar','game66'));
  if v_platform.source='wg' then
    if v_status='success' and v_direction<>'charge' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'sourceName',v_platform.source_name,
    'scopeGroup',v_platform.scope_group,'country',v_platform.country,'team',v_platform.team,
    'timezone',v_platform.timezone,'currency',v_platform.currency,'capabilities',v_capabilities);
  -- All branches project an explicit safe allowlist. No raw JSON, contact,
  -- account/UPI fields, comments, free text, or credentials are selected.
  if v_platform.source='ar' then
    -- Read the small, platform-scoped confirmation map once, outside the order scan.
    -- Optional for older installations; ordinary unknown records remain unknown.
    if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
      execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
        from private.dashboard_admin_order_provider_confirmations
        where source_system=$1 and country_code=$2 and platform=$3 and active'
        into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
    end if;
    v_source:=$q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        null::text as system_order_id,a.order_no as order_number,null::text as third_party_order_number,a.member_id,
        case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
          and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
          else coalesce(nullif(btrim(a.raw_channel),''),$24->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,
        case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.status,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case when a.status='已通过' then 'success' when a.status='已提交' then 'pending'
          when a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消') then 'rejected'
          when a.status in ('失败','提现失败','出款失败') then case when coalesce(btrim(a.raw_channel),'') in ('','人工取消') then 'rejected' else 'failed' end
          else 'unknown' end end as status_group,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
    -- custom_ar_date_union_v1: index each clock, retain each source row once.
    if position($ar_guard$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_guard$ in v_source)=0 then raise exception using errcode='55000',message='analytical_query_contract_drift';end if;
      v_source:=replace(v_source,$ar_old$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
    if v_action='aggregate' or v_status='success' then
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then
    v_source:=$q$
      select n.id,n.source_id as system_order_id,n.order_number,n.third_party_order_number,n.member_id,
        case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
          when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.dataset as direction,n.status_code as status,
        case when n.dataset='withdraw' and n.status_group='failed' and coalesce(btrim(n.provider),'') in ('','人工取消') then 'rejected'
          when n.status_group in ('success','pending','failed','rejected') then n.status_group else 'unknown' end as status_group,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.currency,n.received_at as synced_at,null::text as utr,n.provider as raw_provider
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$22 and n.dataset=any(case $7 when 'all' then array['charge','withdraw'] else array[$7] end)
        and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  elsif v_platform.source='lg' then
    -- LG timestamps are already timestamptz; never reinterpret them as local
    -- timestamps or restrict paid events to the creation-day stat_date.
    v_source:=$q$
      select md5(jsonb_build_array('LG',l.country_code,l.platform,l.order_kind,l.order_no)::text)::uuid as id,
        null::text as system_order_id,l.order_no as order_number,null::text as third_party_order_number,l.member_id,
        coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(l.payment_method),''),'其他类型') as channel_type,
        case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.status_text as status,
        case when l.status_class in ('success','pending','rejected') then l.status_class else 'unknown' end as status_group,
        l.created_at,case when l.status_class='success' then l.paid_at end as success_at,
        l.metric_amount as amount,l.actual_amount,null::numeric as withdraw_fee,$21::text as currency,
        l.updated_at as synced_at,null::text as utr,l.raw_channel as raw_provider
      from public.lg_orders l
      where l.country_code=$3 and l.platform=$22 and l.source_system='LG'
        and l.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and l.created_at>=$5 and l.created_at<$6)
          or (($19='aggregate' or $8='success') and (l.created_at>=$5 and l.created_at<$6
            or (l.status_class='success' and l.paid_at is not null and l.paid_at>=$5 and l.paid_at<$6))))
        and ($9 is null or l.member_id=$9) and ($10 is null or l.order_no=$10)
    $q$;
  elsif v_platform.source='wg' then
    v_source:=private.dashboard_admin_wg_order_source(v_utr,false);
  elsif v_platform.source='game66' then
    v_source:=$q$
      select c.id,null::text as system_order_id,c.order_num as order_number,c.out_trade_no as third_party_order_number,c.uid as member_id,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        'charge'::text as direction,coalesce(nullif(c.status_text,''),c.status_code) as status,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end else 'unknown' end as status_group,
        c.create_time as created_at,case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        'INR'::text as currency,c.last_seen_at as synced_at,null::text as utr,c.pay_method_name as raw_provider
      from public.game66_charge_orders c where c.platform_id=$1 and $7 in ('all','charge')
        and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))
        and ($9 is null or c.uid=$9)
        and ($10 is null or c.order_num=$10) and ($23 is null or c.out_trade_no=$23)
      union all
      select w.id,null::text,w.order_num,w.out_trade_no,w.uid,
        case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),'withdraw',coalesce(nullif(w.status_text,''),w.status_code),
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then case when coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then 'rejected' else 'failed' end when '-1' then 'rejected' else 'unknown' end,
        w.create_time,case when w.status_code='3' then w.update_time end,coalesce(w.amount_display,w.amount_minor/100.0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0),coalesce(w.fee_display,w.fee_minor/100.0),
        'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)
      from public.game66_withdraw_orders w where w.platform_id=$1 and $7 in ('all','withdraw')
        and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  else
    raise exception using errcode='22023',message='unsupported_source';
  end if;
  -- Group and page the identical materialized, filtered source set. The old
  -- detail RPC is never paged repeatedly to manufacture aggregate totals.
  -- Details lets PostgreSQL inline the shared predicate: COUNT can prune all
  -- display/time calculations, and the page can use source time indexes.
  -- Aggregate materializes only compact analytical values (no order IDs/MD5).
  v_sql:='with orders as ('||v_source||'), filtered as '||
    case when v_action='details' then 'not materialized' else 'materialized' end||$q$ (
    select case when $19<>'aggregate' then id end as id,
      case when $19<>'aggregate' then system_order_id end as system_order_id,
      case when $19<>'aggregate' then order_number end as order_number,
      case when $19<>'aggregate' then third_party_order_number end as third_party_order_number,
      case when $19<>'aggregate' then member_id end as member_id,provider,
      case when $19<>'aggregate' then raw_provider end as raw_provider,
      case when $19<>'aggregate' then channel_type end as channel_type,direction,
      case when $19<>'aggregate' then status end as status,status_group,
      created_at,success_at,case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,
      case when $19<>'aggregate' and actual_amount::text not in ('NaN','Infinity','-Infinity') then actual_amount end as actual_amount,
      case when $19<>'aggregate' and withdraw_fee::text not in ('NaN','Infinity','-Infinity') then withdraw_fee end as withdraw_fee,
      currency,synced_at,utr,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (success_at >= $5 and success_at < $6) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (success_at at time zone $4)::date as success_local_date,
      extract(hour from success_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      -- Disjoint amount ranges with the labels used by the admin UI. Integer
      -- boundaries are explicit: 100–200, 201–300, and so on. Every order
      -- remains in exactly one range; low/missing values stay visible.
      case when (case when direction='charge' then $25::numeric[] else $26::numeric[] end) is not null then case
        when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<(case when direction='charge' then $25::numeric[] else $26::numeric[] end)[1] then 'below'
        when amount>(case when direction='charge' then $25::numeric[] else $26::numeric[] end)[11] then 'above'
        else 'band:'||(least(width_bucket(amount,(case when direction='charge' then $25::numeric[] else $26::numeric[] end)),10)-1)::text end
        else case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms,
      case when direction='withdraw' and status_group='pending' and created_at<=$20 then extract(epoch from $20-created_at)*1000 end as pending_wait_ms
    from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
  ), fee_subjects as materialized (
    select distinct direction,currency,provider from filtered where $19<>'details' and status_group='success' and success_in_range
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',count(v.effective_from) filter(where f.amount>=0),
      'fee_version_unmatched_count',count(*)-count(v.effective_from) filter(where f.amount>=0),
      'fee_version_estimated_amount',(sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0))::text,
      'fee_version_state',case when count(v.effective_from) filter(where f.amount>=0)=count(*) then 'complete'
        when count(v.effective_from) filter(where f.amount>=0)>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
    group by f.direction,f.currency,f.provider
  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), created_metrics as (
    select direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,
      case when grouping(local_date)=0 then 'daily' when grouping(local_hour,amount_bucket)=0 then 'matrix'
        when grouping(local_hour,amount_range_bucket)=0 then 'matrix_range'
        when grouping(local_hour)=0 then 'hourly' when grouping(amount_bucket)=0 then 'amount'
        when grouping(amount_range_bucket)=0 then 'amount_range'
        when grouping(provider)=0 then 'provider' else 'summary' end as kind,
      count(*) as all_count,case when count(amount)=count(*) then sum(amount) end as all_amount,
      count(*) filter(where amount is null) as missing_amount_count,
      count(*) filter(where amount<0) as negative_amount_count,
      count(*) filter(where status_group='success') as created_success_count,
      0::bigint as success_count,0::numeric as success_amount,
      count(*) filter(where status_group='pending') as pending_count,
      case when count(amount) filter(where status_group='pending')=count(*) filter(where status_group='pending') then coalesce(sum(amount) filter(where status_group='pending'),0) end as pending_amount,
      count(*) filter(where status_group='failed') as failed_count,
      case when count(amount) filter(where status_group='failed')=count(*) filter(where status_group='failed') then coalesce(sum(amount) filter(where status_group='failed'),0) end as failed_amount,
      count(*) filter(where status_group='rejected') as rejected_count,
      case when count(amount) filter(where status_group='rejected')=count(*) filter(where status_group='rejected') then coalesce(sum(amount) filter(where status_group='rejected'),0) end as rejected_amount,
      count(*) filter(where status_group='unknown') as unknown_count,
      case when count(amount) filter(where status_group='unknown')=count(*) filter(where status_group='unknown') then coalesce(sum(amount) filter(where status_group='unknown'),0) end as unknown_amount,
      max(synced_at) as latest_synced_at
    from filtered where $19<>'details' and created_in_range and $8<>'success'
    group by grouping sets ((direction,currency),(direction,currency,provider),
      (direction,currency,provider,local_date),(direction,currency,local_hour),
      (direction,currency,amount_bucket),(direction,currency,local_hour,amount_bucket),
      (direction,currency,amount_range_bucket),(direction,currency,local_hour,amount_range_bucket))
  ), success_metrics as (
    select direction,currency,provider,success_local_date as local_date,success_local_hour as local_hour,amount_bucket,amount_range_bucket,
      case when grouping(success_local_date)=0 then 'daily' when grouping(success_local_hour,amount_bucket)=0 then 'matrix'
        when grouping(success_local_hour,amount_range_bucket)=0 then 'matrix_range'
        when grouping(success_local_hour)=0 then 'hourly' when grouping(amount_bucket)=0 then 'amount'
        when grouping(amount_range_bucket)=0 then 'amount_range'
        when grouping(provider)=0 then 'provider' else 'summary' end as kind,
      case when $8='success' then count(*) else 0 end as all_count,
      case when $8='success' then case when count(amount)=count(*) then sum(amount) end else 0 end as all_amount,
      case when $8='success' then count(*) filter(where amount is null) else 0 end as missing_amount_count,
      case when $8='success' then count(*) filter(where amount<0) else 0 end as negative_amount_count,
      0::bigint as created_success_count,
      count(*) as success_count,
      case when count(amount)=count(*) then coalesce(sum(amount),0) end as success_amount,
      0::bigint as pending_count,0::numeric as pending_amount,
      0::bigint as failed_count,0::numeric as failed_amount,
      0::bigint as rejected_count,0::numeric as rejected_amount,
      0::bigint as unknown_count,0::numeric as unknown_amount,
      max(synced_at) as latest_synced_at
    from filtered where $19<>'details' and status_group='success' and success_in_range and $8 in ('all','success')
    group by grouping sets ((direction,currency),(direction,currency,provider),
      (direction,currency,provider,success_local_date),(direction,currency,success_local_hour),
      (direction,currency,amount_bucket),(direction,currency,success_local_hour,amount_bucket),
      (direction,currency,amount_range_bucket),(direction,currency,success_local_hour,amount_range_bucket))
  ), metrics_raw as (
    select * from created_metrics union all select * from success_metrics
  ), metrics as (
    select direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,kind,
      sum(all_count)::bigint as all_count,
      case when bool_or(all_count>0 and all_amount is null) then null::numeric else coalesce(sum(all_amount),0) end as all_amount,
      sum(missing_amount_count)::bigint as missing_amount_count,
      sum(negative_amount_count)::bigint as negative_amount_count,
      sum(created_success_count)::bigint as created_success_count,
      sum(success_count)::bigint as success_count,
      case when bool_or(success_count>0 and success_amount is null) then null::numeric else coalesce(sum(success_amount),0) end as success_amount,
      sum(pending_count)::bigint as pending_count,
      case when bool_or(pending_count>0 and pending_amount is null) then null::numeric else coalesce(sum(pending_amount),0) end as pending_amount,
      sum(failed_count)::bigint as failed_count,
      case when bool_or(failed_count>0 and failed_amount is null) then null::numeric else coalesce(sum(failed_amount),0) end as failed_amount,
      sum(rejected_count)::bigint as rejected_count,
      case when bool_or(rejected_count>0 and rejected_amount is null) then null::numeric else coalesce(sum(rejected_amount),0) end as rejected_amount,
      sum(unknown_count)::bigint as unknown_count,
      case when bool_or(unknown_count>0 and unknown_amount is null) then null::numeric else coalesce(sum(unknown_amount),0) end as unknown_amount,
      max(latest_synced_at) as latest_synced_at
    from metrics_raw
    group by direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,kind
  ), metric_json as (
    select kind,(to_jsonb(m)-array['kind','local_date','local_hour','amount_bucket','amount_range_bucket','all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'])
      || jsonb_build_object('date',local_date,'hour',local_hour,'bucket',coalesce(amount_range_bucket,amount_bucket),'all_amount',all_amount::text,
        'success_amount',success_amount::text,'pending_amount',pending_amount::text,'failed_amount',failed_amount::text,
        'rejected_amount',rejected_amount::text,'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) || case when m.kind='provider' then coalesce(fv.value,jsonb_build_object('fee_version_matched_count',0,'fee_version_unmatched_count',m.success_count,'fee_version_estimated_amount',case when m.success_count=0 then '0' end,'fee_version_state',case when m.success_count=0 then 'complete' else 'unknown' end)) else '{}'::jsonb end as value
    from metrics m left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider
      left join fee_version_facts fv on m.kind='provider' and fv.direction=m.direction and fv.currency is not distinct from m.currency and fv.provider is not distinct from m.provider
  ), time_bounds(kind,bucket,min_ms,max_ms) as (
    select k.kind,b.* from (values('pending_age'::text),('latency'::text))k(kind)
    cross join (values
      (0,null::numeric,300000::numeric),(1,300000,1800000),(2,1800000,3600000),(3,3600000,10800000),
      (4,10800000,21600000),(5,21600000,43200000),(6,43200000,86400000),
      (7,86400000,172800000),(8,172800000,259200000),(9,259200000,null))b(bucket,min_ms,max_ms)
    where k.kind='pending_age' or $27<>2
    union all select 'latency',b.* from (values
      (0,null::numeric,60000::numeric),(1,60000,180000),(2,180000,300000),
      (3,300000,1800000),(4,1800000,3600000),(5,3600000,10800000),
      (6,10800000,21600000),(7,21600000,43200000),(8,43200000,86400000),
      (9,86400000,172800000),(10,172800000,259200000),(11,259200000,null))b(bucket,min_ms,max_ms)
    where $27=2),
  duration_rows as materialized (
    select direction,currency,amount,
      case when status_group='success' then 'latency'::text else 'pending_age'::text end as kind,
      case when status_group='success' then latency_ms else pending_wait_ms end as duration_ms,
      case when status_group='success' then
        case when success_at is null then 'missing_success_at' when not isfinite(success_at) then 'invalid_success_at'
          when success_at<created_at then 'reversed_time' when success_at>$20 then 'future_success_at' end
        else case when created_at>$20 then 'future_created_at' end end as excluded_reason
    from filtered where $19<>'details' and ((status_group='success' and success_in_range)
      or (direction='withdraw' and status_group='pending' and created_in_range))
  ), duration_summary as (
    select kind,direction,currency,count(*) as candidate_count,
      count(duration_ms) as valid_count,count(*) filter(where duration_ms is null) as excluded_count,
      case when count(amount) filter(where duration_ms is not null)=count(duration_ms)
        then coalesce(sum(amount) filter(where duration_ms is not null),0) end as valid_amount,
      count(*) filter(where duration_ms is not null and amount is null) as missing_amount_count,
      jsonb_build_object('missing_success_at',count(*) filter(where excluded_reason='missing_success_at'),
        'invalid_success_at',count(*) filter(where excluded_reason='invalid_success_at'),
        'reversed_time',count(*) filter(where excluded_reason='reversed_time'),
        'future_success_at',count(*) filter(where excluded_reason='future_success_at'),
        'future_created_at',count(*) filter(where excluded_reason='future_created_at')) as excluded_reasons,
      avg(duration_ms) as mean_ms,percentile_cont(0.5) within group(order by duration_ms) as p50_ms,
      percentile_cont(0.95) within group(order by duration_ms) as p95_ms,max(duration_ms) as max_ms
    from duration_rows group by kind,direction,currency
  ), duration_bucket_totals as materialized (
    -- Classify each valid order once. Maxima are inclusive; subsequent bins
    -- have strict lower bounds. No join of every order to every threshold.
    select kind,direction,currency,
      case when kind='latency' and $27=2 then case when duration_ms<=60000 then 0 when duration_ms<=180000 then 1 when duration_ms<=300000 then 2 else (case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end)+2 end else case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end end as bucket,
      count(*) as count,count(*) filter(where amount is null) as missing_amount_count,
      coalesce(sum(amount),0) as known_amount
    from duration_rows where duration_ms is not null group by 1,2,3,4
  ), duration_bins as materialized (
    select s.kind,s.direction,s.currency,b.bucket,b.min_ms,b.max_ms,coalesce(r.count,0) as count,
      case when coalesce(r.missing_amount_count,0)=0 then coalesce(r.known_amount,0) end as amount,
      s.valid_count,s.valid_amount
    from duration_summary s join time_bounds b on b.kind=s.kind left join duration_bucket_totals r
      on r.kind=s.kind and r.direction=s.direction and r.currency is not distinct from s.currency and r.bucket=b.bucket
  ), duration_thresholds as (
    -- Only ten tiny aggregate bins are scanned here. Excluding the current
    -- inclusive bin makes these cumulative values strictly > threshold.
    select kind,direction,currency,bucket,max_ms as threshold_ms,
      coalesce(sum(count) over tail,0) as count,
      case when count(*) filter(where amount is null) over tail=0 then coalesce(sum(amount) over tail,0) end as amount,
      valid_count,valid_amount
    from duration_bins
    window tail as (partition by kind,direction,currency order by bucket rows between 1 following and unbounded following)
  ), duration_json as (
    select kind,false as cumulative,bucket,(to_jsonb(b)-array['kind','amount','valid_amount'])
      ||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
        'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_bins b
    union all
    select kind,true,bucket,(to_jsonb(t)-array['kind','amount','valid_amount'])
      ||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
        'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end)
    from duration_thresholds t where threshold_ms is not null
  ), duration_custom as (
    select r.direction,r.currency,$28::numeric as min_ms,$29::numeric as max_ms,
      count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)) as count,
      case when count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29) and amount is null)=0
        then coalesce(sum(amount) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)),0) end as amount,
      s.valid_count,s.valid_amount
    from duration_rows r join duration_summary s on s.kind=r.kind and s.direction=r.direction and s.currency is not distinct from r.currency
    where $30 and r.kind='latency' group by r.direction,r.currency,s.valid_count,s.valid_amount
  ), duration_custom_json as (
    select (to_jsonb(c)-array['amount','valid_amount'])||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
      'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_custom c
  ), page as (
    select id,system_order_id,order_number,third_party_order_number,member_id,provider,raw_provider,channel_type,direction,status,status_group,
      created_at,success_at,amount::text,actual_amount::text,withdraw_fee::text,currency,synced_at,utr,latency_ms,pending_wait_ms
    from filtered where $19<>'aggregate'
      and ($8<>'success' or (status_group='success' and success_in_range))
      order by case when $8='success' then success_at else created_at end desc,direction desc,id desc limit $18 offset $17
  ) select jsonb_build_object('total',(select case when $8='success'
      then count(*) filter(where status_group='success' and success_in_range)
      else count(*) filter(where created_in_range) end from filtered),
    'summary',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from metric_json where kind='summary'),'[]'::jsonb),
    'groups',jsonb_build_object(
      'provider',coalesce((select jsonb_agg(value order by value->>'provider',value->>'direction',value->>'currency') from metric_json where kind='provider'),'[]'::jsonb),
      'daily',coalesce((select jsonb_agg(value order by value->>'date',value->>'provider',value->>'direction',value->>'currency') from metric_json where kind='daily'),'[]'::jsonb),
      'hourly',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'direction',value->>'currency') from metric_json where kind='hourly'),'[]'::jsonb),
      'amount',coalesce((select jsonb_agg(value order by value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='amount'),'[]'::jsonb),
      'matrix',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='matrix'),'[]'::jsonb),
      'amount_range',coalesce((select jsonb_agg(value order by value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='amount_range'),'[]'::jsonb),
      'matrix_range',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='matrix_range'),'[]'::jsonb),
      'latency',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='latency' and not cumulative),'[]'::jsonb),
      'latency_thresholds',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='latency' and cumulative),'[]'::jsonb),
      'pending_age',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='pending_age' and not cumulative),'[]'::jsonb),
      'pending_age_thresholds',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='pending_age' and cumulative),'[]'::jsonb))
      ||case when $30 then jsonb_build_object('latency_custom',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from duration_custom_json),'[]'::jsonb)) else '{}'::jsonb end,
    'latencySummary',coalesce((select jsonb_agg((to_jsonb(s)-array['kind','valid_amount'])||jsonb_build_object('valid_amount',valid_amount::text) order by direction,currency) from duration_summary s where kind='latency'),'[]'::jsonb),
    'pendingSummary',coalesce((select jsonb_agg((to_jsonb(s)-array['kind','valid_amount'])||jsonb_build_object('valid_amount',valid_amount::text) order by direction,currency) from duration_summary s where kind='pending_age'),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by case when $8='success' then success_at else created_at end desc,direction desc,id desc) from page p),'[]'::jsonb))
  $q$;

  -- Provider pages do not need the eight chart grouping sets or duration bins.
  -- Reuse exactly the same scoped source and predicates, with two grouping sets.
  if p_request->>'view'='providers' and v_action='aggregate' then
    if v_status<>'all' then raise exception using errcode='22023',message='unsupported_filter';end if;
    v_sql:='with orders as ('||v_source||$q$), filtered as materialized (
      select direction,currency,provider,status_group,created_at,success_at,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (created_at >= $5 and created_at < $6) as created_in_range,
        (success_at >= $5 and success_at < $6 and status_group='success') as success_in_range
      from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
    ), fee_subjects as materialized (
    select distinct direction,currency,provider from filtered where $19<>'details' and status_group='success' and success_in_range
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',count(v.effective_from) filter(where f.amount>=0),
      'fee_version_unmatched_count',count(*)-count(v.effective_from) filter(where f.amount>=0),
      'fee_version_estimated_amount',(sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0))::text,
      'fee_version_state',case when count(v.effective_from) filter(where f.amount>=0)=count(*) then 'complete'
        when count(v.effective_from) filter(where f.amount>=0)>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
    group by f.direction,f.currency,f.provider
  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), metric as (
      select direction,currency,provider,case when grouping(provider)=0 then 'provider' else 'summary' end as kind,
        count(*) filter(where created_in_range) as all_count,
        case when count(*) filter(where created_in_range and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range),0) end as all_amount,
        count(*) filter(where created_in_range and amount is null) as missing_amount_count,
        count(*) filter(where created_in_range and amount<0) as negative_amount_count,
        count(*) filter(where created_in_range and status_group='success') as created_success_count,
        count(*) filter(where success_in_range) as success_count,
        case when count(*) filter(where success_in_range and amount is null)=0
          then coalesce(sum(amount) filter(where success_in_range),0) end as success_amount,
        count(*) filter(where created_in_range and status_group='pending') as pending_count,
        case when count(*) filter(where created_in_range and status_group='pending' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='pending'),0) end as pending_amount,
        count(*) filter(where created_in_range and status_group='failed') as failed_count,
        case when count(*) filter(where created_in_range and status_group='failed' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='failed'),0) end as failed_amount,
        count(*) filter(where created_in_range and status_group='rejected') as rejected_count,
        case when count(*) filter(where created_in_range and status_group='rejected' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='rejected'),0) end as rejected_amount,
        count(*) filter(where created_in_range and status_group='unknown') as unknown_count,
        case when count(*) filter(where created_in_range and status_group='unknown' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='unknown'),0) end as unknown_amount,
        max(synced_at) as latest_synced_at
      from filtered group by grouping sets ((direction,currency),(direction,currency,provider))
    ), output as (
      select kind,(to_jsonb(m)-'kind')||jsonb_build_object('all_amount',all_amount::text,
        'success_amount',success_amount::text,'pending_amount',pending_amount::text,
        'failed_amount',failed_amount::text,'rejected_amount',rejected_amount::text,
        'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) || case when m.kind='provider' then coalesce(fv.value,jsonb_build_object('fee_version_matched_count',0,'fee_version_unmatched_count',m.success_count,'fee_version_estimated_amount',case when m.success_count=0 then '0' end,'fee_version_state',case when m.success_count=0 then 'complete' else 'unknown' end)) else '{}'::jsonb end as value from metric m
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider
      left join fee_version_facts fv on m.kind='provider' and fv.direction=m.direction and fv.currency is not distinct from m.currency and fv.provider is not distinct from m.provider
    ) select jsonb_build_object('total',(select count(*) from filtered where created_in_range),
      'summary',coalesce((select jsonb_agg(value) from output where kind='summary'),'[]'::jsonb),
      'groups',jsonb_build_object('provider',coalesce((select jsonb_agg(value order by value->>'provider')
        from output where kind='provider'),'[]'::jsonb)),'rows','[]'::jsonb)
    $q$;
  end if;

  execute v_sql into v_result using v_id,v_platform.name,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_fee_country,v_fee_currency_proven;
  if v_action='details' then
    v_result:=jsonb_set(v_result,'{rows}',coalesce((select jsonb_agg(x||private.dashboard_admin_fee_quote(v_fee_country,v_platform.name,
      x->>'provider',x->>'direction',case when v_fee_currency_proven then x->>'currency' end,(x->>'created_at')::timestamptz,(x->>'amount')::numeric) order by n)
      from jsonb_array_elements(v_result->'rows') with ordinality t(x,n)),'[]'::jsonb));
  end if;
  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;
  return v_result||case when v_duration_version=2 then jsonb_build_object('durationVersion',2)
      ||case when v_duration_custom then jsonb_build_object('durationRange',v_duration->'range') else '{}'::jsonb end else '{}'::jsonb end
    ||case when v_amount_bands is null then '{}'::jsonb else jsonb_build_object('amountBands',v_amount_bands,'amountBandsVersion',1) end
    ||jsonb_build_object('version',1,'platform',v_meta,'basis','mixed_created_success','startAt',v_start,'endAt',v_end,
    'asOf',v_asof,'offset',v_offset,'limit',v_limit,'hasMore',(v_result->>'total')::bigint>v_offset::bigint+v_limit,
    'capabilities',v_capabilities);
end;
$function$;$definition_0$;
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target) is distinct from metadata then raise exception 'fee_function_metadata_changed';end if;
 if (select md5(prosrc) from pg_proc where oid=target)<>'e192ebc8fd9947a4f893264e6d15023b' then raise exception 'fee_function_candidate_hash';end if;
end $patch_0$;

do $patch_1$
declare target regprocedure:='private.dashboard_admin_live_rates(jsonb)'::regprocedure;p pg_proc%rowtype;metadata jsonb;
begin
 select * into p from pg_proc where oid=target;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' or not p.prosecdef
 or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""'] then raise exception 'fee_function_metadata_drift';end if;
 if md5(p.prosrc)<>'936c6643a66e0782d3f4c3e5697b22b2' then raise exception 'fee_function_baseline_drift: private.dashboard_admin_live_rates(jsonb)';end if;
 metadata:=to_jsonb(p)-'prosrc';
 execute $definition_1$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_rates(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb := private.dashboard_admin_live_scope();
  v_type text; v_country text; v_platform text; v_provider text; v_query text;
  v_offset integer; v_limit integer; v_key text; v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384 then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
    'scopeType','country','platform','provider','query','offset','limit'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['scopeType','country','platform','provider','query'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200
       or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  foreach v_key in array array['offset','limit'] loop
    if p_request ? v_key and (jsonb_typeof(p_request->v_key)<>'number'
      or p_request->>v_key !~ '^[0-9]{1,7}$') then
      raise exception using errcode='22023',message='invalid_pagination';
    end if;
  end loop;
  v_type:=coalesce(p_request->>'scopeType','all');
  v_country:=nullif(p_request->>'country','');
  v_platform:=nullif(p_request->>'platform','');
  v_provider:=nullif(p_request->>'provider','');
  v_query:=nullif(btrim(p_request->>'query'),'');
  v_offset:=coalesce((p_request->>'offset')::integer,0);
  v_limit:=coalesce((p_request->>'limit')::integer,20);
  if v_type not in ('all','country','platform') then
    raise exception using errcode='22023',message='invalid_scope_type';
  end if;
  if v_limit not in (20,30,50,100,500) or v_offset>1000000 then
    raise exception using errcode='22023',message='invalid_pagination';
  end if;
  -- These small configuration tables are intentionally separate rows. A generic
  -- country row is not a platform override and neither side is a fee history.
  with allowed_rows as materialized (
    select 'country:'||r.id as id,r.id as source_id,'country'::text as scope_type,
      r.country,private.dashboard_data_group(r.country,'') as scope_group,null::text as platform,
      r.third_party as provider,r.category,r.collect_fee,r.payout_fee,r.total_fee,
      r.collect_single_fee,r.payout_single_fee,r.collect_limit,r.payout_limit,
      r.status,null::text as raw_status,r.sheet_name,r.source_row,null::integer as source_column,r.updated_at
    from public.third_party_rates r
    where private.dashboard_scope_allows(v_scope,r.country,'')
    union all
    select 'platform:'||p.id,p.id,'platform'::text,
      p.country,private.dashboard_data_group(p.country,p.platform),p.platform,
      p.third_party,p.category,p.collect_fee,p.payout_fee,p.total_fee,
      p.collect_single_fee,p.payout_single_fee,p.collect_limit,p.payout_limit,
      p.status,p.raw_status,p.sheet_name,p.source_row,p.source_column,p.updated_at
    from public.third_party_platform_status p
    where private.dashboard_scope_allows(v_scope,p.country,p.platform)
  ), filtered as materialized (
    select * from allowed_rows a
    where (v_type='all' or a.scope_type=v_type)
      and (v_country is null or a.scope_group=v_country)
      and (v_platform is null or a.platform=v_platform)
      and (v_provider is null or a.provider=v_provider)
      -- Literal substring, not LIKE wildcard or fuzzy/canonical alias matching.
      and (v_query is null or strpos(lower(a.provider),lower(v_query))>0)
  ), page as materialized (
    select * from filtered order by scope_group nulls last,platform nulls first,provider nulls last,category nulls last,id
    offset v_offset limit v_limit
  ), type_sources as materialized (
    select q.sheet_name,t.* from (
      select sheet_name,array_agg(distinct source_row) as source_rows from page
      where sheet_name is not null and source_row is not null group by sheet_name
    ) q cross join lateral private.dashboard_admin_rate_type_sources(q.sheet_name,q.source_rows) t
  )
  select jsonb_build_object(
    'version',1,'asOf',statement_timestamp(),'basis','current_rate_table',
    'total',(select count(*) from filtered),'offset',v_offset,'limit',v_limit,
    'hasMore',(select count(*) from filtered)>v_offset::bigint+v_limit,
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'sourceId',p.source_id,'scopeType',p.scope_type,
      'country',p.country,'scopeGroup',p.scope_group,'platform',p.platform,'provider',p.provider,
      'category',p.category,'collectFee',p.collect_fee,'payoutFee',p.payout_fee,'totalFee',p.total_fee,
      'collectSingleFee',p.collect_single_fee,'payoutSingleFee',p.payout_single_fee,
      'collectLimit',p.collect_limit,'payoutLimit',p.payout_limit,
      'status',p.status,'rawStatus',p.raw_status,'sheetName',p.sheet_name,
      'sourceRow',p.source_row,'sourceColumn',p.source_column,'updatedAt',p.updated_at,
      'sourceType',t.source_type,'sourceTypeProvider',t.source_type_provider,'sourceTypeCell',t.source_type_cell,
      'sourceTypeHeader',t.source_type_header,'sourceTypeSheetId',t.source_type_sheet_id,
      'sourceTypeCollectedAt',t.source_type_collected_at,
      'feeEffective',coalesce((select jsonb_object_agg(e.direction,jsonb_build_object('state',e.state,'effectiveFrom',e.effective_from,
        'versionId',e.version_id,'source',e.provenance)) from private.fee_rate_current_evidence e where e.source_id=p.source_id),'{}'::jsonb)
    ) order by p.scope_group nulls last,p.platform nulls first,p.provider nulls last,p.category nulls last,p.id)
      from page p left join type_sources t on t.sheet_name=p.sheet_name and t.source_row=p.source_row),'[]'::jsonb),
    'options',jsonb_build_object(
      'countries',coalesce((select jsonb_agg(jsonb_build_object('value',o.scope_group,'label',o.country)
        order by o.scope_group,o.country) from (select scope_group,min(country) as country from allowed_rows
        where scope_group is not null and scope_group<>'' and country is not null group by scope_group) o),'[]'::jsonb),
      'platforms',coalesce((select jsonb_agg(jsonb_build_object('value',o.platform,'country',o.country,'scopeGroup',o.scope_group)
        order by o.scope_group,o.platform) from (select distinct platform,country,scope_group from allowed_rows
        where platform is not null and platform<>'') o),'[]'::jsonb),
      'providers',coalesce((select jsonb_agg(o.provider order by o.provider) from
        (select distinct provider from allowed_rows where provider is not null and provider<>'') o),'[]'::jsonb)
    ),
    'capabilities',jsonb_build_object('historicalFeeVersions',true,'feeEstimate',false,'historicalFeeBasis','order_created_at',
      'providerMatching','exact_raw_name','tierHandling','raw_not_averaged')
  ) into v_result;
  return v_result;
end;
$function$;$definition_1$;
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target) is distinct from metadata then raise exception 'fee_function_metadata_changed';end if;
 if (select md5(prosrc) from pg_proc where oid=target)<>'0174c5be44fcd4a1b64e974faf535d50' then raise exception 'fee_function_candidate_hash';end if;
end $patch_1$;

do $patch_2$
declare target regprocedure:='private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)'::regprocedure;p pg_proc%rowtype;metadata jsonb;
begin
 select * into p from pg_proc where oid=target;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}' or not p.prosecdef
 or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""'] then raise exception 'fee_function_metadata_drift';end if;
 if md5(p.prosrc)<>'b721fa3e499b217f76c67babb02cf17e' then raise exception 'fee_function_baseline_drift: private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)';end if;
 metadata:=to_jsonb(p)-'prosrc';
 execute $definition_2$CREATE OR REPLACE FUNCTION private.dashboard_admin_live_remap_groups(p_rows jsonb, p_country text, p_platform text, p_daily boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r jsonb; old_row jsonb; out_rows jsonb := '{}'::jsonb; key text; canonical text;
  k text; n numeric; fields text[] := array['all_count','missing_amount_count','negative_amount_count',
    'success_count','created_success_count','pending_count','failed_count','rejected_count','unknown_count','fee_low_count','fee_high_count','fee_gap_count','fee_unpriced_count','fee_version_matched_count','fee_version_unmatched_count'];
  amount_fields text[] := array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount','fee_low_amount','fee_high_amount','fee_gap_amount','fee_version_estimated_amount'];
begin
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    canonical:=private.dashboard_admin_live_provider_canonical(p_country,p_platform,r->>'provider');
    key:=coalesce(r->>'direction','')||chr(31)||coalesce(r->>'currency','')||chr(31)||coalesce(canonical,'')||
      case when p_daily then chr(31)||coalesce(r->>'date','') else '' end;
    if not (out_rows ? key) then
      out_rows:=out_rows||jsonb_build_object(key,jsonb_set(r,'{provider}',to_jsonb(canonical),true));
    else
      old_row:=out_rows->key;
      foreach k in array fields loop
        if r->>k is null or old_row->>k is null then
          old_row:=jsonb_set(old_row,array[k],'null'::jsonb,true);
        else
          n:=coalesce((old_row->>k)::numeric,0)+coalesce((r->>k)::numeric,0);
          old_row:=jsonb_set(old_row,array[k],to_jsonb(n),true);
        end if;
      end loop;
      if old_row?'fee_version_state' or r?'fee_version_state' then
        old_row:=jsonb_set(old_row,'{fee_version_state}',to_jsonb(case
          when old_row->>'fee_version_unmatched_count'='0' then 'complete'
          when (old_row->>'fee_version_matched_count')::numeric>0 then 'partial' else 'unknown' end));
      end if;
      foreach k in array amount_fields loop
        if k='fee_version_estimated_amount' and (old_row->>'fee_version_matched_count')::numeric>0 then
          n:=coalesce((old_row->>k)::numeric,0)+coalesce((r->>k)::numeric,0);
          old_row:=jsonb_set(old_row,array[k],to_jsonb(n::text),true);
        elsif r->>k is null or old_row->>k is null then
          old_row:=jsonb_set(old_row,array[k],'null'::jsonb,true);
        else
          n:=coalesce((old_row->>k)::numeric,0)+coalesce((r->>k)::numeric,0);
          old_row:=jsonb_set(old_row,array[k],to_jsonb(trim(to_char(n,'FM999999999999999999999999999999990D99999999'))),true);
        end if;
      end loop;
      if coalesce(r->>'latest_synced_at','')>coalesce(old_row->>'latest_synced_at','') then
        old_row:=jsonb_set(old_row,'{latest_synced_at}',to_jsonb(r->>'latest_synced_at'),true);
      end if;
      out_rows:=jsonb_set(out_rows,array[key],old_row,true);
    end if;
  end loop;
  return coalesce((select jsonb_agg(value order by value->>'provider',value->>'direction',value->>'currency',value->>'date') from jsonb_each(out_rows)),'[]'::jsonb);
end;
$function$;$definition_2$;
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target) is distinct from metadata then raise exception 'fee_function_metadata_changed';end if;
 if (select md5(prosrc) from pg_proc where oid=target)<>'4ac16874975fb1d6987fd8c8e4ffa536' then raise exception 'fee_function_candidate_hash';end if;
end $patch_2$;
notify pgrst,'reload schema';
commit;
