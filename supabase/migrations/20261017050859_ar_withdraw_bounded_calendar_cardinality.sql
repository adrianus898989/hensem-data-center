-- Atomic AR bounded calendar cardinality fix. Counts/scope/detail evidence/history pools unchanged.
-- The existing range guard accepts at most 62 dates. No global/session timeout changes.
-- No source/fact/readiness/cache rows are modified or scanned.
begin;set local statement_timeout='3s';set local lock_timeout='1s';
do $ar_calendar$
declare s record;f record;metadata_before jsonb;g text;hg text;eg text;d text;
begin if current_user<>'postgres' then raise exception'ar_calendar_owner_only';end if;
 for s in select * from(values ('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)','d372cd30224f4e1a6ff2e962d4df12b3','173bf1a012f07d69942571724ff8f658','plpgsql',true,'p_request jsonb, p_scope jsonb, p_start date, p_end date','TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])'),('private.ar_historical_duration_generation()','098abcff7a34ce44bbcb197cf3c4a9cc','43aa54260f120584133e30a78d01e0ba','sql',false,'','text'))v(signature,before_hash,after_hash,language,set_returning,arguments,result)loop
  select x.*into f from pg_proc x where x.oid=to_regprocedure(s.signature);
  if not found or md5(f.prosrc)<>all(array[s.before_hash,s.after_hash])or f.proowner<>'postgres'::regrole or f.prosecdef or f.provolatile<>'s'or f.proparallel<>'u'or f.proretset is distinct from s.set_returning or f.proisstrict or f.proleakproof or f.prokind<>'f'or f.pronargdefaults<>0 or f.provariadic<>0 or f.procost<>100 or f.prorows<>(case when s.set_returning then 1000 else 0 end) or f.proconfig is distinct from array['search_path=""']::text[]or f.proacl::text is distinct from '{postgres=X/postgres}'or f.prolang<>(select oid from pg_language where lanname=s.language)or pg_get_function_arguments(f.oid)<>s.arguments or pg_get_function_result(f.oid)<>s.result then raise exception'ar_calendar_metadata_or_body_drift';end if;
 end loop;
 select jsonb_agg(to_jsonb(x)-'prosrc'order by oid)into metadata_before from pg_proc x where x.oid=any(array['private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure,'private.ar_historical_duration_generation()'::regprocedure]);
 g:=private.ar_withdraw_fact_generation();hg:=private.ar_historical_duration_generation();eg:=private.ar_withdraw_detail_evidence_generation();
 if g is null or hg is null or eg is null then raise exception'ar_calendar_prerequisite_generation_invalid';end if;
 if (select md5(prosrc)from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure)='d372cd30224f4e1a6ff2e962d4df12b3'then
  d:=pg_get_functiondef('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure);
  if(length(d)-length(replace(d,$calendar_old$generate_series(greatest(p_start,DATE '2026-10-10')::timestamp,p_end::timestamp,interval '1 day')dt(d)$calendar_old$,'')))/length($calendar_old$generate_series(greatest(p_start,DATE '2026-10-10')::timestamp,p_end::timestamp,interval '1 day')dt(d)$calendar_old$)<>2 then raise exception'ar_calendar_exact_anchor_drift';end if;
  execute replace(d,$calendar_old$generate_series(greatest(p_start,DATE '2026-10-10')::timestamp,p_end::timestamp,interval '1 day')dt(d)$calendar_old$,$calendar_new$(SELECT (greatest(p_start,DATE '2026-10-10')+day_offset)::timestamp d FROM generate_series(0,61) day_offset WHERE day_offset<=p_end-greatest(p_start,DATE '2026-10-10'))dt$calendar_new$);
 end if;
 if (select md5(prosrc)from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure)='098abcff7a34ce44bbcb197cf3c4a9cc'then
  d:=pg_get_functiondef('private.ar_historical_duration_generation()'::regprocedure);
  if(length(d)-length(replace(d,$hist_old$'d372cd30224f4e1a6ff2e962d4df12b3')$hist_old$,'')))/length($hist_old$'d372cd30224f4e1a6ff2e962d4df12b3')$hist_old$)<>1 then raise exception'ar_calendar_history_anchor_drift';end if;
  execute replace(d,$hist_old$'d372cd30224f4e1a6ff2e962d4df12b3')$hist_old$,$hist_new$'d372cd30224f4e1a6ff2e962d4df12b3','173bf1a012f07d69942571724ff8f658')$hist_new$);
 end if;
 if(select md5(prosrc)from pg_proc where oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure)is distinct from '173bf1a012f07d69942571724ff8f658'then raise exception'ar_calendar_after_hash_failed';end if;
 if(select md5(prosrc)from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure)is distinct from '43aa54260f120584133e30a78d01e0ba'then raise exception'ar_calendar_after_hash_failed';end if;
 if(select jsonb_agg(to_jsonb(x)-'prosrc'order by oid)from pg_proc x where x.oid=any(array['private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure,'private.ar_historical_duration_generation()'::regprocedure]))is distinct from metadata_before then raise exception'ar_calendar_metadata_changed';end if;
 if private.ar_withdraw_fact_generation()is distinct from g or private.ar_historical_duration_generation()is distinct from hg or private.ar_withdraw_detail_evidence_generation()is distinct from eg then raise exception'ar_calendar_existing_generation_changed';end if;
end;$ar_calendar$;commit;
