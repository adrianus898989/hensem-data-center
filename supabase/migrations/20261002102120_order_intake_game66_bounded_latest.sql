-- Bound GAME66 payout latest-row metadata to its exact platform and latest timestamp.
-- Uses existing indexes; no new index, source rows, scope, API or authorization changes.
begin;
set local lock_timeout='3s';set local statement_timeout='15s';
do $bounded_latest$
declare p pg_proc%rowtype;v_definition text;v_metadata jsonb;
begin
 select *into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_order_intake()');
 if not found or p.proowner<>'postgres'::regrole or not p.prosecdef or p.provolatile<>'s'
  or p.prorettype<>'jsonb'::regtype or p.pronargs<>0 or p.pronargdefaults<>0
  or p.proisstrict or p.proparallel<>'u' or p.proconfig is distinct from array['search_path=""']
  or p.prolang<>(select oid from pg_language where lanname='plpgsql')then
  raise exception 'game66_intake_latest_metadata_drift';end if;
 if p.proacl::text is distinct from '{postgres=X/postgres}'then
  raise exception 'game66_intake_latest_acl_drift';end if;
 if md5(p.prosrc)='c6122383ac83f6d789a058872fbfec09'and md5(pg_get_functiondef(p.oid))='8551e0323a9c89621507f037a03735cf'then return;end if;
 if md5(p.prosrc)<>'1de7e3699fb609d271caf28fdfba7b45'or md5(pg_get_functiondef(p.oid))<>'c0e74020bd7d0f12d0cd07a44bd8c703'then
  raise exception 'game66_intake_latest_body_drift';end if;
 v_metadata:=to_jsonb(p)-'prosrc';v_definition:=pg_get_functiondef(p.oid);
 if(length(v_definition)-length(replace(v_definition,$old$    select g.create_time,g.last_seen_at into v_created,v_updated
     from public.game66_withdraw_orders g
     where g.platform_id=p.id and g.create_time is not null
     order by g.create_time desc limit 1;$old$,'')))/length($old$    select g.create_time,g.last_seen_at into v_created,v_updated
     from public.game66_withdraw_orders g
     where g.platform_id=p.id and g.create_time is not null
     order by g.create_time desc limit 1;$old$)<>1 then
  raise exception 'game66_intake_latest_shape_drift';end if;
 v_definition:=replace(v_definition,$old$    select g.create_time,g.last_seen_at into v_created,v_updated
     from public.game66_withdraw_orders g
     where g.platform_id=p.id and g.create_time is not null
     order by g.create_time desc limit 1;$old$,$new$    -- Bound the platform-first timestamp probe before fetching its metadata.
    -- Keep the exact platform, statement snapshot and unspecified timestamp ties.
    with newest as materialized(
     select g.create_time from public.game66_withdraw_orders g
      where g.platform_id=p.id and g.create_time is not null
      order by g.create_time desc limit 1
    )select g.create_time,g.last_seen_at into v_created,v_updated
     from newest n join public.game66_withdraw_orders g
      on g.platform_id=p.id and g.create_time=n.create_time
     order by g.create_time desc limit 1;$new$);
 execute v_definition;
 select *into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_order_intake()');
 if(to_jsonb(p)-'prosrc')is distinct from v_metadata or md5(p.prosrc)<>'c6122383ac83f6d789a058872fbfec09'
  or md5(pg_get_functiondef(p.oid))<>'8551e0323a9c89621507f037a03735cf'then
  raise exception 'game66_intake_latest_postcondition_drift';end if;
end $bounded_latest$;
notify pgrst,'reload schema';
commit;
