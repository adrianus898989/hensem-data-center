-- Metadata-only preflight. No source orders are read and no DDL is performed.
-- Run immediately before online creation after root approval. If another
-- maintenance operation owns the lock, NOWAIT stops without blocking collection.
begin;
set local lock_timeout='2s';
set local statement_timeout='3s';
lock table public.ar_collected_orders in share update exclusive mode nowait;
do $cover_guard$
declare
 target oid:=to_regclass('public.ar_collected_orders');
 p record;m record;t record;idx record;spec record;
 col record;actual_columns text[];
 require_indexes boolean:=false;
begin
 if current_setting('server_encoding')<>'UTF8' or current_setting('block_size')<>'8192'
  or current_setting('server_version_num')::integer/10000<>17 then
  raise exception 'AR91_COVER_SERVER_LAYOUT_DRIFT';end if;
 select c.*,pg_get_userbyid(c.relowner) owner_name into t from pg_class c where c.oid=target;
 if not found or t.relkind<>'r' or t.relpersistence<>'p' or t.owner_name<>'postgres'
  or not t.relrowsecurity or t.relforcerowsecurity
  or t.relacl::text is distinct from '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'
  or exists(select 1 from pg_inherits where inhparent=target or inhrelid=target) then
  raise exception 'AR91_COVER_TABLE_METADATA_DRIFT';end if;
 -- The enforced, VALIDATED bounds prove every existing and future native
 -- entry fits. No raw fact scan, truncation, new constraint or policy change.
 for spec in select * from (values
  ('order_no','text',true,false,100),('member_id','text',false,false,100),
  ('status','text',false,false,100),('raw_channel','text',false,false,100),
  ('applied_at','timestamp without time zone',false,false,0),
  ('completed_at','timestamp without time zone',false,false,0),
  ('member_level','integer',false,false,0),('recharge_count','integer',false,false,0),
  ('source_system','text',true,false,100),('country_code','text',true,false,100),
  ('platform','text',true,false,100),('order_kind','text',true,false,100),
  ('channel_type','text',false,false,100),('money_format_version','smallint',false,false,0),
  ('amount_local','numeric',false,false,0),('currency_local','text',false,false,100),
  ('money_issue_code','text',false,false,100),('amount','numeric(20,2)',false,false,0)
 ) v(name,type_name,not_null,has_default,collation_oid) loop
  select a.*,format_type(a.atttypid,a.atttypmod) type_name into col from pg_attribute a
   where a.attrelid=target and a.attname=spec.name and a.attnum>0 and not a.attisdropped;
  if not found or col.type_name<>spec.type_name or col.attnotnull<>spec.not_null
   or col.atthasdef<>spec.has_default or col.attcollation<>spec.collation_oid then
   raise exception 'AR91_COVER_COLUMN_DRIFT';end if;
 end loop;
 for spec in select * from (values
  ('ar_collected_orders_order_no_check','CHECK (((length(order_no) >= 1) AND (length(order_no) <= 160)))'),
  ('ar_collected_orders_member_id_check','CHECK (((length(member_id) >= 1) AND (length(member_id) <= 80)))'),
  ('ar_collected_orders_status_check','CHECK ((length(status) <= 160))'),
  ('ar_collected_orders_raw_channel_check','CHECK ((length(raw_channel) <= 240))')
 ) v(name,definition) loop
  if not exists(select 1 from pg_constraint c where c.conrelid=target and c.conname=spec.name
   and c.contype='c' and c.convalidated and c.conislocal and not c.connoinherit
   and pg_get_constraintdef(c.oid,false)=spec.definition) then
   raise exception 'AR91_COVER_WIDTH_CONSTRAINT_DRIFT';end if;
 end loop;
 if not exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
  where c.conrelid=target and c.conname='ar_collected_orders_pkey' and c.contype='p'
   and c.convalidated and not c.condeferrable and not c.condeferred
   and i.indisunique and i.indisprimary and i.indisvalid and i.indisready and i.indislive
   and i.indimmediate and i.indpred is null and i.indexprs is null
   and pg_get_constraintdef(c.oid,false)='PRIMARY KEY (source_system, country_code, platform, order_kind, order_no)') then
  raise exception 'AR91_COVER_NATIVE_PK_DRIFT';end if;
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or md5(p.prosrc) not in ('325c95878225f211b91aed89c7abae86','25d8ec448cd3e2dd21ccae3d76132de1')
  or pg_get_userbyid(p.proowner)<>'postgres' or p.prorettype<>'jsonb'::regtype
  or p.provolatile<>'s' or not p.prosecdef or p.proparallel<>'u' or p.lanname<>'plpgsql'
  or p.pronargdefaults<>0 or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off']
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' then
  raise exception 'AR91_COVER_READER_BASELINE_DRIFT';end if;
 select f.*,l.lanname into m from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)');
 if not found or md5(m.prosrc)<>'dc8b95205e35b7366f4f9dbf052d307d'
  or pg_get_userbyid(m.proowner)<>'postgres' or m.prorettype<>'numeric'::regtype
  or m.provolatile<>'i' or m.prosecdef or m.proparallel<>'s' or m.lanname<>'sql'
  or m.pronargdefaults<>0 or m.proconfig is distinct from array['search_path=""']
  or m.proacl::text is distinct from '{postgres=X/postgres}' then
  raise exception 'AR91_COVER_MONEY_HELPER_DRIFT';end if;
 for spec in select * from (values
  ('ar_91club_recharge_applied_cover_idx',7,
   array['applied_at','order_no','member_id','status','raw_channel','member_level','recharge_count']::text[],
   $pred$((source_system = 'AR'::text) AND (country_code = 'IN'::text) AND (platform = '91CLUB'::text) AND (order_kind = 'recharge'::text))$pred$),
  ('ar_91club_recharge_paid_cover_idx',2,array['completed_at','member_id']::text[],
   $pred$((source_system = 'AR'::text) AND (country_code = 'IN'::text) AND (platform = '91CLUB'::text) AND (order_kind = 'recharge'::text) AND (status = '已支付'::text))$pred$)
 ) v(name,natts,columns,predicate) loop
  select i.*,cl.relkind,cl.relpersistence,cl.reloptions,cl.reltablespace,am.amname,
   pg_get_userbyid(cl.relowner) owner_name into idx
   from pg_class cl left join pg_index i on i.indexrelid=cl.oid left join pg_am am on am.oid=cl.relam
   where cl.oid=to_regclass('public.'||spec.name);
  if not found then
   if require_indexes then raise exception 'AR91_COVER_INDEX_MISSING';end if;
   continue;
  end if;
  if idx.indrelid is distinct from target or idx.relkind<>'i' or idx.relpersistence<>'p'
   or idx.owner_name<>'postgres' or idx.amname<>'btree' or idx.reloptions is not null or idx.reltablespace<>0
   or not idx.indisvalid or not idx.indisready or not idx.indislive or idx.indisunique
   or idx.indisprimary or idx.indisexclusion or idx.indisreplident or idx.indisclustered
   or idx.indnkeyatts<>1 or idx.indnatts<>spec.natts or idx.indexprs is not null
   or idx.indoption[0]<>0 or pg_get_expr(idx.indpred,idx.indrelid,false) is distinct from spec.predicate then
   raise exception 'AR91_COVER_INDEX_METADATA_DRIFT';end if;
  select array_agg(pg_get_indexdef(idx.indexrelid,pos,true) order by pos) into actual_columns
   from generate_series(1,spec.natts) pos;
  if actual_columns is distinct from spec.columns then raise exception 'AR91_COVER_INDEX_COLUMNS_DRIFT';end if;
  if not exists(select 1 from pg_opclass op join pg_namespace ns on ns.oid=op.opcnamespace
   join pg_attribute a on a.attrelid=target and a.attnum=idx.indkey[0]
   where op.oid=idx.indclass[0] and ns.nspname='pg_catalog' and op.opcname='timestamp_ops'
    and op.opcdefault and op.opcintype='timestamp without time zone'::regtype
    and idx.indcollation[0]=a.attcollation and a.attcollation=0) then
   raise exception 'AR91_COVER_INDEX_KEY_DRIFT';end if;
 end loop;
end;
$cover_guard$;
rollback;
