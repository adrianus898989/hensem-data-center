-- Register/check only AFTER the independent CREATE/REINDEX CONCURRENTLY has
-- completed. This script creates no index and changes no rows or table policy.
-- SHARE UPDATE EXCLUSIVE is compatible with normal ROW EXCLUSIVE collection
-- writes. NOWAIT fails if another index build/VACUUM/DDL holds a conflicting
-- maintenance lock; it never waits on or blocks the collection write path.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
lock table public.ar_collected_orders in share update exclusive mode nowait;
do $guard$
declare
 target oid:=to_regclass('public.ar_collected_orders');
 idx oid:=to_regclass('public.ar_collected_withdraw_report_cover_idx');
 expected_columns text[]:=array['country_code','platform','applied_at','status','operator','completed_at','observed_at','updated_at'];
 actual_columns text[];
 expected_predicate text:=$predicate$((source_system = 'AR'::text) AND (order_kind = 'withdraw'::text) AND (applied_at >= '2026-10-10 00:00:00'::timestamp without time zone))$predicate$;
begin
 if target is null or idx is null then raise exception 'AR_WITHDRAW_COVER_INDEX_MISSING';end if;
 if not exists(select 1 from pg_class t join pg_roles r on r.oid=t.relowner
   where t.oid=target and t.relkind='r' and t.relpersistence='p' and r.rolname='postgres') then
  raise exception 'AR_WITHDRAW_COVER_TABLE_METADATA_MISMATCH';
 end if;
 if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
   join pg_namespace n on n.oid=c.relnamespace join pg_am am on am.oid=c.relam
   join pg_roles r on r.oid=c.relowner
   where i.indexrelid=idx and i.indrelid=target and c.relkind='i' and c.relpersistence='p'
    and n.nspname='public' and c.relname='ar_collected_withdraw_report_cover_idx' and r.rolname='postgres'
    and am.amname='btree' and i.indisvalid and i.indisready and i.indislive
    and not i.indisunique and not i.indisprimary and not i.indisexclusion and not i.indisreplident
    and i.indnkeyatts=3 and i.indnatts=8 and i.indexprs is null
    and i.indoption[0]=0 and i.indoption[1]=0 and i.indoption[2]=0
    and pg_get_expr(i.indpred,i.indrelid,false)=expected_predicate) then
  raise exception 'AR_WITHDRAW_COVER_INDEX_METADATA_MISMATCH';
 end if;
 select array_agg(pg_get_indexdef(idx,pos,true) order by pos) into actual_columns
 from generate_series(1,8) pos;
 if actual_columns is distinct from expected_columns then
  raise exception 'AR_WITHDRAW_COVER_INDEX_COLUMNS_MISMATCH';
 end if;
 -- ASC/default NULL ordering plus native attribute collations/opclasses must
 -- match the index declaration, not an expression or a differently collated key.
 if exists(select 1 from pg_index i cross join generate_series(0,2) pos
   join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[pos]
   where i.indexrelid=idx and i.indcollation[pos]<>a.attcollation) then
  raise exception 'AR_WITHDRAW_COVER_INDEX_COLLATION_MISMATCH';
 end if;
 -- Success itself is the registration precondition. No state is changed here.
end;
$guard$;
commit;
