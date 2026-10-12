-- YASH.BET business confirmation: automatic withdrawals are not enabled; all collected native withdrawals are manual.
-- Counts include every native status; this rule does not rewrite source orders/operators or certify capture completeness.
begin;
set local statement_timeout='3s';set local lock_timeout='1s';
do $yash_manual_only$
declare p record;f oid:=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');d text;before_meta jsonb;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_yash_withdraw_days(jsonb,jsonb,date,date)');
 if not found or md5(p.prosrc)<>'1e9eda16514b65889295810e6bf1d742' or p.proowner<>'postgres'::regrole
  or p.prolang<>(select oid from pg_language where lanname='sql') or p.prosecdef or p.proisstrict or p.proleakproof or p.provolatile<>'s' or p.proparallel<>'u'
  or not p.proretset or p.prorettype<>'record'::regtype or pg_get_function_arguments(p.oid)<>'p_request jsonb, p_scope jsonb, p_start date, p_end date'
  or pg_get_function_result(p.oid)<>$out$TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, pending_count bigint, failed_count bigint, unknown_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb)$out$
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
 then raise exception 'YASH_MANUAL_ONLY_HELPER_DRIFT';end if;
 select * into p from pg_proc where oid=f;
 if not found or md5(p.prosrc) not in('5965cb8899f0717678aaf7da6195c1c1','564e9a0b7d4b9585d7d254b973f7c67d') or p.proowner<>'postgres'::regrole
  or p.prolang<>(select oid from pg_language where lanname='plpgsql') or not p.prosecdef or p.proisstrict or p.proleakproof or p.provolatile<>'s' or p.proparallel<>'u'
  or p.proretset or p.prorettype<>'jsonb'::regtype or p.proargnames is distinct from array['p_request']::text[] or p.proallargtypes is not null or p.proargmodes is not null
  or pg_get_function_identity_arguments(p.oid)<>'p_request jsonb' or p.pronargdefaults<>1 or pg_get_expr(p.proargdefaults,0) is distinct from '''{}''::jsonb'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
 then raise exception 'YASH_MANUAL_ONLY_MAIN_DRIFT';end if;
 if md5(p.prosrc)='564e9a0b7d4b9585d7d254b973f7c67d' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(f);
 if (length(d)-length(replace(d,$old0$union all select data_date,country,platform,platform_key,total,success,rejected,null::bigint,null::bigint,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'created_to_completed'::text from yash_days where total is not null$old0$,'')))/length($old0$union all select data_date,country,platform,platform_key,total,success,rejected,null::bigint,null::bigint,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'created_to_completed'::text from yash_days where total is not null$old0$)<>1 then raise exception 'YASH_MANUAL_ONLY_ANCHOR_DRIFT_0';end if;
 d:=replace(d,$old0$union all select data_date,country,platform,platform_key,total,success,rejected,null::bigint,null::bigint,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'created_to_completed'::text from yash_days where total is not null$old0$,$new0$-- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.
  union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'created_to_completed'::text from yash_days where total is not null$new0$);
 if (length(d)-length(replace(d,$old1$-- YASH has source statuses and times, but currently collected records do not
 -- identify automatic/manual handling or contain blocking/rejection reasons.$old1$,'')))/length($old1$-- YASH has source statuses and times, but currently collected records do not
 -- identify automatic/manual handling or contain blocking/rejection reasons.$old1$)<>1 then raise exception 'YASH_MANUAL_ONLY_ANCHOR_DRIFT_1';end if;
 d:=replace(d,$old1$-- YASH has source statuses and times, but currently collected records do not
 -- identify automatic/manual handling or contain blocking/rejection reasons.$old1$,$new1$-- Confirmed YASH.BET manual-only policy applies to collected native withdrawals,
 -- including prior dates. Source statuses/operators, notes and coverage remain unchanged.$new1$);
 if (length(d)-length(replace(d,$old2$'classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true,
    'currentComplete'$old2$,'')))/length($old2$'classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true,
    'currentComplete'$old2$)<>1 then raise exception 'YASH_MANUAL_ONLY_ANCHOR_DRIFT_2';end if;
 d:=replace(d,$old2$'classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true,
    'currentComplete'$old2$,$new2$'classificationAvailable',true,'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false,
    'reasonAvailable',true,'sourceNotesAvailable',true,
    'currentComplete'$new2$);
 if (length(d)-length(replace(d,$old3$select jsonb_build_object('source','KB','classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true,'autoCount',null,'manualCount',null,
     'unclassifiedCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),$old3$,'')))/length($old3$select jsonb_build_object('source','KB','classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true,'autoCount',null,'manualCount',null,
     'unclassifiedCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),$old3$)<>1 then raise exception 'YASH_MANUAL_ONLY_ANCHOR_DRIFT_3';end if;
 d:=replace(d,$old3$select jsonb_build_object('source','KB','classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true,'autoCount',null,'manualCount',null,
     'unclassifiedCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),$old3$,$new3$select jsonb_build_object('source','KB','classificationAvailable',true,'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false,
     'reasonAvailable',true,'sourceNotesAvailable',true,'autoCount',0,'manualCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),
     'unclassifiedCount',case when coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) is not null then 0 end,$new3$);
 if (length(d)-length(replace(d,$old4$select jsonb_build_object('source','KB','classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true,'autoCount',null,'manualCount',null,
      'unclassifiedCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),$old4$,'')))/length($old4$select jsonb_build_object('source','KB','classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true,'autoCount',null,'manualCount',null,
      'unclassifiedCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),$old4$)<>1 then raise exception 'YASH_MANUAL_ONLY_ANCHOR_DRIFT_4';end if;
 d:=replace(d,$old4$select jsonb_build_object('source','KB','classificationAvailable',false,'reasonAvailable',true,'sourceNotesAvailable',true,'autoCount',null,'manualCount',null,
      'unclassifiedCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),$old4$,$new4$select jsonb_build_object('source','KB','classificationAvailable',true,'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false,
      'reasonAvailable',true,'sourceNotesAvailable',true,'autoCount',0,'manualCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),
      'unclassifiedCount',case when coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) is not null then 0 end,$new4$);
 if (length(d)-length(replace(d,$old5$    -- SUM above includes only observed classifications. Preserve that known
    -- subset; an all-unknown source set still has NULL counts, never zero.
    v_yash_meta:=jsonb_build_object('classificationAvailable',false,
     'classificationPartial',coalesce(jsonb_typeof(v_result->v_yash_period->'autoCount')='number'
       or jsonb_typeof(v_result->v_yash_period->'manualCount')='number',false),
     'classificationComparable',false,'reasonAvailable',false,
     'autoCount',v_result->v_yash_period->'autoCount','manualCount',v_result->v_yash_period->'manualCount');
    if v_view='auto' then
     select v_yash_meta||jsonb_build_object('unclassifiedCount',coalesce((v_result->v_yash_period->>'unclassifiedCount')::bigint,0)+coalesce(sum(y.total),0)) into v_yash_meta
     from jsonb_to_recordset(v_yash_days)y(data_date date,total bigint)
     where case v_yash_period when 'totals' then y.data_date>=v_start else y.data_date<v_start end;
    end if;
$old5$,'')))/length($old5$    -- SUM above includes only observed classifications. Preserve that known
    -- subset; an all-unknown source set still has NULL counts, never zero.
    v_yash_meta:=jsonb_build_object('classificationAvailable',false,
     'classificationPartial',coalesce(jsonb_typeof(v_result->v_yash_period->'autoCount')='number'
       or jsonb_typeof(v_result->v_yash_period->'manualCount')='number',false),
     'classificationComparable',false,'reasonAvailable',false,
     'autoCount',v_result->v_yash_period->'autoCount','manualCount',v_result->v_yash_period->'manualCount');
    if v_view='auto' then
     select v_yash_meta||jsonb_build_object('unclassifiedCount',coalesce((v_result->v_yash_period->>'unclassifiedCount')::bigint,0)+coalesce(sum(y.total),0)) into v_yash_meta
     from jsonb_to_recordset(v_yash_days)y(data_date date,total bigint)
     where case v_yash_period when 'totals' then y.data_date>=v_start else y.data_date<v_start end;
    end if;
$old5$)<>1 then raise exception 'YASH_MANUAL_ONLY_ANCHOR_DRIFT_5';end if;
 d:=replace(d,$old5$    -- SUM above includes only observed classifications. Preserve that known
    -- subset; an all-unknown source set still has NULL counts, never zero.
    v_yash_meta:=jsonb_build_object('classificationAvailable',false,
     'classificationPartial',coalesce(jsonb_typeof(v_result->v_yash_period->'autoCount')='number'
       or jsonb_typeof(v_result->v_yash_period->'manualCount')='number',false),
     'classificationComparable',false,'reasonAvailable',false,
     'autoCount',v_result->v_yash_period->'autoCount','manualCount',v_result->v_yash_period->'manualCount');
    if v_view='auto' then
     select v_yash_meta||jsonb_build_object('unclassifiedCount',coalesce((v_result->v_yash_period->>'unclassifiedCount')::bigint,0)+coalesce(sum(y.total),0)) into v_yash_meta
     from jsonb_to_recordset(v_yash_days)y(data_date date,total bigint)
     where case v_yash_period when 'totals' then y.data_date>=v_start else y.data_date<v_start end;
    end if;
$old5$,$new5$    -- Native YASH manual counts are already included once in daily/totals.
    -- Other sources' genuinely unclassified rows remain separate.
    v_yash_meta:=jsonb_build_object('classificationAvailable',v_view='auto',
     'classificationPartial',v_view='auto' and coalesce((v_result->v_yash_period->>'unclassifiedCount')::bigint>0,false),
     'classificationComparable',v_view='auto' and coalesce((v_result->v_yash_period->>'unclassifiedCount')::bigint=0,false),
     'reasonAvailable',false);
$new5$);
 execute d;
 select * into p from pg_proc where oid=f;
 if md5(p.prosrc)<>'564e9a0b7d4b9585d7d254b973f7c67d' or (to_jsonb(p)-'prosrc') is distinct from before_meta then raise exception 'YASH_MANUAL_ONLY_POSTCHECK_DRIFT';end if;
end;
$yash_manual_only$;
commit;
