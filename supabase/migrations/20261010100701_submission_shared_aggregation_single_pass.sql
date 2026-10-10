-- Reduce intermediate copies and repeated coverage scans without changing
-- source scope, eligibility, strict thresholds, money, output or authorization.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare p record;updated record;definition text;authenticated_id oid;
 before_hash constant text:='219db2fb64d519ce975a5a2a907cd6db';
 after_hash constant text:='ab63c0ce48fe0ab393b4d5e6ef8a4d83';
begin
 select oid into authenticated_id from pg_catalog.pg_roles where rolname='authenticated';
 select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
 where f.oid=pg_catalog.to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or authenticated_id is null then raise exception 'submission_single_pass_baseline_missing';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
  or not p.prosecdef or p.pronargdefaults<>0 or p.lanname<>'plpgsql'
  or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off'] then
  raise exception 'submission_single_pass_definition_drift';end if;
 if not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=authenticated_id and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee not in (p.proowner,authenticated_id))) then
  raise exception 'submission_single_pass_acl_drift';end if;
 if md5(p.prosrc)=before_hash then
  definition:=pg_catalog.pg_get_functiondef(p.oid);
  -- Every source projects a non-null raw_provider. Canonical has exactly one
  -- row per raw_provider, so the old normalized join preserved source rows.
  if (length(definition)-length(replace(definition,$old_0$ ), normalized_orders as materialized (
  select s.*,(created_at at time zone $4)::date as day,c.provider,
   case when upper(btrim(level_text)) ~ '^L(V)?[0-9]{1,4}$' then regexp_replace(upper(btrim(level_text)),'^LV?','')::int
    when btrim(level_text) ~ '^[0-9]{1,4}$' then btrim(level_text)::int end member_level,
   case when btrim(count_text) ~ '^[0-9]{1,9}$' then btrim(count_text)::int end recharge_count
  from source_rows s join canonical c using(raw_provider)
 ), unplaced_members as materialized (
  select distinct member_id from normalized_orders where created_at is null and member_id is not null
 ), orders as materialized (
  select o.* from normalized_orders o where created_at is not null$old_0$,'')))/length($old_0$ ), normalized_orders as materialized (
  select s.*,(created_at at time zone $4)::date as day,c.provider,
   case when upper(btrim(level_text)) ~ '^L(V)?[0-9]{1,4}$' then regexp_replace(upper(btrim(level_text)),'^LV?','')::int
    when btrim(level_text) ~ '^[0-9]{1,4}$' then btrim(level_text)::int end member_level,
   case when btrim(count_text) ~ '^[0-9]{1,9}$' then btrim(count_text)::int end recharge_count
  from source_rows s join canonical c using(raw_provider)
 ), unplaced_members as materialized (
  select distinct member_id from normalized_orders where created_at is null and member_id is not null
 ), orders as materialized (
  select o.* from normalized_orders o where created_at is not null$old_0$)<>1 then
   raise exception 'submission_single_pass_fragment_drift_0';end if;
  definition:=replace(definition,$old_0$ ), normalized_orders as materialized (
  select s.*,(created_at at time zone $4)::date as day,c.provider,
   case when upper(btrim(level_text)) ~ '^L(V)?[0-9]{1,4}$' then regexp_replace(upper(btrim(level_text)),'^LV?','')::int
    when btrim(level_text) ~ '^[0-9]{1,4}$' then btrim(level_text)::int end member_level,
   case when btrim(count_text) ~ '^[0-9]{1,9}$' then btrim(count_text)::int end recharge_count
  from source_rows s join canonical c using(raw_provider)
 ), unplaced_members as materialized (
  select distinct member_id from normalized_orders where created_at is null and member_id is not null
 ), orders as materialized (
  select o.* from normalized_orders o where created_at is not null$old_0$,$new_0$ ), unplaced_members as materialized (
  select distinct member_id from source_rows where created_at is null and member_id is not null
 ), orders as materialized (
  select s.*,(created_at at time zone $4)::date as day,c.provider,
   case when upper(btrim(level_text)) ~ '^L(V)?[0-9]{1,4}$' then regexp_replace(upper(btrim(level_text)),'^LV?','')::int
    when btrim(level_text) ~ '^[0-9]{1,4}$' then btrim(level_text)::int end member_level,
   case when btrim(count_text) ~ '^[0-9]{1,9}$' then btrim(count_text)::int end recharge_count
  from source_rows s join canonical c using(raw_provider) where created_at is not null$new_0$);
  -- DISTINCT unplaced_members is unique and non-null. Joining it cannot add
  -- order rows; its absence flag is constant for each member-day group.
  if (length(definition)-length(replace(definition,$old_1$and not exists(select 1 from unplaced_members u where u.member_id=orders.member_id) sequence_known,$old_1$,'')))/length($old_1$and not exists(select 1 from unplaced_members u where u.member_id=orders.member_id) sequence_known,$old_1$)<>1 then
   raise exception 'submission_single_pass_fragment_drift_1';end if;
  definition:=replace(definition,$old_1$and not exists(select 1 from unplaced_members u where u.member_id=orders.member_id) sequence_known,$old_1$,$new_1$and bool_and(u.member_id is null) sequence_known,$new_1$);
  if (length(definition)-length(replace(definition,$old_2$from orders where member_id is not null group by day,member_id$old_2$,'')))/length($old_2$from orders where member_id is not null group by day,member_id$old_2$)<>1 then
   raise exception 'submission_single_pass_fragment_drift_2';end if;
  definition:=replace(definition,$old_2$from orders where member_id is not null group by day,member_id$old_2$,$new_2$from orders left join unplaced_members u using(member_id) where member_id is not null group by day,member_id$new_2$);
  if (length(definition)-length(replace(definition,$old_3$ ), selected_member_days as materialized ($old_3$,'')))/length($old_3$ ), selected_member_days as materialized ($old_3$)<>1 then
   raise exception 'submission_single_pass_fragment_drift_3';end if;
  definition:=replace(definition,$old_3$ ), selected_member_days as materialized ($old_3$,$new_3$ ), selected_coverage as (
  select count(*) order_count,count(*) filter(where member_id is null) missing_member_count,
   count(*) filter(where member_level is null) missing_level_count,count(*) filter(where recharge_count is null) missing_recharge_count
  from selected_orders
 ), selected_member_days as materialized ($new_3$);
  if (length(definition)-length(replace(definition,$old_4$  'coverage',jsonb_build_object('orderCount',(select count(*) from selected_orders),'missingMemberCount',(select count(*) from selected_orders where member_id is null),
   'missingLevelCount',(select count(*) from selected_orders where member_level is null),'missingRechargeCount',(select count(*) from selected_orders where recharge_count is null),$old_4$,'')))/length($old_4$  'coverage',jsonb_build_object('orderCount',(select count(*) from selected_orders),'missingMemberCount',(select count(*) from selected_orders where member_id is null),
   'missingLevelCount',(select count(*) from selected_orders where member_level is null),'missingRechargeCount',(select count(*) from selected_orders where recharge_count is null),$old_4$)<>1 then
   raise exception 'submission_single_pass_fragment_drift_4';end if;
  definition:=replace(definition,$old_4$  'coverage',jsonb_build_object('orderCount',(select count(*) from selected_orders),'missingMemberCount',(select count(*) from selected_orders where member_id is null),
   'missingLevelCount',(select count(*) from selected_orders where member_level is null),'missingRechargeCount',(select count(*) from selected_orders where recharge_count is null),$old_4$,$new_4$  'coverage',(select jsonb_build_object('orderCount',sc.order_count,'missingMemberCount',sc.missing_member_count,
   'missingLevelCount',sc.missing_level_count,'missingRechargeCount',sc.missing_recharge_count,$new_4$);
  if (length(definition)-length(replace(definition,$old_5$   'sourceCompletenessVerified',false),$old_5$,'')))/length($old_5$   'sourceCompletenessVerified',false),$old_5$)<>1 then
   raise exception 'submission_single_pass_fragment_drift_5';end if;
  definition:=replace(definition,$old_5$   'sourceCompletenessVerified',false),$old_5$,$new_5$   'sourceCompletenessVerified',false) from selected_coverage sc),$new_5$);
  -- Source projections are immutable/stable reads in this statement snapshot.
  -- Let canonical read only provider fields instead of another full row copy.
  if (length(definition)-length(replace(definition,$old_6$with source_rows as materialized ($old_6$,'')))/length($old_6$with source_rows as materialized ($old_6$)<>1 then
   raise exception 'submission_single_pass_fragment_drift_6';end if;
  definition:=replace(definition,$old_6$with source_rows as materialized ($old_6$,$new_6$with source_rows as not materialized ($new_6$);
  -- These are the only fields used by the four dashboard aggregates below.
  if (length(definition)-length(replace(definition,$old_7$  select o.*,coalesce((o.day,o.member_id) in (select e.day,e.member_id from eligible e where submitted_count>$9),false) flagged$old_7$,'')))/length($old_7$  select o.*,coalesce((o.day,o.member_id) in (select e.day,e.member_id from eligible e where submitted_count>$9),false) flagged$old_7$)<>1 then
   raise exception 'submission_single_pass_fragment_drift_7';end if;
  definition:=replace(definition,$old_7$  select o.*,coalesce((o.day,o.member_id) in (select e.day,e.member_id from eligible e where submitted_count>$9),false) flagged$old_7$,$new_7$  select o.provider,o.created_at,o.day,o.amount,o.paid,coalesce((o.day,o.member_id) in (select e.day,e.member_id from eligible e where submitted_count>$9),false) flagged$new_7$);
  execute definition;
 end if;
 select * into updated from pg_catalog.pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef
  or updated.provolatile<>p.provolatile or updated.prolang<>p.prolang then
  raise exception 'submission_single_pass_postcondition_failed';end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
