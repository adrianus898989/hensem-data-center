-- User-confirmed YASH latest operator 自动审核 classification; no raw rows, jobs or stored bundles are changed.
begin;
set local lock_timeout='500ms'; set local statement_timeout='15s';
do $install$
declare e record; d text; n integer; before_token text; original_meta jsonb; after_meta jsonb; states integer[];
begin
 if current_user<>'postgres' then raise exception 'yash_auto_review_denied'; end if;
 if not pg_try_advisory_xact_lock(hashtext('yash_auto_review_install_v1')) then raise exception 'yash_auto_review_busy'; end if;
 for e in select * from (values
  ('private.dashboard_admin_live_auto_withdraw(jsonb)','9f51264084389551e2beeffaf7843c14','57da58b586ffe7a35550f2a36848124e'),
  ('private.withdraw_prepared_render(jsonb,jsonb)','06baadf5408d14fd71b12e93c7ee8b68','8035e437fd2421568754ec1005ca16d4'),
  ('private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)','13092e904fca6d7cef7ec75052e0abb7','9ee2927b3f363062b4c37e6df56f6ec4'),
  ('private.withdraw_prepared_dependency()','e339a7838ee2782a91efc72d69d6eb47','c64c59a036d36d07b2911eb4d16fec81')
 )v(sig,old_hash,new_hash) loop
  select case md5(prosrc) when e.old_hash then 0 when e.new_hash then 1 else -1 end into n from pg_proc where oid=to_regprocedure(e.sig);
  if n is null or n<0 then raise exception 'yash_auto_review_definition_drift: %',e.sig; end if;
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(e.sig) and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=ARRAY['search_path=""'] and p.proacl::text=case when e.sig='private.dashboard_admin_live_auto_withdraw(jsonb)' then '{postgres=X/postgres,authenticated=X/postgres}' else '{postgres=X/postgres}' end and p.prosecdef=(e.sig='private.dashboard_admin_live_auto_withdraw(jsonb)') and p.provolatile=case when e.sig='private.dashboard_admin_live_auto_withdraw(jsonb)' then 'v'::"char" else 's'::"char" end and not p.proisstrict and not p.proleakproof and p.proparallel='u' and p.procost=100 and p.prorows=0 and not p.proretset) then raise exception 'yash_auto_review_metadata_drift: %',e.sig; end if;
  states:=array_append(states,n);
 end loop;
 if 0=any(states) and 1=any(states) then raise exception 'yash_auto_review_partial_install'; end if;
 if not (0=any(states)) then return; end if;
 before_token:=private.withdraw_prepared_dependency();
 select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-array['oid','prosrc']) into original_meta from pg_proc p where oid=any(ARRAY['private.dashboard_admin_live_auto_withdraw(jsonb)','private.withdraw_prepared_render(jsonb,jsonb)','private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)','private.withdraw_prepared_dependency()']::regprocedure[]);
 d:=pg_get_functiondef('private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$replace0$  select * from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)$replace0$,'')))/length($replace0$  select * from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)$replace0$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace0$  select * from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)$replace0$,$replace0$  select y.*,c.auto_count,c.manual_count from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)
  cross join lateral (
   select coalesce(sum((r->>'processed')::bigint) filter(where r->>'account'='自动审核'),0)::bigint auto_count,
    coalesce(sum((r->>'processed')::bigint) filter(where nullif(r->>'account','') is not null and r->>'account' not in('自动审核','（未知操作人）')),0)::bigint manual_count
   from jsonb_array_elements(y.operator_rows)r
  )c$replace0$);
 if (length(d)-length(replace(d,$replace1$  -- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.$replace1$,'')))/length($replace1$  -- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.$replace1$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace1$  -- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.$replace1$,$replace1$  -- Confirmed 2026-10-30: exact latest operator 自动审核 means automatic withdrawal.
  -- Preserve every source status and unknown operator; classify all observed statuses.$replace1$);
 if (length(d)-length(replace(d,$replace2$union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,$replace2$,'')))/length($replace2$union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,$replace2$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace2$union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,$replace2$,$replace2$union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,$replace2$);
 if (length(d)-length(replace(d,$replace3$'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false$replace3$,'')))/length($replace3$'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false$replace3$)<>3 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace3$'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false$replace3$,$replace3$'classificationBasis','confirmed_latest_operator_auto_review','automaticWithdrawalEnabled',true$replace3$);
 if (length(d)-length(replace(d,$replace4$'autoCount',0,'manualCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),
     'unclassifiedCount',case when coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) is not null then 0 end$replace4$,'')))/length($replace4$'autoCount',0,'manualCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),
     'unclassifiedCount',case when coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) is not null then 0 end$replace4$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace4$'autoCount',0,'manualCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),
     'unclassifiedCount',case when coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) is not null then 0 end$replace4$,$replace4$'autoCount',case when v_view='auto' then (v_yash_item->>'autoCount')::bigint when v_yash_item->>'account'='自动审核' then coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) else 0 end,'manualCount',case when v_view='auto' then (v_yash_item->>'manualCount')::bigint when nullif(v_yash_item->>'account','') is not null and v_yash_item->>'account' not in('自动审核','（未知操作人）') then coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) else 0 end,
     'unclassifiedCount',case when coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) is not null then greatest(coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint)-(case when v_view='auto' then (v_yash_item->>'autoCount')::bigint when v_yash_item->>'account'='自动审核' then coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) else 0 end)-(case when v_view='auto' then (v_yash_item->>'manualCount')::bigint when nullif(v_yash_item->>'account','') is not null and v_yash_item->>'account' not in('自动审核','（未知操作人）') then coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) else 0 end),0) end$replace4$);
 if (length(d)-length(replace(d,$replace5$'autoCount',0,'manualCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),
      'unclassifiedCount',case when coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) is not null then 0 end$replace5$,'')))/length($replace5$'autoCount',0,'manualCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),
      'unclassifiedCount',case when coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) is not null then 0 end$replace5$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace5$'autoCount',0,'manualCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),
      'unclassifiedCount',case when coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) is not null then 0 end$replace5$,$replace5$'autoCount',case when v_view='auto' then (v_yash_item#>>'{previous,autoCount}')::bigint when v_yash_item->>'account'='自动审核' then coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) else 0 end,'manualCount',case when v_view='auto' then (v_yash_item#>>'{previous,manualCount}')::bigint when nullif(v_yash_item->>'account','') is not null and v_yash_item->>'account' not in('自动审核','（未知操作人）') then coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) else 0 end,
      'unclassifiedCount',case when coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) is not null then greatest(coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint)-(case when v_view='auto' then (v_yash_item#>>'{previous,autoCount}')::bigint when v_yash_item->>'account'='自动审核' then coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) else 0 end)-(case when v_view='auto' then (v_yash_item#>>'{previous,manualCount}')::bigint when nullif(v_yash_item->>'account','') is not null and v_yash_item->>'account' not in('自动审核','（未知操作人）') then coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) else 0 end),0) end$replace5$);
 if (length(d)-length(replace(d,$replace6$-- Confirmed YASH.BET manual-only policy applies to collected native withdrawals,$replace6$,'')))/length($replace6$-- Confirmed YASH.BET manual-only policy applies to collected native withdrawals,$replace6$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace6$-- Confirmed YASH.BET manual-only policy applies to collected native withdrawals,$replace6$,$replace6$-- Classify native YASH.BET withdrawals by the confirmed latest operator marker,$replace6$);
 if (length(d)-length(replace(d,$replace7$-- Native YASH manual counts are already included once in daily/totals.$replace7$,'')))/length($replace7$-- Native YASH manual counts are already included once in daily/totals.$replace7$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace7$-- Native YASH manual counts are already included once in daily/totals.$replace7$,$replace7$-- Native YASH classified counts are already included once in daily/totals.$replace7$);
 execute d;
 if (select md5(prosrc) from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure)<>'57da58b586ffe7a35550f2a36848124e' then raise exception 'yash_auto_review_result_drift'; end if;
 d:=pg_get_functiondef('private.withdraw_prepared_render(jsonb,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$replace0$  select * from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)$replace0$,'')))/length($replace0$  select * from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)$replace0$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace0$  select * from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)$replace0$,$replace0$  select y.*,c.auto_count,c.manual_count from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)
  cross join lateral (
   select coalesce(sum((r->>'processed')::bigint) filter(where r->>'account'='自动审核'),0)::bigint auto_count,
    coalesce(sum((r->>'processed')::bigint) filter(where nullif(r->>'account','') is not null and r->>'account' not in('自动审核','（未知操作人）')),0)::bigint manual_count
   from jsonb_array_elements(y.operator_rows)r
  )c$replace0$);
 if (length(d)-length(replace(d,$replace1$  -- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.$replace1$,'')))/length($replace1$  -- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.$replace1$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace1$  -- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.$replace1$,$replace1$  -- Confirmed 2026-10-30: exact latest operator 自动审核 means automatic withdrawal.
  -- Preserve every source status and unknown operator; classify all observed statuses.$replace1$);
 if (length(d)-length(replace(d,$replace2$union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,$replace2$,'')))/length($replace2$union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,$replace2$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace2$union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,$replace2$,$replace2$union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,$replace2$);
 if (length(d)-length(replace(d,$replace3$'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false$replace3$,'')))/length($replace3$'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false$replace3$)<>3 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace3$'classificationBasis','confirmed_manual_only','automaticWithdrawalEnabled',false$replace3$,$replace3$'classificationBasis','confirmed_latest_operator_auto_review','automaticWithdrawalEnabled',true$replace3$);
 if (length(d)-length(replace(d,$replace4$'autoCount',0,'manualCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),
     'unclassifiedCount',case when coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) is not null then 0 end$replace4$,'')))/length($replace4$'autoCount',0,'manualCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),
     'unclassifiedCount',case when coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) is not null then 0 end$replace4$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace4$'autoCount',0,'manualCount',coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint),
     'unclassifiedCount',case when coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) is not null then 0 end$replace4$,$replace4$'autoCount',case when v_view='auto' then (v_yash_item->>'autoCount')::bigint when v_yash_item->>'account'='自动审核' then coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) else 0 end,'manualCount',case when v_view='auto' then (v_yash_item->>'manualCount')::bigint when nullif(v_yash_item->>'account','') is not null and v_yash_item->>'account' not in('自动审核','（未知操作人）') then coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) else 0 end,
     'unclassifiedCount',case when coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) is not null then greatest(coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint)-(case when v_view='auto' then (v_yash_item->>'autoCount')::bigint when v_yash_item->>'account'='自动审核' then coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) else 0 end)-(case when v_view='auto' then (v_yash_item->>'manualCount')::bigint when nullif(v_yash_item->>'account','') is not null and v_yash_item->>'account' not in('自动审核','（未知操作人）') then coalesce((v_yash_item->>'total')::bigint,(v_yash_item->>'processed')::bigint) else 0 end),0) end$replace4$);
 if (length(d)-length(replace(d,$replace5$'autoCount',0,'manualCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),
      'unclassifiedCount',case when coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) is not null then 0 end$replace5$,'')))/length($replace5$'autoCount',0,'manualCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),
      'unclassifiedCount',case when coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) is not null then 0 end$replace5$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace5$'autoCount',0,'manualCount',coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint),
      'unclassifiedCount',case when coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) is not null then 0 end$replace5$,$replace5$'autoCount',case when v_view='auto' then (v_yash_item#>>'{previous,autoCount}')::bigint when v_yash_item->>'account'='自动审核' then coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) else 0 end,'manualCount',case when v_view='auto' then (v_yash_item#>>'{previous,manualCount}')::bigint when nullif(v_yash_item->>'account','') is not null and v_yash_item->>'account' not in('自动审核','（未知操作人）') then coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) else 0 end,
      'unclassifiedCount',case when coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) is not null then greatest(coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint)-(case when v_view='auto' then (v_yash_item#>>'{previous,autoCount}')::bigint when v_yash_item->>'account'='自动审核' then coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) else 0 end)-(case when v_view='auto' then (v_yash_item#>>'{previous,manualCount}')::bigint when nullif(v_yash_item->>'account','') is not null and v_yash_item->>'account' not in('自动审核','（未知操作人）') then coalesce((v_yash_item#>>'{previous,total}')::bigint,(v_yash_item#>>'{previous,processed}')::bigint) else 0 end),0) end$replace5$);
 if (length(d)-length(replace(d,$replace6$-- Confirmed YASH.BET manual-only policy applies to collected native withdrawals,$replace6$,'')))/length($replace6$-- Confirmed YASH.BET manual-only policy applies to collected native withdrawals,$replace6$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace6$-- Confirmed YASH.BET manual-only policy applies to collected native withdrawals,$replace6$,$replace6$-- Classify native YASH.BET withdrawals by the confirmed latest operator marker,$replace6$);
 if (length(d)-length(replace(d,$replace7$-- Native YASH manual counts are already included once in daily/totals.$replace7$,'')))/length($replace7$-- Native YASH manual counts are already included once in daily/totals.$replace7$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace7$-- Native YASH manual counts are already included once in daily/totals.$replace7$,$replace7$-- Native YASH classified counts are already included once in daily/totals.$replace7$);
 execute d;
 if (select md5(prosrc) from pg_proc where oid='private.withdraw_prepared_render(jsonb,jsonb)'::regprocedure)<>'8035e437fd2421568754ec1005ca16d4' then raise exception 'yash_auto_review_result_drift'; end if;
 d:=pg_get_functiondef('private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$replace0$  select * from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)$replace0$,'')))/length($replace0$  select * from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)$replace0$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace0$  select * from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)$replace0$,$replace0$  select y.*,c.auto_count,c.manual_count from jsonb_to_recordset(v_yash_days) y(data_date date,country text,platform text,platform_key text,total bigint,success bigint,rejected bigint,
   pending_count bigint,failed_count bigint,unknown_count bigint,avg_seconds numeric,duration_sample_count bigint,duration_total_seconds numeric,
   source_updated_at timestamptz,updated_at timestamptz,complete boolean,operator_rows jsonb)
  cross join lateral (
   select coalesce(sum((r->>'processed')::bigint) filter(where r->>'account'='自动审核'),0)::bigint auto_count,
    coalesce(sum((r->>'processed')::bigint) filter(where nullif(r->>'account','') is not null and r->>'account' not in('自动审核','（未知操作人）')),0)::bigint manual_count
   from jsonb_array_elements(y.operator_rows)r
  )c$replace0$);
 if (length(d)-length(replace(d,$replace1$  -- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.$replace1$,'')))/length($replace1$  -- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.$replace1$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace1$  -- Business confirmation: YASH.BET has not enabled automatic withdrawals.
  -- Classify every collected native withdrawal as manual without changing its source status/operator.$replace1$,$replace1$  -- Confirmed 2026-10-30: exact latest operator 自动审核 means automatic withdrawal.
  -- Preserve every source status and unknown operator; classify all observed statuses.$replace1$);
 if (length(d)-length(replace(d,$replace2$union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,$replace2$,'')))/length($replace2$union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,$replace2$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace2$union all select data_date,country,platform,platform_key,total,success,rejected,0::bigint,total,avg_seconds,source_updated_at,updated_at,$replace2$,$replace2$union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,$replace2$);
 execute d;
 if (select md5(prosrc) from pg_proc where oid='private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)'::regprocedure)<>'9ee2927b3f363062b4c37e6df56f6ec4' then raise exception 'yash_auto_review_result_drift'; end if;
 d:=pg_get_functiondef('private.withdraw_prepared_dependency()'::regprocedure);
 if (length(d)-length(replace(d,$replace0$CASE WHEN p.oid=$replace0$,'')))/length($replace0$CASE WHEN p.oid=$replace0$)<>1 then raise exception 'yash_auto_review_anchor_drift'; end if;
 d:=replace(d,$replace0$CASE WHEN p.oid=$replace0$,$replace0$CASE WHEN p.oid=to_regprocedure('private.withdraw_prepared_render(jsonb,jsonb)')
 AND md5(p.prosrc)='8035e437fd2421568754ec1005ca16d4'
 AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl::text='{postgres=X/postgres}'
 AND p.proconfig=ARRAY['search_path=""'] AND NOT p.prosecdef AND p.provolatile='s'
 AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.procost=100
 AND p.prorows=0 AND NOT p.proretset AND p.prorettype='jsonb'::regtype
 AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 AND pg_get_function_arguments(p.oid)='p_request jsonb, p_bundle jsonb'
 AND p.prosupport='-'::regproc AND p.probin IS NULL AND p.prosqlbody IS NULL
 AND p.provariadic=0 AND p.protrftypes IS NULL AND p.prokind='f'
 AND p.proallargtypes IS NULL AND p.proargmodes IS NULL AND p.pronargdefaults=0
 THEN '06baadf5408d14fd71b12e93c7ee8b68' WHEN p.oid=$replace0$);
 execute d;
 if (select md5(prosrc) from pg_proc where oid='private.withdraw_prepared_dependency()'::regprocedure)<>'c64c59a036d36d07b2911eb4d16fec81' then raise exception 'yash_auto_review_result_drift'; end if;
 select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-array['oid','prosrc']) into after_meta from pg_proc p where oid=any(ARRAY['private.dashboard_admin_live_auto_withdraw(jsonb)','private.withdraw_prepared_render(jsonb,jsonb)','private.auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)','private.withdraw_prepared_dependency()']::regprocedure[]);
 if original_meta is distinct from after_meta then raise exception 'yash_auto_review_metadata_changed'; end if;
 if before_token is distinct from private.withdraw_prepared_dependency() then raise exception 'yash_auto_review_dependency_changed'; end if;
end;$install$;
commit;
