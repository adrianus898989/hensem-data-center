-- Atomic AR streaming install. Counts/scope/detail evidence/history pools unchanged.
-- No source/fact/readiness/cache rows are modified or scanned.
begin;set local statement_timeout='3s';set local lock_timeout='1s';
do $ar_streaming$
declare s record;f record;metadata_before jsonb;g text;hg text;eg text;d text;
begin if current_user<>'postgres' then raise exception'ar_streaming_owner_only';end if;
 for s in select * from(values ('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)','3645bf1a24efd1ae7b89897616172fa5','d372cd30224f4e1a6ff2e962d4df12b3','plpgsql',true,'p_request jsonb, p_scope jsonb, p_start date, p_end date','TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])'),('private.ar_historical_duration_generation()','6ad649935379e96fae90ea7659be7b1c','098abcff7a34ce44bbcb197cf3c4a9cc','sql',false,'','text'))v(signature,before_hash,after_hash,language,set_returning,arguments,result)loop
  select x.*into f from pg_proc x where x.oid=to_regprocedure(s.signature);
  if not found or md5(f.prosrc)<>all(array[s.before_hash,s.after_hash])or f.proowner<>'postgres'::regrole or f.prosecdef or f.provolatile<>'s'or f.proparallel<>'u'or f.proretset is distinct from s.set_returning or f.proisstrict or f.proleakproof or f.prokind<>'f'or f.pronargdefaults<>0 or f.provariadic<>0 or f.procost<>100 or f.prorows<>(case when s.set_returning then 1000 else 0 end) or f.proconfig is distinct from array['search_path=""']::text[]or f.proacl::text is distinct from '{postgres=X/postgres}'or f.prolang<>(select oid from pg_language where lanname=s.language)or pg_get_function_arguments(f.oid)<>s.arguments or pg_get_function_result(f.oid)<>s.result then raise exception'ar_streaming_metadata_or_body_drift';end if;
 end loop;
 select jsonb_agg(to_jsonb(x)-'prosrc'order by oid)into metadata_before from pg_proc x where x.oid=any(array['private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure,'private.ar_historical_duration_generation()'::regprocedure]);
 g:=private.ar_withdraw_fact_generation();hg:=private.ar_historical_duration_generation();eg:=private.ar_withdraw_detail_evidence_generation();
 if g is null or hg is null or eg is null then raise exception'ar_streaming_prerequisite_generation_invalid';end if;
 if (select md5(prosrc)from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure)='3645bf1a24efd1ae7b89897616172fa5'then
  d:=pg_get_functiondef('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure);
  if(length(d)-length(replace(d,$ar_old_0$), classified AS MATERIALIZED ($ar_old_0$,'')))/length($ar_old_0$), classified AS MATERIALIZED ($ar_old_0$)<>1 then raise exception'ar_streaming_exact_anchor_drift';end if;
  d:=replace(d,$ar_old_0$), classified AS MATERIALIZED ($ar_old_0$,$ar_new_0$), classified AS NOT MATERIALIZED ($ar_new_0$);
  if(length(d)-length(replace(d,$ar_old_1$ ), days AS (
$ar_old_1$,'')))/length($ar_old_1$ ), days AS (
$ar_old_1$)<>1 then raise exception'ar_streaming_exact_anchor_drift';end if;
  d:=replace(d,$ar_old_1$ ), days AS (
$ar_old_1$,$ar_new_1$ ), classified_operator AS MATERIALIZED (
  -- Auto consumes only daily totals. Operators reuse one full fact stream.
  SELECT * FROM classified WHERE coalesce(p_request->>'view','auto')='operators'
 ), classified_input AS NOT MATERIALIZED (
  SELECT * FROM classified WHERE coalesce(p_request->>'view','auto')<>'operators'
  UNION ALL
  SELECT * FROM classified_operator
 ), days AS (
$ar_new_1$);
  if(length(d)-length(replace(d,$ar_old_2$FROM classified f $ar_old_2$,'')))/length($ar_old_2$FROM classified f $ar_old_2$)<>2 then raise exception'ar_streaming_exact_anchor_drift';end if;
  d:=replace(d,$ar_old_2$FROM classified f $ar_old_2$,$ar_new_2$FROM classified_input f $ar_new_2$);
  execute d;
 end if;
 if (select md5(prosrc)from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure)='6ad649935379e96fae90ea7659be7b1c'then
  d:=pg_get_functiondef('private.ar_historical_duration_generation()'::regprocedure);
  if(length(d)-length(replace(d,$hist_old$'3645bf1a24efd1ae7b89897616172fa5')$hist_old$,'')))/length($hist_old$'3645bf1a24efd1ae7b89897616172fa5')$hist_old$)<>1 then raise exception'ar_streaming_history_anchor_drift';end if;
  execute replace(d,$hist_old$'3645bf1a24efd1ae7b89897616172fa5')$hist_old$,$hist_new$'3645bf1a24efd1ae7b89897616172fa5','d372cd30224f4e1a6ff2e962d4df12b3')$hist_new$);
 end if;
 if(select md5(prosrc)from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure)is distinct from 'd372cd30224f4e1a6ff2e962d4df12b3'then raise exception'ar_streaming_after_hash_failed';end if;
 if(select md5(prosrc)from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure)is distinct from '098abcff7a34ce44bbcb197cf3c4a9cc'then raise exception'ar_streaming_after_hash_failed';end if;
 if(select jsonb_agg(to_jsonb(x)-'prosrc'order by oid)from pg_proc x where x.oid=any(array['private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure,'private.ar_historical_duration_generation()'::regprocedure]))is distinct from metadata_before then raise exception'ar_streaming_metadata_changed';end if;
 if private.ar_withdraw_fact_generation()is distinct from g or private.ar_historical_duration_generation()is distinct from hg or private.ar_withdraw_detail_evidence_generation()is distinct from eg then raise exception'ar_streaming_existing_generation_changed';end if;
end;$ar_streaming$;commit;
