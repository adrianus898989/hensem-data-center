-- Avoid per-row SQL function calls across YASH history. The status set and
-- finite/ordered/nonfuture completion predicates exactly preserve the native helper.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $migration$
declare p record;updated record;definition text;
 before_hash constant text:='c64aba6321106d2c566cab95a14382b8';after_hash constant text:='38e9b7d9a8e994d40896e29c85769892';
begin
 select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
  where f.oid=pg_catalog.to_regprocedure('private.dashboard_admin_yash_submission_coverage(date)');
 if not found then raise exception 'yash_coverage_predicates_baseline_missing';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
  or p.prosecdef or p.pronargdefaults<>0 or p.lanname<>'sql'
  or p.proconfig is distinct from array['search_path=""'] then raise exception 'yash_coverage_predicates_definition_drift';end if;
 if exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee<>p.proowner)) then raise exception 'yash_coverage_predicates_acl_drift';end if;
 if md5(p.prosrc)=before_hash then
  definition:=pg_catalog.pg_get_functiondef(p.oid);
  if (length(definition)-length(replace(definition,$old_0$private.dashboard_admin_yash_status('deposit',status)='unknown'$old_0$,'')))/length($old_0$private.dashboard_admin_yash_status('deposit',status)='unknown'$old_0$)<>1 then raise exception 'yash_coverage_predicates_fragment_drift_0';end if;
  definition:=replace(definition,$old_0$private.dashboard_admin_yash_status('deposit',status)='unknown'$old_0$,$new_0$coalesce(status not in ('充值成功','人工确认成功','已创建','处理中','充值失败','订单过期','用户取消'),true)$new_0$);
  if (length(definition)-length(replace(definition,$old_1$private.dashboard_admin_yash_status('deposit',y.status)='success'$old_1$,'')))/length($old_1$private.dashboard_admin_yash_status('deposit',y.status)='success'$old_1$)<>1 then raise exception 'yash_coverage_predicates_fragment_drift_1';end if;
  definition:=replace(definition,$old_1$private.dashboard_admin_yash_status('deposit',y.status)='success'$old_1$,$new_1$y.status in ('充值成功','人工确认成功')$new_1$);
  if (length(definition)-length(replace(definition,$old_2$private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) is null$old_2$,'')))/length($old_2$private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) is null$old_2$)<>1 then raise exception 'yash_coverage_predicates_fragment_drift_2';end if;
  definition:=replace(definition,$old_2$private.dashboard_admin_yash_completed_at('deposit',y.status,y.created_at,y.completed_at,statement_timestamp()) is null$old_2$,$new_2$not coalesce(isfinite(y.created_at) and isfinite(y.completed_at) and isfinite(statement_timestamp())
     and y.completed_at>=y.created_at and y.completed_at<=statement_timestamp(),false)$new_2$);
  execute definition;
 end if;
 select * into updated from pg_catalog.pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef
  or updated.provolatile<>p.provolatile or updated.prolang<>p.prolang then raise exception 'yash_coverage_predicates_postcondition_failed';end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
