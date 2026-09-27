-- Compact withdrawal/report catalog classification. No identities, data or permissions change.
-- Materialize country/key classification once per existing directory identity.
begin;
do $catalog_baseline$
declare actual text;
begin
 select md5(prosrc) into actual from pg_proc
 where oid=to_regprocedure('private.dashboard_admin_live_withdraw_platforms()');
 if actual is null or actual not in ('578bf9e046c386999d0fcae632fe743d','9eb1b8bf1433ed68193ffd1dc48f9495') then
  raise exception 'Withdrawal catalog baseline changed; review current definition before applying';
 end if;
end;
$catalog_baseline$;
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
  withdraw_display as materialized (
    select r.*,private.dashboard_admin_live_report_country(r.country,r.platform) as mapping_country,x.display_country
    from withdraw_raw r cross join lateral (select case when upper(r.country) in ('巴西','BR','BRAZIL') and exists(
      select 1 from withdraw_raw k where upper(k.country) in ('胖虎巴西','BR_PANGHU','PANGHU BRAZIL') and upper(k.platform)=upper(r.platform))
      then '胖虎巴西' else private.dashboard_admin_live_report_country(r.country,r.platform) end::text display_country)x
  ),
  withdraw_classified as materialized (
    select d.*,private.dashboard_admin_live_deposit_platform_key(d.display_country,d.platform) as platform_key,case d.display_country
      when '胖虎巴西' then 'BR_PANGHU' when '印度' then 'IN' when '巴西' then 'BR' when '巴基斯坦' then 'PK'
      when '印尼' then 'ID' when '越南' then 'VN' when '菲律宾' then 'PH' when '马来' then 'MY' when '缅甸' then 'MM'
      when '尼日利亚' then 'NG' when '哥伦比亚' then 'CO' when '墨西哥' then 'MX' when '智利' then 'CL'
      else coalesce(d.country_code,d.display_country) end::text scope_group
    from withdraw_display d
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
      where m.country=c.mapping_country
        and c.platform_key in(m.source_key,m.name_key)
    ) ownership on true
    where private.dashboard_scope_allows(v_scope,c.scope_group,c.platform)
  )
 select distinct w.id,w.name,w.team,w.country,w.scope_group,w.source,w.timezone,w.currency,w.source_name from withdraw_targets w;
end;
$function$;

commit;
