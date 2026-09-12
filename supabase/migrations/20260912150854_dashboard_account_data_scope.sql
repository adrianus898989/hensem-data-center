-- Account data scope: additive, restrictive, read-time authorization only.
-- No collector, source country, business value, existing module policy or view is rewritten.
-- Existing accounts retain all data. Owner accounts must retain all data.
begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.dashboard_data_scope_valid(p_scope jsonb)
returns boolean language plpgsql immutable set search_path = '' as $function$
begin
  if p_scope is null or jsonb_typeof(p_scope) is distinct from 'object'
     or jsonb_typeof(p_scope->'countries') is distinct from 'array' then return false; end if;
  if p_scope->>'mode' = 'all' then return jsonb_array_length(p_scope->'countries') = 0; end if;
  if p_scope->>'mode' is distinct from 'selected'
     or jsonb_array_length(p_scope->'countries') = 0 then return false; end if;
  return not exists (
    select 1 from jsonb_array_elements(p_scope->'countries') as entry(value)
    where jsonb_typeof(value) is distinct from 'string'
       or (value #>> '{}') <> all (array[
         'BR_PANGHU','BR','IN','PK','ID','VN','PH','MY','MM','NG','CO','MX','CL','SA','BR_NATIVE','USDT'
       ]::text[])
  );
end;
$function$;

-- Kept in exact semantic parity with src/lib/dashboardDataScope.ts.
-- Platform remapping is applied only inside Brazil, never across countries.
create or replace function private.dashboard_data_group(p_country text, p_platform text default '')
returns text language plpgsql immutable set search_path = '' as $function$
declare
  -- ECMAScript String.trim whitespace, including NBSP/BOM (not arbitrary punctuation).
  v_trim text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_country text := upper(btrim(regexp_replace(btrim(coalesce(p_country,''),v_trim), '盘口$', ''),v_trim));
  v_platform text := upper(btrim(coalesce(p_platform,''),v_trim));
  v_group text;
begin
  v_group := case
    when v_country = any(array['BR_PANGHU','BR','IN','PK','ID','VN','PH','MY','MM','NG','CO','MX','CL','SA','BR_NATIVE','USDT']) then v_country
    when v_country = any(array['巴西','BRAZIL']) then 'BR'
    when v_country = any(array['胖虎巴西','PANGHU BRAZIL']) then 'BR_PANGHU'
    when v_country = any(array['印度','印度线下','INDIA']) then 'IN'
    when v_country = any(array['巴基斯坦','PAKISTAN']) then 'PK'
    when v_country = any(array['印尼','印度尼西亚','INDONESIA']) then 'ID'
    when v_country = any(array['越南','VIETNAM']) then 'VN'
    when v_country = any(array['菲律宾','PHILIPPINES']) then 'PH'
    when v_country = any(array['马来','马来西亚','MALAYSIA']) then 'MY'
    when v_country = any(array['缅甸','MYANMAR']) then 'MM'
    when v_country = any(array['尼日利亚','NIGERIA']) then 'NG'
    when v_country = any(array['哥伦比亚','COLOMBIA']) then 'CO'
    when v_country = any(array['墨西哥','MEXICO']) then 'MX'
    when v_country = any(array['智利','CHILE']) then 'CL'
    when v_country = any(array['南美','SOUTH AMERICA']) then 'SA'
    when v_country = '巴西原生' then 'BR_NATIVE'
    when v_country = any(array['USDT通道','USDT 通道']) then 'USDT'
    else '' end;
  if v_group = 'SA' then
    v_group := case v_platform when 'NPG-CHILE' then 'CL' when 'NPG-COLOMBIA' then 'CO'
      when 'NPG-MEXICO' then 'MX' else v_group end;
  end if;
  if v_group in ('BR','BR_PANGHU') then
    v_platform := case v_platform when 'FF55' then 'FF555' when '222VIP.COM' then '222VIP'
      when '222-VIP' then '222VIP' when '67-VIP' then '67VIP' else v_platform end;
    if v_platform = any(array[
      'VIP345','KKVIP','KK345','FF555','TPTP','AA45','F75','25RR','8599BET','9596BET','8566BET',
      '5V555','58EE','27FF','222O','32QQ','67VIP','222VIP','345F','234T','888HH','BET5697',
      '96F','45FF','76PP','56L','559K','2V222','776F','5C555'
    ]) then return 'BR_PANGHU'; end if;
    if v_platform = any(array['POPNOV','POPFEZ','POPCRA']) then return 'BR'; end if;
  end if;
  return v_group;
