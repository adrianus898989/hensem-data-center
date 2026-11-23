-- Amount-page previous-period single-provider selection only. Existing financial functions and grants are untouched.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $amount_provider_subset$
declare reader regprocedure:='private.dashboard_serving_ready_read(text,jsonb)'::regprocedure;
 definition text;common_before jsonb;common_after jsonb;d record;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='amount_provider_release_owner_required';end if;
 for d in select * from (values
  ('private.dashboard_admin_live_provider_canonical(text,text,text)','4cda5f3c69719886903b149adc206e20'),
  ('private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)','69fed90d2ec868b637756e93ab4e02ab'),
  ('private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)','0d13d39347899ee453179c1b7851d749')
 ) as f(identity,digest) loop
  if not exists(select from pg_proc p where p.oid=to_regprocedure(d.identity) and md5(pg_get_functiondef(p.oid))=d.digest
    and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}')
  then raise exception using errcode='22023',message='amount_provider_prerequisite_drift',detail=d.identity;end if;
 end loop;
 select pg_get_functiondef(p.oid) into definition from pg_proc p where p.oid=reader
  and md5(p.prosrc)='966f086a1a862f926ff92967deaa6ec4' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}'
  and p.provolatile='s' and not p.prosecdef;
 if md5(definition) is distinct from 'a556549c122d06bc0c4a92a9a795aafc' then raise exception using errcode='22023',message='amount_provider_install_preflight_drift';end if;
 select jsonb_object_agg(s,private.prepared_aggregate_dependency_common(s)) into common_before from unnest(array['IN','BR','VN','ID','PK','ZAR','MX','CO'])s;
 definition:=replace(definition,
$old$ profile_groups text[];projected jsonb;$old$,
$new$ profile_groups text[];projected jsonb;
 provider_subset_ok boolean:=false;provider_leaves jsonb;provider_country text;provider_platform text;requested_provider text;$new$);
 definition:=replace(definition,
$old$ select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;$old$,
$new$ select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 if p_page='amount' and not full_transport then
  -- A later change to matching or either projection resumes the original path.
  select bool_and(md5(pg_get_functiondef(to_regprocedure(f.identity))) is not distinct from f.digest)
   into provider_subset_ok from (values
    ('private.dashboard_admin_live_provider_canonical(text,text,text)','4cda5f3c69719886903b149adc206e20'),
    ('private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)','69fed90d2ec868b637756e93ab4e02ab'),
    ('private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)','0d13d39347899ee453179c1b7851d749')
   ) as f(identity,digest);
 end if;$new$);
 definition:=replace(definition,
$old$  payload:=artifact.payload;projection_base:=private.prepared_aggregate_canonical_request(baseq,t);$old$,
$new$  payload:=artifact.payload;projection_base:=private.prepared_aggregate_canonical_request(baseq,t);
  if provider_subset_ok and jsonb_typeof(c->'providers')='array' and jsonb_array_length(c->'providers')=1 then
   provider_country:=payload#>>'{platform,country}';provider_platform:=payload#>>'{platform,sourceName}';
   provider_leaves:=payload#>'{groups,provider}';requested_provider:=c#>>'{providers,0}';
   if provider_country='印度' and provider_country=t->>'country' and provider_platform=t->>'source_name'
    and payload#>>'{platform,id}'=t->>'id' and jsonb_array_length(provider_leaves) between 4 and 512
    and not exists(select from jsonb_array_elements(provider_leaves) leaf
      where jsonb_typeof(leaf) is distinct from 'object' or jsonb_typeof(leaf->'provider') is distinct from 'string'
       or coalesce(leaf->>'direction','') not in ('charge','withdraw'))
    -- Full-master provider conversion sorts by these three columns. Preserve
    -- its original tie ordering for publishers that emit duplicate keys.
    and (baseq->>'view'<>'full' or not exists(
      select from jsonb_array_elements(provider_leaves) leaf
      group by leaf->>'provider',leaf->>'direction',leaf->>'currency' having count(*)>1))
   then
    -- Evaluate the pinned native resolver once per distinct name in this
    -- platform. Keep its scalar lookups, live overrides and exact precedence.
    -- Extract the three small inputs once rather than detoasting a full master for every label.
    with labels as materialized(
      select leaf->>'provider' as raw from jsonb_array_elements(provider_leaves) leaf
       where c->>'direction'='all' or leaf->>'direction'=c->>'direction'
      union select requested_provider
    ), wg as materialized(select * from private.dashboard_admin_wg_provider_aliases()),
    mapped as materialized(select i.raw,
     case when i.country in ('IN','印度') and i.platform in ('YASH.BET','YASHBET') and btrim(i.raw)='WinPay'
  then private.dashboard_admin_live_provider_alias(i.country,coalesce(
    (select o.canonical_provider from private.dashboard_admin_provider_overrides o
     where o.country=i.country and o.platform=i.platform and o.raw_provider=btrim(i.raw)),
    'NewWinPay')) else private.dashboard_admin_live_provider_alias(i.country,coalesce(
  (select coalesce(o.canonical_provider,a.canonical_provider)
   from wg a
   left join private.dashboard_admin_provider_overrides o on o.country=a.country and o.platform=a.platform and o.raw_provider=a.raw_provider
   where i.country in (a.country_code,a.country) and i.platform=a.platform and btrim(i.raw)=a.raw_provider),
  (select coalesce(o.canonical_provider,private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider),case when cardinality(n.names)=1 then n.names[1] end)
    from private.dashboard_admin_provider_registry r left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
    cross join lateral (select private.dashboard_admin_live_provider_alias_values(r.country,r.canonical_values) names)n
    where r.country=i.country and r.platform=i.platform and r.raw_provider=case when i.raw='未识别通道' then '' else coalesce(btrim(i.raw),'') end),i.raw)) end
     as canonical from (select raw,provider_country as country,provider_platform as platform from labels)i)
    select coalesce(jsonb_agg(leaf order by ordinal),'[]'::jsonb) into provider_leaves
    from jsonb_array_elements(provider_leaves) with ordinality as source(leaf,ordinal)
    join mapped m on m.raw=leaf->>'provider'
    where m.canonical=(select wanted.canonical from mapped wanted where wanted.raw=requested_provider);
    -- The original projections below still validate and compute every financial field.
    payload:=jsonb_set(payload,'{groups,provider}',provider_leaves);
   end if;
  end if;$new$);
 if md5(definition) is distinct from '5c45409896b3538eba87303b343478fa' then raise exception using errcode='22023',message='amount_provider_install_transform_drift';end if;
 execute definition;
 if not exists(select from pg_proc p where p.oid=reader and md5(pg_get_functiondef(p.oid))='5c45409896b3538eba87303b343478fa' and md5(p.prosrc)='ebd465eb6e5f34c714e9faf63a084642'
  and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}' and p.provolatile='s' and not p.prosecdef)
 then raise exception using errcode='22023',message='amount_provider_install_postflight_drift';end if;
 select jsonb_object_agg(s,private.prepared_aggregate_dependency_common(s)) into common_after from unnest(array['IN','BR','VN','ID','PK','ZAR','MX','CO'])s;
 if common_after is distinct from common_before then raise exception using errcode='22023',message='amount_provider_financial_dependency_changed';end if;
end;$amount_provider_subset$;
COMMIT;
