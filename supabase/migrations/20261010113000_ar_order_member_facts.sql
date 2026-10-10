-- Preserve the reviewed AR publisher, money proof, routing and credentials.
-- Missing member facts remain unknown. Old twelve-field clients stay valid.
-- NOT VALID enforces new writes without scanning the historical order table
-- under this migration's metadata lock. Validate separately in maintenance.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare
 p record;after_p record;definition text;service_id oid;before_hash constant text:='a43ce2f21c203d20d425b4685f3c8310';
 after_hash constant text:='04d9083ce37811be6b184f397f6a65be';
begin
 select oid into service_id from pg_catalog.pg_roles where rolname='service_role';
 select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
 where f.oid=pg_catalog.to_regprocedure('public.publish_ar_collected_orders(text,jsonb)');
 if not found or service_id is null then raise exception 'ar_member_facts_baseline_missing';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'v'
   or p.prosecdef or p.pronargdefaults<>0 or p.lanname<>'plpgsql' or p.proconfig is distinct from array['search_path=""'] then
  raise exception 'ar_member_facts_definition_drift';end if;
 if not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=service_id and a.privilege_type='EXECUTE' and not a.is_grantable)
   or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
     where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee not in (p.proowner,service_id))) then
  raise exception 'ar_member_facts_acl_drift';end if;
 alter table public.ar_collected_orders add column if not exists member_level integer;
 alter table public.ar_collected_orders add column if not exists recharge_count integer;
 if exists(select 1 from pg_catalog.pg_attribute a where a.attrelid='public.ar_collected_orders'::regclass
   and a.attname in ('member_level','recharge_count') and not a.attisdropped
   and (a.atttypid<>'integer'::regtype or a.attnotnull or a.atthasdef)) then raise exception 'ar_member_facts_column_drift';end if;
 if md5(p.prosrc)=before_hash then
  alter table public.ar_collected_orders add constraint ar_member_level_range check(member_level between 0 and 9999) not valid;
  alter table public.ar_collected_orders add constraint ar_recharge_count_range check(recharge_count between 0 and 999999999) not valid;
  definition:=pg_catalog.pg_get_functiondef(p.oid);
  if (length(definition)-length(replace(definition,$old0$(SELECT count(*) FROM jsonb_object_keys(r))<>(CASE WHEN dual THEN 15 ELSE 12 END)$old0$,'')))/length($old0$(SELECT count(*) FROM jsonb_object_keys(r))<>(CASE WHEN dual THEN 15 ELSE 12 END)$old0$)<>1 then raise exception 'ar_member_facts_fragment_drift';end if;
  definition:=replace(definition,$old0$(SELECT count(*) FROM jsonb_object_keys(r))<>(CASE WHEN dual THEN 15 ELSE 12 END)$old0$,$new0$(SELECT count(*) FROM jsonb_object_keys(r) f(key) WHERE f.key<>ALL(ARRAY['member_level','recharge_count']))<>(CASE WHEN dual THEN 15 ELSE 12 END)$new0$);
  if (length(definition)-length(replace(definition,$old1$CASE WHEN dual THEN ARRAY['amount_local','amount_usdt','currency_local'] ELSE ARRAY[]::text[] END))$old1$,'')))/length($old1$CASE WHEN dual THEN ARRAY['amount_local','amount_usdt','currency_local'] ELSE ARRAY[]::text[] END))$old1$)<>1 then raise exception 'ar_member_facts_fragment_drift';end if;
  definition:=replace(definition,$old1$CASE WHEN dual THEN ARRAY['amount_local','amount_usdt','currency_local'] ELSE ARRAY[]::text[] END))$old1$,$new1$CASE WHEN dual THEN ARRAY['amount_local','amount_usdt','currency_local'] ELSE ARRAY[]::text[] END || ARRAY['member_level','recharge_count']))$new1$);
  if (length(definition)-length(replace(definition,$old2$   IF r->'amount' IS DISTINCT FROM 'null'::jsonb THEN$old2$,'')))/length($old2$   IF r->'amount' IS DISTINCT FROM 'null'::jsonb THEN$old2$)<>1 then raise exception 'ar_member_facts_fragment_drift';end if;
  definition:=replace(definition,$old2$   IF r->'amount' IS DISTINCT FROM 'null'::jsonb THEN$old2$,$new2$   -- Optional source facts: missing/null remain unknown; integers preserve zero.
   FOREACH k IN ARRAY ARRAY['member_level','recharge_count'] LOOP
     IF r ? k AND r->k IS DISTINCT FROM 'null'::jsonb THEN
       IF jsonb_typeof(r->k) IS DISTINCT FROM 'number'
         OR r->>k !~ '^(0|[1-9][0-9]{0,8})$' THEN
         RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_MEMBER_FACT';
       END IF;
       IF (r->>k)::numeric>(CASE WHEN k='member_level' THEN 9999 ELSE 999999999 END) THEN
         RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ARO_INVALID_MEMBER_FACT';
       END IF;
     END IF;
   END LOOP;
   IF r->'amount' IS DISTINCT FROM 'null'::jsonb THEN$new2$);
  if (length(definition)-length(replace(definition,$old3$   amount_local,amount_usdt,currency_local,money_format_version,money_observed_at,money_issue_code)$old3$,'')))/length($old3$   amount_local,amount_usdt,currency_local,money_format_version,money_observed_at,money_issue_code)$old3$)<>1 then raise exception 'ar_member_facts_fragment_drift';end if;
  definition:=replace(definition,$old3$   amount_local,amount_usdt,currency_local,money_format_version,money_observed_at,money_issue_code)$old3$,$new3$   amount_local,amount_usdt,currency_local,money_format_version,money_observed_at,money_issue_code,member_level,recharge_count)$new3$);
  if (length(definition)-length(replace(definition,$old4$   CASE WHEN dual AND value->'amount_local'='null'::jsonb THEN 'LOCAL_AMOUNT_NOT_PROVIDED' END
$old4$,'')))/length($old4$   CASE WHEN dual AND value->'amount_local'='null'::jsonb THEN 'LOCAL_AMOUNT_NOT_PROVIDED' END
$old4$)<>1 then raise exception 'ar_member_facts_fragment_drift';end if;
  definition:=replace(definition,$old4$   CASE WHEN dual AND value->'amount_local'='null'::jsonb THEN 'LOCAL_AMOUNT_NOT_PROVIDED' END
$old4$,$new4$   CASE WHEN dual AND value->'amount_local'='null'::jsonb THEN 'LOCAL_AMOUNT_NOT_PROVIDED' END,
   (value->>'member_level')::integer,(value->>'recharge_count')::integer
$new4$);
  if (length(definition)-length(replace(definition,$old5$   member_id=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.member_id ELSE public.ar_collected_orders.member_id END,$old5$,'')))/length($old5$   member_id=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.member_id ELSE public.ar_collected_orders.member_id END,$old5$)<>1 then raise exception 'ar_member_facts_fragment_drift';end if;
  definition:=replace(definition,$old5$   member_id=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.member_id ELSE public.ar_collected_orders.member_id END,$old5$,$new5$   -- Old clients and unavailable fields never erase previously captured facts.
   member_level=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN coalesce(excluded.member_level,public.ar_collected_orders.member_level) ELSE public.ar_collected_orders.member_level END,
   recharge_count=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN coalesce(excluded.recharge_count,public.ar_collected_orders.recharge_count) ELSE public.ar_collected_orders.recharge_count END,
   member_id=CASE WHEN public.ar_collected_orders.observed_at<excluded.observed_at THEN excluded.member_id ELSE public.ar_collected_orders.member_id END,$new5$);
  execute definition;
 end if;
 select * into after_p from pg_catalog.pg_proc where oid=p.oid;
 if md5(after_p.prosrc)<>after_hash or after_p.proacl is distinct from p.proacl or after_p.proowner<>p.proowner
   or after_p.proconfig is distinct from p.proconfig or after_p.prosecdef<>p.prosecdef
   or after_p.provolatile<>p.provolatile or after_p.prolang<>p.prolang then
  raise exception 'ar_member_facts_postcondition_failed';end if;
 if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.ar_collected_orders'::regclass
   and conname='ar_member_level_range' and contype='c' and not connoinherit
   and lower(regexp_replace(pg_catalog.pg_get_expr(conbin,conrelid),'[[:space:]()]','','g'))='member_level>=0andmember_level<=9999')
   or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.ar_collected_orders'::regclass
   and conname='ar_recharge_count_range' and contype='c' and not connoinherit
   and lower(regexp_replace(pg_catalog.pg_get_expr(conbin,conrelid),'[[:space:]()]','','g'))='recharge_count>=0andrecharge_count<=999999999') then raise exception 'ar_member_facts_constraint_drift';end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