end;
$function$;

alter table public.dashboard_profiles
  add column if not exists data_scope jsonb not null default '{"mode":"all","countries":[]}'::jsonb;
alter table public.dashboard_profiles
  alter column data_scope set default '{"mode":"all","countries":[]}'::jsonb,
  alter column data_scope set not null;
alter table public.dashboard_profiles drop constraint if exists dashboard_profiles_data_scope_valid;
alter table public.dashboard_profiles add constraint dashboard_profiles_data_scope_valid check (
  private.dashboard_data_scope_valid(data_scope)
  and (role <> 'owner' or data_scope->>'mode' = 'all')
);

-- The caller cannot supply a profile ID or trusted scope. auth.uid() remains
-- the original request identity even when a SECURITY DEFINER RPC calls this.
create or replace function private.dashboard_current_data_scope()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_profile public.dashboard_profiles%rowtype;
  v_scope jsonb;
begin
  select * into v_profile from public.dashboard_profiles where auth_user_id = (select auth.uid()) and active = true;
  if not found then return '{"mode":"selected","countries":[]}'::jsonb; end if;
  if v_profile.role = 'owner' then return '{"mode":"all","countries":[]}'::jsonb; end if;
  v_scope := v_profile.data_scope;
  if not private.dashboard_data_scope_valid(v_scope) then return '{"mode":"selected","countries":[]}'::jsonb; end if;
  if v_scope->>'mode' = 'all' then return '{"mode":"all","countries":[]}'::jsonb; end if;
  return jsonb_build_object('mode','selected','countries',(
    select jsonb_agg(value order by value) from (select distinct value from jsonb_array_elements_text(v_scope->'countries')) as keys
  ));
end;
$function$;

create or replace function private.dashboard_scope_allows(p_scope jsonb, p_country text, p_platform text default '')
returns boolean language plpgsql immutable set search_path = '' as $function$
declare v_group text;
begin
  if not private.dashboard_data_scope_valid(p_scope) then return false; end if;
  if p_scope->>'mode' = 'all' then return true; end if;
  v_group := private.dashboard_data_group(p_country,p_platform);
  return v_group <> '' and (p_scope->'countries') ? v_group;
end;
$function$;

revoke all on function private.dashboard_data_scope_valid(jsonb) from public, anon;
revoke all on function private.dashboard_data_group(text,text) from public, anon;
revoke all on function private.dashboard_current_data_scope() from public, anon;
revoke all on function private.dashboard_scope_allows(jsonb,text,text) from public, anon;
grant execute on function private.dashboard_data_scope_valid(jsonb), private.dashboard_data_group(text,text),
  private.dashboard_current_data_scope(), private.dashboard_scope_allows(jsonb,text,text) to authenticated, service_role;

-- RESTRICTIVE makes this an AND with every existing module/read/write policy.
-- No permissive policy, table grant, ingest credential, receipt or view changes.
do $policies$
declare v_table text;
begin
  foreach v_table in array array['auto_withdraw_daily','withdraw_operator_daily','third_party_volume','third_party_platform_status'] loop
    execute format('drop policy if exists dashboard_data_scope_read on public.%I',v_table);
    execute format('create policy dashboard_data_scope_read on public.%I as restrictive for select to authenticated using (private.dashboard_scope_allows((select private.dashboard_current_data_scope()),country,platform))',v_table);
  end loop;
  foreach v_table in array array['ar_config_daily','ar_config_targets','panda_config_daily','panda_config_targets',
    'panda_config_dictionary_daily','wg_config_daily','wg_config_targets','withdraw_reasons_daily','withdraw_member_notes_daily'] loop
    execute format('drop policy if exists dashboard_data_scope_read on public.%I',v_table);
    execute format('create policy dashboard_data_scope_read on public.%I as restrictive for select to authenticated using (private.dashboard_scope_allows((select private.dashboard_current_data_scope()),country_code,platform))',v_table);
  end loop;
  -- Rates have no platform identity: a Brazil rate must never be borrowed by
  -- a Panghu-only account. This does not alter any stored rate or business key.
  drop policy if exists dashboard_data_scope_read on public.third_party_rates;
  create policy dashboard_data_scope_read on public.third_party_rates as restrictive for select to authenticated
    using (private.dashboard_scope_allows((select private.dashboard_current_data_scope()),country,''));
  -- These are source/global task totals, not safely assignable platform rows.
  -- Even a Brazil source country can aggregate both Brazil presentation groups.
  foreach v_table in array array['auto_withdraw_history_backfill','auto_withdraw_sync_status','third_party_history_backfill','sync_status'] loop
    execute format('drop policy if exists dashboard_data_scope_read on public.%I',v_table);
    execute format('create policy dashboard_data_scope_read on public.%I as restrictive for select to authenticated using (((select private.dashboard_current_data_scope())->>''mode'') = ''all'')',v_table);
  end loop;
