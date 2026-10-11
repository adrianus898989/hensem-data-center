-- Preserve every daily field; limit projected input to the native query window.
-- Auto view does not consume operator_rows. Operators view retains its original lane.
begin;
set local lock_timeout='2s';set local statement_timeout='15s';
do $patch$
declare p record;v_body text;v_definition text;v_before jsonb;v_generation text;
begin
 select * into p from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if pg_get_userbyid(p.proowner)<>'postgres' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
  or p.provolatile<>'s' or p.prosecdef or p.proparallel<>'u' or not p.proretset or p.prorettype<>'record'::regtype
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
  or pg_get_function_result(p.oid)<>$result$TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])$result$
  or md5(p.prosrc) not in('90a9a7aa8e3142494d37d3a6cb6c2a8d','3e7e5666a6e7b869a02513221597da1a') then raise exception 'AR_WITHDRAW_BOUNDED_METADATA_OR_BODY_DRIFT';end if;
 v_generation:=private.ar_withdraw_fact_generation();
 if v_generation is null then raise exception 'AR_WITHDRAW_BOUNDED_GENERATION_INVALID';end if;
 v_before:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)='90a9a7aa8e3142494d37d3a6cb6c2a8d' then
  v_body:=p.prosrc;
  if (length(v_body)-length(replace(v_body,$old0$  WHERE q.projected
 ), days AS ($old0$,'')))/length($old0$  WHERE q.projected
 ), days AS ($old0$)<>1
   then raise exception 'AR_WITHDRAW_BOUNDED_ANCHOR_0_DRIFT';end if;
  v_body:=replace(v_body,$old0$  WHERE q.projected
 ), days AS ($old0$,$new0$  WHERE q.projected
   AND f.applied_at>=greatest(p_start,DATE '2026-10-10')::timestamp
   AND f.applied_at<(p_end+1)::timestamp
 ), days AS ($new0$);
  if (length(v_body)-length(replace(v_body,$old1$  FROM classified f WHERE f.method='manual' GROUP BY f.data_date,f.country,f.platform_key,f.account$old1$,'')))/length($old1$  FROM classified f WHERE f.method='manual' GROUP BY f.data_date,f.country,f.platform_key,f.account$old1$)<>1
   then raise exception 'AR_WITHDRAW_BOUNDED_ANCHOR_1_DRIFT';end if;
  v_body:=replace(v_body,$old1$  FROM classified f WHERE f.method='manual' GROUP BY f.data_date,f.country,f.platform_key,f.account$old1$,$new1$  FROM classified f WHERE f.method='manual' AND coalesce(p_request->>'view','auto')='operators'
  GROUP BY f.data_date,f.country,f.platform_key,f.account$new1$);
  if md5(v_body)<>'3e7e5666a6e7b869a02513221597da1a' then raise exception 'AR_WITHDRAW_BOUNDED_PATCH_DRIFT';end if;
  v_definition:=pg_get_functiondef(p.oid);
  execute replace(v_definition,p.prosrc,v_body);
 end if;
 select * into p from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if md5(p.prosrc)<>'3e7e5666a6e7b869a02513221597da1a' or (to_jsonb(p)-'prosrc') is distinct from v_before
  or private.ar_withdraw_fact_generation() is distinct from v_generation
  then raise exception 'AR_WITHDRAW_BOUNDED_POSTCHECK_FAILED';end if;
end;
$patch$;
commit;
