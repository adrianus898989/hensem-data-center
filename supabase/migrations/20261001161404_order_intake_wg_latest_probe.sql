-- Bound WG metadata latest-row probes to one index entry per eligible site.
-- Read-path-only: no order/receipt/config data changes, no new indexes or grants.
begin;
do $migration$
declare p record; v_body text; v_definition text; v_before constant text:='7935b7161c8212bd633b4d8b52823594';
 v_after text; v_old constant text:=$old$    select n.created_at,n.stored_at into v_created,v_updated from (
     select w.created_at,w.stored_at from public.wg_recharge_details w join private.dashboard_admin_wg_sites()s on s.site_code=w.site_code
      where d='charge' and s.country_code=p.scope_group and s.platform=p.source_name order by w.created_at desc limit 1
    )n;
    if d='withdraw' then
     select w.created_at,w.stored_at into v_created,v_updated from public.wg_withdraw_details w join private.dashboard_admin_wg_sites()s on s.site_code=w.site_code
      where s.country_code=p.scope_group and s.platform=p.source_name order by w.created_at desc limit 1;
    end if;$old$; v_new constant text:=$new$    -- Bound each site's newest-row probe before comparing sites in this scope.
    -- DESC keeps the existing implicit NULLS FIRST and timestamp tie semantics.
    if d='charge' then
     select n.created_at,n.stored_at into v_created,v_updated
      from private.dashboard_admin_wg_sites()s
      cross join lateral (
       select w.created_at,w.stored_at from public.wg_recharge_details w
        where w.site_code=s.site_code order by w.created_at desc limit 1
      )n where s.country_code=p.scope_group and s.platform=p.source_name
      order by n.created_at desc limit 1;
    else
     select n.created_at,n.stored_at into v_created,v_updated
      from private.dashboard_admin_wg_sites()s
      cross join lateral (
       select w.created_at,w.stored_at from public.wg_withdraw_details w
        where w.site_code=s.site_code order by w.created_at desc limit 1
      )n where s.country_code=p.scope_group and s.platform=p.source_name
      order by n.created_at desc limit 1;
    end if;$new$;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_order_intake()');
 if not found or p.prokind<>'f' or p.pronargs<>0 or p.pronargdefaults<>0
  or p.prorettype<>'jsonb'::regtype or p.proretset or not p.prosecdef or p.proisstrict
  or p.provolatile<>'s' or p.proparallel<>'u' or p.proleakproof
  or p.proconfig is distinct from array['search_path=""']
  or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or pg_get_userbyid(p.proowner)<>'postgres'
 then raise exception 'wg_intake_probe_metadata_drift';end if;
 if p.proacl is distinct from array['postgres=X/postgres']::aclitem[]
 then raise exception 'wg_intake_probe_acl_drift';end if;
 -- The expected patched body is reconstructed from the exact inverse, not
 -- accepted merely because an arbitrary function happens to contain v_new.
 if md5(p.prosrc)<>v_before then
  if length(p.prosrc)-length(replace(p.prosrc,v_new,''))<>length(v_new)
   or md5(replace(p.prosrc,v_new,v_old))<>v_before
  then raise exception 'wg_intake_probe_body_drift';end if;
  return;
 end if;
 if length(p.prosrc)-length(replace(p.prosrc,v_old,''))<>length(v_old)
 then raise exception 'wg_intake_probe_anchor_drift';end if;
 v_body:=replace(p.prosrc,v_old,v_new);v_after:=md5(v_body);
 v_definition:=replace(pg_get_functiondef(p.oid),p.prosrc,v_body);
 execute v_definition;
 if not exists(select 1 from pg_proc q where q.oid=p.oid and md5(q.prosrc)=v_after
  and q.proacl is not distinct from p.proacl and q.proowner=p.proowner
  and q.prosecdef=p.prosecdef and q.provolatile=p.provolatile and q.proparallel=p.proparallel
  and q.proisstrict=p.proisstrict and q.proconfig is not distinct from p.proconfig)
 then raise exception 'wg_intake_probe_preservation_failed';end if;
end;$migration$;
commit;
