-- Bounded repeated reads are consolidated; scope and business judgments stay unchanged.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $fix$
declare p pg_proc%rowtype;original_metadata jsonb;d text;
begin
 select * into strict p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_sync_health_rows(timestamp with time zone)');
 if not (pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}' and p.prosecdef and p.provolatile='s' and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.proconfig=ARRAY['search_path=""','jit=off']::text[]) then raise exception 'dashboard_lg_sync_health_latest_batch_metadata_drift';end if;
 if md5(p.prosrc) not in ('cb9773a8b4e1a5bc4dc93bb92e6586cc','4f7b6f978b78830054406d97aee8aa24') then raise exception 'dashboard_lg_sync_health_latest_batch_baseline_drift';end if;
 original_metadata:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)='cb9773a8b4e1a5bc4dc93bb92e6586cc' then
  d:=pg_get_functiondef(p.oid);
  if (length(d)-length(replace(d,$old0$v_run record;v_first date;$old0$,'')))/length($old0$v_run record;v_first date;$old0$)<>1 then raise exception 'dashboard_lg_sync_health_latest_batch_marker_drift';end if;
  d:=replace(d,$old0$v_run record;v_first date;$old0$,$new0$v_run record;v_lg_runs jsonb;v_first date;$new0$);
  if (length(d)-length(replace(d,$old1$   for v_day in select v_today-i from generate_series(1,7)i where v_first is null or v_today-i>=v_first loop$old1$,'')))/length($old1$   for v_day in select v_today-i from generate_series(1,7)i where v_first is null or v_today-i>=v_first loop$old1$)<>1 then raise exception 'dashboard_lg_sync_health_latest_batch_marker_drift';end if;
  d:=replace(d,$old1$   for v_day in select v_today-i from generate_series(1,7)i where v_first is null or v_today-i>=v_first loop$old1$,$new1$   v_lg_runs:=null;
   if dataset='lg_orders' or (dataset='orders' and source_system='lg') then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_lg_runs from (
     select distinct on(t.stat_date) t.stat_date,t.status,t.sync_mode,t.expected_count,t.fetched_count,t.published_at,
      count(*) over(partition by t.stat_date,t.observed_at) latest_ties
     from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind
      and t.stat_date>=v_today-7 and t.stat_date<v_today and (v_first is null or t.stat_date>=v_first)
     order by t.stat_date,t.observed_at desc
    )r;
   end if;
   for v_day in select v_today-i from generate_series(1,7)i where v_first is null or v_today-i>=v_first loop$new1$);
  if (length(d)-length(replace(d,$old2$     select t.status,t.sync_mode,t.expected_count,t.fetched_count,t.published_at into v_run from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.stat_date=v_day order by t.observed_at desc limit 1;$old2$,'')))/length($old2$     select t.status,t.sync_mode,t.expected_count,t.fetched_count,t.published_at into v_run from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.stat_date=v_day order by t.observed_at desc limit 1;$old2$)<>1 then raise exception 'dashboard_lg_sync_health_latest_batch_marker_drift';end if;
  d:=replace(d,$old2$     select t.status,t.sync_mode,t.expected_count,t.fetched_count,t.published_at into v_run from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.stat_date=v_day order by t.observed_at desc limit 1;$old2$,$new2$     select t.status,t.sync_mode,t.expected_count,t.fetched_count,t.published_at,t.latest_ties into v_run
      from jsonb_to_recordset(coalesce(v_lg_runs,'[]'::jsonb)) t(stat_date date,status text,sync_mode text,expected_count bigint,fetched_count bigint,published_at timestamptz,latest_ties bigint)
      where t.stat_date=v_day;
     -- Preserve the original undefined tie choice with its exact daily query.
     if found and v_run.latest_ties>1 then
      select t.status,t.sync_mode,t.expected_count,t.fetched_count,t.published_at into v_run from public.lg_sync_runs t where t.country_code=v_raw_country and t.platform=v_raw_platform and t.order_kind=v_kind and t.stat_date=v_day order by t.observed_at desc limit 1;
     end if;$new2$);
  execute d;
 end if;
 select * into strict p from pg_proc where oid=p.oid;
 if to_jsonb(p)-'prosrc' is distinct from original_metadata or md5(p.prosrc)<>'4f7b6f978b78830054406d97aee8aa24' then raise exception 'dashboard_lg_sync_health_latest_batch_postcheck_failed';end if;
end $fix$;
commit;
