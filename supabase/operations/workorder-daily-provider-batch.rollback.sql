-- ROLLBACK: one existing private unique helper; only daily provider name lookup changes.
-- No source rows, original grouping, money, diagnostics, scope, grants, wrappers or prepared kernels change.
begin;
set local statement_timeout='3s';set local lock_timeout='500ms';
do $patch$
declare target regprocedure:='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure;
 p pg_proc%rowtype;metadata jsonb;definition text;d record;protected jsonb;
 before_text constant text:=$before$  ), daily_provider_inputs as materialized (
    select distinct country,platform,raw_provider,channel_type from daily_source
  ), daily_provider_routes as materialized (
    -- Reuse exactly the current raw-input route: WG and YASH stay scalar.
    select x.*,coalesce(x.country in ('IN','印度') and x.platform in ('YASH.BET','YASHBET'),false)
      or exists(select 1 from scalar_platforms a where x.country in (a.country_code,a.country)
        and x.platform=a.platform) as needs_scalar
    from daily_provider_inputs x
  ), daily_names as materialized (
    select b.* from private.dashboard_admin_live_workorder_provider_batch(
      (select coalesce(jsonb_agg(jsonb_build_object('country',country,'platform',platform,
        'raw_provider',raw_provider,'channel_type',channel_type)),'[]'::jsonb)
       from daily_provider_routes where not needs_scalar)) b
    union all
    select x.country,x.platform,x.raw_provider,x.channel_type,
      private.dashboard_admin_live_workorder_provider(x.country,x.platform,x.raw_provider,x.channel_type)
    from daily_provider_routes x where needs_scalar
$before$;
 after_text constant text:=$after$  ), daily_names as materialized (
    select x.*,private.dashboard_admin_live_workorder_provider(country,platform,raw_provider,channel_type) provider
    from (select distinct country,platform,raw_provider,channel_type from daily_source) x
$after$;
begin
 if current_user<>'postgres'then raise exception 'workorder_daily_batch_owner_required';end if;
 select *into p from pg_proc where oid=target;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}'
 or p.prosecdef or p.provolatile<>'s'or p.proconfig is distinct from array['search_path=""']
 or p.proparallel<>'u'or p.proisstrict or p.proleakproof or p.pronargdefaults<>0
 or pg_get_function_arguments(target)<>'p_request jsonb, p_result jsonb'or pg_get_function_result(target)<>'jsonb'
 then raise exception 'workorder_daily_batch_metadata_drift';end if;
 for d in select *from(values
 ('private.dashboard_admin_live_workorder_provider(text,text,text,text)','3eeda654b2724af8537776ed812458fe'),
 ('private.dashboard_admin_live_workorder_provider_batch(jsonb)','12cc504d23658ed10d677deebb7e7049'),
 ('private.dashboard_admin_live_provider_canonical(text,text,text)','008e5cee3a4f6ac9e90706c45bee56da'),
 ('private.dashboard_admin_wg_provider_aliases()','5dedf6cf8a430e21b69ca81069db8b3b')
 )x(signature,body_md5)loop
  if not exists(select 1 from pg_proc dp where dp.oid=to_regprocedure(d.signature)and md5(dp.prosrc)=d.body_md5)
  then raise exception 'workorder_daily_batch_mapping_dependency_drift';end if;
 end loop;
 for d in select *from(values
 ('private.prepared_aggregate_dependency_common(text)','36966b6e1e434eb6d5990e551f816b8e','1c8080bcc9742302e3cf5c11ef565c40'),
 ('private.provider_snapshot_dependency_token(jsonb)','ccf807a978ba7f0d3cb9f527dad6c5d4','94146d61170c7a3cc87db9e04be01854')
 )x(signature,body_md5,definition_md5)loop
  if not exists(select 1 from pg_proc dp where dp.oid=to_regprocedure(d.signature)and md5(dp.prosrc)=d.body_md5 and md5(pg_get_functiondef(dp.oid))=d.definition_md5)
  then raise exception 'workorder_daily_batch_financial_dependency_drift';end if;
 end loop;
 select jsonb_agg(to_jsonb(dp)order by dp.oid)into protected from pg_proc dp where dp.oid in(
 'private.prepared_aggregate_dependency_common(text)'::regprocedure,'private.provider_snapshot_dependency_token(jsonb)'::regprocedure);
 if md5(p.prosrc)='770866cae75d9cb307295740962a7d36'and md5(pg_get_functiondef(target))='8fecd2ab934c99d52bf9804d9c32376a'then return;end if;
 if md5(p.prosrc)<>'39393d9ff3333631da2086cb42517fd9'or md5(pg_get_functiondef(target))<>'f15d863db5a96c0045cb7ee3f382cac4'
 then raise exception 'workorder_daily_batch_baseline_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 if position(before_text in definition)=0 or position(before_text in substring(definition from position(before_text in definition)+length(before_text)))>0
 then raise exception 'workorder_daily_batch_replacement_not_unique';end if;
 execute replace(definition,before_text,after_text);
 select *into p from pg_proc where oid=target;
 if md5(p.prosrc)<>'770866cae75d9cb307295740962a7d36'or md5(pg_get_functiondef(target))<>'8fecd2ab934c99d52bf9804d9c32376a'or(to_jsonb(p)-'prosrc')is distinct from metadata
 then raise exception 'workorder_daily_batch_postcondition_failed';end if;
 if protected is distinct from(select jsonb_agg(to_jsonb(dp)order by dp.oid)from pg_proc dp where dp.oid in(
 'private.prepared_aggregate_dependency_common(text)'::regprocedure,'private.provider_snapshot_dependency_token(jsonb)'::regprocedure))
 then raise exception 'workorder_daily_batch_financial_dependency_changed';end if;
end;$patch$;
commit;
