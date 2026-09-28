-- Batch only already-scoped workorder names. Preserve the scalar classifier's
-- exact precedence, platform overrides and conflict behavior; never cache across requests.
begin;
create or replace function private.dashboard_admin_live_workorder_provider_batch(p_names jsonb)
returns table(country text,platform text,raw_provider text,channel_type text,provider text)
language sql stable set search_path='' as $batch$
 with inputs as materialized (
  select distinct i.*,btrim(coalesce(i.raw_provider,'')) raw,btrim(coalesce(i.channel_type,'')) channel,
   regexp_replace(lower(btrim(coalesce(i.raw_provider,''))),'[^a-z0-9一-龥]+','','g') r,
   regexp_replace(lower(btrim(coalesce(i.channel_type,''))),'[^a-z0-9一-龥]+','','g') c
  from jsonb_to_recordset(p_names) i(country text,platform text,raw_provider text,channel_type text)
 ), rules as materialized (
  select i.*,case when i.country='印度' and (r='arbpayinr' or c='arbpayinr') then 'ArbPay'
   else o.canonical_provider end direct,
   case when i.country='印度' and r='paytm' then case c
    when 'haoxpayinr' then 'WPay' when 'wpayinr' then 'WPay' when 'ic2payinr' then 'ICPay'
    when 'ninepayinr' then 'NinePay' when 'ox2payinr' then 'OXPay' when 'rapayinr' then 'RAPay'
    when 'umoneypayinr' then 'UmoneyPay' when 'wepay2inr' then 'WePay' end
   when i.country='印度' and r='qr' then case c when 'umoneypayinr' then 'UmoneyPay' when 'wepay2inr' then 'WePay' end
   when i.country='缅甸' and r in ('kbzpay','wavepay') then case c when 'kingpaymmk' then 'KingPay' when 'ytpaymmk' then 'YTPay' end
   when i.country='马来' and r='duitnow' and c='fpaymyr' then 'FPay'
   when i.country='马来' and r='touchngo' and c='truepaymyr' then 'TruePay' end named,
   (i.country='印度' and r in ('paytm','qr') or i.country='缅甸' and r in ('kbzpay','wavepay')
     or i.country='马来' and r in ('duitnow','touchngo')) generic
  from inputs i left join private.dashboard_admin_provider_overrides o
   on o.country=i.country and o.platform=i.platform and o.raw_provider=i.raw
 ), lookup as materialized (
  select *,case when named is null and generic and c<>'' and c<>r then raw||' / '||channel else coalesce(named,raw) end lookup_name
  from rules
 ), registry as materialized (
  select l.*,r.raw_provider registry_raw,r.canonical_values,o.canonical_provider override_name
  from lookup l left join private.dashboard_admin_provider_registry r
   on l.direct is null and r.country=l.country and r.platform=l.platform
    and r.raw_provider=case when l.lookup_name='未识别通道' then '' else l.lookup_name end
  left join private.dashboard_admin_provider_overrides o
   on o.country=r.country and o.platform=r.platform and o.raw_provider=r.raw_provider
 ), sets as materialized (
  select distinct country,canonical_values from registry where direct is null and override_name is null and registry_raw is not null
 ), names as materialized (
  select country,canonical_values,private.dashboard_admin_live_provider_alias_values(country,canonical_values) values from sets
 ), candidates as materialized (
  select r.*,coalesce(r.override_name,
   case when registry_raw is not null then private.dashboard_admin_live_confirmed_usdt_provider(r.country,registry_raw) end,
   case when cardinality(n.values)=1 then n.values[1] end,lookup_name) canonical_input
  from registry r left join names n on n.country=r.country and n.canonical_values is not distinct from r.canonical_values
 ), aliases as materialized (
  select country,canonical_input,private.dashboard_admin_live_provider_alias(country,canonical_input) result
  from (select distinct country,canonical_input from candidates where direct is null) x
 )
 select c.country,c.platform,c.raw_provider,c.channel_type,coalesce(c.direct,a.result)
 from candidates c left join aliases a on a.country is not distinct from c.country and a.canonical_input is not distinct from c.canonical_input;
$batch$;
revoke all on function private.dashboard_admin_live_workorder_provider_batch(jsonb) from public,anon,authenticated;
do $patch$
declare definition text; original text; replacement text;
begin
 select pg_get_functiondef('private.dashboard_admin_live_workorders(jsonb)'::regprocedure) into definition;
 if position('workorder_provider_batch_v2' in definition)=0 then
  original:=$old$  ), workorder_provider_names_v1 as materialized (
    select names.*,private.dashboard_admin_live_workorder_provider(names.country,names.platform,names.raw_provider,
      nullif(names.channel_type,'未识别通道')) as canonical_provider
    from (select distinct country,platform,raw_provider,channel_type from scoped) names
$old$;
  replacement:=$new$  ), workorder_provider_batch_v2 as materialized (
    select * from private.dashboard_admin_live_workorder_provider_batch((select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb)
      from (select distinct country,platform,raw_provider,nullif(channel_type,'未识别通道') channel_type from scoped) n))
  ), workorder_provider_names_v1 as materialized (
    select names.*,b.provider canonical_provider from (select distinct country,platform,raw_provider,channel_type from scoped) names
    join workorder_provider_batch_v2 b on b.country=names.country and b.platform=names.platform and b.raw_provider=names.raw_provider
     and b.channel_type is not distinct from nullif(names.channel_type,'未识别通道')
$new$;
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Workorder batch summary baseline changed';end if;
  execute replace(definition,original,replacement);
 end if;
 select pg_get_functiondef('private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure) into definition;
 if position('dashboard_admin_live_workorder_provider_batch' in definition)=0 then
  original:=$old$    select x.*,private.dashboard_admin_live_workorder_provider(x.country,x.platform,x.raw_provider,x.channel_type) as provider
    from (select distinct country,platform,raw_provider,channel_type from raw_details) x$old$;
  replacement:=$new$    select * from private.dashboard_admin_live_workorder_provider_batch((select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
      from (select distinct country,platform,raw_provider,channel_type from raw_details) x))$new$;
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then raise exception 'Workorder batch unique baseline changed';end if;
  execute replace(definition,original,replacement);
 end if;
end;
$patch$;
notify pgrst,'reload schema';
commit;