end;
$policies$;

drop policy if exists dashboard_data_scope_all on public.auto_withdraw_notes;
create policy dashboard_data_scope_all on public.auto_withdraw_notes as restrictive for all to authenticated
  using (private.dashboard_scope_allows((select private.dashboard_current_data_scope()),country,platform))
  with check (private.dashboard_scope_allows((select private.dashboard_current_data_scope()),country,platform));

-- The existing sync RPC is SECURITY DEFINER, so an RLS-only patch is insufficient.
-- Insert an explicitly scoped branch AFTER its existing module permission check.
-- The all-data path, function signature, grants and original SQL stay byte-identical.
do $rpc$
declare
  v_definition text := pg_get_functiondef('public.dashboard_third_party_sync_status(date,date)'::regprocedure);
  v_anchor text := E'  select\n    count(*)::int,';
  v_marker text := '-- dashboard_data_scope_restricted_v1';
  v_branch text := $branch$
  -- dashboard_data_scope_restricted_v1
  if (private.dashboard_current_data_scope()->>'mode') is distinct from 'all' then
    select max(v.updated_at),count(distinct v.data_date)::int,
      count(distinct v.data_date) filter (where v.direction='代收')::int,
      count(distinct v.data_date) filter (where v.direction='代付')::int
    into v_db_last,v_data_days,v_collect_days,v_payout_days
    from public.third_party_volume v
    where v.data_date between p_start and p_end
      and private.dashboard_scope_allows((select private.dashboard_current_data_scope()),v.country,v.platform);
    select greatest(
      coalesce((select max(r.updated_at) from public.third_party_rates r
        where private.dashboard_scope_allows((select private.dashboard_current_data_scope()),r.country,'')), '-infinity'::timestamptz),
      coalesce((select max(s.updated_at) from public.third_party_platform_status s
        where private.dashboard_scope_allows((select private.dashboard_current_data_scope()),s.country,s.platform)), '-infinity'::timestamptz)
    ) into v_rate_last;
    if v_rate_last = '-infinity'::timestamptz then v_rate_last := null; end if;
    return jsonb_build_object(
      'ok',true,'start',p_start,'end',p_end,'dataScopeRestricted',true,
      'historyTasks',null,'historySuccess',null,'historyRemaining',null,'historyFailed',null,
      'historyRowsWritten',null,'historyLatestSyncAt',null,'historyComplete',false,
      'dataDays',v_data_days,'collectDays',v_collect_days,'payoutDays',v_payout_days,
      'latestWriteAt',v_db_last,'ratesLatestWriteAt',v_rate_last);
  end if;
  -- dashboard_data_scope_restricted_v1_end

$branch$;
begin
  if position(v_marker in v_definition) > 0 then return; end if;
  if position('SECURITY DEFINER' in v_definition) = 0
    or position(E'raise exception ''没有三方量 / 费率查看权限'';' in v_definition) = 0
    or position(E'raise exception ''没有三方量 / 费率查看权限'';' in v_definition) > position(v_anchor in v_definition)
    or (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1 then
    raise exception 'DASHBOARD_DATA_SCOPE_SYNC_RPC_BASELINE_MISMATCH';
  end if;
  execute replace(v_definition,v_anchor,v_branch || v_anchor);
end;
$rpc$;

commit;

-- Production verification plan (operator review required; do not save real accounts):
-- BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='<test uuid>';
-- Test one owner/all and one synthetic restricted account against every base table,
-- security-invoker latest/grouped view, fast/fast_v2 RPC, sync RPC and notes WITH CHECK.
-- Test BR_PANGHU vs BR, country aliases, another module denied, and an inactive profile.
-- Inspect globals/rates/unknown country rejection; compare original values and row keys.
-- RESET ROLE; ROLLBACK; -- Always roll back temporary profiles/notes; never commit fixtures.
