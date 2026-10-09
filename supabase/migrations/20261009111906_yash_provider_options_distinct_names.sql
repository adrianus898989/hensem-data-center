-- Normalize each distinct YASH supplier once instead of once per order.
-- The existing authorized platform catalog, direction and site guards stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $patch$
declare p record;d text;before_meta jsonb;r record;
begin
 select q.*,pg_get_userbyid(q.proowner) owner_name,l.lanname
 into p from pg_proc q join pg_language l on l.oid=q.prolang
 where q.oid=to_regprocedure('private.dashboard_admin_live_provider_options(jsonb)');
 if p.oid is null or md5(p.prosrc) is distinct from '7985ae5769b167ff475239d708d7fcdd' then
  raise exception 'yash_provider_options_body_drift';
 end if;
 if p.owner_name is distinct from 'postgres' or p.lanname is distinct from 'plpgsql'
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u'
  or p.proisstrict or p.proleakproof or p.proretset or p.prokind<>'f'
  or p.procost<>100 or p.prorows<>0
  or pg_get_function_arguments(p.oid) is distinct from 'p_request jsonb DEFAULT ''{}''::jsonb'
  or pg_get_function_result(p.oid) is distinct from 'jsonb' then
  raise exception 'yash_provider_options_metadata_drift';
 end if;
 select pg_get_functiondef(q.oid),to_jsonb(q)-'prosrc' into d,before_meta
 from pg_proc q where q.oid=p.oid;
 for r in select * from(values
  ($old$  ), all_matches as ($old$,$new$  ), yash_names as materialized (
    select p.country,p.source_name,n.supplier
    from platforms p cross join lateral (
      select distinct y.supplier
      from private.yash_orders y
      where p.source='kb' and p.scope_group='IN' and p.source_name='YASH.BET' and y.source_site='yash'
        and y.order_type=any(case coalesce(p_request->>'direction','all') when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
    )n
  ), all_matches as ($new$),
  ($old$    select private.dashboard_admin_live_provider_canonical(p.country,p.source_name,private.dashboard_admin_yash_provider(y.supplier))
    from platforms p join private.yash_orders y on p.source='kb' and p.scope_group='IN' and p.source_name='YASH.BET' and y.source_site='yash'
    where y.order_type=any(case coalesce(p_request->>'direction','all') when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)$old$,
   $new$    select private.dashboard_admin_live_provider_canonical(country,source_name,private.dashboard_admin_yash_provider(supplier))
    from yash_names$new$)
 )x(old_text,new_text) loop
  if (length(d)-length(replace(d,r.old_text,'')))/length(r.old_text)<>1 then
   raise exception 'yash_provider_options_anchor_drift';
  end if;
  d:=replace(d,r.old_text,r.new_text);
 end loop;
 execute d;
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=p.oid) is distinct from before_meta then
  raise exception 'yash_provider_options_metadata_changed';
 end if;
end;
$patch$;
commit;
