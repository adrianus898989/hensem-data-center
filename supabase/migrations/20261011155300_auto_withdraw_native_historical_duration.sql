-- Historical AR native duration is a verified received-source cache, never upstream completeness.
-- Cache misses retain source-report time. No historical raw order scan is added to the live RPC.
begin;
set local lock_timeout='2s';
do $patch$
declare p record;before_meta jsonb;definition text;entry record;
begin
 for entry in select * from(values ('private.invalidate_ar_historical_duration_cache()','449b1519da934e2da7034f698d42fb9a'),('private.refresh_ar_historical_duration(text,date)','c1ca787546f804af858c5316305b7f70'),('private.guard_ar_historical_duration_cache_write()','8ec77a15af7089409cc9368db595a5e7'),('private.ar_historical_duration_generation()','059d6bd465ec451839f0db41aad2ea0e'),('private.dashboard_admin_ar_historical_duration_days(jsonb,jsonb,date,date)','9a7bba61d4cdb9b185c7fb7a07c8dc03'))f(sig,hash) loop
  select q.* into p from pg_proc q where q.oid=to_regprocedure(entry.sig);
  if not found or md5(p.prosrc)<>entry.hash or pg_get_userbyid(p.proowner)<>'postgres'
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
   then raise exception 'AR_DURATION_CACHE_PREREQUISITE_DRIFT';end if;
 end loop;
 if private.ar_historical_duration_generation() is null then raise exception 'AR_DURATION_CACHE_GENERATION_INVALID';end if;
 select q.*,pg_get_userbyid(q.proowner) owner_name,to_jsonb(q)-'prosrc' metadata into p
 from pg_proc q where q.oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if p.owner_name<>'postgres' or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u'
  or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}' or p.proretset or pg_get_function_result(p.oid)<>'jsonb'
  then raise exception 'AR_DURATION_CACHE_MAIN_METADATA_DRIFT';end if;
 if md5(p.prosrc) not in('5dfb74e25b5702bd6dc9212c2be9f1c3','cb33854922fdb014a665fba646ace941') then raise exception 'AR_DURATION_CACHE_MAIN_BODY_DRIFT';end if;
 before_meta:=p.metadata;if md5(p.prosrc)='cb33854922fdb014a665fba646ace941' then return;end if;
 definition:=pg_get_functiondef(p.oid);
 if (length(definition)-length(replace(definition,$old0$v_newar_days jsonb;v_ar_days jsonb;$old0$,'')))/length($old0$v_newar_days jsonb;v_ar_days jsonb;$old0$)<>1 then raise exception 'AR_DURATION_CACHE_MAIN_ANCHOR_DRIFT';end if;
 definition:=replace(definition,$old0$v_newar_days jsonb;v_ar_days jsonb;$old0$,$new0$v_newar_days jsonb;v_ar_history_durations jsonb:='[]'::jsonb;v_ar_days jsonb;$new0$);
 if (length(definition)-length(replace(definition,$old1$ from private.dashboard_admin_ar_withdraw_days(p_request,v_scope,v_before,v_end) a;
 with selected_targets$old1$,'')))/length($old1$ from private.dashboard_admin_ar_withdraw_days(p_request,v_scope,v_before,v_end) a;
 with selected_targets$old1$)<>1 then raise exception 'AR_DURATION_CACHE_MAIN_ANCHOR_DRIFT';end if;
 definition:=replace(definition,$old1$ from private.dashboard_admin_ar_withdraw_days(p_request,v_scope,v_before,v_end) a;
 with selected_targets$old1$,$new1$ from private.dashboard_admin_ar_withdraw_days(p_request,v_scope,v_before,v_end) a;
 if v_view='auto' and v_before<date '2026-10-10' then
  select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) into v_ar_history_durations
  from private.dashboard_admin_ar_historical_duration_days(p_request,v_scope,v_before,least(v_end,date '2026-10-09')) h;
 end if;
 with selected_targets$new1$);
 if (length(definition)-length(replace(definition,$old2$ ), daily_source as materialized (
  select p.* from prior_daily_source p$old2$,'')))/length($old2$ ), daily_source as materialized (
  select p.* from prior_daily_source p$old2$)<>1 then raise exception 'AR_DURATION_CACHE_MAIN_ANCHOR_DRIFT';end if;
 definition:=replace(definition,$old2$ ), daily_source as materialized (
  select p.* from prior_daily_source p$old2$,$new2$ ), historical_ar_duration as materialized (
  select * from jsonb_to_recordset(v_ar_history_durations) h(data_date date,country text,platform_key text,alias_keys text[],
   duration_sample_count bigint,duration_total_seconds numeric,generated_at timestamptz)
  where h.duration_sample_count>0
 ), prior_ar_duration_rows as not materialized (
  select p.*,h.duration_sample_count native_sample_count,h.duration_total_seconds native_total_seconds,
   row_number() over(partition by p.data_date,p.country,h.platform_key order by p.platform_key,p.platform,p.total,p.success,p.rejected,p.auto_count,p.manual_count,
    p.duration_sample_count,p.duration_total_seconds,p.source_updated_at,p.updated_at) native_rank
  from prior_daily_source p left join historical_ar_duration h on h.data_date=p.data_date and h.country=p.country and p.platform_key=any(h.alias_keys)
 ), prior_ar_duration_source as materialized (
  -- One canonical/day native pool is attached once even when reports expose several aliases or rows.
  -- Keep every report count, classification and timestamp; only replace processing-time fields.
  select p.data_date,p.country,p.platform,p.platform_key,p.total,p.success,p.rejected,p.auto_count,p.manual_count,
   case when p.native_sample_count is not null then case when p.native_rank=1 then p.native_total_seconds/nullif(p.native_sample_count,0) end else p.avg_seconds end avg_seconds,
   p.source_updated_at,p.updated_at,
   case when p.native_sample_count is not null then case when p.native_rank=1 then p.native_sample_count else 0 end else p.duration_sample_count end duration_sample_count,
   case when p.native_sample_count is not null then case when p.native_rank=1 then p.native_total_seconds else 0 end else p.duration_total_seconds end duration_total_seconds,
   case when p.native_sample_count is not null then 'applied_to_completed' else p.duration_basis end duration_basis
  from prior_ar_duration_rows p
 ), daily_source as materialized (
  select p.* from prior_ar_duration_source p$new2$);
 if (length(definition)-length(replace(definition,$old3$    when 'durationChange' then case when coalesce((item->>'comparisonComparable')::boolean,true)
      then (item->>'avgSeconds')::numeric/nullif((item->'previous'->>'avgSeconds')::numeric,0)-1 end$old3$,'')))/length($old3$    when 'durationChange' then case when coalesce((item->>'comparisonComparable')::boolean,true)
      then (item->>'avgSeconds')::numeric/nullif((item->'previous'->>'avgSeconds')::numeric,0)-1 end$old3$)<>1 then raise exception 'AR_DURATION_CACHE_MAIN_ANCHOR_DRIFT';end if;
 definition:=replace(definition,$old3$    when 'durationChange' then case when coalesce((item->>'comparisonComparable')::boolean,true)
      then (item->>'avgSeconds')::numeric/nullif((item->'previous'->>'avgSeconds')::numeric,0)-1 end$old3$,$new3$    when 'durationChange' then case when item->>'durationBasis'=any(array['created_to_operated','created_to_completed','applied_to_completed','source_submitted_to_handled','source_reported_processing'])
      and item->>'durationBasis'=item->'previous'->>'durationBasis'
      and item->>'avgSeconds' not in('NaN','Infinity','-Infinity') and item->'previous'->>'avgSeconds' not in('NaN','Infinity','-Infinity')
      and (item->>'avgSeconds')::numeric>=0 and (item->'previous'->>'avgSeconds')::numeric>=0
      then case when (item->'previous'->>'avgSeconds')::numeric=0 then case when (item->>'avgSeconds')::numeric=0 then 0 end
       else (item->>'avgSeconds')::numeric/(item->'previous'->>'avgSeconds')::numeric-1 end end$new3$);
 if (length(definition)-length(replace(definition,$old4$ return v_result;$old4$,'')))/length($old4$ return v_result;$old4$)<>1 then raise exception 'AR_DURATION_CACHE_MAIN_ANCHOR_DRIFT';end if;
 definition:=replace(definition,$old4$ return v_result;$old4$,$new4$ if v_view='auto' and jsonb_array_length(v_ar_history_durations)>0 then
  v_ar_rows:='[]'::jsonb;
  for v_ar_item in select value from jsonb_array_elements(v_result->'rows') loop
   if v_ar_item->>'durationBasis'='applied_to_completed' and exists(
    select 1 from jsonb_to_recordset(v_ar_history_durations) h(data_date date,country text,platform_key text,alias_keys text[],duration_sample_count bigint)
    where h.country=v_ar_item->>'country' and private.dashboard_admin_live_withdraw_key(v_ar_item->>'platform')=any(h.alias_keys) and h.duration_sample_count>0
     and h.data_date between case when v_daily then (v_ar_item->>'dataDate')::date else v_start end and case when v_daily then (v_ar_item->>'dataDate')::date else v_end end) then
    v_ar_item:=v_ar_item||jsonb_build_object('durationSource','native_historical_cache','durationCacheVerified',true,'durationCompletenessVerified',false);
   end if;
   if v_ar_item#>>'{previous,durationBasis}'='applied_to_completed' and exists(
    select 1 from jsonb_to_recordset(v_ar_history_durations) h(data_date date,country text,platform_key text,alias_keys text[],duration_sample_count bigint)
    where h.country=v_ar_item->>'country' and private.dashboard_admin_live_withdraw_key(v_ar_item->>'platform')=any(h.alias_keys) and h.duration_sample_count>0
     and h.data_date between case when v_daily then (v_ar_item->>'dataDate')::date-1 else v_before end and case when v_daily then (v_ar_item->>'dataDate')::date-1 else v_start-1 end) then
    v_ar_item:=jsonb_set(v_ar_item,'{previous}',(v_ar_item->'previous')||jsonb_build_object('durationSource','native_historical_cache','durationCacheVerified',true,'durationCompletenessVerified',false));
   end if;
   v_ar_rows:=v_ar_rows||jsonb_build_array(v_ar_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_ar_rows);
 end if;
 return v_result;$new4$);
 execute definition;
 select md5(q.prosrc) hash,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if p.hash<>'cb33854922fdb014a665fba646ace941' or p.metadata is distinct from before_meta then raise exception 'AR_DURATION_CACHE_MAIN_POSTCHECK';end if;
end;$patch$;
commit;
