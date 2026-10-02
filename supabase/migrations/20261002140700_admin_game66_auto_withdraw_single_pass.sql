-- Read each authorized GAME66 platform/date fact range once, preserving all
-- existing daily/operator JSON, raw scope and numeric AVG semantics.
-- Existing index only: no table/index/collector/role changes.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $single_pass$
declare
 target regprocedure:=to_regprocedure('private.dashboard_admin_live_game66_withdraw(date,date,text,text[])');
 p pg_proc%rowtype; old_metadata jsonb; relation regclass; spec jsonb; name text;
begin
 select * into p from pg_proc where oid=target;
 if not found or md5(p.prosrc) is distinct from '779033b18df07a6e6b59c7f5770ba083'
  or md5(pg_get_functiondef(p.oid)) is distinct from 'eb50e5bd5d588fc2bd4477dd22389ae4'
  then raise exception 'game66_auto_single_pass_body_drift';end if;
 if p.proowner is distinct from 'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.prosecdef is distinct from true or p.provolatile is distinct from 's'
  or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""']
  or p.prolang is distinct from (select oid from pg_language where lanname='plpgsql')
  or p.prokind is distinct from 'f' or p.prorettype is distinct from 'jsonb'::regtype
  or p.proretset is distinct from false or p.proisstrict is distinct from false or p.proleakproof is distinct from false
  or p.procost is distinct from 100::real or p.prorows is distinct from 0::real
  or p.pronargs is distinct from 4 or p.pronargdefaults is distinct from 0 or p.provariadic is distinct from 0::oid
  or p.proargnames is distinct from array['p_start','p_end','p_country','p_platforms']
  or p.proargmodes is not null or p.proallargtypes is not null
  then raise exception 'game66_auto_single_pass_metadata_drift';end if;
 foreach name in array array['game66_platforms','game66_withdraw_orders'] loop
  relation:=to_regclass('public.'||name);
  if relation is null or not exists(select 1 from pg_class c where c.oid=relation
    and c.relkind='r' and c.relowner='postgres'::regrole and c.relrowsecurity and not c.relforcerowsecurity)
   then raise exception 'game66_auto_single_pass_relation_drift: %',name;end if;
  for spec in select value from jsonb_array_elements(case name when 'game66_platforms' then
   '[{"name":"id","type":"uuid"},{"name":"team_code","type":"text"},{"name":"team_name","type":"text"},{"name":"platform_code","type":"text"},{"name":"platform_name","type":"text"}]'::jsonb
   else '[{"name":"platform_id","type":"uuid"},{"name":"status_code","type":"text"},{"name":"auto_commit","type":"text"},{"name":"audit_admin","type":"text"},{"name":"lock_admin","type":"text"},{"name":"lock_user_admin","type":"text"},{"name":"create_time","type":"timestamptz"},{"name":"submit_time","type":"timestamptz"},{"name":"update_time","type":"timestamptz"},{"name":"last_seen_at","type":"timestamptz"}]'::jsonb end) loop
   if not exists(select 1 from pg_attribute a where a.attrelid=relation and a.attnum>0 and not a.attisdropped
    and a.attname=spec->>'name' and a.atttypid=(spec->>'type')::regtype)
    then raise exception 'game66_auto_single_pass_column_drift: %.%',name,spec->>'name';end if;
  end loop;
 end loop;
 if not exists(select 1 from pg_index i join pg_class ix on ix.oid=i.indexrelid
    where i.indrelid='public.game66_withdraw_orders'::regclass
      and i.indexrelid=to_regclass('public.game66_withdraw_orders_platform_time_idx')
      and ix.relowner='postgres'::regrole and i.indisvalid and i.indisready
      and pg_get_indexdef(i.indexrelid)='CREATE INDEX game66_withdraw_orders_platform_time_idx ON public.game66_withdraw_orders USING btree (platform_id, create_time DESC)')
  then raise exception 'game66_auto_single_pass_index_drift';end if;
 old_metadata:=to_jsonb(p)-'prosrc';
 execute $candidate$
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_game66_withdraw(p_start date, p_end date, p_country text, p_platforms text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_scope jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_operator_rows jsonb := '[]'::jsonb;
  v_latest timestamptz;
  v_operator_latest timestamptz;
  v_start_at timestamptz;
  v_end_at timestamptz;
begin
  perform private.dashboard_admin_live_scope();
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 366 then
    raise exception using errcode = '22023', message = 'GAME66_INVALID_DATE_RANGE';
  end if;

  v_scope := private.dashboard_admin_live_scope();
  v_start_at := p_start::timestamp at time zone 'Asia/Kolkata';
  v_end_at := (p_end + 1)::timestamp at time zone 'Asia/Kolkata';

  -- Offline candidate: source facts flow through one parameterized platform
  -- scan and one aggregate. No raw fact materialization or weighted-average
  -- rewriting; daily and operator AVG retain independent original states.
  with allowed_platforms as materialized (
    select p.id,
      case p.team_code
        when 'hong_kong' then 'HK_TEAM'
        when 'red_crab' then 'RED_CRAB'
        else upper(p.team_code)
      end as country_code,
      coalesce(nullif(pg_catalog.btrim(p.team_name), ''), nullif(pg_catalog.btrim(p.team_code), ''), '未分组团队') as country,
      coalesce(nullif(pg_catalog.btrim(p.platform_name), ''), nullif(pg_catalog.btrim(p.platform_code), ''), '未标记平台') as platform
    from public.game66_platforms p
    where p.team_name=p_country
      and (p_platforms is null or private.dashboard_admin_live_withdraw_key(p.platform_name)=any(p_platforms))
      and private.dashboard_scope_allows(v_scope,
        case p.team_code
          when 'hong_kong' then 'HK_TEAM'
          when 'red_crab' then 'RED_CRAB'
          else upper(p.team_code)
        end,p.platform_name)
  ), facts as (
    select (w.create_time at time zone 'Asia/Kolkata')::date as data_date,
      p.country_code,p.country,p.platform,
      case when w.auto_commit = '2' then '自动审核'
        else coalesce(nullif(pg_catalog.btrim(w.audit_admin), ''),
          nullif(pg_catalog.btrim(w.lock_admin), ''),
          nullif(pg_catalog.btrim(w.lock_user_admin), ''),
          '人工审核（未标记账号）') end as account,
      w.status_code,w.auto_commit,w.create_time,
      greatest(0::numeric,extract(epoch from (
        coalesce(w.update_time,w.submit_time,w.last_seen_at,w.create_time)-w.create_time
      ))) as handle_seconds,
      coalesce(w.last_seen_at,w.update_time,w.submit_time,w.create_time) as updated_at
    from allowed_platforms p cross join lateral (
      select w.create_time,w.status_code,w.auto_commit,w.audit_admin,
        w.lock_admin,w.lock_user_admin,w.update_time,w.submit_time,w.last_seen_at
      from public.game66_withdraw_orders w
      where w.platform_id=p.id and w.create_time>=v_start_at and w.create_time<v_end_at
      offset 0
    ) w
  ), source_stats as materialized (
    select data_date,country_code,country,platform,account,
      grouping(account) as grouping_level,
      count(*)::bigint as total,
      count(*) filter (where status_code in ('1','3'))::bigint as success,
      count(*) filter (where status_code = '-1')::bigint as rejected,
      count(*) filter (where auto_commit = '2')::bigint as auto_count,
      count(*) filter (where auto_commit is distinct from '2')::bigint as manual_count,
      count(*) filter (where status_code = '1')::bigint as submitted_count,
      count(*) filter (where status_code = '3')::bigint as paid_count,
      count(*) filter (where status_code = '2')::bigint as payout_failed_count,
      coalesce(avg(handle_seconds) filter (where create_time is not null),0)::numeric as avg_seconds,
      max(updated_at) as updated_at
    from facts
    group by grouping sets (
      (data_date,country_code,country,platform),
      (data_date,country_code,country,platform,account)
    )
  ), daily_grouped as (
    select * from source_stats where grouping_level=1
  ), operator_grouped as (
    select data_date,country_code,country,platform,account,total as processed,rejected,avg_seconds,updated_at
    from source_stats where grouping_level=0
  ), daily_result(rows,latest) as (
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(concat_ws('|||', 'game66', data_date::text, country_code, platform)),
      'data_date', data_date,
      'country_code', country_code,
      'country', country,
      'platform', platform,
      'total', total,
      'success', success,
      'rejected', rejected,
      'auto_count', auto_count,
      'manual_count', manual_count,
      'avg_seconds', avg_seconds,
      'avg_time_text', '',
      'source_sheet', 'game66_withdraw_orders',
      'raw', jsonb_build_object(
        'submitted_count', submitted_count,
        'paid_count', paid_count,
        'payout_failed_count', payout_failed_count,
        'success_status_codes', jsonb_build_array('1', '3'),
        'reject_status_code', '-1'
      ),
      'source_updated_at', updated_at,
      'updated_at', updated_at
    ) order by data_date, country_code, platform), '[]'::jsonb),
    max(updated_at)
  from daily_grouped
  ), operator_result(rows,latest) as (
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(concat_ws('|||', 'game66-operator', data_date::text, country_code, platform, account)),
      'data_date', data_date,
      'country_code', country_code,
      'country', country,
      'platform', platform,
      'account', account,
      'processed', processed,
      'rejected', rejected,
      'avg_seconds', avg_seconds,
      'avg_time_text', '',
      'source_sheet', 'game66_withdraw_orders',
      'raw', jsonb_build_object('operator_source', case when account = '自动审核' then 'auto_commit' else 'audit_admin' end),
      'source_updated_at', updated_at,
      'updated_at', updated_at
    ) order by data_date, country_code, platform, account), '[]'::jsonb),
    max(updated_at)
  from operator_grouped
  )
  select d.rows,d.latest,o.rows,o.latest
  into v_rows,v_latest,v_operator_rows,v_operator_latest
  from daily_result d cross join operator_result o;

  v_latest := greatest(v_latest, v_operator_latest);
  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'operatorRows', v_operator_rows,
    'latestWriteAt', v_latest
  );
end;
$function$

;
 $candidate$;
 select * into p from pg_proc where oid=target;
 if (to_jsonb(p)-'prosrc') is distinct from old_metadata
  or md5(p.prosrc) is distinct from 'df9722109e2b1443531c017a3bcf7d5f'
  then raise exception 'game66_auto_single_pass_postcondition_drift';end if;
end;
$single_pass$;
notify pgrst,'reload schema';
commit;
