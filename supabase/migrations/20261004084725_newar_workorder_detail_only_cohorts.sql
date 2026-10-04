-- Reuse accepted NEW_AR deposit tickets when a native platform/day has no
-- daily receipt. Existing daily facts and original-payment matching remain
-- authoritative. Collected tickets never prove full-day completeness.
begin;
set local lock_timeout='3s';set local statement_timeout='20s';
do $install$
declare target regprocedure:='private.dashboard_admin_live_workorders(jsonb)'::regprocedure;
 p pg_proc%rowtype;metadata jsonb;definition text;original text;replacement text;
begin
 select * into p from pg_proc where oid=target;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or p.provolatile<>'s' then
  raise exception 'newar_workorder_detail_metadata_or_acl_drift';end if;
 if md5(p.prosrc)='813f5a871d33d24489616dc4cfa353a4' then return;end if;
 if md5(p.prosrc)<>'45eea02c1db9fa617efe277a8bdc056c' then raise exception 'newar_workorder_detail_baseline_drift';end if;
 if (select md5(prosrc) from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure)
  <>'a7bcb66755d22ddb9d6228cf94c91a4e' then raise exception 'newar_workorder_original_helper_baseline_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';
 select pg_get_functiondef(target) into definition;
 original:=$old_0$  ), scoped as materialized (
$old_0$;
 replacement:=$new_0$  ), newar_detail_targets_v1 as materialized (
    -- Only the exact authorized native identity can contribute realtime rows.
    select distinct n.platform,n.country_code,n.country,n.timezone,n.currency,n.launch_at
    from targets p join public.newar_detail_platforms n on p.source='newar'
      and n.platform=p.source_name and n.country=p.country and n.country_code=p.scope_group
    where v_direction in ('all','charge') and n.enabled
      and (n.launch_at is null or n.launch_at<=statement_timestamp())
      and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
  ), newar_detail_days_v1 as materialized (
    -- Existing daily receipt, including a confirmed zero, wins for the whole
    -- native platform/day. Never double count a daily cohort and its tickets.
    select t.*,day::date stat_date
    from newar_detail_targets_v1 t
    cross join lateral generate_series(v_start::timestamp,v_end::timestamp,interval '1 day') day
    where not exists(select 1 from public.workorder_deposit_daily w
      where w.source_system='AR_WORKORDER' and w.country_code=t.country_code
        and w.country=t.country and w.platform=t.platform and w.stat_date=day::date)
  ), newar_detail_rows_v1 as materialized (
    select t.stat_date,t.country_code,t.country,t.platform,
      coalesce(nullif(btrim(n.provider),''),'未识别三方') raw_provider,
      coalesce(nullif(btrim(n.channel_type),''),'未识别通道') channel_type,
      case when n.currency=t.currency and n.amount is not null
        and n.amount::text not in ('NaN','Infinity','-Infinity') then n.amount end amount,
      n.status_code='4' successful,n.captured_at,n.received_at
    from newar_detail_days_v1 t join public.newar_detail_records n
      on n.platform=t.platform and n.dataset='workorder'
      and n.created_at>=(t.stat_date::timestamp at time zone t.timezone)
      and n.created_at<((t.stat_date+1)::timestamp at time zone t.timezone)
      and (t.launch_at is null or n.created_at>=t.launch_at)
    where n.workorder_type in ('存款未到账','存款未到账自动化')
  ), newar_detail_scoped_v1 as materialized (
    -- These are counts of accepted collected tickets, not expected full-day
    -- totals. Original payment references, conflicts and KYC remain in the
    -- unchanged original-order helper after canonical provider filtering.
    select stat_date,country_code,country,platform,raw_provider,channel_type,
      count(*) submitted_count,
      case when bool_and(amount is not null) then sum(amount) end submitted_amount,
      count(*) filter(where successful) success_count,
      case when count(*) filter(where successful)=0 then 0::numeric
        when bool_and(amount is not null) filter(where successful) then sum(amount) filter(where successful) end success_amount,
      case when count(*) filter(where not coalesce(successful,false))=0 then 0::numeric
        when bool_and(amount is not null) filter(where not coalesce(successful,false))
        then sum(amount) filter(where not coalesce(successful,false)) end pending_amount,
      count(*) filter(where not coalesce(successful,false)) pending_count,
      0::bigint withdraw_not_received_count,0::numeric withdraw_not_received_amount,
      0::bigint withdraw_success_count,0::numeric withdraw_success_amount,
      max(captured_at) source_updated_at,max(received_at) updated_at,true detail_only
    from newar_detail_rows_v1
    group by stat_date,country_code,country,platform,raw_provider,channel_type
  ), daily_scoped as materialized (
$new_0$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_0_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_1$      w.withdraw_success_count,w.withdraw_success_amount,w.source_updated_at,w.updated_at
$old_1$;
 replacement:=$new_1$      w.withdraw_success_count,w.withdraw_success_amount,w.source_updated_at,w.updated_at,false detail_only
$new_1$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_1_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_2$  ), identities as materialized (
$old_2$;
 replacement:=$new_2$  ), scoped as materialized (
    select * from daily_scoped
    union all
    select stat_date,country_code,country,platform,raw_provider,channel_type,
      submitted_count,submitted_amount,success_count,success_amount,pending_count,pending_amount,
      withdraw_not_received_count,withdraw_not_received_amount,withdraw_success_count,withdraw_success_amount,
      source_updated_at,updated_at,detail_only
    from newar_detail_scoped_v1
  ), identities as materialized (
$new_2$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_2_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_3$      count(distinct s.stat_date)::integer as days,(v_end-v_start+1) as expected_days
$old_3$;
 replacement:=$new_3$      count(distinct s.stat_date) filter(where not s.detail_only)::integer as days,
      count(distinct s.stat_date) filter(where s.detail_only)::integer as detail_days,(v_end-v_start+1) as expected_days
$new_3$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_3_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_4$    'version',2,'basis','AR_WORKORDER_daily_read_model','startDate',v_start,'endDate',v_end,
$old_4$;
 replacement:=$new_4$    'version',2,'basis',case when exists(select 1 from newar_detail_scoped_v1) then 'AR_WORKORDER_daily_or_collected_read_model' else 'AR_WORKORDER_daily_read_model' end,'startDate',v_start,'endDate',v_end,
$new_4$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_4_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_5$        'days',days,'expectedDays',expected_days,'complete',days=expected_days) order by platform) from coverage),'[]'::jsonb)),
$old_5$;
 replacement:=$new_5$        'days',days,'expectedDays',expected_days,'complete',days=expected_days)||
        case when detail_days>0 then jsonb_build_object('detailOnlyDays',detail_days) else '{}'::jsonb end
        order by platform) from coverage),'[]'::jsonb))||
      case when exists(select 1 from newar_detail_scoped_v1) then jsonb_build_object('detailOnly',jsonb_build_object(
        'basis','accepted_newar_deposit_tickets_without_daily_receipt',
        'platformDays',(select count(*) from (select distinct country_code,platform,stat_date from newar_detail_scoped_v1) d),
        'collectedTickets',(select sum(submitted_count) from newar_detail_scoped_v1),
        'latestCapturedAt',(select max(source_updated_at) from newar_detail_scoped_v1),
        'latestReceivedAt',(select max(updated_at) from newar_detail_scoped_v1),
        'complete',false)) else '{}'::jsonb end,
