-- Reconcile AR creation-day intake with a validated RECHARGE_REVIEW snapshot.
-- Read-only business data; existing authorization and function ACLs are retained.
begin;
do $migration$
declare p record;v_definition text;v_body text;v_acl aclitem[];v_auth oid;v_service oid;
begin
 select oid into v_auth from pg_roles where rolname='authenticated';
 select oid into v_service from pg_roles where rolname='service_role';
 select * into p from pg_proc where oid=to_regprocedure('public.dashboard_admin_live_intake_coverage(jsonb)');
 if not found or md5(p.prosrc)<>'697704eba7fc57c48dddfd78ec6043ff' or p.prosecdef
  or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s' or p.pronargdefaults<>1
  or p.proconfig is distinct from array['search_path=""']
  or p.prolang<>(select oid from pg_language where lanname='sql') then raise exception 'ar_creation_coverage_public_drift';end if;
 if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.is_grantable or a.grantee not in(p.proowner,v_auth,coalesce(v_service,p.proowner)))
  or not exists(select 1 from aclexplode(p.proacl) a where a.grantee=v_auth and a.privilege_type='EXECUTE' and not a.is_grantable)
 then raise exception 'ar_creation_coverage_public_acl_drift';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_intake_coverage(jsonb)');
 if not found or md5(p.prosrc) not in ('ec7507aca3dd677e9f4a85d6ad59b9a7','c8550ba902b18fed16dc60c26393cba8') or not p.prosecdef
  or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s' or p.pronargdefaults<>1
  or p.proconfig is distinct from array['search_path=""','jit=off']
  or p.prolang<>(select oid from pg_language where lanname='plpgsql') then raise exception 'ar_creation_coverage_private_drift';end if;
 if v_auth is null or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.is_grantable or a.grantee not in(p.proowner,v_auth))
  or not exists(select 1 from aclexplode(p.proacl) a where a.grantee=v_auth and a.privilege_type='EXECUTE' and not a.is_grantable)
 then raise exception 'ar_creation_coverage_private_acl_drift';end if;
 if md5(p.prosrc)='c8550ba902b18fed16dc60c26393cba8' then return;end if;
 v_acl:=p.proacl;v_definition:=pg_get_functiondef(p.oid);
 v_definition:=replace(v_definition,$olddecl$ status text;evidence text;received boolean;complete boolean;zero_confirmed boolean;expected boolean;collector_status text;expected_count bigint;fetched_count bigint;$olddecl$,$newdecl$ status text;evidence text;received boolean;complete boolean;zero_confirmed boolean;expected boolean;collector_status text;expected_count bigint;fetched_count bigint;
 -- AR_CREATION_COVERAGE_DECL_BEGIN
 v_ar_snapshot record;v_ar_valid boolean;v_ar_counts numeric[];v_ar_value jsonb;v_ar_group jsonb;
 v_ar_expected_groups jsonb;v_ar_observed_groups jsonb;v_ar_group_key text;v_ar_group_total numeric;
 -- AR_CREATION_COVERAGE_DECL_END$newdecl$);
 v_definition:=replace(v_definition,$oldbranch$     if not coalesce(v_has,false) and exists(select 1 from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform and a.order_kind=v_kind and a.source_system='AR' and a.completed_at>=v_day::timestamp and a.completed_at<(v_day+1)::timestamp) then evidence:='only_success_day_records_received';end if;$oldbranch$,$newbranch$     if not coalesce(v_has,false) and exists(select 1 from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform and a.order_kind=v_kind and a.source_system='AR' and a.completed_at>=v_day::timestamp and a.completed_at<(v_day+1)::timestamp) then evidence:='only_success_day_records_received';end if;
     -- AR_CREATION_COVERAGE_BEGIN
     -- A successful API response or one created order is not a full-day receipt.
     -- Only charge is reconciled; payout and the independently timed success cohort stay unchanged.
     if v_direction='charge' then
      select t.snapshot,t.snapshot_id,t.snapshot_at,t.updated_at into v_ar_snapshot
       from public.collection_success_daily t where t.source_system='RECHARGE_REVIEW'
        and t.country_code=v_raw_country and t.platform=v_raw_platform and t.stat_date=v_day;
      if found then
       v_ar_valid:=coalesce(jsonb_typeof(v_ar_snapshot.snapshot)='object'
        and v_ar_snapshot.snapshot->'schema_version'='1'::jsonb
        and v_ar_snapshot.snapshot->>'source_system'='RECHARGE_REVIEW'
        and v_ar_snapshot.snapshot->>'country_code'=v_raw_country
        and v_ar_snapshot.snapshot->>'platform'=v_raw_platform
        and v_ar_snapshot.snapshot->>'stat_date'=v_day::text
        and v_ar_snapshot.snapshot->>'timezone'=v_zone
        and v_ar_snapshot.snapshot->>'snapshot_id'=v_ar_snapshot.snapshot_id::text
        and v_ar_snapshot.snapshot#>'{coverage,complete}'='true'::jsonb
        and jsonb_typeof(v_ar_snapshot.snapshot->'coverage')='object'
        and jsonb_typeof(v_ar_snapshot.snapshot->'totals')='object'
        and jsonb_typeof(v_ar_snapshot.snapshot->'groups')='array'
        and isfinite(v_ar_snapshot.snapshot_at) and v_ar_snapshot.snapshot_at<=v_asof+interval '5 minutes'
        and (v_ar_snapshot.snapshot_at at time zone v_zone)::date>v_day,false);
       if v_ar_valid then
        begin
         v_ar_valid:=coalesce(jsonb_typeof(v_ar_snapshot.snapshot->'snapshot_at')='string'
          and v_ar_snapshot.snapshot->>'snapshot_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
          and (v_ar_snapshot.snapshot->>'snapshot_at')::timestamptz=v_ar_snapshot.snapshot_at,false);
        exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then v_ar_valid:=false;
        end;
       end if;
       v_ar_counts:=array[]::numeric[];
       if v_ar_valid then
        foreach v_ar_value in array array[v_ar_snapshot.snapshot#>'{coverage,expected_count}',
          v_ar_snapshot.snapshot#>'{coverage,fetched_count}',v_ar_snapshot.snapshot#>'{coverage,unique_count}',
          v_ar_snapshot.snapshot#>'{totals,submitted_count}'] loop
         if jsonb_typeof(v_ar_value) is distinct from 'number' then v_ar_valid:=false;exit;end if;
         if (v_ar_value::text)::numeric not between 0 and 9007199254740991
          or trunc((v_ar_value::text)::numeric)<>(v_ar_value::text)::numeric then v_ar_valid:=false;exit;end if;
         v_ar_counts:=array_append(v_ar_counts,(v_ar_value::text)::numeric);
        end loop;
       end if;
       if v_ar_valid then
        v_ar_valid:=v_ar_counts[1]=v_ar_counts[2] and v_ar_counts[1]=v_ar_counts[3]
         and v_ar_counts[1]=v_ar_counts[4] and jsonb_array_length(v_ar_snapshot.snapshot->'groups')<=2000;
       end if;
       v_ar_expected_groups:='{}';v_ar_group_total:=0;
       if v_ar_valid then
        for v_ar_group in select value from jsonb_array_elements(v_ar_snapshot.snapshot->'groups') loop
         if jsonb_typeof(v_ar_group) is distinct from 'object'
          or jsonb_typeof(v_ar_group->'raw_channel') is distinct from 'string'
          or jsonb_typeof(v_ar_group->'channel_type') is distinct from 'string'
          or length(v_ar_group->>'raw_channel') not between 1 and 96
          or length(v_ar_group->>'channel_type') not between 1 and 48
          or jsonb_typeof(v_ar_group->'submitted_count') is distinct from 'number' then v_ar_valid:=false;exit;end if;
         v_ar_value:=v_ar_group->'submitted_count';
         if (v_ar_value::text)::numeric not between 1 and 9007199254740991
          or trunc((v_ar_value::text)::numeric)<>(v_ar_value::text)::numeric then v_ar_valid:=false;exit;end if;
         v_ar_group_key:=jsonb_build_array(v_ar_group->>'raw_channel',v_ar_group->>'channel_type')::text;
         if v_ar_expected_groups ? v_ar_group_key then v_ar_valid:=false;exit;end if;
         v_ar_expected_groups:=v_ar_expected_groups||jsonb_build_object(v_ar_group_key,v_ar_value);
         v_ar_group_total:=v_ar_group_total+(v_ar_value::text)::numeric;
        end loop;
        v_ar_valid:=v_ar_valid and v_ar_group_total=v_ar_counts[1];
       end if;
       if v_ar_valid then
        expected_count:=v_ar_counts[1]::bigint;collector_status:='snapshot_complete';
        -- Exact raw channel/type comparison: aliases must not hide a missing channel.
        -- No member/order fields or amounts leave this aggregate; status is deliberately irrelevant.
        select coalesce(sum(g.n),0)::bigint,coalesce(jsonb_object_agg(g.key,to_jsonb(g.n)),'{}'::jsonb),max(g.seen)
         into fetched_count,v_ar_observed_groups,v_seen from(
          select jsonb_build_array(a.raw_channel,a.channel_type)::text key,count(*) n,max(a.updated_at) seen
          from public.ar_collected_orders a where a.country_code=v_raw_country and a.platform=v_raw_platform
           and a.order_kind='recharge' and a.source_system='AR'
           and a.applied_at>=v_day::timestamp and a.applied_at<(v_day+1)::timestamp
          group by a.raw_channel,a.channel_type)g;
        v_has:=fetched_count>0;
        complete:=fetched_count=expected_count and v_ar_observed_groups=v_ar_expected_groups;
        zero_confirmed:=complete and expected_count=0;
        if complete then
         v_has:=true;v_seen:=coalesce(v_seen,v_ar_snapshot.updated_at,v_ar_snapshot.snapshot_at);
         status:=case when zero_confirmed then 'zero_complete' else 'complete' end;
         evidence:=case when zero_confirmed then 'source_completed_zero_rows' else 'source_created_counts_reconciled' end;
        else
         status:='partial';evidence:=case when fetched_count<>expected_count
          then 'source_created_count_mismatch' else 'source_created_channel_mismatch' end;
        end if;
       else
        collector_status:='snapshot_invalid';evidence:='source_snapshot_invalid';
        status:=case when coalesce(v_has,false) then 'received' else 'not_received' end;
       end if;
      end if;
     end if;
     -- AR_CREATION_COVERAGE_END$newbranch$);
 execute v_definition;
 select prosrc,proacl into v_body,v_acl from pg_proc where oid=p.oid;
 if md5(v_body)<>'c8550ba902b18fed16dc60c26393cba8' or v_acl is distinct from p.proacl then
  raise exception 'ar_creation_coverage_postcheck_failed';end if;
end;$migration$;
commit;
