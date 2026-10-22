CREATE OR REPLACE FUNCTION private.prepared_aggregate_dependency(p_target jsonb, p_common text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when p_target->>'source'='panda'then
  md5(jsonb_build_object('base',previous.token,'pandaPrefixContract',1,
   'prefixFunction',(select jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl::text)
    from pg_proc p where p.oid='panda_private.prepared_window(text,text,timestamptz,timestamptz)'::regprocedure))::text)
 else previous.token end
 from(select md5(jsonb_build_object('common',p_common,
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in(p_target->>'scope_group',p_target->>'country')and platform in(p_target->>'name',p_target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in(p_target->>'scope_group',p_target->>'country')and platform in(p_target->>'name',p_target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and p_target->>'source'='ar'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where p_target->>'source'='ar'and source_system='AR'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name')
 )::text))previous(token);
$function$