$new_5$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_5_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_6$      sum(submitted_amount) as submitted_amount,
$old_6$;
 replacement:=$new_6$      case when count(submitted_amount)=count(*) then sum(submitted_amount) end as submitted_amount,
$new_6$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_6_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_7$    select coalesce(sum(submitted_amount),0) as submitted_amount,
$old_7$;
 replacement:=$new_7$    select case when count(submitted_amount)=count(*) then coalesce(sum(submitted_amount),0) end as submitted_amount,
$new_7$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_7_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_8$      select provider,direction,sum(submitted_amount) as "submittedAmount",sum(submitted_count) as "submittedCount",
$old_8$;
 replacement:=$new_8$      select provider,direction,case when count(submitted_amount)=count(*) then sum(submitted_amount) end as "submittedAmount",sum(submitted_count) as "submittedCount",
$new_8$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_8_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_9$        sum(submitted_amount) as submitted_amount,sum(submitted_count) as submitted_count,
$old_9$;
 replacement:=$new_9$        case when count(submitted_amount)=count(*) then sum(submitted_amount) end as submitted_amount,sum(submitted_count) as submitted_count,
$new_9$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_9_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_10$      from (select direction,coalesce(sum(submitted_amount),0) as submitted_amount,
$old_10$;
 replacement:=$new_10$      from (select direction,case when count(submitted_amount)=count(*) then coalesce(sum(submitted_amount),0) end as submitted_amount,
$new_10$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_10_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_11$      sum(success_amount) as success_amount,
$old_11$;
 replacement:=$new_11$      case when count(success_amount)=count(*) then sum(success_amount) end as success_amount,
$new_11$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_11_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_12$      coalesce(sum(success_amount),0) as success_amount,
$old_12$;
 replacement:=$new_12$      case when count(success_amount)=count(*) then coalesce(sum(success_amount),0) end as success_amount,
$new_12$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_12_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_13$        sum(success_amount) as "successAmount",sum(success_count) as "successCount",
$old_13$;
 replacement:=$new_13$        case when count(success_amount)=count(*) then sum(success_amount) end as "successAmount",sum(success_count) as "successCount",
$new_13$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_13_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_14$        sum(success_amount) as success_amount,sum(success_count) as success_count,
$old_14$;
 replacement:=$new_14$        case when count(success_amount)=count(*) then sum(success_amount) end as success_amount,sum(success_count) as success_count,
$new_14$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_14_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_15$        coalesce(sum(submitted_count),0) as submitted_count,coalesce(sum(success_amount),0) as success_amount,
$old_15$;
 replacement:=$new_15$        coalesce(sum(submitted_count),0) as submitted_count,case when count(success_amount)=count(*) then coalesce(sum(success_amount),0) end as success_amount,
$new_15$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_15_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_16$      sum(not_received_amount) as not_received_amount,
$old_16$;
 replacement:=$new_16$      case when count(not_received_amount)=count(*) then sum(not_received_amount) end as not_received_amount,
$new_16$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_16_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_17$      coalesce(sum(not_received_amount),0) as not_received_amount,
$old_17$;
 replacement:=$new_17$      case when count(not_received_amount)=count(*) then coalesce(sum(not_received_amount),0) end as not_received_amount,
$new_17$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_17_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_18$        sum(not_received_amount) as "notReceivedAmount",sum(not_received_count) as "notReceivedCount"
$old_18$;
 replacement:=$new_18$        case when count(not_received_amount)=count(*) then sum(not_received_amount) end as "notReceivedAmount",sum(not_received_count) as "notReceivedCount"
$new_18$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_18_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_19$        sum(not_received_amount) as not_received_amount,sum(not_received_count) as not_received_count
$old_19$;
 replacement:=$new_19$        case when count(not_received_amount)=count(*) then sum(not_received_amount) end as not_received_amount,sum(not_received_count) as not_received_count
$new_19$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_19_drift';end if;
 definition:=replace(definition,original,replacement);
 original:=$old_20$        coalesce(sum(success_count),0) as success_count,coalesce(sum(not_received_amount),0) as not_received_amount,
$old_20$;
 replacement:=$new_20$        coalesce(sum(success_count),0) as success_count,case when count(not_received_amount)=count(*) then coalesce(sum(not_received_amount),0) end as not_received_amount,
$new_20$;
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'newar_workorder_detail_patch_20_drift';end if;
 definition:=replace(definition,original,replacement);
 execute definition;
 if(select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target)is distinct from metadata then
  raise exception 'newar_workorder_detail_metadata_changed';end if;
 if(select md5(prosrc) from pg_proc where oid=target)<>'813f5a871d33d24489616dc4cfa353a4' then raise exception 'newar_workorder_detail_candidate_hash';end if;
end $install$;
notify pgrst,'reload schema';
commit;
