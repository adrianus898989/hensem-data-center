-- Preserve received prior NEWAR report time without borrowing report counts.
-- No source orders are scanned; current/previous classification and coverage remain unchanged.
begin;
set local lock_timeout='2s';
do $patch$
declare p record;before_meta jsonb;definition text;
begin
 select q.*,pg_get_userbyid(q.proowner) owner_name,to_jsonb(q)-'prosrc' metadata into p
 from pg_proc q where q.oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if p.owner_name<>'postgres' or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u'
  or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or pg_get_function_result(p.oid)<>'jsonb' or p.proretset
  then raise exception 'WITHDRAW_HISTORICAL_DURATION_METADATA_MISMATCH';end if;
 if md5(p.prosrc) not in('5969967b0e0e25511c43a5df5e25ec6f','5dfb74e25b5702bd6dc9212c2be9f1c3') then raise exception 'WITHDRAW_HISTORICAL_DURATION_BODY_MISMATCH';end if;
 before_meta:=p.metadata;
 if md5(p.prosrc)='5dfb74e25b5702bd6dc9212c2be9f1c3' then return;end if;
 definition:=pg_get_functiondef(p.oid);
 if (length(definition)-length(replace(definition,$old0$ ), daily_source as materialized ($old0$,'')))/length($old0$ ), daily_source as materialized ($old0$)<>1 then raise exception 'WITHDRAW_HISTORICAL_DURATION_ANCHOR_MISMATCH';end if;
 definition:=replace(definition,$old0$ ), daily_source as materialized ($old0$,$new0$ ), historical_newar_duration as materialized (
  -- Only observed prior source-report time may fill a missing prior native time.
  -- The native cohort/counts and current period are never replaced by a report.
  select p.data_date,p.country,p.platform_key,
   sum(p.duration_sample_count)::bigint duration_sample_count,
   sum(p.duration_total_seconds) duration_total_seconds,
   sum(p.duration_total_seconds)/nullif(sum(p.duration_sample_count),0) avg_seconds
  from prior_daily_source p
  where p.data_date<v_start and p.duration_sample_count>0 and p.duration_total_seconds is not null
   and exists(select 1 from newar_days n where n.data_date=p.data_date and n.country=p.country and n.platform_key=p.platform_key
    and n.avg_seconds is null and coalesce(n.duration_sample_count,0)=0)
  group by p.data_date,p.country,p.platform_key
 ), daily_source as materialized ($new0$);
 if (length(definition)-length(replace(definition,$old1$  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'source_submitted_to_handled'::text from newar_days$old1$,'')))/length($old1$  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'source_submitted_to_handled'::text from newar_days$old1$)<>1 then raise exception 'WITHDRAW_HISTORICAL_DURATION_ANCHOR_MISMATCH';end if;
 definition:=replace(definition,$old1$  union all select data_date,country,platform,platform_key,total,success,rejected,auto_count,manual_count,avg_seconds,source_updated_at,updated_at,
   duration_sample_count,duration_total_seconds,'source_submitted_to_handled'::text from newar_days$old1$,$new1$  union all select n.data_date,n.country,n.platform,n.platform_key,n.total,n.success,n.rejected,n.auto_count,n.manual_count,
   case when h.duration_sample_count is not null then h.avg_seconds else n.avg_seconds end,n.source_updated_at,n.updated_at,
   case when h.duration_sample_count is not null then h.duration_sample_count else n.duration_sample_count end,
   case when h.duration_sample_count is not null then h.duration_total_seconds else n.duration_total_seconds end,
   case when h.duration_sample_count is not null then 'source_reported_processing' else 'source_submitted_to_handled' end::text
  from newar_days n left join historical_newar_duration h on h.data_date=n.data_date and h.country=n.country and h.platform_key=n.platform_key
   and n.avg_seconds is null and coalesce(n.duration_sample_count,0)=0$new1$);
 if (length(definition)-length(replace(definition,$old2$    v_yash_item:=v_yash_item||v_yash_meta;
   end if;
   v_yash_rows:=v_yash_rows||jsonb_build_array(v_yash_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_yash_rows);
  if v_view='auto' then$old2$,'')))/length($old2$    v_yash_item:=v_yash_item||v_yash_meta;
   end if;
   v_yash_rows:=v_yash_rows||jsonb_build_array(v_yash_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_yash_rows);
  if v_view='auto' then$old2$)<>1 then raise exception 'WITHDRAW_HISTORICAL_DURATION_ANCHOR_MISMATCH';end if;
 definition:=replace(definition,$old2$    v_yash_item:=v_yash_item||v_yash_meta;
   end if;
   v_yash_rows:=v_yash_rows||jsonb_build_array(v_yash_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_yash_rows);
  if v_view='auto' then$old2$,$new2$    v_yash_item:=v_yash_item||v_yash_meta;
    if v_view='auto' and v_yash_item#>>'{previous,durationBasis}'='source_reported_processing' then
     v_yash_item:=jsonb_set(v_yash_item,'{previous}',(v_yash_item->'previous')||
      jsonb_build_object('durationSource','historical_source_report','durationCompletenessVerified',false));
    end if;
   end if;
   v_yash_rows:=v_yash_rows||jsonb_build_array(v_yash_item);
  end loop;
  v_result:=jsonb_set(v_result,'{rows}',v_yash_rows);
  if v_view='auto' then$new2$);
 execute definition;
 select md5(q.prosrc) hash,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if p.hash<>'5dfb74e25b5702bd6dc9212c2be9f1c3' or p.metadata is distinct from before_meta then raise exception 'WITHDRAW_HISTORICAL_DURATION_POSTCONDITION';end if;
end;
$patch$;
commit;
