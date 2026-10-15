-- Exact background-prepared aggregate results. No source-table rewrite or active cron in this migration.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';

-- BEGIN catalog
create or replace function private.prepared_aggregate_native_catalog()
 RETURNS TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$

begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  return query
  with ar_targets as (
    select md5('ar:'||t.country_code||':'||src.platform)::uuid as id,
      coalesce(m.platform_name,t.platform)::text as name,
      case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end::text as team,
      t.country_name::text as country,t.country_code::text as scope_group,
      'ar'::text as source,
      coalesce(nullif(t.timezone,''),case t.country_code
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta'
        when 'VN' then 'Asia/Ho_Chi_Minh' when 'PH' then 'Asia/Manila'
        when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota'
        when 'MX' then 'America/Mexico_City' when 'CL' then 'America/Santiago'
        else 'Asia/Kolkata' end)::text as timezone,
      coalesce(nullif(t.currency,''),case t.country_code
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP'
        when 'MY' then 'MYR' when 'MM' then 'MMK' when 'NG' then 'NGN'
        when 'CO' then 'COP' when 'MX' then 'MXN' when 'CL' then 'CLP'
        else null end)::text as currency,
      src.platform::text as source_name
    from public.ar_config_targets t
    cross join lateral (
      select case when t.country_code='IN' and upper(btrim(t.platform))='SHREEWIN'
        and not exists(select 1 from public.ar_collected_orders a where a.country_code=t.country_code
          and a.platform=t.platform and a.source_system='AR' and a.order_kind in ('recharge','withdraw') offset 0)
        then 'Shree.Win' else t.platform end as platform
    ) src
    left join public.dashboard_platform_team_map m on m.active
      and m.source_system=case when t.source_system='NEW_AR' then 'NEW_AR' else 'AR' end
      and (m.source_country=t.country_name or m.source_country=t.country_code)
      and upper(btrim(m.source_platform))=upper(btrim(src.platform))
    where true
      and not (t.source_system='NEW_AR' and exists(select 1 from public.newar_detail_platforms n
        where n.platform=t.platform and n.country_code=t.country_code and n.enabled
          and (n.launch_at is null or n.launch_at<=now()) offset 0))
  ),
  ar_mapped_only as (
    select md5('ar:'||m.country_code||':'||m.source_platform)::uuid as id,
      m.platform_name::text as name,case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end::text as team,m.country_name::text as country,
      m.country_code::text as scope_group,'ar'::text as source,
      case m.country_code
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta'
        when 'VN' then 'Asia/Ho_Chi_Minh' when 'PH' then 'Asia/Manila'
        when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota'
        when 'MX' then 'America/Mexico_City' when 'CL' then 'America/Santiago'
        else 'Asia/Kolkata' end::text as timezone,
      case m.country_code
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP'
        when 'MY' then 'MYR' when 'MM' then 'MMK' when 'NG' then 'NGN'
        when 'CO' then 'COP' when 'MX' then 'MXN' when 'CL' then 'CLP'
        else null end::text as currency,
      m.source_platform::text as source_name
    from public.dashboard_platform_team_map m
    where m.active and m.source_system='AR'
      and true
      and not exists(select 1 from public.ar_config_targets t
        where t.country_code=m.country_code
          and upper(btrim(t.platform))=upper(btrim(m.source_platform)))
  )
  select g.id,g.platform_name,case when upper(btrim(g.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else g.team_name end,g.team_name,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
    'game66'::text,'Asia/Kolkata'::text,'INR'::text,g.platform_name
  from public.game66_platforms g
  where true
    and (exists(select 1 from public.game66_charge_orders c where c.platform_id=g.id offset 0)
      or exists(select 1 from public.game66_withdraw_orders w where w.platform_id=g.id offset 0))
  union all
  select ar_targets.id,ar_targets.name,ar_targets.team,ar_targets.country,ar_targets.scope_group,ar_targets.source,ar_targets.timezone,ar_targets.currency,ar_targets.source_name from ar_targets
  union all
  select ar_mapped_only.id,ar_mapped_only.name,ar_mapped_only.team,ar_mapped_only.country,ar_mapped_only.scope_group,ar_mapped_only.source,ar_mapped_only.timezone,ar_mapped_only.currency,ar_mapped_only.source_name from ar_mapped_only
  union all
  select md5('newar:'||n.country_code||':'||n.platform)::uuid,
    coalesce(m.platform_name,n.platform),case when upper(btrim(m.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else m.team_name end,n.country,n.country_code,
    'newar'::text,n.timezone,n.currency,n.platform
  from public.newar_detail_platforms n
  left join public.dashboard_platform_team_map m on m.active and m.source_system='NEW_AR'
    and (m.source_country=n.country or m.source_country=n.country_code)
    and upper(btrim(m.source_platform))=upper(btrim(n.platform))
  where n.enabled and (n.launch_at is null or n.launch_at<=now())
    and true
  union all
  -- Only real current LG order scopes qualify. The historical raw LG/SUPERLG
  -- report mapping is not a PH order scope and cannot create a duplicate row.
  select md5('lg:'||l.country_code||':'||l.platform)::uuid,
    coalesce(m.platform_name,l.platform),m.team_name,
    case l.country_code when 'PH' then '菲律宾' when 'ID' then '印尼' when 'PK' then '巴基斯坦' end,
    l.country_code,'lg'::text,public.lg_country_timezone(l.country_code),
    case l.country_code when 'PH' then 'PHP' when 'ID' then 'IDR' when 'PK' then 'PKR' end,l.platform
  from private.dashboard_admin_live_lg_scopes() l
  left join lateral (
    select t.platform_name,t.team_name from public.dashboard_platform_team_map t
    where t.active and t.source_system='LG' and t.source_platform=l.platform
      and t.country_code=l.country_code and t.source_country in (l.country_code,
        case l.country_code when 'PH' then '菲律宾' when 'ID' then '印尼' when 'PK' then '巴基斯坦' end)
    order by (t.source_country=l.country_code) desc,t.source_country limit 1
  )m on true
  where l.country_code=public.lg_platform_country(l.platform)
    and public.lg_country_timezone(l.country_code) is not null
    and true

  union all
  select md5('WG:'||w.site_code)::uuid,coalesce(m.platform_name,w.platform),m.team_name,w.country,w.country_code,
    'wg'::text,w.timezone,w.currency,w.platform
  from private.dashboard_admin_wg_sites()w
  left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
    where t.active and t.source_system='WG' and t.country_code=w.country_code
      and upper(btrim(t.source_platform))=w.platform
    order by (t.source_country=w.country_code) desc,t.source_country limit 1)m on true
  where true

  union all
  select md5('duoli:ID:'||w.platform)::uuid,coalesce(m.platform_name,w.platform),m.team_name,w.country,w.country_code,
   'duoli'::text,w.timezone,w.currency,w.platform
  from private.dashboard_admin_duoli_sites()w
  left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
   where t.active and t.source_system in('DOLI','REPORT') and t.country_code=w.country_code
    and upper(btrim(t.source_platform))=w.platform
   order by (t.source_system='DOLI') desc,(t.source_country=w.country_code) desc,t.source_country limit 1)m on true
  where true

 union all
 select md5('kb:IN:YASH.BET')::uuid,coalesce(m.platform_name,'YASH.BET'),m.team_name,'印度'::text,'IN'::text,
  'kb'::text,'Asia/Kolkata'::text,'INR'::text,'YASH.BET'::text
 from (values(1))s(n)
 left join lateral(select t.platform_name,t.team_name from public.dashboard_platform_team_map t
  where t.active and t.source_system='KB' and t.country_code='IN' and upper(btrim(t.source_platform))='YASH.BET'
  order by (t.source_country='IN') desc,t.source_country limit 1)m on true
 where true

 union all
 select md5('panda:BR:'||s.platform)::uuid,s.platform_label,
  coalesce(m.team_name,case when private.dashboard_admin_live_is_panghu_platform(s.platform_label) then '胖虎' end),
  '巴西'::text,private.dashboard_data_group('BR',s.platform_label),'panda'::text,'America/Sao_Paulo'::text,'BRL'::text,s.platform_label
 from panda_private.order_scopes s
 left join lateral (select t.team_name from public.dashboard_platform_team_map t
  where t.active and t.source_system='PANDA' and t.source_platform=s.platform_label
   and t.country_code in('BR','BR_PANGHU') order by t.source_country limit 1)m on true
 where s.country_code='BR' and s.currency='BRL' and s.region_id=1 and s.platform in('platform_12601','platform_12609','platform_13610','platform_16615','platform_170','platform_17530','platform_1930841','platform_208','platform_222vip','platform_2231','platform_2250','platform_2269','platform_2279','platform_231','platform_234t','platform_235','platform_2382','platform_2431','platform_2461','platform_2470','platform_2537','platform_2v222','platform_345f','platform_406','platform_428','platform_447','platform_448','platform_45ff','platform_559k','platform_56l','platform_596','platform_609','platform_613','platform_620','platform_647','platform_67vip','platform_723','platform_737','platform_755','platform_756','platform_759','platform_76pp','platform_776f','platform_798','platform_800','platform_801','platform_802','platform_8566bet','platform_888hh','platform_96f','platform_985','platform_987','platform_998','platform_bet5697')
  and true
;
end;
$function$;

-- END catalog

-- BEGIN helpers
-- Transform only the bounded native SQL selected by the audited kernel. This
-- helper is private and no caller-supplied SQL can enter the worker.
create function private.prepared_aggregate_source_clocks(p_sql text,p_source text,p_basis text)
returns text language plpgsql immutable set search_path='' as $$
declare s text:=p_sql;old text;replacement text;col text;target_col text;columns text[];lower_before integer;upper_before integer;lower_after integer;upper_after integer;
begin
 if p_source='ar' then
  s:=replace(s,'a.raw_channel as raw_provider','a.raw_channel as raw_provider,null::timestamptz as source_updated_at');
  s:=regexp_replace(s,'a[.]completed_at([[:space:]]*>=?[[:space:]]*)[(][$]5 at time zone [$]4[)]','a.completed_at\1($35 at time zone $4)','g');
  s:=regexp_replace(s,'a[.]completed_at([[:space:]]*<[[:space:]]*)[(][$]6 at time zone [$]4[)]','a.completed_at\1($36 at time zone $4)','g');
 elsif p_source='newar' then
  s:=replace(s,'n.provider as raw_provider','n.provider as raw_provider,n.source_updated_at');
  col:=case when p_basis='source_updated' then 'n.source_updated_at' else 'n.success_at' end;
  s:=replace(s,'n.success_at is not null',col||' is not null');
  s:=replace(s,'n.success_at>=$5',col||'>=$35');s:=replace(s,'n.success_at<$6',col||'<$36');
 elsif p_source='lg' then
  s:=replace(s,'l.raw_channel as raw_provider','l.raw_channel as raw_provider,null::timestamptz as source_updated_at');
  s:=replace(s,'l.paid_at>=$5','l.paid_at>=$35');s:=replace(s,'l.paid_at<$6','l.paid_at<$36');
 elsif p_source='kb' then
  -- YASH has no order-update clock. Its completion clock stays native.
  s:=replace(s,'as raw_provider','as raw_provider,null::timestamptz as source_updated_at');
  s:=regexp_replace(s,'y[.]completed_at([[:space:]]*>=[[:space:]]*)[$]5','y.completed_at\1$35','g');
  s:=regexp_replace(s,'y[.]completed_at([[:space:]]*<[[:space:]]*)[$]6','y.completed_at\1$36','g');
  s:=regexp_replace(s,'t[.]success_at([[:space:]]*>=[[:space:]]*)[$]5','t.success_at\1$35','g');
  s:=regexp_replace(s,'t[.]success_at([[:space:]]*<[[:space:]]*)[$]6','t.success_at\1$36','g');
 elsif p_source='duoli' then
  s:=replace(s,'private.dashboard_admin_duoli_provider(d.provider_code) as raw_provider','private.dashboard_admin_duoli_provider(d.provider_code) as raw_provider,d.updated_at as source_updated_at');
  s:=regexp_replace(s,'d[.]updated_at([[:space:]]*>=[[:space:]]*)[$]5','d.updated_at\1$35','g');
  s:=regexp_replace(s,'d[.]updated_at([[:space:]]*<[[:space:]]*)[$]6','d.updated_at\1$36','g');
  s:=regexp_replace(s,'t[.]success_at([[:space:]]*>=[[:space:]]*)[$]5','t.success_at\1$35','g');
  s:=regexp_replace(s,'t[.]success_at([[:space:]]*<[[:space:]]*)[$]6','t.success_at\1$36','g');
 elsif p_source='wg' then
  s:=replace(s,'w.provider as raw_provider','w.provider as raw_provider,w.updated_at as source_updated_at');
  col:=case when p_basis='source_updated' then 'w.updated_at' else 'w.success_at' end;
  s:=replace(s,'w.success_at>=$5',col||'>=$35');s:=replace(s,'w.success_at<$6',col||'<$36');
 elsif p_source='game66' then
  s:=replace(s,'c.pay_method_name as raw_provider','c.pay_method_name as raw_provider,null::timestamptz as source_updated_at');
  s:=replace(s,$x$'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)$x$,$x$'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name),w.update_time$x$);
  s:=replace(s,'c.pay_time>=$5','c.pay_time>=$35');s:=replace(s,'c.pay_time<$6','c.pay_time<$36');
  s:=replace(s,'w.update_time>=$5','w.update_time>=$35');s:=replace(s,'w.update_time<$6','w.update_time<$36');
 elsif p_source='panda' then
  -- Legacy source only guarantees created-window membership. Never invent
  -- success/update coverage; unsupported explicit modes are rejected earlier.
  s:=replace(s,'private.dashboard_admin_panda_provider(o.provider_name) raw_provider','private.dashboard_admin_panda_provider(o.provider_name) raw_provider,o.source_updated_at');
 else raise exception using errcode='22023',message='prepared_source_unsupported';end if;
 if s=p_sql or position('source_updated_at' in s)=0 then raise exception using errcode='55000',message='prepared_source_clock_contract_drift';end if;
 -- Each native secondary predicate must be rebound on both sides. Do not
 -- publish after a future source-helper change only partially matches a patch.
 columns:=case p_source when 'ar'then array['a.completed_at']when 'newar'then array['n.success_at']when 'lg'then array['l.paid_at']when 'kb'then array['y.completed_at','t.success_at']when 'duoli'then array['d.updated_at','t.success_at']when 'wg'then array['w.success_at']when 'game66'then array['c.pay_time','w.update_time']else array[]::text[]end;
 foreach col in array columns loop
  target_col:=case when p_basis='source_updated'and p_source='newar'then'n.source_updated_at'when p_basis='source_updated'and p_source='wg'then'w.updated_at'else col end;
  old:=replace(col,'.','[.]');replacement:=replace(target_col,'.','[.]');
  select count(*)into lower_before from regexp_matches(p_sql,old||'[[:space:]]*>=[[:space:]]*[(]?[[:space:]]*[$]5([^0-9]|$)','g');
  select count(*)into upper_before from regexp_matches(p_sql,old||'[[:space:]]*<[[:space:]]*[(]?[[:space:]]*[$]6([^0-9]|$)','g');
  select count(*)into lower_after from regexp_matches(s,replacement||'[[:space:]]*>=[[:space:]]*[(]?[[:space:]]*[$]35([^0-9]|$)','g');
  select count(*)into upper_after from regexp_matches(s,replacement||'[[:space:]]*<[[:space:]]*[(]?[[:space:]]*[$]36([^0-9]|$)','g');
  if lower_before=0 or upper_before=0 or lower_before<>lower_after or upper_before<>upper_after
   or s~(old||'[[:space:]]*(>=|<)[[:space:]]*[(]?[[:space:]]*[$][56]([^0-9]|$)')then raise exception using errcode='55000',message='prepared_source_clock_predicate_drift';end if;
 end loop;

 return s;
end;$$;

-- Validate every key before admission. Keeping the exact jsonb in the unique
-- key means omitted/defaulted fields never collide with explicit filters.
create function private.prepared_aggregate_request_reason(q jsonb,t jsonb)
returns text language plpgsql stable set search_path='' as $$
declare k text;a timestamptz;b timestamptz;c timestamptz;d timestamptz;s text:=t->>'source';basis text:=q->>'successBasis';direction text:=coalesce(q->>'direction','all');n numeric;
begin
 if q is null or jsonb_typeof(q)<>'object' or octet_length(q::text)>32768
  or q->>'action' is distinct from 'aggregate' or coalesce(q->>'view','full')not in('providers','full')
  or q->>'platformId' is distinct from t->>'id' or t->>'source' not in('ar','newar','lg','game66','wg','duoli','kb','panda') then return 'unsupported_request';end if;
 if exists(select 1 from jsonb_object_keys(q)x where x<>all(array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','amountBands','durationVersion','durationRange','offset','limit'])) then return 'unsupported_filter';end if;
 foreach k in array array['startAt','endAt','successStartAt','successEndAt'] loop
  if k in('startAt','endAt') or q?k then
   if jsonb_typeof(q->k)is distinct from 'string' or q->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then return 'invalid_time';end if;
  end if;
 end loop;
 a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;c:=coalesce(q->>'successStartAt',q->>'startAt')::timestamptz;d:=coalesce(q->>'successEndAt',q->>'endAt')::timestamptz;
 if not(isfinite(a)and isfinite(b)and isfinite(c)and isfinite(d))or a>=b or c>=d or b-a>interval'32days'or d-c>interval'32days'or ((b-interval'1microsecond')at time zone(t->>'timezone'))::date-(a at time zone(t->>'timezone'))::date>30 or ((d-interval'1microsecond')at time zone(t->>'timezone'))::date-(c at time zone(t->>'timezone'))::date>30 then return 'invalid_time_range';end if;
 if (q?'successStartAt')<>(q?'successEndAt') or (q?'successBasis' and (jsonb_typeof(q->'successBasis')is distinct from 'string' or basis not in('success','source_updated'))) then return 'invalid_success_clock';end if;
 if coalesce(q->>'view','full')='providers'and coalesce(q->>'status','all')<>'all'then return'unsupported_providers_status';end if;
 if direction not in('all','charge','withdraw')or coalesce(q->>'status','all')not in('all','success','pending','failed','rejected','unknown') then return 'invalid_status_or_direction';end if;
 foreach k in array array['providers','channelTypes']loop
  if q?k and q->k<>'null'::jsonb then
   if jsonb_typeof(q->k)<>'array'or jsonb_array_length(q->k)>200 or exists(select 1 from jsonb_array_elements(q->k)x where jsonb_typeof(x)<>'string'or length(x#>>'{}')not between 1 and 200 or x#>>'{}'~'[[:cntrl:]]')then return 'invalid_filter';end if;
  end if;
 end loop;
 if q?'currency'and q->'currency'<>'null'::jsonb and(jsonb_typeof(q->'currency')<>'string'or length(q->>'currency')>16)then return 'invalid_currency';end if;
 foreach k in array array['amountMin','amountMax']loop if q?k and q->k<>'null'::jsonb then n:=(q->>k)::numeric;if n::text in('NaN','Infinity','-Infinity')then return 'invalid_amount';end if;end if;end loop;
 if (q->>'amountMin')::numeric>(q->>'amountMax')::numeric or (q->>'amountMaxExclusive')::boolean and(q->>'amountMin')::numeric>=(q->>'amountMax')::numeric then return 'invalid_amount';end if;
 if q?'amountMaxExclusive'and(jsonb_typeof(q->'amountMaxExclusive')<>'boolean'or q->>'amountMax'is null)then return 'invalid_amount';end if;
 if q?'offset'and coalesce(q->>'offset','')<>'0'then return 'unsupported_offset';end if;
 if q?'limit'and coalesce(q->>'limit','')not in('20','30','50','100','500')then return 'invalid_limit';end if;
 perform private.dashboard_admin_validate_duration(q);perform private.dashboard_admin_validate_amount_bands(q->'amountBands',direction);
 return null;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then return 'invalid_filter';
end;$$;

-- Capability failures affect only the secondary metrics, never known created
-- metrics. Native observed/received/ingested timestamps are not source clocks.
create function private.prepared_aggregate_secondary_reason(q jsonb,t jsonb)returns text language plpgsql stable set search_path=''as $$
declare s text:=t->>'source';basis text:=coalesce(q->>'successBasis',case when s='duoli'then 'source_updated'else 'success'end);direction text:=coalesce(q->>'direction','all');
begin
 if basis='source_updated'then
  if s not in('newar','duoli','wg','game66')or s='wg'and direction<>'charge'or s='game66'and direction<>'withdraw'then return 'source_update_time_unavailable';end if;
  if s='newar'and not exists(select 1 from pg_index where indexrelid=to_regclass('public.newar_detail_source_updated_success_idx')and indrelid=to_regclass('public.newar_detail_records')and indisvalid and indisready and pg_get_indexdef(indexrelid)like '%(platform, dataset, source_updated_at)%'and pg_get_expr(indpred,indrelid)like '%status_group%success%')then return 'source_update_index_not_ready';end if;
 elsif s='duoli'then return 'payment_success_time_unavailable';end if;
 if s='wg'and direction<>'charge'then return 'payment_success_time_unavailable_for_withdraw';end if;
 if s='panda'then return 'success_window_coverage_unavailable';end if;
 return null;
end;$$;

-- END helpers

-- BEGIN kernel
create or replace function private.prepared_aggregate_raw_kernel(p_request jsonb,p_catalog jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $kernel$
declare
  v_secondary_start timestamptz;v_secondary_end timestamptz;v_basis text;v_secondary_available boolean;
  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
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
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  v_options:=p_catalog;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'successStartAt','successEndAt','successBasis','action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','amountBands','durationVersion','durationRange','offset','limit','view'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  if v_action<>'aggregate' then raise exception using errcode='22023',message='prepared_aggregate_only';end if;
  v_secondary_start:=coalesce(p_request->>'successStartAt',p_request->>'startAt')::timestamptz;
  v_secondary_end:=coalesce(p_request->>'successEndAt',p_request->>'endAt')::timestamptz;
  v_basis:=coalesce(p_request->>'successBasis','legacy');
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
          'historicalFees',true,'actualAmount',p->>'source'<>'ar','recordedFee',p->>'source' in ('newar','game66'),'scopeGroupIsGeographicCountry',p->>'source'<>'game66')||case when p->>'source'='ar' then private.ar_middle_channel_capabilities((p->>'id')::uuid)
      when p->>'source'='panda' then private.dashboard_admin_panda_capabilities()
      when p->>'source'='kb' then private.dashboard_admin_yash_capabilities()
      when p->>'source'='duoli' then private.dashboard_admin_duoli_capabilities()
      when p->>'source'='wg' then private.dashboard_admin_wg_capabilities() else '{}'::jsonb end)),'[]'::jsonb)
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
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg','kb')) then
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
    if false then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  if v_platform.source='duoli' then
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  if v_platform.source='panda' then
    if v_member is not null then raise exception using errcode='22023',message='unsupported_member_filter_for_panda';end if;
    
    v_capabilities:=v_capabilities||private.dashboard_admin_panda_capabilities(v_direction);
    v_panda_coverage:=private.dashboard_admin_panda_query_coverage(v_platform.source_name,v_direction,v_start,v_end);
    if v_action<>'details' and (v_panda_coverage->>'complete')::boolean is not true then raise exception using errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';end if;
  end if;
  if p_request?'successBasis'then v_capabilities:=v_capabilities||jsonb_build_object('successTimeBasis',case when v_basis='source_updated'then'source_updated_at'else'success_at'end,'successCohort','independent_secondary_window','independentSuccessWindow',true);end if;
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
        private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end)) as amount,
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
    -- ar_local_amount_known_inline_v1: only the fingerprinted native rule is
    -- expanded. A future amount-helper change retains the original call.
    if exists(select 1 from pg_catalog.pg_proc m
      where m.oid=pg_catalog.to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
        and pg_catalog.md5(m.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'
        and m.proowner='postgres'::regrole and m.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
        and m.provolatile='i' and m.proparallel='s' and not m.prosecdef and not m.proisstrict and not m.proleakproof
        and m.proconfig is not distinct from array['search_path=""']
        and m.proacl::text is not distinct from '{postgres=X/postgres}' and m.pronargdefaults=0
        and m.prorettype='numeric'::regtype and not m.proretset and m.pronargs=8) then
      v_source:=replace(v_source,$ar_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))$ar_amount_call$,$ar_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
 END$ar_amount_case$);
    end if;
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
  elsif v_platform.source='panda' then
    v_source:=private.dashboard_admin_panda_order_source();
  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
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
  v_secondary_available:=private.prepared_aggregate_secondary_reason(p_request,to_jsonb(v_platform))is null or(v_direction='all'and(v_platform.source='wg'or(v_platform.source='game66'and v_basis='source_updated')));
  v_source:=private.prepared_aggregate_source_clocks(v_source,v_platform.source,case when v_secondary_available then v_basis else 'legacy' end);
  -- Group and page the identical materialized, filtered source set. The old
  -- detail RPC is never paged repeatedly to manufacture aggregate totals.
  -- Details lets PostgreSQL inline the shared predicate: COUNT can prune all
  -- display/time calculations, and the page can use source time indexes.
  -- Aggregate materializes only compact analytical values (no order IDs/MD5).
  v_sql:='with source_orders as ('||v_source||'), orders as (select *,case when not $38 then null::timestamptz when $37=''source_updated'' then source_updated_at else success_at end as secondary_at from source_orders), filtered as '||
    case when v_action='details' then 'not materialized' else 'materialized' end||$q$ (
    select case when $19<>'aggregate' then id end as id,
      case when $19<>'aggregate' then system_order_id end as system_order_id,
      case when $19<>'aggregate' then order_number end as order_number,
      case when $19<>'aggregate' then third_party_order_number end as third_party_order_number,
      case when $19<>'aggregate' then member_id end as member_id,provider,
      case when $19<>'aggregate' then raw_provider end as raw_provider,
      channel_type,direction,
      case when $19<>'aggregate' then status end as status,status_group,
      created_at,success_at,case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,
      case when $19<>'aggregate' and actual_amount::text not in ('NaN','Infinity','-Infinity') then actual_amount end as actual_amount,
      case when $19<>'aggregate' and withdraw_fee::text not in ('NaN','Infinity','-Infinity') then withdraw_fee end as withdraw_fee,
      currency,synced_at,utr,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (secondary_at >= $35 and secondary_at < $36) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (secondary_at at time zone $4)::date as success_local_date,
      extract(hour from secondary_at at time zone $4)::integer as success_local_hour,
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
    select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
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
    v_sql:='with source_orders as ('||v_source||$q$), orders as (select *,case when not $38 then null::timestamptz when $37='source_updated' then source_updated_at else success_at end as secondary_at from source_orders), filtered as materialized (
      select direction,currency,provider,channel_type,status_group,created_at,success_at,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (created_at >= $5 and created_at < $6) as created_in_range,
        (secondary_at >= $35 and secondary_at < $36 and status_group='success') as success_in_range
      from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
    ), fee_subjects as materialized (
    select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
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
    -- ar_provider_fee_fold_v1: unchanged facts, one fewer filtered scan.
    if v_platform.source='ar' then
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_0$), fee_bands as (
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
    $ar_fee_fold_0$,'')))/length($ar_fee_fold_0$), fee_bands as (
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
    $ar_fee_fold_0$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_0$), fee_bands as (
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
    $ar_fee_fold_0$,$ar_fee_fold_0$$ar_fee_fold_0$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$,'')))/length($ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$,$ar_fee_fold_1$max(synced_at) as latest_synced_at,
        jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts$ar_fee_fold_1$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$,'')))/length($ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$,$ar_fee_fold_2$(to_jsonb(m)-array['kind','fee_facts'])$ar_fee_fold_2$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$,'')))/length($ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$,$ar_fee_fold_3$case when m.kind='provider' then m.fee_facts else '{}'::jsonb end$ar_fee_fold_3$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$,'')))/length($ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$,$ar_fee_fold_4$$ar_fee_fold_4$);
    end if;
  end if;

  if v_platform.source='duoli' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  if v_platform.source='panda' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'')))/length($panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$)<>1 then raise exception 'panda_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using v_id,v_platform.name,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_fee_country,v_fee_currency_proven,(v_platform.source='wg'),case when v_secondary_available then v_secondary_start else v_start end,case when v_secondary_available then v_secondary_end else v_start end,v_basis,v_secondary_available;
  if v_action='details' then
    v_result:=jsonb_set(v_result,'{rows}',coalesce((select jsonb_agg(x||case when v_platform.source='wg' and x->>'direction'='charge' and x->>'channel_type'='提现转充值' then
      jsonb_build_object('fee_exempt',true,'fee_exempt_reason','wg_withdraw_to_charge','fee_version_state','complete',
        'fee_version_ids','[]'::jsonb,'fee_version_percent_rate','0','fee_version_fixed_fee','0',
        'fee_version_estimated_amount','0','fee_version_basis','native_business_rule')
      else private.dashboard_admin_fee_quote(v_fee_country,v_platform.name,
      x->>'provider',x->>'direction',case when v_fee_currency_proven then x->>'currency' end,(x->>'created_at')::timestamptz,(x->>'amount')::numeric,private.dashboard_admin_fee_category(v_fee_country,x->>'channel_type')) end order by n)
      from jsonb_array_elements(v_result->'rows') with ordinality t(x,n)),'[]'::jsonb));
  end if;
  if v_action='details' and v_platform.source='ar' then v_result:=private.dashboard_admin_ar_order_money(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='panda' then
    v_result:=private.dashboard_admin_panda_order_result(v_result)||jsonb_build_object('pandaCoverage',v_panda_coverage);
  end if;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  v_result:=private.dashboard_admin_order_business_result(v_result,v_platform.source,v_platform.scope_group,v_platform.source_name,v_platform.id);
  return v_result||case when v_duration_version=2 then jsonb_build_object('durationVersion',2)
      ||case when v_duration_custom then jsonb_build_object('durationRange',v_duration->'range') else '{}'::jsonb end else '{}'::jsonb end
    ||case when v_amount_bands is null then '{}'::jsonb else jsonb_build_object('amountBands',v_amount_bands,'amountBandsVersion',1) end
    ||jsonb_build_object('version',1,'platform',v_meta,'basis','mixed_created_success','startAt',v_start,'endAt',v_end,
    'successStartAt',v_secondary_start,'successEndAt',v_secondary_end,'successBasis',case when v_basis='legacy' and v_platform.source='duoli' then 'source_updated' when v_basis='legacy' then 'success' else v_basis end,
    'asOf',v_asof,'offset',v_offset,'limit',v_limit,'hasMore',(v_result->>'total')::bigint>v_offset::bigint+v_limit,
    'capabilities',v_capabilities);
end;
$kernel$;

-- END kernel

-- BEGIN expand
create or replace function private.prepared_aggregate_expand_provider_filter(p_request jsonb,p_target jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_platform record;
  v_scope jsonb;
  v_selected text[];
  v_raw text[];
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- A missing key has SQL NULL type, so `type <> 'array'` alone does not return.
  -- All-provider queries must not normalize the entire provider directory.
  if p_request is null or coalesce(jsonb_typeof(p_request->'providers'),'null')<>'array' then
    return p_request;
  end if;
  if jsonb_array_length(p_request->'providers')=0 then return p_request; end if;
  if jsonb_array_length(p_request->'providers')>200 or exists(
    select 1 from jsonb_array_elements(p_request->'providers') a
    where jsonb_typeof(a)<>'string' or length(a#>>'{}') not between 1 and 200
      or (a#>>'{}') ~ '[[:cntrl:]]'
  ) then raise exception using errcode='22023',message='invalid_filter'; end if;
  begin
    v_id:=(p_request->>'platformId')::uuid;
  exception when others then
    return p_request;
  end;
  if v_id is null then return p_request; end if;
  -- Keep the existing authenticated, active-profile, grant and platform checks.
  select * into v_platform from jsonb_to_record(p_target) as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then return p_request; end if;

  select array_agg(value order by value) into v_selected
    from jsonb_array_elements_text(p_request->'providers') value;
  if v_platform.source='panda' then
    with names as materialized (
     select provider from private.dashboard_admin_panda_provider_names(v_platform.source_name,coalesce(p_request->>'direction','all'))
    ), matches as (
     select unnest(v_selected) provider union select provider from names
     where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,provider)=any(v_selected)
    ) select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='kb' then
    with names as materialized (
     select distinct private.dashboard_admin_yash_order_provider(y.order_type,y.supplier,y.channel) provider
     from private.yash_orders y where v_platform.scope_group='IN' and v_platform.source_name='YASH.BET' and y.source_site='yash'
      and ((y.created_at>=(p_request->>'startAt')::timestamptz and y.created_at<(p_request->>'endAt')::timestamptz)or(y.completed_at>=coalesce(p_request->>'successStartAt',p_request->>'startAt')::timestamptz and y.completed_at<coalesce(p_request->>'successEndAt',p_request->>'endAt')::timestamptz))
      and y.order_type=any(case coalesce(p_request->>'direction','all') when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
    ), matches as (
     select unnest(v_selected) provider union select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    )select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='duoli' then
    with names as materialized (
     select distinct private.dashboard_admin_duoli_provider(d.provider_code) provider
     from private.duoli_order_details d where d.platform=v_platform.source_name and v_platform.scope_group='ID' and d.country='ID' and d.system_name='DOLI'
      and ((d.created_at>=(p_request->>'startAt')::timestamptz and d.created_at<(p_request->>'endAt')::timestamptz)or(d.updated_at>=coalesce(p_request->>'successStartAt',p_request->>'startAt')::timestamptz and d.updated_at<coalesce(p_request->>'successEndAt',p_request->>'endAt')::timestamptz))
      and d.business=any(case coalesce(p_request->>'direction','all') when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
    ), matches as (
     select unnest(v_selected) provider union select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    )select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='wg' then
    with names as materialized (
      -- Canonicalize once per distinct native name, never once per historical order.
      -- The shared helper enumerates every raw name by the existing site/provider index.
      select provider from private.dashboard_admin_wg_provider_names(
        v_platform.scope_group,v_platform.source_name,coalesce(p_request->>'direction','all'))
    ), matches as (
      select unnest(v_selected) provider union select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    )select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  if v_platform.source='newar' then
    declare
      native_start timestamptz; native_end timestamptz;secondary_start timestamptz;secondary_end timestamptz;
      native_direction text:=coalesce(p_request->>'direction','all');
      native_success boolean:=coalesce(p_request->>'action','catalog')='aggregate' or coalesce(p_request->>'status','all')='success';
    begin
      -- The original reader still validates the request. Never enumerate native
      -- orders for malformed/unbounded input before it reaches that validator.
      if native_direction not in ('all','charge','withdraw')
        or coalesce(jsonb_typeof(p_request->'startAt'),'null')<>'string'
        or coalesce(jsonb_typeof(p_request->'endAt'),'null')<>'string' then return p_request; end if;
      begin
        native_start:=(p_request->>'startAt')::timestamptz;
        native_end:=(p_request->>'endAt')::timestamptz;secondary_start:=coalesce(p_request->>'successStartAt',p_request->>'startAt')::timestamptz;secondary_end:=coalesce(p_request->>'successEndAt',p_request->>'endAt')::timestamptz;
      exception when others then return p_request; end;
      if native_start is null or native_end is null or not isfinite(native_start) or not isfinite(native_end)
        or native_end<=native_start or native_end-native_start>interval '32 days' then return p_request; end if;
      with native_rows as materialized (
        -- Separate creation/success branches use the existing time indexes.
        -- Both are required for historical orders that succeeded on this day.
        select n.provider,n.dataset,n.channel_type,n.status_group
        from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
        where n.platform=v_platform.source_name and n.dataset=any(case native_direction when 'all' then array['charge','withdraw'] else array[native_direction] end)
          and n.created_at>=native_start and n.created_at<native_end
          and (t.launch_at is null or n.created_at>=t.launch_at)
        union all
        select n.provider,n.dataset,n.channel_type,n.status_group
        from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
        where native_success and n.platform=v_platform.source_name
          and n.dataset=any(case native_direction when 'all' then array['charge','withdraw'] else array[native_direction] end)
          and n.status_group='success' and ((coalesce(p_request->>'successBasis','success')='source_updated' and n.source_updated_at>=secondary_start and n.source_updated_at<secondary_end) or(coalesce(p_request->>'successBasis','success')<>'source_updated' and n.success_at>=secondary_start and n.success_at<secondary_end))
          and (t.launch_at is null or n.created_at>=t.launch_at)
      ), native_names as materialized (
        -- Exactly the same native labels as the existing order engine.
        select distinct case when dataset='charge' and coalesce(btrim(provider),'')='' and channel_type='ManualRecharge' then '人工充值'
          when dataset='withdraw' and status_group in ('failed','rejected') and coalesce(btrim(provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(provider),''),'未识别通道') end provider from native_rows
      ), matches as (
        select unnest(v_selected) provider
        union select n.provider from native_names n
          where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
      ) select array_agg(distinct provider order by provider) into v_raw from matches;
      return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
    end;
  end if;
  if v_platform.source='lg' then
    with names as materialized (
      select distinct coalesce(nullif(btrim(d.third_party),''),nullif(btrim(d.raw_channel),''),'未识别通道') as provider
      from public.lg_success_daily d
      where d.country_code=v_platform.scope_group and d.platform=v_platform.source_name
        and d.scope_type in ('third_party','channel')
        and d.order_kind=any(case coalesce(p_request->>'direction','all') when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
    ), matches as (
      select unnest(v_selected) as provider union
      select n.provider from names n
      where private.dashboard_admin_live_provider_canonical(v_platform.country,v_platform.source_name,n.provider)=any(v_selected)
    ) select array_agg(distinct provider order by provider) into v_raw from matches;
    return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
  end if;
  with scoped as materialized (
    -- Restrict by the registry's indexed country/platform before evaluating
    -- aliases; provider_rows() materializes all authorized platforms first.
    select r.country,r.platform,r.raw_provider,r.canonical_values
    from private.dashboard_admin_provider_registry r
    where r.country=v_platform.country
      and r.platform=any(array[v_platform.name,v_platform.source_name]::text[])

  ), normalized as materialized (
    select r.country,r.platform,r.raw_provider,
      case when private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider) is not null
        then array[private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider)]
        else private.dashboard_admin_live_provider_alias_values(r.country,r.canonical_values) end canonical_values
    from scoped r
  ), mapped as (
    select value as raw_provider from unnest(v_selected) value
    union
    select coalesce(nullif(r.raw_provider,''),'未识别通道')
    from normalized r
    left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
    where coalesce(private.dashboard_admin_live_provider_alias(r.country,o.canonical_provider),
      case when cardinality(r.canonical_values)=1 then r.canonical_values[1] end)=any(v_selected)
  )
  select array_agg(distinct raw_provider order by raw_provider) into v_raw from mapped;
  return jsonb_set(p_request,'{providers}',to_jsonb(coalesce(v_raw,'{}'::text[])),true);
end;
$function$;

-- END expand

-- BEGIN dependencies
create function private.prepared_aggregate_dependency_common(p_scope text)
returns text language sql stable security invoker set search_path='' as $fn$
 select md5(jsonb_build_object(
  'contract','exact-prepared-dual-clock-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),md5(p.prosrc),p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  -- Fee outputs consume immutable versions, category presence and evidence eligibility,
  -- not the sheet publisher's observation/generation identity. Keep all IN directions.
  'feeSemantics',jsonb_build_object(
   'versions',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country=p_scope),
   'openIntervalEvidence',(select coalesce(jsonb_agg(jsonb_build_array(v.id,
    exists(select 1 from private.fee_rate_current_evidence e
     join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id
     where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready'
      and r.updated_at=g.published_at))order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country=p_scope),
   'sourceCategories',(select coalesce(jsonb_agg(category order by category),'[]'::jsonb)
    from(select distinct upper(btrim(r.category)) category from public.third_party_rates r
     where private.dashboard_data_group(r.country,'')=p_scope) categories),
   'blockingEvidence',(select coalesce(jsonb_agg(jsonb_build_array(direction,category,provider)
    order by direction,category,provider),'[]'::jsonb)
    from(select distinct bad.direction,upper(btrim(r.category)) category,r.third_party provider
     from private.fee_rate_current_evidence bad
     join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where (bad.version_id is null or bad.state<>'ready'
       or r.updated_at is distinct from generation.published_at)
      and private.dashboard_data_group(r.country,'')=p_scope) blockers)
  )
 )::text);
$fn$;
create function private.prepared_aggregate_dependency(p_target jsonb,p_common text)returns text language sql stable set search_path=''as $fn$
 select md5(jsonb_build_object('common',p_common,
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in(p_target->>'scope_group',p_target->>'country')and platform in(p_target->>'name',p_target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in(p_target->>'scope_group',p_target->>'country')and platform in(p_target->>'name',p_target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and p_target->>'source'='ar'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where p_target->>'source'='ar'and source_system='AR'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name')
 )::text);
$fn$;
create function private.prepared_aggregate_dependency(p_target jsonb)returns text language sql stable set search_path=''as $fn$ select private.prepared_aggregate_dependency(p_target,private.prepared_aggregate_dependency_common(case when p_target->>'source'='game66'then'IN'else p_target->>'scope_group'end));$fn$;

-- END dependencies

-- BEGIN projection
-- Pure projection of a validated, immutable providers publication. The caller
-- authorizes the native target and checks generation/dependency/expiry first.
-- Both requests are normalized by prepared_aggregate_canonical_request; this
-- function never reads orders, admits work, or changes either time window.
create or replace function private.dashboard_prepared_provider_projection(
  p_payload jsonb,p_base_request jsonb,p_request jsonb
) returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare
  selected jsonb; summaries jsonb:='[]'::jsonb; result jsonb; bucket record;
  summary jsonb; key text; value numeric; invalid boolean; total numeric;
  providers text[]; country text; platform text; stamp text;
  count_keys constant text[]:=array['all_count','success_count','pending_count','failed_count','rejected_count','unknown_count','missing_amount_count','negative_amount_count','created_success_count'];
  amount_keys constant text[]:=array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'];
begin
  if jsonb_typeof(p_base_request) is distinct from 'object'
    or jsonb_typeof(p_request) is distinct from 'object'
    or p_base_request->>'action' is distinct from 'aggregate'
    or p_request->>'action' is distinct from 'aggregate'
    or p_base_request->>'view' is distinct from 'providers'
    or p_request->>'view' is distinct from 'providers'
    or p_base_request->>'direction' is distinct from 'all'
    or coalesce(p_base_request->>'status','all')<>'all'
    or coalesce(p_request->>'status','all')<>'all'
    or coalesce(p_request->>'direction','') not in ('all','charge','withdraw')
    or (p_base_request-array['providers','direction']) is distinct from (p_request-array['providers','direction'])
    or coalesce(p_base_request->'providers','[]'::jsonb)<>'[]'::jsonb
    or jsonb_typeof(coalesce(p_request->'providers','[]'::jsonb)) is distinct from 'array'
  then raise exception using errcode='22023',message='prepared_projection_scope_mismatch';end if;
  if jsonb_array_length(coalesce(p_request->'providers','[]'::jsonb))>200 or exists(
    select 1 from jsonb_array_elements(coalesce(p_request->'providers','[]'::jsonb)) n
    where jsonb_typeof(n)<>'string' or length(btrim(n#>>'{}')) not between 1 and 200 or (n#>>'{}')~'[[:cntrl:]]'
  ) then raise exception using errcode='22023',message='prepared_projection_invalid_providers';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload->>'version' is distinct from '1'
    or p_payload->'rows' is distinct from '[]'::jsonb
    or jsonb_typeof(p_payload->'summary') is distinct from 'array'
    or jsonb_typeof(p_payload->'groups'->'provider') is distinct from 'array'
    or p_payload ?| array['error','partial','_parts']
    or p_payload->'platform'->>'id' is distinct from p_request->>'platformId'
    or (p_payload->>'startAt')::timestamptz is distinct from (p_request->>'startAt')::timestamptz
    or (p_payload->>'endAt')::timestamptz is distinct from (p_request->>'endAt')::timestamptz
  then raise exception using errcode='22023',message='prepared_projection_invalid_payload';end if;
  -- The publisher/reader validates the full native identity. Require the name
  -- context used by the same existing country/platform alias resolver as live.
  country:=p_payload->'platform'->>'country';platform:=p_payload->'platform'->>'sourceName';
  if nullif(btrim(country),'') is null or nullif(btrim(platform),'') is null then
    raise exception using errcode='22023',message='prepared_projection_invalid_native_identity';end if;
  -- The canonical request carries the effective success clock, including its
  -- native legacy default. Neither clock can be silently exchanged here.
  if p_request ? 'successStartAt' and (
    (p_payload->>'successStartAt')::timestamptz is distinct from (p_request->>'successStartAt')::timestamptz
    or (p_payload->>'successEndAt')::timestamptz is distinct from (p_request->>'successEndAt')::timestamptz
    or p_payload->>'successBasis' is distinct from p_request->>'successBasis'
  ) then raise exception using errcode='22023',message='prepared_projection_success_window_mismatch';end if;
  select array_agg(distinct private.dashboard_admin_live_provider_canonical(country,platform,n)) into providers
    from jsonb_array_elements_text(coalesce(p_request->'providers','[]'::jsonb)) n;
  if exists(select 1 from jsonb_array_elements(p_payload->'groups'->'provider') r
    where jsonb_typeof(r)<>'object' or coalesce(r->>'direction','') not in ('charge','withdraw'))
  then raise exception using errcode='22023',message='prepared_projection_invalid_provider_rows';end if;
  if providers is null and p_request->>'direction'='all' then return p_payload;end if;
  -- Keep the complete original provider row, including fee intervals, evidence,
  -- nulls and monetary precision. Duplicate requested aliases never duplicate it.
  select coalesce(jsonb_agg(r order by n),'[]'::jsonb) into selected
    from jsonb_array_elements(p_payload->'groups'->'provider') with ordinality a(r,n)
    where (p_request->>'direction'='all' or r->>'direction'=p_request->>'direction')
      and (providers is null or private.dashboard_admin_live_provider_canonical(country,platform,r->>'provider')=any(providers));
  for bucket in select r->'direction' direction,r->'currency' currency,jsonb_agg(r) leaves
    from jsonb_array_elements(selected) r group by r->'direction',r->'currency' order by r->'direction',r->'currency'
  loop
    summary:=jsonb_build_object('direction',bucket.direction,'currency',bucket.currency,'provider',null);
    foreach key in array count_keys loop
      if exists(select 1 from jsonb_array_elements(bucket.leaves) r where r ? key)
        or exists(select 1 from jsonb_array_elements(p_payload->'summary') r where r ? key) then
        select bool_or(r->>key is null or coalesce(r->>key,'')!~'^[0-9]+$'),
          sum(case when r->>key~'^[0-9]+$' then (r->>key)::numeric end)
          into invalid,value from jsonb_array_elements(bucket.leaves) r;
        summary:=summary||jsonb_build_object(key,case when invalid then null else value end);
      end if;
    end loop;
    foreach key in array amount_keys loop
      select bool_or(r->>key is null or coalesce(r->>key,'')!~'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'),
        sum(case when r->>key~'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then (r->>key)::numeric end)
        into invalid,value from jsonb_array_elements(bucket.leaves) r;
      summary:=summary||jsonb_build_object(key,case when invalid then null else value::text end);
    end loop;
    select r->>'latest_synced_at' into stamp from jsonb_array_elements(bucket.leaves) r
      where r->>'latest_synced_at' is not null order by (r->>'latest_synced_at')::timestamptz desc limit 1;
    summary:=summary||jsonb_build_object('latest_synced_at',stamp);
    -- Deliberately no fee/distinct-member/rate summation in summary: the kernel
    -- exposes fee facts on provider leaves, and unique people are not additive.
    summaries:=summaries||jsonb_build_array(summary);
  end loop;
  select coalesce(bool_or(r->>'all_count' is null or coalesce(r->>'all_count','')!~'^[0-9]+$'),false),
    coalesce(sum(case when r->>'all_count'~'^[0-9]+$' then (r->>'all_count')::numeric end),0)
    into invalid,total from jsonb_array_elements(selected) r;
  if invalid then total:=null;end if;
  result:=p_payload||jsonb_build_object('summary',summaries,'total',total,'rows','[]'::jsonb,
    'groups',jsonb_build_object('provider',selected));
  -- No whole-platform dimensional data may survive a provider projection.
  if p_payload ? 'latencySummary' then result:=result||jsonb_build_object('latencySummary','[]'::jsonb);end if;
  if p_payload ? 'pendingSummary' then result:=result||jsonb_build_object('pendingSummary','[]'::jsonb);end if;
  if p_payload ? 'hasMore' then result:=result||jsonb_build_object('hasMore',case when total is null then null else total>coalesce((p_payload->>'offset')::bigint,0)+coalesce((p_payload->>'limit')::bigint,20) end);end if;
  return result;
end;
$function$;
revoke all on function private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- END projection

-- BEGIN direction
-- Narrow a full immutable publication to one business direction. Every other
-- filter and both independent clocks must be exactly equal after canonicalizing.
-- Group rows and latency percentiles are selected, never re-aggregated.
create or replace function private.dashboard_prepared_direction_projection(
  p_payload jsonb,p_base_request jsonb,p_request jsonb
) returns jsonb language plpgsql immutable security invoker set search_path='' as $function$
declare r jsonb:=p_payload; groups jsonb; rows jsonb; summaries jsonb;k text;total numeric;invalid boolean;count_key text;d text:=p_request->>'direction';
begin
 if jsonb_typeof(p_base_request)is distinct from'object'or jsonb_typeof(p_request)is distinct from'object'
 or p_base_request->>'action'is distinct from'aggregate'or p_request->>'action'is distinct from'aggregate'
 or p_base_request->>'view'is distinct from'full'or p_request->>'view'is distinct from'full'
 or p_base_request->>'direction'is distinct from'all'or d is null or d not in('all','charge','withdraw')
 or(p_base_request-'direction')is distinct from(p_request-'direction')
 or jsonb_typeof(r)is distinct from'object'or r->>'version'is distinct from'1'
 or r->'rows'is distinct from'[]'::jsonb or jsonb_typeof(r->'summary')is distinct from'array'
 or jsonb_typeof(r->'groups')is distinct from'object' or r ?| array['error','partial','_parts']
 or r#>>'{platform,id}'is distinct from p_request->>'platformId'
 or(r->>'startAt')::timestamptz is distinct from(p_request->>'startAt')::timestamptz
 or(r->>'endAt')::timestamptz is distinct from(p_request->>'endAt')::timestamptz
 or(r->>'successStartAt')::timestamptz is distinct from(p_request->>'successStartAt')::timestamptz
 or(r->>'successEndAt')::timestamptz is distinct from(p_request->>'successEndAt')::timestamptz
 or r->>'successBasis'is distinct from p_request->>'successBasis'
 then raise exception using errcode='22023',message='prepared_direction_scope_mismatch';end if;
 if d='all'then return r;end if;
 select coalesce(jsonb_agg(x order by n),'[]'::jsonb)into summaries from jsonb_array_elements(r->'summary')with ordinality a(x,n)where x->>'direction'=d;
 groups:=r->'groups';
 for k in select jsonb_object_keys(groups)loop
  if jsonb_typeof(groups->k)is distinct from'array'then raise exception 'prepared_direction_invalid_group';end if;
  if exists(select 1 from jsonb_array_elements(groups->k)x where coalesce(x->>'direction','')not in('charge','withdraw'))then raise exception 'prepared_direction_unscoped_row';end if;
  select coalesce(jsonb_agg(x order by n),'[]'::jsonb)into rows from jsonb_array_elements(groups->k)with ordinality a(x,n)where x->>'direction'=d;
  groups:=jsonb_set(groups,array[k],rows);
 end loop;
 foreach k in array array['latencySummary','pendingSummary']loop
  if r ? k then
   if jsonb_typeof(r->k)is distinct from'array'then raise exception 'prepared_direction_invalid_summary';end if;
   select coalesce(jsonb_agg(x order by n),'[]'::jsonb)into rows from jsonb_array_elements(r->k)with ordinality a(x,n)where x->>'direction'=d;
   r:=jsonb_set(r,array[k],rows);
  end if;
 end loop;
 count_key:=case when p_request->>'status'='success'then'success_count'else'all_count'end;
 select coalesce(bool_or(x->>count_key is null or coalesce(x->>count_key,'')!~'^[0-9]+$'),false),
  coalesce(sum(case when x->>count_key~'^[0-9]+$'then(x->>count_key)::numeric end),0)
  into invalid,total from jsonb_array_elements(summaries)x;
 if invalid or(count_key='success_count'and(r#>>array['capabilities',d||'SuccessTimeAvailable'])='false')then total:=null;end if;
 return r||jsonb_build_object('summary',summaries,'groups',groups,'total',total,
  'hasMore',case when total is null then null else total>coalesce((r->>'offset')::integer,0)+coalesce((r->>'limit')::integer,20)end);
end;
$function$;
revoke all on function private.dashboard_prepared_direction_projection(jsonb,jsonb,jsonb)from public,anon,authenticated,service_role;

-- END direction

-- BEGIN mask
-- Pure result shaping when a native source has no proven secondary clock.
-- Creation facts and native evidence remain usable; absence is never zero.
create or replace function private.prepared_aggregate_mask_secondary_row(
  p_row jsonb,p_reason text,p_direction text,p_parent_direction text default null,p_depth integer default 0
) returns jsonb language plpgsql immutable security invoker set search_path='' as $function$
declare
  r jsonb:=p_row; d text; k text; children jsonb;
begin
  if p_depth>16 then raise exception 'prepared_secondary_result_depth';end if;
  if jsonb_typeof(r) is distinct from 'object' then raise exception 'prepared_secondary_invalid_row';end if;
  d:=coalesce(r->>'direction',p_parent_direction);
  if p_direction='all' or d=p_direction then
    for k in select jsonb_object_keys(r) loop
      -- Fee bands are facts of the secondary success cohort. Identity, provider
      -- and fee category metadata are kept separately from these facts.
      if k in ('success_count','success_amount','success_rate','successRate','success_member_count','success_order_count')
        or k ~ '^fee_.*_(count|amount)$' then
        r:=jsonb_set(r,array[k],'null'::jsonb);
      elsif k='fee_version_state' then r:=jsonb_set(r,array[k],'"unavailable"'::jsonb);
      end if;
    end loop;
    r:=r||jsonb_build_object('success_count',null,'success_amount',null,'success_available',false,
      'success_unavailable_reason',p_reason,'fee_available',false,'fee_unavailable_reason',p_reason);
  end if;
  foreach k in array array['items','fee_items'] loop
    if r ? k then
      if jsonb_typeof(r->k) is distinct from 'array' then raise exception 'prepared_secondary_invalid_children';end if;
      select coalesce(jsonb_agg(private.prepared_aggregate_mask_secondary_row(x,p_reason,p_direction,d,p_depth+1) order by n),'[]'::jsonb)
        into children from jsonb_array_elements(r->k) with ordinality t(x,n);
      r:=jsonb_set(r,array[k],children);
    end if;
  end loop;
  return r;
end;
$function$;

create or replace function private.prepared_aggregate_mask_secondary(
  p_payload jsonb,p_reason text,p_direction text default 'all'
) returns jsonb language plpgsql immutable security invoker set search_path='' as $function$
declare
  r jsonb:=p_payload; caps jsonb; groups jsonb; k text; rows jsonb; d text;
begin
  if jsonb_typeof(r) is distinct from 'object' or nullif(btrim(p_reason),'') is null
    or p_direction is null or p_direction not in ('all','charge','withdraw')
    or jsonb_typeof(r->'summary') is distinct from 'array'
    or jsonb_typeof(r->'groups') is distinct from 'object'
  then raise exception 'prepared_secondary_invalid_result';end if;
  select coalesce(jsonb_agg(private.prepared_aggregate_mask_secondary_row(x,p_reason,p_direction) order by n),'[]'::jsonb)
    into rows from jsonb_array_elements(r->'summary') with ordinality t(x,n);
  r:=jsonb_set(r,'{summary}',rows);groups:=r->'groups';
  for k in select jsonb_object_keys(groups) loop
    if jsonb_typeof(groups->k) is distinct from 'array' then raise exception 'prepared_secondary_invalid_group';end if;
    if k in ('latency','latency_thresholds','latency_custom') then
      select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into rows
        from jsonb_array_elements(groups->k) with ordinality t(x,n)
        where p_direction<>'all' and x->>'direction' in ('charge','withdraw') and x->>'direction'<>p_direction;
    elsif k in ('pending_age','pending_age_thresholds') then
      -- Pending age is based on creation and asOf, independent of success.
      continue;
    else
      select coalesce(jsonb_agg(private.prepared_aggregate_mask_secondary_row(x,p_reason,p_direction) order by n),'[]'::jsonb)
        into rows from jsonb_array_elements(groups->k) with ordinality t(x,n);
    end if;
    groups:=jsonb_set(groups,array[k],rows);
  end loop;
  r:=jsonb_set(r,'{groups}',groups);
  if r ? 'latencySummary' then
    if jsonb_typeof(r->'latencySummary') is distinct from 'array' then raise exception 'prepared_secondary_invalid_latency';end if;
    select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into rows
      from jsonb_array_elements(r->'latencySummary') with ordinality t(x,n)
      where p_direction<>'all' and x->>'direction' in ('charge','withdraw') and x->>'direction'<>p_direction;
    r:=jsonb_set(r,'{latencySummary}',rows);
  end if;
  caps:=coalesce(r->'capabilities','{}'::jsonb);
  if jsonb_typeof(caps)<>'object' then raise exception 'prepared_secondary_invalid_capabilities';end if;
  foreach d in array case when p_direction='all' then array['charge','withdraw'] else array[p_direction] end loop
    caps:=caps||jsonb_build_object(d||'SuccessTimeAvailable',false,d||'SecondaryTimeAvailable',false,
      d||'SecondaryTimeUnavailableReason',p_reason,d||'LatencyAvailable',false);
  end loop;
  if p_direction='all' then
    caps:=caps||jsonb_build_object('successTimeAvailable',false,'secondaryTimeAvailable',false,
      'secondaryTimeUnavailableReason',p_reason,'latencyAvailable',false);
  else
    caps:=caps||jsonb_build_object('secondaryTimeAvailability','partial');
  end if;
  r:=r||jsonb_build_object('capabilities',caps);
  if jsonb_typeof(r->'platform')='object' then
    r:=jsonb_set(r,'{platform,capabilities}',coalesce(r->'platform'->'capabilities','{}'::jsonb)||caps);
  end if;
  return r;
end;
$function$;
revoke all on function private.prepared_aggregate_mask_secondary_row(jsonb,text,text,text,integer) from public,anon,authenticated,service_role;
revoke all on function private.prepared_aggregate_mask_secondary(jsonb,text,text) from public,anon,authenticated,service_role;

-- END mask

-- BEGIN store
create table private.prepared_aggregate_jobs(
 id uuid primary key default gen_random_uuid(),request_key jsonb not null,request_fingerprint text generated always as(md5(request_key::text))stored unique,target jsonb not null,request jsonb not null,
 status text not null default 'queued' check(status in('queued','running','ready','failed')),revision bigint not null default 1,
 dependency text not null,fence bigint not null default 0,run_id uuid,lease_until timestamptz,worker text,
 claim_pid integer,claim_backend_start timestamptz,attempts integer not null default 0,
 not_before timestamptz not null default clock_timestamp(),last_requested_at timestamptz not null default clock_timestamp(),
 next_due_at timestamptz,priority smallint not null default 0,last_error text,created_at timestamptz not null default clock_timestamp());
create index prepared_aggregate_due_idx on private.prepared_aggregate_jobs(status,not_before,priority desc,created_at);
create table private.prepared_aggregate_artifacts(
 id uuid primary key default gen_random_uuid(),job_id uuid not null references private.prepared_aggregate_jobs(id)on delete cascade,
 run_id uuid not null,fence bigint not null,revision bigint not null,dependency text not null,payload jsonb not null,
 computed_at timestamptz not null,expires_at timestamptz not null,cutoff timestamptz not null,source_complete boolean not null,
 bytes integer not null check(bytes between 2 and 4194304),unique(job_id,run_id));
create table private.prepared_aggregate_heads(job_id uuid primary key references private.prepared_aggregate_jobs(id)on delete cascade,artifact_id uuid not null unique references private.prepared_aggregate_artifacts(id));
create table private.prepared_aggregate_admissions(actor uuid not null,day date not null,total integer not null check(total between 0 and 1000),primary key(actor,day));
create table private.prepared_aggregate_schedule(singleton boolean primary key default true check(singleton),cursor_id uuid,cursor_tier smallint not null default 0,enabled boolean not null default false);
insert into private.prepared_aggregate_schedule(singleton)values(true);
alter table private.prepared_aggregate_jobs enable row level security;alter table private.prepared_aggregate_artifacts enable row level security;
alter table private.prepared_aggregate_heads enable row level security;alter table private.prepared_aggregate_admissions enable row level security;alter table private.prepared_aggregate_schedule enable row level security;
revoke all on private.prepared_aggregate_jobs,private.prepared_aggregate_artifacts,private.prepared_aggregate_heads,private.prepared_aggregate_admissions,private.prepared_aggregate_schedule from public,anon,authenticated,service_role;
create function private.prepared_aggregate_immutable()returns trigger language plpgsql set search_path=''as $$begin raise exception using errcode='55000',message='prepared_artifact_immutable';end;$$;
create trigger prepared_aggregate_immutable before update on private.prepared_aggregate_artifacts for each row execute function private.prepared_aggregate_immutable();

-- Keys represent semantics, not page, pagination, or timestamp spelling.
-- The bounded index fingerprint is only an accelerator: every lookup/upsert
-- verifies full JSON equality, so a collision fails admission rather than reuse.
create function private.prepared_aggregate_canonical_request(q jsonb,t jsonb)returns jsonb language plpgsql immutable set search_path=''as $$
declare c jsonb:=q-array['offset','limit'];k text;v text;
begin
 c:=c||jsonb_build_object('view',coalesce(q->>'view','full'),'direction',coalesce(q->>'direction','all'),'status',coalesce(q->>'status','all'),
 'successStartAt',coalesce(q->>'successStartAt',q->>'startAt'),'successEndAt',coalesce(q->>'successEndAt',q->>'endAt'),
 'successBasis',coalesce(q->>'successBasis',case when t->>'source'='duoli' then 'source_updated' else 'success' end));
 foreach k in array array['startAt','endAt','successStartAt','successEndAt']loop c:=jsonb_set(c,array[k],to_jsonb(to_char((c->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));end loop;
 if c->>'view'='providers'then c:=c-'amountBands';end if;
 foreach k in array array['providers','channelTypes']loop
  if c->k='null'::jsonb or c->k='[]'::jsonb then c:=c-k;
  elsif jsonb_typeof(c->k)='array'then c:=jsonb_set(c,array[k],(select jsonb_agg(x order by x)from(select distinct value x from jsonb_array_elements(c->k))a));end if;
 end loop;
 foreach k in array array['currency','amountMin','amountMax','durationRange']loop if c->k='null'::jsonb then c:=c-k;end if;end loop;
 return c;
end;$$;
create function private.prepared_aggregate_key(q jsonb,t jsonb)returns jsonb language sql immutable set search_path=''as $$
 select jsonb_build_array('exact-prepared-v1',t,private.prepared_aggregate_canonical_request(q,t));
$$;
create function private.prepared_aggregate_echo(payload jsonb,q jsonb,t jsonb)returns jsonb language sql immutable set search_path=''as $$
 select payload||jsonb_build_object('offset',coalesce((q->>'offset')::integer,0),'limit',coalesce((q->>'limit')::integer,20),
 'hasMore',case when payload->>'total'is null then null else(payload->>'total')::numeric>coalesce((q->>'offset')::integer,0)+coalesce((q->>'limit')::integer,20)end,'startAt',q->>'startAt','endAt',q->>'endAt','successStartAt',coalesce(q->>'successStartAt',q->>'startAt'),
 'successEndAt',coalesce(q->>'successEndAt',q->>'endAt'),'successBasis',coalesce(q->>'successBasis',case when t->>'source'='duoli' then 'source_updated' else 'success' end))
 ||case when q?'amountBands'then jsonb_build_object('amountBands',q->'amountBands','amountBandsVersion',1)else '{}'::jsonb end;
$$;
create function private.prepared_aggregate_target_current(t jsonb)returns boolean language sql stable set search_path=''as $$
 select exists(select 1 from private.prepared_aggregate_native_catalog()p where p.id=(t->>'id')::uuid and to_jsonb(p)=t);
$$;
create function private.prepared_aggregate_enqueue(q jsonb,t jsonb,dep text,p_priority smallint default 0)
returns uuid language plpgsql volatile set search_path=''as $$
declare k jsonb:=private.prepared_aggregate_key(q,t);j private.prepared_aggregate_jobs%rowtype;
begin
 if private.prepared_aggregate_request_reason(q,t)is not null then raise exception using errcode='22023',message='prepared_request_unsupported';end if;
 select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k for update;
 if found then
  update private.prepared_aggregate_jobs set last_requested_at=clock_timestamp(),priority=greatest(priority,p_priority),
   revision=revision+case when dependency<>dep or target<>t then 1 else 0 end,
   status=case when dependency<>dep or target<>t then 'queued' when status='failed'and attempts<3 and not_before<=clock_timestamp()then'queued'else status end,
   attempts=case when dependency<>dep or target<>t then 0 else attempts end,dependency=dep,target=t,not_before=case when dependency<>dep or target<>t then clock_timestamp()else not_before end,
   lease_until=case when dependency<>dep or target<>t then null else lease_until end where id=j.id;
  return j.id;
 end if;
 if not pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_admission_v1',0))then return null;end if;
 if (select count(*)from(select 1 from private.prepared_aggregate_jobs limit 10000)s)>=10000 then return null;end if;
 insert into private.prepared_aggregate_jobs(request_key,target,request,dependency,priority)values(k,t,q,dep,p_priority)
 on conflict(request_fingerprint)do update set last_requested_at=excluded.last_requested_at where private.prepared_aggregate_jobs.request_key=excluded.request_key returning id into j.id;
 return j.id;
end;$$;

-- All members of a batch are authorized before the first enqueue. This is a
-- result reader/admission path only: it never calls a raw calculation kernel.
create function private.prepared_aggregate_read(p_page text,p_request jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''as $$
declare access jsonb;page jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;items jsonb:='[]';reason text;dep text;k jsonb;j private.prepared_aggregate_jobs%rowtype;a private.prepared_aggregate_artifacts%rowtype;status text;v_id uuid;v_actor uuid:=auth.uid();budget integer;ctx jsonb;baseq jsonb;payload jsonb;commons jsonb:='{}';scope text;common text;
begin
 access:=private.dashboard_role_access();
 if (access->>'canView')::boolean is not true then raise exception using errcode='42501',message='preview_denied';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages')where value->>'id'=p_page;
 if page is null or not(page->'requests'?'aggregate')or not(page->'requests'?'aggregatePrepared')then raise exception using errcode='42501',message='page_action_denied';end if;
 if access->>'mode'='assigned'then
  if not private.dashboard_role_context_valid()or not(access->'permissions'?&array[p_page||'.view',p_page||'.query'])then raise exception using errcode='42501',message='role_permission_denied';end if;
  ctx:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb->'payload';
  if ctx->>'page'is distinct from p_page or ctx->>'rpc'is distinct from 'dashboard_admin_live_aggregate_prepared'or ctx->>'action'is distinct from 'aggregatePrepared'then raise exception using errcode='42501',message='page_action_denied';end if;
 end if;
 if p_request is null or jsonb_typeof(p_request)<>'object'or p_request-array['requests']<>'{}'::jsonb or octet_length(p_request::text)>1048576
 or jsonb_typeof(p_request->'requests')is distinct from 'array'or jsonb_array_length(p_request->'requests')not between 1 and 50 then raise exception using errcode='22023',message='invalid_prepared_batch';end if;
 -- Includes profile/session/IP/grant and exact native scope authorization.
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  begin v_id:=(q->>'platformId')::uuid;exception when others then raise exception using errcode='22023',message='invalid_platform';end;
  select value into t from jsonb_array_elements(catalog)where value->>'id'=v_id::text;
  if t is null then raise exception using errcode='42501',message='platform_denied';end if;
  targets:=targets||jsonb_build_array(t);
 end loop;
 for q,t in select r.value,x.value from jsonb_array_elements(p_request->'requests')with ordinality r(value,n)join jsonb_array_elements(targets)with ordinality x(value,n)using(n)loop
  reason:=private.prepared_aggregate_request_reason(q,t);
  if reason is not null then items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','unsupported','reason',reason,'publication',null,'result',null));continue;end if;
  scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;dep:=private.prepared_aggregate_dependency(t,common);baseq:=case when coalesce(q->>'view','full')='providers'then(q-array['providers','amountBands'])||jsonb_build_object('direction','all')else q||jsonb_build_object('direction','all')end;if private.prepared_aggregate_request_reason(baseq,t)is not null then baseq:=q;end if;k:=private.prepared_aggregate_key(baseq,t);payload:=null;
  select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
  select a0.*into a from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
  if a.id is not null and a.revision=j.revision and a.dependency=dep and j.dependency=dep and j.target=t and a.expires_at>clock_timestamp()then
   payload:=case when coalesce(q->>'view','full')='providers'then private.dashboard_prepared_provider_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))when baseq->>'direction'='all'then private.dashboard_prepared_direction_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))else a.payload end;
   update private.prepared_aggregate_jobs set last_requested_at=clock_timestamp()where id=j.id and last_requested_at<clock_timestamp()-interval'5minutes';
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','publication',jsonb_build_object('id',a.id,'generation',a.revision::text||':'||a.fence::text,'computedAt',a.computed_at,'expiresAt',a.expires_at,'cutoff',a.cutoff,'calculationComplete',true,'sourceComplete',a.source_complete),
    'result',private.prepared_aggregate_echo(coalesce(payload,a.payload),q,t)));
  else
   status:=case when a.id is not null then 'stale'when j.status in('queued','running')then'building'else'missing'end;
   -- Count newly observed exact requests only. Exceeding admission budget never
   -- reveals another scope or falls back to a synchronous source scan.
   if j.id is null then
    insert into private.prepared_aggregate_admissions(actor,day,total)values(v_actor,current_date,1)on conflict(actor,day)do update set total=private.prepared_aggregate_admissions.total+1 where private.prepared_aggregate_admissions.total<1000 returning total into budget;
    if budget is not null then perform private.prepared_aggregate_enqueue(baseq,t,dep,20::smallint);end if;
   else
    perform private.prepared_aggregate_enqueue(baseq,t,dep,20::smallint);
    update private.prepared_aggregate_jobs z set status='queued',not_before=clock_timestamp()where z.id=j.id and z.status='ready'and(a.expires_at<=clock_timestamp()or a.id is null);
   end if;
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status',status,'publication',null,'result',null));
  end if;
 end loop;
 return jsonb_build_object('version',1,'items',items);
end;$$;
create function private.dashboard_admin_live_aggregate_prepared(p_request jsonb)returns jsonb language plpgsql volatile security definer set search_path=''as $$
declare ctx jsonb:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb->'payload';begin
 return private.prepared_aggregate_read(ctx->>'page',p_request);end;$$;
create function public.dashboard_admin_aggregate_prepared(p_page text,p_request jsonb)returns jsonb language plpgsql volatile security definer set search_path=''as $$
declare a jsonb:=private.dashboard_role_access();begin
 if a->>'mode'='assigned'then return public.dashboard_admin_execute(p_page,p_request||jsonb_build_object('action','aggregatePrepared'));end if;
 return private.prepared_aggregate_read(p_page,p_request);end;$$;
revoke all on function public.dashboard_admin_aggregate_prepared(text,jsonb)from public,anon,service_role;grant execute on function public.dashboard_admin_aggregate_prepared(text,jsonb)to authenticated;

-- END store

-- BEGIN coordination
-- One admission lane for both prepared stores. Calculation functions and
-- provider dependency tokens stay unchanged; only scheduling is coordinated.
create table private.prepared_aggregate_worker_turn(
 singleton boolean primary key default true check(singleton),
 next_kind text check(next_kind in('provider','prepared')),waiting_since timestamptz);
insert into private.prepared_aggregate_worker_turn(singleton)values(true);
alter table private.prepared_aggregate_worker_turn enable row level security;
revoke all on private.prepared_aggregate_worker_turn from public,anon,authenticated,service_role;
create function private.prepared_aggregate_take_turn(p_kind text)returns boolean language plpgsql volatile set search_path=''as $$
declare turn private.prepared_aggregate_worker_turn%rowtype;other_due boolean;
begin
 if current_user<>'postgres'or p_kind not in('provider','prepared')then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 -- Both callers already hold provider_snapshot_claim_v1 and have selected a
 -- runnable task. Only a successful grant advances the alternating turn.
 select *into turn from private.prepared_aggregate_worker_turn where singleton for update;
 if turn.next_kind is not null and turn.next_kind<>p_kind then
  if p_kind='provider'then
   select exists(select 1 from private.prepared_aggregate_jobs where status in('queued','failed')and attempts<3 and not_before<=clock_timestamp())into other_due;
  else
   select exists(select 1 from private.provider_snapshot_jobs q join private.provider_snapshot_targets t on t.target=q.target and t.enabled
    where q.status in('queued','failed')and q.attempts<3 and q.not_before<=clock_timestamp()
    and(not exists(select 1 from private.provider_snapshot_cohort_jobs cj where cj.job_id=q.id)or exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_cohorts c on c.id=cj.cohort_id where cj.job_id=q.id and c.status='building')))into other_due;
  end if;
  -- Let the other one-second scheduler claim first. If it is unavailable,
  -- bounded fallback avoids indefinitely stalling a healthy scheduler.
  if other_due and(turn.waiting_since is null or turn.waiting_since>clock_timestamp()-interval'3seconds')then
   update private.prepared_aggregate_worker_turn set waiting_since=coalesce(waiting_since,clock_timestamp())where singleton;return false;
  end if;
 end if;
 update private.prepared_aggregate_worker_turn set next_kind=case p_kind when'provider'then'prepared'else'provider'end,waiting_since=null where singleton;
 return true;
end;$$;

-- Guarded in-place edits preserve the current provider worker's retention and
-- failure handling. The claim/run functions are not semantic kernel inputs.
do $coordination$
declare d text;anchor text;
begin
 d:=pg_get_functiondef('private.provider_snapshot_claim(text,integer)'::regprocedure);
 anchor:=$a$if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return null;end if;$a$;
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception using errcode='55000',message='prepared_provider_claim_lock_drift';end if;
 d:=replace(d,anchor,anchor||E'\n if exists(select 1 from private.prepared_aggregate_jobs where status=''running''and lease_until>clock_timestamp())then return null;end if;');
 anchor:=$a$if not found then return null;end if;$a$;
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception using errcode='55000',message='prepared_provider_claim_selection_drift';end if;
 d:=replace(d,anchor,anchor||E'\n if not private.prepared_aggregate_take_turn(''provider'')then return null;end if;');execute d;
 d:=pg_get_functiondef('private.provider_snapshot_run_claimed(text)'::regprocedure);
 anchor:=$a$if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))then return jsonb_build_object('status','busy');end if;$a$;
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception using errcode='55000',message='prepared_provider_worker_lock_drift';end if;
 d:=replace(d,anchor,$a$if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))then
  update private.provider_snapshot_jobs set status='queued',attempts=greatest(attempts-1,0),worker=null,lease_until=null,claim_backend_pid=null,claim_backend_start=null,not_before=clock_timestamp()+interval'1second',last_error_code=null,updated_at=clock_timestamp()
   where id=(claimed->>'jobId')::uuid and run_id=(claimed->>'runId')::uuid and fence=(claimed->>'fence')::bigint and worker=p_worker and status='running'and lease_until>clock_timestamp()and claim_backend_pid=pg_backend_pid()and claim_backend_start=backend_started;
  perform set_config('provider_snapshot.claim','',false);return jsonb_build_object('status','busy');end if;$a$);execute d;
end;$coordination$;

-- END coordination

-- BEGIN worker
create function private.prepared_aggregate_claim(p_worker text)returns jsonb language plpgsql volatile set search_path=''as $$
declare j private.prepared_aggregate_jobs%rowtype;started timestamptz;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if p_worker is null or length(p_worker)not between 1 and 80 or p_worker~'[[:cntrl:]]'then raise exception using errcode='22023',message='invalid_worker';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return null;end if;
 if exists(select 1 from private.prepared_aggregate_jobs where status='running'and lease_until>clock_timestamp())
 or exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;
 update private.prepared_aggregate_jobs set status='failed',last_error='lease_expired',not_before=clock_timestamp()+interval'1minute',lease_until=null where status='running'and lease_until<=clock_timestamp();
 select *into j from private.prepared_aggregate_jobs where status in('queued','failed')and not_before<=clock_timestamp()and attempts<3
 order by priority+least(60,floor(extract(epoch from(clock_timestamp()-not_before))/15))desc,not_before,created_at for update skip locked limit 1;
 if not found then return null;end if;
 if not private.prepared_aggregate_target_current(j.target)then update private.prepared_aggregate_jobs set status='failed',attempts=3,last_error='obsolete_target'where id=j.id;return null;end if;
 if not private.prepared_aggregate_take_turn('prepared')then return null;end if;
 select backend_start into started from pg_stat_activity where pid=pg_backend_pid();
 update private.prepared_aggregate_jobs set status='running',fence=fence+1,run_id=gen_random_uuid(),lease_until=clock_timestamp()+interval'120seconds',attempts=attempts+1,worker=p_worker,claim_pid=pg_backend_pid(),claim_backend_start=started where id=j.id returning *into j;
 return jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence,'revision',j.revision);
end;$$;
create function private.prepared_aggregate_prepare_claim(p_worker text)returns jsonb language plpgsql volatile set search_path=''as $$
declare j jsonb;budget interval:=current_setting('statement_timeout')::interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if budget<=interval'0seconds'or budget>interval'3seconds'then raise exception using errcode='22023',message='prepared_claim_deadline_required';end if;
 perform set_config('prepared_aggregate.claim','',false);j:=private.prepared_aggregate_claim(p_worker);
 if j is not null then perform set_config('prepared_aggregate.claim',j::text,false);end if;return j;
end;$$;
create function private.prepared_aggregate_complete(p_job uuid,p_run uuid,p_fence bigint,p_payload jsonb)
returns jsonb language plpgsql volatile set search_path=''as $$
declare j private.prepared_aggregate_jobs%rowtype;aid uuid;dep text;computed timestamptz:=clock_timestamp();cutoff timestamptz;expires timestamptz;bytes integer;secondary text;missing_direction text;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 select *into j from private.prepared_aggregate_jobs where id=p_job for update;
 if not found or j.status<>'running'or j.run_id is distinct from p_run or j.fence<>p_fence or j.lease_until<=clock_timestamp()then return jsonb_build_object('published',false,'reason','obsolete_claim');end if;
 dep:=private.prepared_aggregate_dependency(j.target);
 if dep<>j.dependency or not private.prepared_aggregate_target_current(j.target)then
  update private.prepared_aggregate_jobs set status='queued',revision=revision+1,dependency=dep,lease_until=null,not_before=clock_timestamp(),attempts=0 where id=j.id;
  return jsonb_build_object('published',false,'reason','dependency_changed');end if;
 bytes:=octet_length(p_payload::text);
 if p_payload is null or jsonb_typeof(p_payload)<>'object'or bytes>4194304
 or p_payload->>'version'is distinct from '1'or p_payload->'rows'is distinct from '[]'::jsonb
 or jsonb_typeof(p_payload->'summary')is distinct from'array'or jsonb_typeof(p_payload->'groups')is distinct from'object'
 or jsonb_typeof(p_payload#>'{groups,provider}')is distinct from'array'
 or p_payload->'partial'='true'::jsonb or p_payload->'complete'='false'::jsonb or p_payload?'error'
 or exists(select 1 from jsonb_each(p_payload->'groups')x where jsonb_typeof(x.value)<>'array')
 or p_payload->>'successBasis'is distinct from coalesce(j.request->>'successBasis',case when j.target->>'source'='duoli'then'source_updated'else'success'end)
 or(j.request->>'durationVersion'='2'and p_payload->>'durationVersion'is distinct from'2')
 or(j.request?'durationRange'and p_payload->'durationRange'is distinct from j.request->'durationRange')
 or(coalesce(j.request->>'view','full')='full'and not(p_payload->'groups'?&array['provider','hourly','daily','amount','matrix','latency','pending_age']))
 or p_payload#>>'{platform,id}'is distinct from j.target->>'id'
 or p_payload#>>'{platform,source}'is distinct from j.target->>'source'
 or p_payload#>>'{platform,sourceName}'is distinct from j.target->>'source_name'
 or p_payload#>>'{platform,country}'is distinct from j.target->>'country'
 or p_payload#>>'{platform,scopeGroup}'is distinct from j.target->>'scope_group'
 or p_payload#>>'{platform,currency}'is distinct from j.target->>'currency'
 or p_payload#>>'{platform,timezone}'is distinct from j.target->>'timezone'
 or(p_payload->>'startAt')::timestamptz is distinct from(j.request->>'startAt')::timestamptz
 or(p_payload->>'endAt')::timestamptz is distinct from(j.request->>'endAt')::timestamptz
 or(p_payload->>'successStartAt')::timestamptz is distinct from coalesce(j.request->>'successStartAt',j.request->>'startAt')::timestamptz
 or(p_payload->>'successEndAt')::timestamptz is distinct from coalesce(j.request->>'successEndAt',j.request->>'endAt')::timestamptz
 then raise exception using errcode='22023',message='prepared_incomplete_or_scope_mismatch';end if;
 secondary:=private.prepared_aggregate_secondary_reason(j.request,j.target);
 if secondary is not null then
  missing_direction:=case when j.target->>'source'='wg'and coalesce(j.request->>'direction','all')='all'then'withdraw'when j.target->>'source'='game66'and j.request->>'successBasis'='source_updated'and coalesce(j.request->>'direction','all')='all'then'charge'else'all'end;
  if private.prepared_aggregate_mask_secondary(p_payload,secondary,missing_direction)is distinct from p_payload or(j.request->>'status'='success'and(p_payload->'total'is distinct from'null'::jsonb or p_payload->'hasMore'is distinct from'null'::jsonb))then raise exception using errcode='22023',message='prepared_missing_secondary_capability';end if;
 end if;
 cutoff:=(p_payload->>'asOf')::timestamptz;
 if cutoff is null or not isfinite(cutoff)or cutoff>computed or cutoff<computed-interval'2minutes'then raise exception using errcode='22023',message='prepared_invalid_cutoff';end if;
 -- Current/mutable dates get ten-minute freshness; closed requests six hours.
 expires:=computed+case when greatest((j.request->>'endAt')::timestamptz,coalesce(j.request->>'successEndAt',j.request->>'endAt')::timestamptz)>computed-interval'24hours'then interval'10minutes'else interval'6hours'end;
 if(select coalesce(sum(a0.bytes),0)from private.prepared_aggregate_artifacts a0)+bytes>536870912 then raise exception using errcode='54000',message='prepared_storage_budget';end if;
 insert into private.prepared_aggregate_artifacts(job_id,run_id,fence,revision,dependency,payload,computed_at,expires_at,cutoff,source_complete,bytes)
 values(j.id,p_run,p_fence,j.revision,dep,p_payload,computed,expires,cutoff,false,bytes)returning id into aid;
 insert into private.prepared_aggregate_heads(job_id,artifact_id)values(j.id,aid)on conflict(job_id)do update set artifact_id=excluded.artifact_id;
 update private.prepared_aggregate_jobs set status='ready',lease_until=null,next_due_at=expires-interval'2minutes',attempts=0,last_error=null where id=j.id;
 return jsonb_build_object('published',true,'id',aid,'generation',j.revision::text||':'||j.fence::text);
end;$$;
create function private.prepared_aggregate_compute(q jsonb,t jsonb)returns jsonb language plpgsql stable set search_path=''set jit='off'as $$
declare request jsonb;result jsonb;reason text;secondary text;missing_direction text;
begin
 reason:=private.prepared_aggregate_request_reason(q,t);if reason is not null then raise exception using errcode='22023',message=reason;end if;
 request:=private.prepared_aggregate_expand_provider_filter(q,t);
 result:=private.prepared_aggregate_raw_kernel(request,jsonb_build_array(t));
 result:=private.provider_snapshot_orders_result_kernel(result,request);
 secondary:=private.prepared_aggregate_secondary_reason(q,t);
 if secondary is not null then
  missing_direction:=case when t->>'source'='wg'and coalesce(q->>'direction','all')='all'then'withdraw'when t->>'source'='game66'and q->>'successBasis'='source_updated'and coalesce(q->>'direction','all')='all'then'charge'else'all'end;
  result:=private.prepared_aggregate_mask_secondary(result,secondary,missing_direction);
  if q->>'status'='success'then result:=result||jsonb_build_object('total',null,'hasMore',null);end if;
 end if;
 return result;
end;$$;
create function private.prepared_aggregate_run_claimed(p_worker text)returns jsonb language plpgsql volatile set search_path=''as $$
declare j private.prepared_aggregate_jobs%rowtype;c jsonb;result jsonb;budget interval:=current_setting('statement_timeout')::interval;started timestamptz;code text;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if budget<=interval'0seconds'or budget>interval'50seconds'or current_setting('transaction_isolation')<>'read committed'then raise exception using errcode='22023',message='prepared_worker_deadline_required';end if;
 c:=nullif(current_setting('prepared_aggregate.claim',true),'')::jsonb;
 if c is null then return jsonb_build_object('status','idle');end if;
 select *into j from private.prepared_aggregate_jobs where id=(c->>'jobId')::uuid;
 select backend_start into started from pg_stat_activity where pid=pg_backend_pid();
 if j.id is null or j.status<>'running'or j.run_id::text is distinct from c->>'runId'or j.fence::text is distinct from c->>'fence'or j.worker is distinct from p_worker or j.claim_pid<>pg_backend_pid()or j.claim_backend_start is distinct from started or j.lease_until<=clock_timestamp()then return jsonb_build_object('status','obsolete');end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))then
  update private.prepared_aggregate_jobs set status='queued',attempts=greatest(attempts-1,0),worker=null,lease_until=null,claim_pid=null,claim_backend_start=null,not_before=clock_timestamp()+interval'1second',last_error=null where id=j.id and run_id=j.run_id and fence=j.fence and status='running'and lease_until>clock_timestamp()and claim_pid=pg_backend_pid()and claim_backend_start=started;
  perform set_config('prepared_aggregate.claim','',false);return jsonb_build_object('status','busy');end if;
 begin
  -- One STABLE expression supplies one database read snapshot. No auth context
  -- or user JWT is fabricated by the background worker.
  result:=private.prepared_aggregate_compute(j.request,j.target);
  return private.prepared_aggregate_complete(j.id,j.run_id,j.fence,result);
 exception when query_canceled then raise;
 when others then
  get stacked diagnostics code=returned_sqlstate;
  update private.prepared_aggregate_jobs set status='failed',last_error=code,lease_until=null,not_before=clock_timestamp()+make_interval(secs=>least(1800,60*(2^attempts)::integer))where id=j.id and run_id=j.run_id and fence=j.fence;
  return jsonb_build_object('status','failed','code',code);
 end;
end;$$;

-- Six native targets per tick, rotated by stable UUID, only three local days.
-- Full/custom requests are admitted by real authorized use and refreshed while
-- recently used; they are never multiplied across every source by the planner.
create function private.prepared_aggregate_prewarm(p_now timestamptz default now())returns jsonb language plpgsql volatile set search_path=''as $$
declare state private.prepared_aggregate_schedule%rowtype;t jsonb;d date;offset_day integer;q jsonb;dep text;n integer:=0;last_id uuid;last_tier smallint;commons jsonb:='{}';scope text;common text;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into state from private.prepared_aggregate_schedule where singleton for update;
 if not state.enabled then return jsonb_build_object('status','disabled');end if;
 update private.prepared_aggregate_jobs set status='queued',not_before=clock_timestamp(),attempts=0 where id in(select id from private.prepared_aggregate_jobs where status='ready'and next_due_at<=p_now and last_requested_at>p_now-interval'24hours'order by next_due_at limit 50);
 for t in select to_jsonb(p)from private.prepared_aggregate_native_catalog()p where state.cursor_id is null or(case when p.scope_group='IN'then 0 else 1 end,p.id)>(state.cursor_tier,state.cursor_id)order by case when p.scope_group='IN'then 0 else 1 end,p.id limit 6 loop
  d:=(p_now at time zone(t->>'timezone'))::date;scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;dep:=private.prepared_aggregate_dependency(t,common);
  for offset_day in 0..2 loop
   q:=jsonb_build_object('action','aggregate','view','providers','platformId',t->>'id','startAt',private.provider_snapshot_iso((d-offset_day)::timestamp at time zone(t->>'timezone')),'endAt',private.provider_snapshot_iso((d-offset_day+1)::timestamp at time zone(t->>'timezone')),'successStartAt',private.provider_snapshot_iso((d-offset_day)::timestamp at time zone(t->>'timezone')),'successEndAt',private.provider_snapshot_iso((d-offset_day+1)::timestamp at time zone(t->>'timezone')),'successBasis','success','direction','all','status','all','currency',t->>'currency','offset',0,'limit',20);
   if private.prepared_aggregate_request_reason(q,t)is null then perform private.prepared_aggregate_enqueue(q,t,dep,(case when t->>'scope_group'='IN'then 10-offset_day else 0 end)::smallint);n:=n+1;end if;
   if t->>'scope_group'='IN'and offset_day<2 then
    q:=q||jsonb_build_object('view','full','amountBands','{"charge":[100,200,300,400,500,1000,2000,5000,10000,20000,50000],"withdraw":[100,200,300,400,500,1000,2000,5000,10000,20000,50000]}'::jsonb);
    perform private.prepared_aggregate_enqueue(q,t,dep,(6-offset_day)::smallint);
    perform private.prepared_aggregate_enqueue(q||jsonb_build_object('durationVersion',2),t,dep,(4-offset_day)::smallint);n:=n+2;
   end if;
  end loop;last_tier:=case when t->>'scope_group'='IN'then 0 else 1 end;last_id:=(t->>'id')::uuid;
 end loop;
 update private.prepared_aggregate_schedule set cursor_id=last_id,cursor_tier=coalesce(last_tier,0)where singleton;
 return jsonb_build_object('status','queued','requests',n);
end;$$;
create function private.prepared_aggregate_maintenance()returns jsonb language plpgsql volatile set search_path=''as $$
declare n integer;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_maintenance_v1',0))then return jsonb_build_object('status','busy');end if;
 delete from private.prepared_aggregate_artifacts where id in(select a.id from private.prepared_aggregate_artifacts a left join private.prepared_aggregate_heads h on h.artifact_id=a.id where h.artifact_id is null order by a.computed_at limit 200);
 get diagnostics n=row_count;
 delete from private.prepared_aggregate_jobs where id in(select id from private.prepared_aggregate_jobs where last_requested_at<clock_timestamp()-interval'7days'and status<>'running'order by last_requested_at limit 100);
 delete from private.prepared_aggregate_admissions where day<current_date-7;
 return jsonb_build_object('status','complete','deletedArtifacts',n);
end;$$;

-- END worker

-- BEGIN gateway
-- Extend the existing page permission catalog only on pages already authorized
-- to aggregate. Preserve every unrelated role and gateway branch.
do $route$
declare d text;c jsonb;pages jsonb;anchor text:=$a$rpc:=case action$a$;
begin
 c:=private.dashboard_role_catalog();
 select jsonb_agg(case when p->>'id'=any(array['overview','collection','payout','merchants','providers','provider_payout','success_analysis','time','amount','matrix','provider_daily','latency','risk','teamops','teamcountries','teamplatforms','daily_comparison'])and p->'requests'?'aggregate'and not(p->'requests'?'aggregatePrepared')then jsonb_set(p,'{requests}',(p->'requests')||'"aggregatePrepared"'::jsonb)else p end order by n)into pages from jsonb_array_elements(c->'pages')with ordinality x(p,n);
 c:=jsonb_set(c,'{pages}',pages);
 execute 'create or replace function private.dashboard_role_catalog()returns jsonb language sql immutable set search_path='||quote_literal('')||'as '||quote_literal('select '||quote_literal(c::text)||'::jsonb');
 d:=pg_get_functiondef('public.dashboard_admin_execute(text,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 or position('aggregatePrepared'in d)>0 then raise exception using errcode='55000',message='prepared_gateway_anchor_drift';end if;
 if position('octet_length(p_request::text)>65536'in d)=0 then raise exception using errcode='55000',message='prepared_gateway_size_guard_drift';end if;
 d:=replace(d,'octet_length(p_request::text)>65536','octet_length(p_request::text)>(case when p_request->>''action''=''aggregatePrepared''then 1048576 else 65536 end)');
 d:=replace(d,anchor,anchor||E'\n  when ''aggregatePrepared'' then ''dashboard_admin_live_aggregate_prepared''');execute d;
end;$route$;
-- Only this endpoint is public. Helpers/tables cannot be called through REST,
-- by authenticated users, or by the service role.
do $acl$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname like 'prepared_aggregate_%'or p.proname='dashboard_admin_live_aggregate_prepared')loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end;$acl$;
notify pgrst,'reload schema';

-- END gateway
commit;
