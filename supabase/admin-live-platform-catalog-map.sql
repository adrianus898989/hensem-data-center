-- Include the authoritative team / package-system mapping in the private
-- catalog used by the new admin filters. Legacy pages do not call this RPC.
-- AR rows are catalogued from Supabase configuration and the active mapping:
-- a configured platform remains visible when it has no orders yet, and an
-- active mapping can supply a catalog row when the collector has not created
-- its config row yet. No source data is copied or rewritten.
begin;

-- Automatic-withdraw rows are a separate daily read model. Keep their
-- platform identity in the catalog so the withdrawal page can expose every
-- collected platform without making the order RPC pretend those rows are
-- transaction records.
create or replace function private.dashboard_admin_live_is_panghu_platform(p_name text)
returns boolean language sql immutable parallel safe set search_path='' as $$
  select upper(btrim(coalesce(p_name,'')))=any(array[
    'VIP345','KKVIP','KK345','FF555','TPTP','AA45','F75','25RR',
    '8599BET','9596BET','8566BET','5V555','58EE','27FF','222O','32QQ',
    '67VIP','222VIP','345F','234T','888HH','BET5697','96F','45FF',
    '76PP','56L','559K','2V222','776F','5C555','FF55','222VIP.COM','222-VIP','67-VIP'
  ]::text[])
$$;
revoke all on function private.dashboard_admin_live_is_panghu_platform(text) from public,anon,authenticated;

-- Source labels are authoritative; the alias list only repairs legacy Brazil labels.
create or replace function private.dashboard_admin_live_report_country(p_country text,p_platform text)
returns text language sql immutable parallel safe set search_path='' as $$
 select case when upper(btrim(p_country)) in ('南美','SA') and upper(btrim(p_platform)) in ('NPG-CHILE','NPG-COLOMBIA','NPG-MEXICO') then case upper(btrim(p_platform)) when 'NPG-CHILE' then '智利' when 'NPG-COLOMBIA' then '哥伦比亚' else '墨西哥' end when upper(btrim(p_country)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL')
   or (upper(btrim(p_country)) in ('巴西','BR','BRAZIL') and private.dashboard_admin_live_is_panghu_platform(p_platform))
 then '胖虎巴西' else case upper(btrim(p_country))
 when 'IN' then '印度' when 'INDIA' then '印度' when 'BR' then '巴西' when 'BRAZIL' then '巴西'
 when 'PK' then '巴基斯坦' when 'ID' then '印尼' when 'VN' then '越南' when 'PH' then '菲律宾'
 when 'MY' then '马来' when 'MM' then '缅甸' when 'NG' then '尼日利亚' when 'CO' then '哥伦比亚'
 when 'CL' then '智利' when 'MX' then '墨西哥' when 'HK_TEAM' then '香港' when 'RED_CRAB' then '红膏蟹'
 else btrim(p_country) end end
$$;
revoke all on function private.dashboard_admin_live_report_country(text,text) from public,anon,authenticated;

create or replace function private.dashboard_admin_live_platforms()
returns table(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)
language plpgsql stable security definer set search_path='' as $$
declare v_scope jsonb := private.dashboard_admin_live_scope();
begin
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
    left join public.dashboard_platform_team_map m on m.active and m.source_system='AR'
      and (m.source_country=t.country_name or m.source_country=t.country_code)
      and upper(btrim(m.source_platform))=upper(btrim(src.platform))
    where private.dashboard_scope_allows(v_scope,t.country_code,t.platform)
      and not (t.source_system='NEW_AR' and exists(select 1 from public.newar_detail_platforms n
        where n.platform=t.platform and n.country_code=t.country_code and n.enabled
          and (n.launch_at is null or n.launch_at<=now())
          and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
            and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0) offset 0))
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
      and private.dashboard_scope_allows(v_scope,m.country_code,m.source_platform)
      and not exists(select 1 from public.ar_config_targets t
        where t.country_code=m.country_code
          and upper(btrim(t.platform))=upper(btrim(m.source_platform))
          and not (t.source_system='NEW_AR' and exists(select 1 from public.newar_detail_platforms n
            where n.platform=t.platform and n.country_code=t.country_code and n.enabled
              and (n.launch_at is null or n.launch_at<=now())
              and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
                and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0) offset 0)))
  )
  select g.id,g.platform_name,case when upper(btrim(g.team_name)) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') then '胖虎' else g.team_name end,g.team_name,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,
    'game66'::text,'Asia/Kolkata'::text,'INR'::text,g.platform_name
  from public.game66_platforms g
  where private.dashboard_scope_allows(v_scope,
    case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name)
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
    and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
    and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
      and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0)
;
end;
$$;
revoke all on function private.dashboard_admin_live_platforms() from public,anon;
grant execute on function private.dashboard_admin_live_platforms() to authenticated;

