-- Index-bounded AR analytical reads and independent custom analysis segments.
-- No source/collector/schema/index/timeout changes. Preserve original grants,
-- current owner, SECURITY DEFINER search_path and catalog authorization gates.
-- Creation and success are independent event clocks; the union branches are
-- mutually exclusive even when creation time is NULL. Money stays numeric.
begin;
set local statement_timeout='30s';
do $patch$
declare p record;r record;d text;n integer;old_acl aclitem[];old_owner oid;v_name text;
begin
  foreach v_name in array array['dashboard_admin_live_query_raw','dashboard_admin_live_drilldown_raw'] loop
    select * into strict p from pg_proc where oid=to_regprocedure('private.'||v_name||'(jsonb)');
    if not p.prosecdef or p.provolatile<>'s' or p.prorettype<>'jsonb'::regtype
      or p.prolang<>(select oid from pg_language where lanname='plpgsql')
      or p.proconfig is distinct from array['search_path=""','jit=off'] then
      raise exception 'custom_analysis_engine_contract_drift: %',v_name;
    end if;
    d:=pg_get_functiondef(p.oid);old_acl:=p.proacl;old_owner:=p.proowner;
    if position('custom_ar_date_union_v1' in d)>0 then
      if v_name='dashboard_admin_live_drilldown_raw' and (
        position('custom_analysis_ranges_v1' in d)=0 or position('v_hour_min,v_hour_max;' in d)=0
        or (length(d)-length(replace(d,'from output where gp=0 and gd=0','')))/length('from output where gp=0 and gd=0')<>2) then
        raise exception 'custom_analysis_installation_incomplete';
      end if;
      continue;
    end if;
    for r in select * from (values
      ('dashboard_admin_live_query_raw',$old$    $q$;
  elsif v_platform.source='newar' then$old$,$new$    $q$;
    -- custom_ar_date_union_v1: index each clock, retain each source row once.
    v_source:=replace(v_source,$ar_old$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
    if v_action='aggregate' or v_status='success' then
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$    $q$;
  elsif v_platform.source='newar' then$old$,$new$    $q$;
    -- custom_ar_date_union_v1: latency already reads only its successful clock.
    if v_kind<>'latency' then
      v_source:=replace(v_source,$ar_old$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$  v_confirmations jsonb := '{}'::jsonb;$old$,$new$  v_confirmations jsonb := '{}'::jsonb;
  -- custom_analysis_ranges_v1: isolated hour/amount segment, no re-bucketing.
  v_max_exclusive boolean:=false;v_hour_min integer;v_hour_max integer;v_hour_range jsonb;$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$'amountMin','amountMax','amountBands'$old$,$new$'amountMin','amountMax','amountMaxExclusive','hourRange','amountBands'$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$v_kind not in('hourly','amount','amount_range','matrix','matrix_range','latency')$old$,$new$v_kind not in('hourly','amount','amount_range','matrix','matrix_range','latency','custom')$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$    if v_kind<>'hourly' then$old$,$new$    if v_kind not in('hourly','custom') then$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$  select * into v_platform from jsonb_to_recordset(v_options)$old$,$new$  if p_request?'hourRange' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'hourRange') is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_range:=p_request->'hourRange';
    if exists(select 1 from jsonb_object_keys(v_hour_range) k where k<>all(array['minHour','maxHour']))
      or jsonb_typeof(v_hour_range->'minHour') is distinct from 'number'
      or jsonb_typeof(v_hour_range->'maxHour') is distinct from 'number'
      or coalesce(v_hour_range->>'minHour','')!~ '^[0-9]{1,2}$'
      or coalesce(v_hour_range->>'maxHour','')!~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_min:=(v_hour_range->>'minHour')::integer;v_hour_max:=(v_hour_range->>'maxHour')::integer;
    if v_hour_min not between 0 and 23 or v_hour_max not between 1 and 24 or v_hour_min>=v_hour_max then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
  end if;
  if p_request?'amountMaxExclusive' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then raise exception using errcode='22023',message='invalid_range';end if;
  end if;
  if v_kind='custom' and (v_min<0 or v_max<0 or (v_hour_range is null and v_min is null and v_max is null)) then
    raise exception using errcode='22023',message='invalid_custom_segment';
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$($16 is null or amount<=$16)$old$,$new$($16 is null or case when $37 then amount<$16 else amount<=$16 end)$new$,2),
      ('dashboard_admin_live_drilldown_raw',$old$          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27) as created_match,$old$,$new$          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or local_hour>=$38) and ($39 is null or local_hour<$39))) as created_match,$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27) as success_match$old$,$new$          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or success_local_hour>=$38) and ($39 is null or success_local_hour<$39))) as success_match$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$    ), contributions as (
      -- Distinct event clocks: never copy a successful event into creation totals.
      select direction,currency,local_date as date,1::bigint as all_count,amount as all_amount,
        (amount is null)::integer as missing_amount_count,(amount<0)::integer as negative_amount_count,
        (status_group='success')::integer as created_success_count,0::bigint as success_count,0::numeric as success_amount,
        (status_group='pending')::integer as pending_count,case when status_group='pending' then amount else 0 end as pending_amount,
        (status_group='failed')::integer as failed_count,case when status_group='failed' then amount else 0 end as failed_amount,
        (status_group='rejected')::integer as rejected_count,case when status_group='rejected' then amount else 0 end as rejected_amount,
        (status_group='unknown')::integer as unknown_count,case when status_group='unknown' then amount else 0 end as unknown_amount,synced_at
      from segment where created_match
      union all
      select direction,currency,success_local_date,0,0,0,0,0,1,amount,0,0,0,0,0,0,0,0,synced_at from segment where success_match
    ), metrics as (
      select direction,currency,date,sum(all_count)::bigint as all_count,
        case when bool_or(all_count>0 and all_amount is null) then null::numeric else coalesce(sum(all_amount),0) end as all_amount,
        sum(missing_amount_count)::bigint as missing_amount_count,coalesce(sum(negative_amount_count),0)::bigint as negative_amount_count,
        sum(created_success_count)::bigint as created_success_count,sum(success_count)::bigint as success_count,
        case when bool_or(success_count>0 and success_amount is null) then null::numeric else coalesce(sum(success_amount),0) end as success_amount,
        sum(pending_count)::bigint as pending_count,
        case when bool_or(pending_count>0 and pending_amount is null) then null::numeric else coalesce(sum(pending_amount),0) end as pending_amount,
        sum(failed_count)::bigint as failed_count,
        case when bool_or(failed_count>0 and failed_amount is null) then null::numeric else coalesce(sum(failed_amount),0) end as failed_amount,
        sum(rejected_count)::bigint as rejected_count,
        case when bool_or(rejected_count>0 and rejected_amount is null) then null::numeric else coalesce(sum(rejected_amount),0) end as rejected_amount,
        sum(unknown_count)::bigint as unknown_count,
        case when bool_or(unknown_count>0 and unknown_amount is null) then null::numeric else coalesce(sum(unknown_amount),0) end as unknown_amount,
        max(synced_at) as latest_synced_at
      from contributions group by grouping sets ((direction,currency),(direction,currency,date))
    ), output as (
      select date,(to_jsonb(m)-array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'])||jsonb_build_object(
        'all_amount',all_amount::text,'success_amount',success_amount::text,'pending_amount',pending_amount::text,
        'failed_amount',failed_amount::text,'rejected_amount',rejected_amount::text,'unknown_amount',unknown_amount::text) as value from metrics m
    ) select jsonb_build_object(
      'summary',coalesce((select jsonb_agg(value-'date' order by value->>'direction',value->>'currency') from output where date is null),'[]'::jsonb),
      'groups',jsonb_build_object('daily',coalesce((select jsonb_agg(value order by date,value->>'direction',value->>'currency') from output where date is not null),'[]'::jsonb)),
      'rows','[]'::jsonb)
    $q$;
  end if;$old$,$new$    ), provider_names as materialized (
      -- Map each distinct raw name once, before provider/day grouping.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from segment where created_match or success_match) names
    ), selected as (
      select s.*,n.provider as canonical_provider from segment s
      join provider_names n on n.raw_provider=s.provider where s.created_match or s.success_match
    ), contributions as (
      -- Distinct event clocks: never copy a successful event into creation totals.
      select direction,currency,canonical_provider as provider,local_date as date,1::bigint as all_count,amount as all_amount,
        (amount is null)::integer as missing_amount_count,(amount<0)::integer as negative_amount_count,
        (status_group='success')::integer as created_success_count,0::bigint as success_count,0::numeric as success_amount,
        (status_group='pending')::integer as pending_count,case when status_group='pending' then amount else 0 end as pending_amount,
        (status_group='failed')::integer as failed_count,case when status_group='failed' then amount else 0 end as failed_amount,
        (status_group='rejected')::integer as rejected_count,case when status_group='rejected' then amount else 0 end as rejected_amount,
        (status_group='unknown')::integer as unknown_count,case when status_group='unknown' then amount else 0 end as unknown_amount,synced_at
      from selected where created_match
      union all
      select direction,currency,canonical_provider,success_local_date,0,0,0,0,0,1,amount,0,0,0,0,0,0,0,0,synced_at from selected where success_match
    ), metrics as (
      select direction,currency,provider,date,grouping(provider) as gp,grouping(date) as gd,sum(all_count)::bigint as all_count,
        case when bool_or(all_count>0 and all_amount is null) then null::numeric else coalesce(sum(all_amount),0) end as all_amount,
        sum(missing_amount_count)::bigint as missing_amount_count,coalesce(sum(negative_amount_count),0)::bigint as negative_amount_count,
        sum(created_success_count)::bigint as created_success_count,sum(success_count)::bigint as success_count,
        case when bool_or(success_count>0 and success_amount is null) then null::numeric else coalesce(sum(success_amount),0) end as success_amount,
        sum(pending_count)::bigint as pending_count,
        case when bool_or(pending_count>0 and pending_amount is null) then null::numeric else coalesce(sum(pending_amount),0) end as pending_amount,
        sum(failed_count)::bigint as failed_count,
        case when bool_or(failed_count>0 and failed_amount is null) then null::numeric else coalesce(sum(failed_amount),0) end as failed_amount,
        sum(rejected_count)::bigint as rejected_count,
        case when bool_or(rejected_count>0 and rejected_amount is null) then null::numeric else coalesce(sum(rejected_amount),0) end as rejected_amount,
        sum(unknown_count)::bigint as unknown_count,
        case when bool_or(unknown_count>0 and unknown_amount is null) then null::numeric else coalesce(sum(unknown_amount),0) end as unknown_amount,
        max(synced_at) as latest_synced_at
      from contributions group by grouping sets ((direction,currency),(direction,currency,date),
        (direction,currency,provider),(direction,currency,provider,date))
    ), output as (
      select date,gp,gd,(to_jsonb(m)-array['gp','gd','all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'])||jsonb_build_object(
        'all_amount',all_amount::text,'success_amount',success_amount::text,'pending_amount',pending_amount::text,
        'failed_amount',failed_amount::text,'rejected_amount',rejected_amount::text,'unknown_amount',unknown_amount::text) as value from metrics m
    ) select jsonb_build_object(
      'summary',coalesce((select jsonb_agg(value-array['date','provider'] order by value->>'direction',value->>'currency') from output where gp=1 and gd=1),'[]'::jsonb),
      'groups',jsonb_build_object(
        'daily',coalesce((select jsonb_agg(value-'provider' order by date,value->>'direction',value->>'currency') from output where gp=1 and gd=0),'[]'::jsonb),
        'provider',coalesce((select jsonb_agg(value-'date' order by value->>'provider',value->>'direction',value->>'currency') from output where gp=0 and gd=1),'[]'::jsonb),
        'provider_daily',coalesce((select jsonb_agg(value order by date,value->>'provider',value->>'direction',value->>'currency') from output where gp=0 and gd=0),'[]'::jsonb)),
      'rows','[]'::jsonb)
    $q$;
  end if;$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$v_duration_version,v_duration_min,v_duration_max,v_duration_custom;$old$,$new$v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_hour_min,v_hour_max;$new$,1),
      ('dashboard_admin_live_drilldown_raw',$old$'kind',v_kind,'hour',v_hour,'bucket'$old$,$new$'kind',v_kind,'hour',v_hour,'hourRange',v_hour_range,'amountMin',case when v_kind='custom' then v_min end,'amountMax',case when v_kind='custom' then v_max end,'amountMaxExclusive',case when v_kind='custom' and v_max is not null then v_max_exclusive end,'bucket'$new$,1)
    ) a(fn,old_text,new_text,expected_count) where fn=v_name loop
      n:=(length(d)-length(replace(d,r.old_text,'')))/length(r.old_text);
      if n<>r.expected_count then raise exception 'custom_analysis_anchor_drift: %: %',v_name,left(r.old_text,100);end if;
      d:=replace(d,r.old_text,r.new_text);
    end loop;
    execute d;
    if exists(select 1 from pg_proc q where q.oid=p.oid
      and(q.proacl is distinct from old_acl or q.proowner<>old_owner or q.proconfig is distinct from p.proconfig)) then
      raise exception 'custom_analysis_acl_changed';
    end if;
  end loop;
end;
$patch$;
notify pgrst,'reload schema';
commit;
