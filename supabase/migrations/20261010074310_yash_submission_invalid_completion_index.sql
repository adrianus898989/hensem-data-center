-- Keep historical invalid-success checks indexable and separate non-static
-- future-completion validation. Missing/null/nonfinite/ordered-time rules stay exact.
-- A short lock/statement bound rolls back the index and function patch together.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare p record;updated record;definition text;index_info record;
 before_hash constant text:='38e9b7d9a8e994d40896e29c85769892';after_hash constant text:='10d09a786ea5dfd56a4ec90a9e0597d4';
begin
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('private.dashboard_admin_yash_submission_coverage(date)');
 if not found then raise exception 'yash_invalid_completion_baseline_missing';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
  or p.prosecdef or p.pronargdefaults<>0 or p.lanname<>'sql' or p.proconfig is distinct from array['search_path=""'] then raise exception 'yash_invalid_completion_definition_drift';end if;
 if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee<>p.proowner)) then raise exception 'yash_invalid_completion_acl_drift';end if;
 create index if not exists yash_submission_invalid_completion_idx on private.yash_orders(created_at)
  where source_site='yash' and order_type='deposit' and status in ('充值成功','人工确认成功')
  and (created_at is null or completed_at is null or not isfinite(created_at) or not isfinite(completed_at) or completed_at<created_at);
 select i.*,pg_get_expr(i.indpred,i.indrelid) predicate into index_info from pg_index i
 where i.indexrelid=to_regclass('private.yash_submission_invalid_completion_idx');
 if not found or index_info.indrelid<>'private.yash_orders'::regclass or not index_info.indisvalid or not index_info.indisready
  or index_info.indisunique or index_info.indnatts<>1
  or index_info.indkey::text<>(select attnum::text from pg_attribute where attrelid='private.yash_orders'::regclass and attname='created_at' and not attisdropped)
  or index_info.predicate is distinct from $predicate$((source_site = 'yash'::text) AND (order_type = 'deposit'::text) AND (status = ANY (ARRAY['充值成功'::text, '人工确认成功'::text])) AND ((created_at IS NULL) OR (completed_at IS NULL) OR (NOT isfinite(created_at)) OR (NOT isfinite(completed_at)) OR (completed_at < created_at)))$predicate$
  then raise exception 'yash_invalid_completion_index_drift';end if;
 if md5(p.prosrc)=before_hash then
  definition:=pg_get_functiondef(p.oid);
  if (length(definition)-length(replace(definition,$old$   (select count(*) from private.yash_orders y cross join bounds b where y.source_site='yash' and y.order_type='deposit'
    and y.status in ('充值成功','人工确认成功') and (y.created_at<b.end_at or y.created_at is null)
    and not coalesce(isfinite(y.created_at) and isfinite(y.completed_at) and isfinite(statement_timestamp())
     and y.completed_at>=y.created_at and y.completed_at<=statement_timestamp(),false)) missing_success_time_count$old$,'')))/length($old$   (select count(*) from private.yash_orders y cross join bounds b where y.source_site='yash' and y.order_type='deposit'
    and y.status in ('充值成功','人工确认成功') and (y.created_at<b.end_at or y.created_at is null)
    and not coalesce(isfinite(y.created_at) and isfinite(y.completed_at) and isfinite(statement_timestamp())
     and y.completed_at>=y.created_at and y.completed_at<=statement_timestamp(),false)) missing_success_time_count$old$)<>1 then raise exception 'yash_invalid_completion_fragment_drift';end if;
  execute replace(definition,$old$   (select count(*) from private.yash_orders y cross join bounds b where y.source_site='yash' and y.order_type='deposit'
    and y.status in ('充值成功','人工确认成功') and (y.created_at<b.end_at or y.created_at is null)
    and not coalesce(isfinite(y.created_at) and isfinite(y.completed_at) and isfinite(statement_timestamp())
     and y.completed_at>=y.created_at and y.completed_at<=statement_timestamp(),false)) missing_success_time_count$old$,$new$   ((select count(*) from private.yash_orders y cross join bounds b where y.source_site='yash' and y.order_type='deposit'
    and y.status in ('充值成功','人工确认成功') and (y.created_at<b.end_at or y.created_at is null)
    and (y.created_at is null or y.completed_at is null or not isfinite(y.created_at) or not isfinite(y.completed_at) or y.completed_at<y.created_at))
   +(select count(*) from private.yash_orders y cross join bounds b where y.source_site='yash' and y.order_type='deposit'
    and y.status in ('充值成功','人工确认成功') and (y.created_at<b.end_at or y.created_at is null)
    and isfinite(y.created_at) and isfinite(y.completed_at) and y.completed_at>=y.created_at and y.completed_at>statement_timestamp())) missing_success_time_count$new$);
 end if;
 select * into updated from pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef or updated.provolatile<>p.provolatile
  or updated.prolang<>p.prolang then raise exception 'yash_invalid_completion_postcondition_failed';end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
