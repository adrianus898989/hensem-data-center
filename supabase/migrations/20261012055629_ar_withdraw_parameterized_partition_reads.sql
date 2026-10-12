-- Parameterize each exact native alias/day before reading source or verified facts.
-- Preserve b8b rejected-unknown=>manual, all counts, day bounds and authorization.
-- Historical time formula is unchanged; retain its existing cache generation.
begin;
set local lock_timeout='2s';set local statement_timeout='15s';
do $partition_reads$
declare p record;d text;m jsonb;fact_g text;duration_g text;main_m jsonb;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)');
 if not found or md5(p.prosrc) not in('b8b971e82282e984bcdfc90c17c9a471','1bfc6398524bc3194b91f1d411960425')
  or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.proisstrict or p.proleakproof
  or p.provolatile<>'s' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or not p.proretset or p.prorettype<>'record'::regtype or p.pronargs<>4
  or pg_get_function_identity_arguments(p.oid)<>'p_request jsonb, p_scope jsonb, p_start date, p_end date'
  or pg_get_function_result(p.oid) is distinct from $out$TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])$out$
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
 then raise exception 'AR_PARTITION_READER_DRIFT';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.ar_historical_duration_generation()');
 if not found or md5(p.prosrc) not in('7782a45c2346c6b5cecffab74801a324','dab45cf30ff7388f2d0642737977460f')
  or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or p.proisstrict or p.proleakproof
  or p.provolatile<>'s' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='sql')
  or p.proretset or p.prorettype<>'text'::regtype or p.pronargs<>0
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
 then raise exception 'AR_PARTITION_DURATION_GUARD_DRIFT';end if;
 fact_g:=private.ar_withdraw_fact_generation();duration_g:=private.ar_historical_duration_generation();
 if fact_g is null then raise exception 'AR_PARTITION_FACT_GENERATION_INVALID';end if;
 select to_jsonb(mp) into main_m from pg_proc mp where mp.oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 select * into p from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if md5(p.prosrc)='b8b971e82282e984bcdfc90c17c9a471' then
  m:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
  if (length(d)-length(replace(d,$old0$  FROM partitions q JOIN public.ar_collected_orders a ON a.source_system='AR' AND a.country_code=q.code
   AND a.platform=q.native_alias AND a.order_kind='withdraw'
   AND a.applied_at>=TIMESTAMP '2026-10-10'
   AND a.applied_at>=q.data_date::timestamp AND a.applied_at<(q.data_date+1)::timestamp
   WHERE NOT q.projected$old0$,'')))/length($old0$  FROM partitions q JOIN public.ar_collected_orders a ON a.source_system='AR' AND a.country_code=q.code
   AND a.platform=q.native_alias AND a.order_kind='withdraw'
   AND a.applied_at>=TIMESTAMP '2026-10-10'
   AND a.applied_at>=q.data_date::timestamp AND a.applied_at<(q.data_date+1)::timestamp
   WHERE NOT q.projected$old0$)<>1 then raise exception 'AR_PARTITION_ANCHOR_0_DRIFT';end if;
  d:=replace(d,$old0$  FROM partitions q JOIN public.ar_collected_orders a ON a.source_system='AR' AND a.country_code=q.code
   AND a.platform=q.native_alias AND a.order_kind='withdraw'
   AND a.applied_at>=TIMESTAMP '2026-10-10'
   AND a.applied_at>=q.data_date::timestamp AND a.applied_at<(q.data_date+1)::timestamp
   WHERE NOT q.projected$old0$,$new0$  FROM partitions q CROSS JOIN LATERAL (
   SELECT a.* FROM public.ar_collected_orders a
   WHERE NOT q.projected AND a.source_system='AR' AND a.country_code=q.code
    AND a.platform=q.native_alias AND a.order_kind='withdraw'
    AND a.applied_at>=TIMESTAMP '2026-10-10'
    AND a.applied_at>=q.data_date::timestamp AND a.applied_at<(q.data_date+1)::timestamp
   OFFSET 0
  ) a$new0$);
  if (length(d)-length(replace(d,$old1$  FROM partitions q JOIN private.ar_withdraw_facts f ON f.country_code=q.code AND f.platform=q.native_alias
   AND f.applied_at>=q.data_date::timestamp AND f.applied_at<(q.data_date+1)::timestamp
  WHERE q.projected
   AND f.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp
   AND f.applied_at<(p_end+1)::timestamp$old1$,'')))/length($old1$  FROM partitions q JOIN private.ar_withdraw_facts f ON f.country_code=q.code AND f.platform=q.native_alias
   AND f.applied_at>=q.data_date::timestamp AND f.applied_at<(q.data_date+1)::timestamp
  WHERE q.projected
   AND f.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp
   AND f.applied_at<(p_end+1)::timestamp$old1$)<>1 then raise exception 'AR_PARTITION_ANCHOR_1_DRIFT';end if;
  d:=replace(d,$old1$  FROM partitions q JOIN private.ar_withdraw_facts f ON f.country_code=q.code AND f.platform=q.native_alias
   AND f.applied_at>=q.data_date::timestamp AND f.applied_at<(q.data_date+1)::timestamp
  WHERE q.projected
   AND f.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp
   AND f.applied_at<(p_end+1)::timestamp$old1$,$new1$  FROM partitions q CROSS JOIN LATERAL (
   SELECT f.* FROM private.ar_withdraw_facts f
   WHERE q.projected AND f.country_code=q.code AND f.platform=q.native_alias
    AND f.applied_at>=q.data_date::timestamp AND f.applied_at<(q.data_date+1)::timestamp
    AND f.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp
    AND f.applied_at<(p_end+1)::timestamp
   OFFSET 0
  ) f$new1$);
  execute d;
  select * into p from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
  if md5(p.prosrc)<>'1bfc6398524bc3194b91f1d411960425' or (to_jsonb(p)-'prosrc') is distinct from m then raise exception 'AR_PARTITION_READER_POSTCHECK';end if;
 end if;
 select * into p from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure;
 if md5(p.prosrc)='7782a45c2346c6b5cecffab74801a324' then
  m:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
  if (length(d)-length(replace(d,$gold$md5(z.prosrc) IN('3e7e5666a6e7b869a02513221597da1a','b8b971e82282e984bcdfc90c17c9a471')$gold$,'')))/length($gold$md5(z.prosrc) IN('3e7e5666a6e7b869a02513221597da1a','b8b971e82282e984bcdfc90c17c9a471')$gold$)<>1 then raise exception 'AR_PARTITION_DURATION_ANCHOR_DRIFT';end if;
  execute replace(d,$gold$md5(z.prosrc) IN('3e7e5666a6e7b869a02513221597da1a','b8b971e82282e984bcdfc90c17c9a471')$gold$,$gnew$md5(z.prosrc) IN('3e7e5666a6e7b869a02513221597da1a','b8b971e82282e984bcdfc90c17c9a471','1bfc6398524bc3194b91f1d411960425')$gnew$);
  select * into p from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure;
  if md5(p.prosrc)<>'dab45cf30ff7388f2d0642737977460f' or (to_jsonb(p)-'prosrc') is distinct from m then raise exception 'AR_PARTITION_DURATION_POSTCHECK';end if;
 end if;
 if private.ar_withdraw_fact_generation() is distinct from fact_g or private.ar_historical_duration_generation() is distinct from duration_g
  or (select to_jsonb(mp) from pg_proc mp where mp.oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure) is distinct from main_m
 then raise exception 'AR_PARTITION_GENERATION_OR_MAIN_CHANGED';end if;
end;$partition_reads$;
commit;
