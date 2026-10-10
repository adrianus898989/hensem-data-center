-- Bound the day-series cardinality and aggregate coverage/operator facts once.
-- Preserve raw-field parsing, source selection, completeness and all output semantics.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $patch$
declare p record;d text;before_meta jsonb;
 old_part text:=$old$ ), days as materialized (
  select s.*,d::date local_date,d::timestamp at time zone s.timezone day_start,(d::date+1)::timestamp at time zone s.timezone day_end,
   (select range_agg(tstzrange(c.effective_start_at,c.end_at,'[)')) from private.newar_detail_coverage_runs c
    where c.platform=s.source_name and c.dataset='withdraw' and c.invalidated_at is null and c.observed_at<=statement_timestamp()
     and c.effective_start_at<(d::date+1)::timestamp at time zone s.timezone and c.end_at>d::timestamp at time zone s.timezone) ranges,
   (select max(c.observed_at) from private.newar_detail_coverage_runs c where c.platform=s.source_name and c.dataset='withdraw'
    and c.invalidated_at is null and c.observed_at<=statement_timestamp() and c.effective_start_at<(d::date+1)::timestamp at time zone s.timezone
    and c.end_at>d::timestamp at time zone s.timezone) coverage_seen
  from sites s cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
$old$;
 new_part text:=$new$ ), days as materialized (
  select s.*,(p_start+g.day_offset)::date local_date,
   (p_start+g.day_offset)::timestamp at time zone s.timezone day_start,
   (p_start+g.day_offset+1)::timestamp at time zone s.timezone day_end,c.ranges,c.coverage_seen
  from sites s cross join generate_series(0,p_end-p_start) g(day_offset)
  cross join lateral (
   select range_agg(tstzrange(c.effective_start_at,c.end_at,'[)')) ranges,max(c.observed_at) coverage_seen
   from private.newar_detail_coverage_runs c
   where c.platform=s.source_name and c.dataset='withdraw' and c.invalidated_at is null
    and c.observed_at<=statement_timestamp()
    and c.effective_start_at<(p_start+g.day_offset+1)::timestamp at time zone s.timezone
    and c.end_at>(p_start+g.day_offset)::timestamp at time zone s.timezone
  ) c$new$;
begin
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q
  where q.oid='private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
  or p.owner_name<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres}'
  then raise exception 'newar_withdraw_plan_metadata_drift';end if;
 if md5(p.prosrc)='47fe6d24232211930ea6c0aae3e2ea11' then return;end if;
 if md5(p.prosrc)<>'6f1f1f97205482e9ec637c27693064dc' then raise exception 'newar_withdraw_plan_definition_drift';end if;
 select pg_get_functiondef(q.oid),to_jsonb(q)-'prosrc' into d,before_meta from pg_proc q
  where q.oid=p.oid;
 if (length(d)-length(replace(d,old_part,'')))/length(old_part)<>1
  or (length(d)-length(replace(d,' ), operators as (','')))/length(' ), operators as (')<>1
  then raise exception 'newar_withdraw_plan_anchor_drift';end if;
 execute replace(replace(d,old_part,new_part),' ), operators as (',' ), operators as materialized (');
 if (select md5(q.prosrc) from pg_proc q where q.oid=p.oid)<>'47fe6d24232211930ea6c0aae3e2ea11'
  or (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=p.oid) is distinct from before_meta
  then raise exception 'newar_withdraw_plan_postcondition_failed';end if;
end;$patch$;
commit;
