-- Reviewable read-only RPC optimization. No order writes, indexes, table changes,
-- grant changes, request changes, timeout increases, or new helper functions.
-- The two source-time scans remain separate; daily cross-provider dedupe and
-- overlapping frequency thresholds keep their existing definitions.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $patch$
declare p record; before_metadata jsonb; after_metadata jsonb; definition text; old_fragment text; new_fragment text;
begin
  select p1.* into p from pg_catalog.pg_proc p1
    where p1.oid=pg_catalog.to_regprocedure('private.dashboard_admin_live_member_daily(jsonb)');
  if not found then raise exception 'Member-day reader baseline missing'; end if;
  -- Exact known behavioral metadata guard. Catalog OIDs differ across instances;
  -- the existing OID, ACL, owner and every pg_proc attribute are compared below.
  if pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' or current_user<>'postgres'
    or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
    or p.prokind<>'f' or p.provolatile<>'s' or not p.prosecdef or p.proretset
    or p.proisstrict or p.proleakproof or p.proparallel<>'u'
    or p.prorettype<>'jsonb'::regtype or p.proargtypes<>'3802'::oidvector
    or p.pronargs<>1 or p.pronargdefaults<>0 or p.proargnames<>array['p_request']::text[]
    or p.proargmodes is not null or p.proallargtypes is not null or p.proargdefaults is not null
    or p.proconfig is distinct from array['search_path=""','jit=off']::text[]
    or p.procost<>100 or p.prorows<>0 or p.provariadic<>0 or p.prosupport<>0
    or p.probin is not null or p.prosqlbody is not null or p.protrftypes is not null
    or p.proacl::text[] is distinct from array['postgres=X/postgres','authenticated=X/postgres']::text[]
  then raise exception 'Member-day reader metadata changed; review before applying'; end if;
  before_metadata:=pg_catalog.to_jsonb(p)-'prosrc';
  if pg_catalog.md5(p.prosrc)='477dc1efd988b2985032974976299ce5' then return; end if;
  if pg_catalog.md5(p.prosrc)<>'f6798fbbe20b7156b31a8af92bbe2888' then
    raise exception 'Member-day reader production body changed; review before applying';
  end if;
  definition:=pg_catalog.pg_get_functiondef(p.oid);
  old_fragment:=$old$  ), counts as (
    select date,direction,
      count(distinct member_id) filter(where basis='created') as created_member_count,
      count(distinct member_id) filter(where basis='success') as success_member_count,
      count(*) filter(where basis='created') as created_order_count,
      count(*) filter(where basis='success') as success_order_count,
      count(*) filter(where basis='created' and member_id is null) as created_missing_member_count,
      count(*) filter(where basis='success' and member_id is null) as success_missing_member_count
    from filtered group by date,direction
  ), member_orders as (
    select date,direction,member_id,
      count(*) filter(where basis='created') as created_count,
      count(*) filter(where basis='success') as success_count
    from filtered where member_id is not null group by date,direction,member_id
  ), frequency as (
    select date,direction,
      count(*) filter(where created_count>=2) as created_members_ge2,
      count(*) filter(where created_count>=3) as created_members_ge3,
      count(*) filter(where created_count>=4) as created_members_ge4,
      count(*) filter(where created_count>=5) as created_members_ge5,
      count(*) filter(where success_count>=2) as success_members_ge2,
      count(*) filter(where success_count>=3) as success_members_ge3,
      count(*) filter(where success_count>=4) as success_members_ge4,
      count(*) filter(where success_count>=5) as success_members_ge5
    from member_orders group by date,direction
  ), days as ($old$;
  new_fragment:=$new$  ), member_orders as (
    -- member_daily_single_group_v1: include NULL IDs to preserve missing-order
    -- coverage; they never count as a member or a frequency-threshold member.
    select date,direction,member_id,
      count(*) filter(where basis='created') as created_count,
      count(*) filter(where basis='success') as success_count
    from filtered group by date,direction,member_id
  ), counts as (
    select date,direction,
      count(*) filter(where member_id is not null and created_count>0) as created_member_count,
      count(*) filter(where member_id is not null and success_count>0) as success_member_count,
      sum(created_count) as created_order_count,
      sum(success_count) as success_order_count,
      coalesce(sum(created_count) filter(where member_id is null),0) as created_missing_member_count,
      coalesce(sum(success_count) filter(where member_id is null),0) as success_missing_member_count,
      count(*) filter(where member_id is not null and created_count>=2) as created_members_ge2,
      count(*) filter(where member_id is not null and created_count>=3) as created_members_ge3,
      count(*) filter(where member_id is not null and created_count>=4) as created_members_ge4,
      count(*) filter(where member_id is not null and created_count>=5) as created_members_ge5,
      count(*) filter(where member_id is not null and success_count>=2) as success_members_ge2,
      count(*) filter(where member_id is not null and success_count>=3) as success_members_ge3,
      count(*) filter(where member_id is not null and success_count>=4) as success_members_ge4,
      count(*) filter(where member_id is not null and success_count>=5) as success_members_ge5
    from member_orders group by date,direction
  ), days as ($new$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
    or (length(definition)-length(replace(definition,'coalesce(f.','')))/length('coalesce(f.')<>8
    or (length(definition)-length(replace(definition,$join$    left join frequency f on f.date=days.date and f.direction=d.direction
$join$,'')))/length($join$    left join frequency f on f.date=days.date and f.direction=d.direction
$join$)<>1
  then raise exception 'Member-day reader aggregate anchors changed'; end if;
  definition:=replace(replace(replace(definition,old_fragment,new_fragment),'coalesce(f.','coalesce(c.'),$join$    left join frequency f on f.date=days.date and f.direction=d.direction
$join$,'');
  execute definition;
  select pg_catalog.to_jsonb(p1)-'prosrc' into after_metadata from pg_catalog.pg_proc p1 where p1.oid=p.oid;
  if after_metadata is distinct from before_metadata
    or (select pg_catalog.md5(p1.prosrc) from pg_catalog.pg_proc p1 where p1.oid=p.oid)<>'477dc1efd988b2985032974976299ce5'
  then raise exception 'Member-day reader OID, ACL, metadata or expected body drift'; end if;
end;
$patch$;
notify pgrst,'reload schema';
commit;
