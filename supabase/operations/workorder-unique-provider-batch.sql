-- Restore batched workorder original-order provider lookup without changing
-- source-specific WG/YASH classification, distinct totals, live notes or grants.
-- Only one existing helper changes. No orders, jobs, caches or schedules are written.
begin;
set local statement_timeout='3s';
set local lock_timeout='500ms';
do $install$
declare target regprocedure:='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure;
 p pg_proc%rowtype; metadata jsonb; definition text; after_body constant text:='770866cae75d9cb307295740962a7d36';
 d record; source text; replacement text;
begin
 select * into p from pg_proc where oid=target;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']
  or p.proparallel<>'u' or p.proisstrict or p.proleakproof or p.pronargdefaults<>0
  or pg_get_function_arguments(target)<>'p_request jsonb, p_result jsonb'
  or pg_get_function_result(target)<>'jsonb' then
  raise exception 'workorder_unique_batch_metadata_or_acl_drift';end if;
 for d in select * from (values
  ('private.dashboard_admin_live_workorder_provider(text,text,text,text)','3eeda654b2724af8537776ed812458fe'),
  ('private.dashboard_admin_live_workorder_provider_batch(jsonb)','12cc504d23658ed10d677deebb7e7049'),
  ('private.dashboard_admin_live_provider_canonical(text,text,text)','008e5cee3a4f6ac9e90706c45bee56da'),
  ('private.dashboard_admin_wg_provider_aliases()','5dedf6cf8a430e21b69ca81069db8b3b')
 ) x(signature,body_md5) loop
  if not exists(select 1 from pg_proc dp where dp.oid=to_regprocedure(d.signature) and md5(dp.prosrc)=d.body_md5)
   then raise exception 'workorder_unique_batch_dependency_drift: %',d.signature;end if;
 end loop;
 if md5(p.prosrc)=after_body then
  if md5(pg_get_functiondef(target))<>'8fecd2ab934c99d52bf9804d9c32376a' then
   raise exception 'workorder_unique_batch_definition_drift';end if;
  return;end if;
 if md5(p.prosrc)<>'14b1fb584d1d86332a71f9b6451816dd'
  or md5(pg_get_functiondef(target))<>'c16c906df1ddd814be59fa1c232fb68f' then
  raise exception 'workorder_unique_batch_baseline_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';
 source:=$old$  ), provider_names as materialized (
    -- Resolve each distinct source label once, not once per issue record.
    select x.*,private.dashboard_admin_live_workorder_provider(x.country,x.platform,x.raw_provider,x.channel_type) as provider
    from (select distinct country,platform,raw_provider,channel_type from raw_details) x
$old$;
 replacement:=$new$  ), provider_inputs as materialized (
    select distinct country,platform,raw_provider,channel_type from raw_details
  ), scalar_platforms as materialized (
    -- The current canonical resolver has source-specific WG and YASH rules
    -- absent from the legacy batch helper. Keep their exact scalar semantics.
    select distinct a.country_code,a.country,a.platform
    from private.dashboard_admin_wg_provider_aliases() a
  ), provider_input_routes as materialized (
    select x.*,coalesce(x.country in ('IN','印度') and x.platform in ('YASH.BET','YASHBET'),false)
      or exists(select 1 from scalar_platforms a where x.country in (a.country_code,a.country)
        and x.platform=a.platform) as needs_scalar
    from provider_inputs x
  ), provider_names as materialized (
    -- WORKORDER_UNIQUE_PROVIDER_BATCH_V3: batch only semantically equivalent
    -- inputs; the existing distinct-original grouping and scope stay unchanged.
    select b.* from private.dashboard_admin_live_workorder_provider_batch(
      (select coalesce(jsonb_agg(jsonb_build_object('country',country,'platform',platform,
        'raw_provider',raw_provider,'channel_type',channel_type)),'[]'::jsonb)
       from provider_input_routes where not needs_scalar)) b
    union all
    select x.country,x.platform,x.raw_provider,x.channel_type,
      private.dashboard_admin_live_workorder_provider(x.country,x.platform,x.raw_provider,x.channel_type)
    from provider_input_routes x where needs_scalar
$new$;
 definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,source,'')))/length(source)<>1 then
  raise exception 'workorder_unique_batch_anchor_drift';end if;
 execute replace(definition,source,replacement);
 select * into p from pg_proc where oid=target;
 if md5(p.prosrc)<>after_body or md5(pg_get_functiondef(target))<>'8fecd2ab934c99d52bf9804d9c32376a'
  or to_jsonb(p)-'prosrc' is distinct from metadata then
  raise exception 'workorder_unique_batch_postcondition_failed';end if;
end;
$install$;
commit;