-- Read only when explicitly listing collected/withdrawal platforms, never per order query.
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_withdraw_platforms()
 RETURNS TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_scope jsonb:=private.dashboard_admin_live_scope();
begin
 return query with
  withdraw_raw as (
    select distinct btrim(a.country)::text as country,btrim(a.platform)::text as platform,null::text as country_code
    from public.auto_withdraw_daily a
    where nullif(btrim(a.country),'') is not null and nullif(btrim(a.platform),'') is not null
    union
    select distinct btrim(o.country)::text,btrim(o.platform)::text,null::text
    from public.withdraw_operator_daily o
    where nullif(btrim(o.country),'') is not null and nullif(btrim(o.platform),'') is not null
    union
    select distinct btrim(s.country)::text,btrim(s.platform)::text,nullif(btrim(s.country_code),'')::text
    from public.newar_business_snapshots s
    where s.kind='auto_withdraw_bundle' and s.direction='all'
      and nullif(btrim(s.country),'') is not null and nullif(btrim(s.platform),'') is not null
  ),
  withdraw_classified as (
    select r.country,r.platform,x.display_country,case x.display_country
      when '胖虎巴西' then 'BR_PANGHU' when '印度' then 'IN' when '巴西' then 'BR' when '巴基斯坦' then 'PK'
      when '印尼' then 'ID' when '越南' then 'VN' when '菲律宾' then 'PH' when '马来' then 'MY' when '缅甸' then 'MM'
      when '尼日利亚' then 'NG' when '哥伦比亚' then 'CO' when '墨西哥' then 'MX' when '智利' then 'CL'
      else coalesce(r.country_code,x.display_country) end::text scope_group
    from withdraw_raw r cross join lateral (select case when upper(r.country) in ('巴西','BR','BRAZIL') and exists(
      select 1 from withdraw_raw k where upper(k.country) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') and upper(k.platform)=upper(r.platform))
      then '胖虎巴西' else private.dashboard_admin_live_report_country(r.country,r.platform) end::text display_country)x
  ),
  mapping_keys as materialized (
    -- Read existing ownership once. A source-neutral report seed may inherit
    -- only when every active mapping of this exact country/key agrees.
    select m.team_name,
      private.dashboard_admin_live_report_country(m.source_country,m.source_platform) as country,
      private.dashboard_admin_live_withdraw_key(m.source_platform) as source_key,
      private.dashboard_admin_live_withdraw_key(m.platform_name) as name_key
    from public.dashboard_platform_team_map m where m.active
  ),
  withdraw_targets as (
    select md5('withdraw:'||c.display_country||':'||c.platform)::uuid as id,
      c.platform::text as name,
      case when c.scope_group='BR_PANGHU' then '胖虎' when ownership.teams=1 then ownership.team when ownership.teams>1 then '__team_conflict__' else '__unassigned__' end::text as team,
      c.display_country::text as country,c.scope_group::text as scope_group,
      'withdraw'::text as source,
      case c.scope_group
        when 'IN' then 'Asia/Kolkata' when 'BR' then 'America/Sao_Paulo' when 'BR_PANGHU' then 'America/Sao_Paulo'
        when 'PK' then 'Asia/Karachi' when 'ID' then 'Asia/Jakarta' when 'VN' then 'Asia/Ho_Chi_Minh'
        when 'PH' then 'Asia/Manila' when 'MY' then 'Asia/Kuala_Lumpur' when 'MM' then 'Asia/Yangon'
        when 'NG' then 'Africa/Lagos' when 'CO' then 'America/Bogota' when 'MX' then 'America/Mexico_City'
        when 'CL' then 'America/Santiago' else 'Asia/Kolkata' end::text as timezone,
      case c.scope_group
        when 'IN' then 'INR' when 'BR' then 'BRL' when 'BR_PANGHU' then 'BRL' when 'PK' then 'PKR'
        when 'ID' then 'IDR' when 'VN' then 'VND' when 'PH' then 'PHP' when 'MY' then 'MYR'
        when 'MM' then 'MMK' when 'NG' then 'NGN' when 'CO' then 'COP' when 'MX' then 'MXN'
        when 'CL' then 'CLP' else null end::text as currency,
      c.platform::text as source_name
    from withdraw_classified c
    left join lateral (
      select count(distinct m.team_name) as teams,min(m.team_name) as team
      from mapping_keys m
      where m.country=private.dashboard_admin_live_report_country(c.country,c.platform)
        and private.dashboard_admin_live_deposit_platform_key(c.display_country,c.platform) in(m.source_key,m.name_key)
    ) ownership on true
    where private.dashboard_scope_allows(v_scope,c.scope_group,c.platform)
  )
 select distinct w.id,w.name,w.team,w.country,w.scope_group,w.source,w.timezone,w.currency,w.source_name from withdraw_targets w;
end;
$function$;
revoke all on function private.dashboard_admin_live_withdraw_platforms() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
