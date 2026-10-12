-- Replace broad source SHARE maintenance with a nonqueued global maintenance barrier.
-- Historical source writers take compatible SHARED advisory locks before atomic invalidation.
-- No data scan, receipt publication or scope change occurs during installation.
begin;
set local lock_timeout='2s';
do $barrier_upgrade$
declare p record;e record;version_after boolean;before_meta jsonb;definition text;
begin
 select md5(prosrc)='a6f3c885ea14511edb6fcf48ee32113c' into version_after from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure;
 for e in select * from(values ('private.invalidate_ar_historical_duration_cache()','19242ee751f4827f31cda6142f0876df','d9542829c2bb82345f27d5b00080d7c0',true,'v','trigger'),('private.refresh_ar_historical_duration(text,date)','c1ca787546f804af858c5316305b7f70','bc6b303925ab3eda045c3f3725220c89',false,'v','jsonb'),('private.refresh_ar_historical_duration_hour(text,date,integer)','e2ef925cccf651717fc387264ee7aac0','d8fc73594da699c74c13afddd8d9ed70',false,'v','jsonb'),('private.finalize_ar_historical_duration_day(text,date)','bc79b2a57df0df1bd80258a821d51755','17811807bf452cd1675d7ce54487c145',false,'v','jsonb'),('private.ar_historical_duration_generation()','0f46df284b4ad2feb4ffb0f6a0393d10','a6f3c885ea14511edb6fcf48ee32113c',false,'s','text'))v(sig,before_hash,after_hash,definer,volatility,result_type) loop
  select q.*,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid=to_regprocedure(e.sig);
  if not found or md5(p.prosrc)<>(case when version_after then e.after_hash else e.before_hash end)
   or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef is distinct from e.definer or p.provolatile::text<>e.volatility
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
   or p.proretset or pg_get_function_result(p.oid)<>e.result_type then raise exception 'AR_DURATION_BARRIER_BASELINE_DRIFT';end if;
 end loop;
 if private.ar_historical_duration_generation() is null then raise exception 'AR_DURATION_BARRIER_GENERATION_INVALID';end if;
 if version_after then return;end if;
 select to_jsonb(q)-'prosrc' metadata,pg_get_functiondef(q.oid) definition into p from pg_proc q where q.oid='private.invalidate_ar_historical_duration_cache()'::regprocedure;
 before_meta:=p.metadata;definition:=p.definition;
 if (length(definition)-length(replace(definition,$old0$
begin
 if TG_RELID<>'public.ar_collected_orders'::regclass or TG_WHEN<>'AFTER' then raise exception 'ar_historical_duration_trigger_context';end if;
 if TG_OP='TRUNCATE' then
  if TG_LEVEL<>'STATEMENT' then raise exception 'ar_historical_duration_trigger_context';end if;
  delete from private.ar_historical_duration_cache;delete from private.ar_historical_duration_hour_parts;return null;
 end if;
 if TG_LEVEL<>'ROW' then raise exception 'ar_historical_duration_trigger_context';end if;
 -- Capture-only, status and operator updates cannot change this time-only pool.
 if TG_OP='UPDATE' and row(OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.applied_at,OLD.completed_at)
  is not distinct from row(NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.applied_at,NEW.completed_at) then return null;end if;
 if TG_OP in('UPDATE','DELETE') and OLD.source_system='AR' and OLD.country_code='IN' and OLD.order_kind='withdraw'
  and isfinite(OLD.applied_at) and OLD.applied_at<timestamp '2026-10-10' then
  delete from private.ar_historical_duration_cache c where c.country_code=OLD.country_code and c.platform=OLD.platform and c.data_date=OLD.applied_at::date;
  delete from private.ar_historical_duration_hour_parts c where c.country_code=OLD.country_code and c.platform=OLD.platform and c.data_date=OLD.applied_at::date;
 end if;
 if TG_OP in('UPDATE','INSERT') and NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw'
  and isfinite(NEW.applied_at) and NEW.applied_at<timestamp '2026-10-10' then
  delete from private.ar_historical_duration_cache c where c.country_code=NEW.country_code and c.platform=NEW.platform and c.data_date=NEW.applied_at::date;
  delete from private.ar_historical_duration_hour_parts c where c.country_code=NEW.country_code and c.platform=NEW.platform and c.data_date=NEW.applied_at::date;
 end if;
 return null;
end;
$old0$,'')))/length($old0$
begin
 if TG_RELID<>'public.ar_collected_orders'::regclass or TG_WHEN<>'AFTER' then raise exception 'ar_historical_duration_trigger_context';end if;
 if TG_OP='TRUNCATE' then
  if TG_LEVEL<>'STATEMENT' then raise exception 'ar_historical_duration_trigger_context';end if;
  delete from private.ar_historical_duration_cache;delete from private.ar_historical_duration_hour_parts;return null;
 end if;
 if TG_LEVEL<>'ROW' then raise exception 'ar_historical_duration_trigger_context';end if;
 -- Capture-only, status and operator updates cannot change this time-only pool.
 if TG_OP='UPDATE' and row(OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.applied_at,OLD.completed_at)
  is not distinct from row(NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.applied_at,NEW.completed_at) then return null;end if;
 if TG_OP in('UPDATE','DELETE') and OLD.source_system='AR' and OLD.country_code='IN' and OLD.order_kind='withdraw'
  and isfinite(OLD.applied_at) and OLD.applied_at<timestamp '2026-10-10' then
  delete from private.ar_historical_duration_cache c where c.country_code=OLD.country_code and c.platform=OLD.platform and c.data_date=OLD.applied_at::date;
  delete from private.ar_historical_duration_hour_parts c where c.country_code=OLD.country_code and c.platform=OLD.platform and c.data_date=OLD.applied_at::date;
 end if;
 if TG_OP in('UPDATE','INSERT') and NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw'
  and isfinite(NEW.applied_at) and NEW.applied_at<timestamp '2026-10-10' then
  delete from private.ar_historical_duration_cache c where c.country_code=NEW.country_code and c.platform=NEW.platform and c.data_date=NEW.applied_at::date;
  delete from private.ar_historical_duration_hour_parts c where c.country_code=NEW.country_code and c.platform=NEW.platform and c.data_date=NEW.applied_at::date;
 end if;
 return null;
end;
$old0$)<>1 then raise exception 'AR_DURATION_BARRIER_ANCHOR_DRIFT';end if;
 definition:=replace(definition,$old0$
begin
 if TG_RELID<>'public.ar_collected_orders'::regclass or TG_WHEN<>'AFTER' then raise exception 'ar_historical_duration_trigger_context';end if;
 if TG_OP='TRUNCATE' then
  if TG_LEVEL<>'STATEMENT' then raise exception 'ar_historical_duration_trigger_context';end if;
  delete from private.ar_historical_duration_cache;delete from private.ar_historical_duration_hour_parts;return null;
 end if;
 if TG_LEVEL<>'ROW' then raise exception 'ar_historical_duration_trigger_context';end if;
 -- Capture-only, status and operator updates cannot change this time-only pool.
 if TG_OP='UPDATE' and row(OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.applied_at,OLD.completed_at)
  is not distinct from row(NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.applied_at,NEW.completed_at) then return null;end if;
 if TG_OP in('UPDATE','DELETE') and OLD.source_system='AR' and OLD.country_code='IN' and OLD.order_kind='withdraw'
  and isfinite(OLD.applied_at) and OLD.applied_at<timestamp '2026-10-10' then
  delete from private.ar_historical_duration_cache c where c.country_code=OLD.country_code and c.platform=OLD.platform and c.data_date=OLD.applied_at::date;
  delete from private.ar_historical_duration_hour_parts c where c.country_code=OLD.country_code and c.platform=OLD.platform and c.data_date=OLD.applied_at::date;
 end if;
 if TG_OP in('UPDATE','INSERT') and NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw'
  and isfinite(NEW.applied_at) and NEW.applied_at<timestamp '2026-10-10' then
  delete from private.ar_historical_duration_cache c where c.country_code=NEW.country_code and c.platform=NEW.platform and c.data_date=NEW.applied_at::date;
  delete from private.ar_historical_duration_hour_parts c where c.country_code=NEW.country_code and c.platform=NEW.platform and c.data_date=NEW.applied_at::date;
 end if;
 return null;
end;
$old0$,$new0$
begin
 if TG_RELID<>'public.ar_collected_orders'::regclass or TG_WHEN<>'AFTER' then raise exception 'ar_historical_duration_trigger_context';end if;
 if TG_OP='TRUNCATE' then
  if TG_LEVEL<>'STATEMENT' then raise exception 'ar_historical_duration_trigger_context';end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('ar-historical-duration:source-barrier:v1',0));
  delete from private.ar_historical_duration_cache;delete from private.ar_historical_duration_hour_parts;return null;
 end if;
 if TG_LEVEL<>'ROW' then raise exception 'ar_historical_duration_trigger_context';end if;
 -- Capture-only, status and operator updates cannot change this time-only pool.
 if TG_OP='UPDATE' and row(OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.applied_at,OLD.completed_at)
  is not distinct from row(NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.applied_at,NEW.completed_at) then return null;end if;
 -- New dates and metadata-only capture changes never participate in the historical barrier.
 if not ((TG_OP in('UPDATE','DELETE') and OLD.source_system='AR' and OLD.country_code='IN' and OLD.order_kind='withdraw'
    and isfinite(OLD.applied_at) and OLD.applied_at<timestamp '2026-10-10')
   or (TG_OP in('UPDATE','INSERT') and NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw'
    and isfinite(NEW.applied_at) and NEW.applied_at<timestamp '2026-10-10')) then return null;end if;
 -- Writers are mutually compatible. Waiting writers hold no historical cache locks yet.
 perform pg_advisory_xact_lock_shared(hashtextextended('ar-historical-duration:source-barrier:v1',0));
 if TG_OP in('UPDATE','DELETE') and OLD.source_system='AR' and OLD.country_code='IN' and OLD.order_kind='withdraw'
  and isfinite(OLD.applied_at) and OLD.applied_at<timestamp '2026-10-10' then
  delete from private.ar_historical_duration_cache c where c.country_code=OLD.country_code and c.platform=OLD.platform and c.data_date=OLD.applied_at::date;
  delete from private.ar_historical_duration_hour_parts c where c.country_code=OLD.country_code and c.platform=OLD.platform and c.data_date=OLD.applied_at::date;
 end if;
 if TG_OP in('UPDATE','INSERT') and NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw'
  and isfinite(NEW.applied_at) and NEW.applied_at<timestamp '2026-10-10' then
  delete from private.ar_historical_duration_cache c where c.country_code=NEW.country_code and c.platform=NEW.platform and c.data_date=NEW.applied_at::date;
  delete from private.ar_historical_duration_hour_parts c where c.country_code=NEW.country_code and c.platform=NEW.platform and c.data_date=NEW.applied_at::date;
 end if;
 return null;
end;
$new0$);
 execute definition;
 select md5(q.prosrc) hash,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid='private.invalidate_ar_historical_duration_cache()'::regprocedure;
 if p.hash<>'d9542829c2bb82345f27d5b00080d7c0' or p.metadata is distinct from before_meta then raise exception 'AR_DURATION_BARRIER_METADATA_CHANGED';end if;
 select to_jsonb(q)-'prosrc' metadata,pg_get_functiondef(q.oid) definition into p from pg_proc q where q.oid='private.refresh_ar_historical_duration(text,date)'::regprocedure;
 before_meta:=p.metadata;definition:=p.definition;
 if (length(definition)-length(replace(definition,$old1$
declare g text;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' then raise exception 'invalid_ar_historical_duration_partition';end if;
 -- Only explicit maintenance holds this short source-write lock. Never used by a live reader.
 lock table public.ar_collected_orders in share mode nowait;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 select count(*),count(*) filter(where n.seconds>0),coalesce(sum(n.seconds) filter(where n.seconds>0),0)
 into source_count,sample_count,total_seconds
 from (select case when a.completed_at>a.applied_at then trunc(extract(epoch from a.completed_at-a.applied_at)) end seconds
  from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform=p_platform and a.order_kind='withdraw'
   and a.applied_at>=p_day::timestamp and a.applied_at<(p_day+1)::timestamp)n;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_cache(country_code,platform,data_date,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$old1$,'')))/length($old1$
declare g text;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' then raise exception 'invalid_ar_historical_duration_partition';end if;
 -- Only explicit maintenance holds this short source-write lock. Never used by a live reader.
 lock table public.ar_collected_orders in share mode nowait;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 select count(*),count(*) filter(where n.seconds>0),coalesce(sum(n.seconds) filter(where n.seconds>0),0)
 into source_count,sample_count,total_seconds
 from (select case when a.completed_at>a.applied_at then trunc(extract(epoch from a.completed_at-a.applied_at)) end seconds
  from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform=p_platform and a.order_kind='withdraw'
   and a.applied_at>=p_day::timestamp and a.applied_at<(p_day+1)::timestamp)n;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_cache(country_code,platform,data_date,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$old1$)<>1 then raise exception 'AR_DURATION_BARRIER_ANCHOR_DRIFT';end if;
 definition:=replace(definition,$old1$
declare g text;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' then raise exception 'invalid_ar_historical_duration_partition';end if;
 -- Only explicit maintenance holds this short source-write lock. Never used by a live reader.
 lock table public.ar_collected_orders in share mode nowait;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 select count(*),count(*) filter(where n.seconds>0),coalesce(sum(n.seconds) filter(where n.seconds>0),0)
 into source_count,sample_count,total_seconds
 from (select case when a.completed_at>a.applied_at then trunc(extract(epoch from a.completed_at-a.applied_at)) end seconds
  from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform=p_platform and a.order_kind='withdraw'
   and a.applied_at>=p_day::timestamp and a.applied_at<(p_day+1)::timestamp)n;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_cache(country_code,platform,data_date,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$old1$,$new1$
declare g text;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' then raise exception 'invalid_ar_historical_duration_partition';end if;
 -- Owner maintenance protects source DDL; its advisory barrier serializes historical invalidation.
 -- ACCESS SHARE blocks destructive DDL/TRUNCATE but is compatible with normal source DML and autovacuum.
 lock table public.ar_collected_orders in access share mode nowait;
 -- Never queue an exclusive maintenance barrier behind source writers.
 if not pg_try_advisory_xact_lock(hashtextextended('ar-historical-duration:source-barrier:v1',0)) then
  raise exception using errcode='55P03',message='ar_historical_duration_maintenance_busy';end if;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 select count(*),count(*) filter(where n.seconds>0),coalesce(sum(n.seconds) filter(where n.seconds>0),0)
 into source_count,sample_count,total_seconds
 from (select case when a.completed_at>a.applied_at then trunc(extract(epoch from a.completed_at-a.applied_at)) end seconds
  from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform=p_platform and a.order_kind='withdraw'
   and a.applied_at>=p_day::timestamp and a.applied_at<(p_day+1)::timestamp)n;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_cache(country_code,platform,data_date,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$new1$);
 execute definition;
 select md5(q.prosrc) hash,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid='private.refresh_ar_historical_duration(text,date)'::regprocedure;
 if p.hash<>'bc6b303925ab3eda045c3f3725220c89' or p.metadata is distinct from before_meta then raise exception 'AR_DURATION_BARRIER_METADATA_CHANGED';end if;
 select to_jsonb(q)-'prosrc' metadata,pg_get_functiondef(q.oid) definition into p from pg_proc q where q.oid='private.refresh_ar_historical_duration_hour(text,date,integer)'::regprocedure;
 before_meta:=p.metadata;definition:=p.definition;
 if (length(definition)-length(replace(definition,$old2$
declare g text;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;lo timestamp;hi timestamp;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' or p_hour is null or p_hour not between 0 and 23 then
  raise exception 'invalid_ar_historical_duration_partition';end if;
 lock table public.ar_collected_orders in share mode nowait;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 lo:=p_day::timestamp+make_interval(hours=>p_hour);hi:=lo+interval '1 hour';
 select count(*),count(*) filter(where n.seconds>0),coalesce(sum(n.seconds) filter(where n.seconds>0),0)
 into source_count,sample_count,total_seconds
 from (select case when a.completed_at>a.applied_at then trunc(extract(epoch from a.completed_at-a.applied_at)) end seconds
  from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform=p_platform and a.order_kind='withdraw'
   and a.applied_at>=lo and a.applied_at<hi)n;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_hour_parts(country_code,platform,data_date,native_hour,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,p_hour,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date,native_hour) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'hour',p_hour,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$old2$,'')))/length($old2$
declare g text;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;lo timestamp;hi timestamp;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' or p_hour is null or p_hour not between 0 and 23 then
  raise exception 'invalid_ar_historical_duration_partition';end if;
 lock table public.ar_collected_orders in share mode nowait;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 lo:=p_day::timestamp+make_interval(hours=>p_hour);hi:=lo+interval '1 hour';
 select count(*),count(*) filter(where n.seconds>0),coalesce(sum(n.seconds) filter(where n.seconds>0),0)
 into source_count,sample_count,total_seconds
 from (select case when a.completed_at>a.applied_at then trunc(extract(epoch from a.completed_at-a.applied_at)) end seconds
  from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform=p_platform and a.order_kind='withdraw'
   and a.applied_at>=lo and a.applied_at<hi)n;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_hour_parts(country_code,platform,data_date,native_hour,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,p_hour,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date,native_hour) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'hour',p_hour,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$old2$)<>1 then raise exception 'AR_DURATION_BARRIER_ANCHOR_DRIFT';end if;
 definition:=replace(definition,$old2$
declare g text;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;lo timestamp;hi timestamp;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' or p_hour is null or p_hour not between 0 and 23 then
  raise exception 'invalid_ar_historical_duration_partition';end if;
 lock table public.ar_collected_orders in share mode nowait;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 lo:=p_day::timestamp+make_interval(hours=>p_hour);hi:=lo+interval '1 hour';
 select count(*),count(*) filter(where n.seconds>0),coalesce(sum(n.seconds) filter(where n.seconds>0),0)
 into source_count,sample_count,total_seconds
 from (select case when a.completed_at>a.applied_at then trunc(extract(epoch from a.completed_at-a.applied_at)) end seconds
  from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform=p_platform and a.order_kind='withdraw'
   and a.applied_at>=lo and a.applied_at<hi)n;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_hour_parts(country_code,platform,data_date,native_hour,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,p_hour,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date,native_hour) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'hour',p_hour,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$old2$,$new2$
declare g text;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;lo timestamp;hi timestamp;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' or p_hour is null or p_hour not between 0 and 23 then
  raise exception 'invalid_ar_historical_duration_partition';end if;
 -- ACCESS SHARE blocks destructive DDL/TRUNCATE but is compatible with normal source DML and autovacuum.
 lock table public.ar_collected_orders in access share mode nowait;
 -- Never queue an exclusive maintenance barrier behind source writers.
 if not pg_try_advisory_xact_lock(hashtextextended('ar-historical-duration:source-barrier:v1',0)) then
  raise exception using errcode='55P03',message='ar_historical_duration_maintenance_busy';end if;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 lo:=p_day::timestamp+make_interval(hours=>p_hour);hi:=lo+interval '1 hour';
 select count(*),count(*) filter(where n.seconds>0),coalesce(sum(n.seconds) filter(where n.seconds>0),0)
 into source_count,sample_count,total_seconds
 from (select case when a.completed_at>a.applied_at then trunc(extract(epoch from a.completed_at-a.applied_at)) end seconds
  from public.ar_collected_orders a where a.source_system='AR' and a.country_code='IN' and a.platform=p_platform and a.order_kind='withdraw'
   and a.applied_at>=lo and a.applied_at<hi)n;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_hour_parts(country_code,platform,data_date,native_hour,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,p_hour,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date,native_hour) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'hour',p_hour,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$new2$);
 execute definition;
 select md5(q.prosrc) hash,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid='private.refresh_ar_historical_duration_hour(text,date,integer)'::regprocedure;
 if p.hash<>'d8fc73594da699c74c13afddd8d9ed70' or p.metadata is distinct from before_meta then raise exception 'AR_DURATION_BARRIER_METADATA_CHANGED';end if;
 select to_jsonb(q)-'prosrc' metadata,pg_get_functiondef(q.oid) definition into p from pg_proc q where q.oid='private.finalize_ar_historical_duration_day(text,date)'::regprocedure;
 before_meta:=p.metadata;definition:=p.definition;
 if (length(definition)-length(replace(definition,$old3$
declare g text;part_count integer;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' then raise exception 'invalid_ar_historical_duration_partition';end if;
 -- The same source lock serializes finalization with source writes/atomic whole-day invalidation.
 lock table public.ar_collected_orders in share mode nowait;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 select count(*),sum(c.source_row_count),sum(c.duration_sample_count),sum(c.duration_total_seconds)
 into part_count,source_count,sample_count,total_seconds
 from private.ar_historical_duration_hour_parts c where c.country_code='IN' and c.platform=p_platform and c.data_date=p_day and c.generation=g;
 if part_count<>24 then raise exception 'ar_historical_duration_hours_incomplete';end if;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_cache(country_code,platform,data_date,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'hours',part_count,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$old3$,'')))/length($old3$
declare g text;part_count integer;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' then raise exception 'invalid_ar_historical_duration_partition';end if;
 -- The same source lock serializes finalization with source writes/atomic whole-day invalidation.
 lock table public.ar_collected_orders in share mode nowait;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 select count(*),sum(c.source_row_count),sum(c.duration_sample_count),sum(c.duration_total_seconds)
 into part_count,source_count,sample_count,total_seconds
 from private.ar_historical_duration_hour_parts c where c.country_code='IN' and c.platform=p_platform and c.data_date=p_day and c.generation=g;
 if part_count<>24 then raise exception 'ar_historical_duration_hours_incomplete';end if;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_cache(country_code,platform,data_date,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'hours',part_count,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$old3$)<>1 then raise exception 'AR_DURATION_BARRIER_ANCHOR_DRIFT';end if;
 definition:=replace(definition,$old3$
declare g text;part_count integer;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' then raise exception 'invalid_ar_historical_duration_partition';end if;
 -- The same source lock serializes finalization with source writes/atomic whole-day invalidation.
 lock table public.ar_collected_orders in share mode nowait;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 select count(*),sum(c.source_row_count),sum(c.duration_sample_count),sum(c.duration_total_seconds)
 into part_count,source_count,sample_count,total_seconds
 from private.ar_historical_duration_hour_parts c where c.country_code='IN' and c.platform=p_platform and c.data_date=p_day and c.generation=g;
 if part_count<>24 then raise exception 'ar_historical_duration_hours_incomplete';end if;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_cache(country_code,platform,data_date,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'hours',part_count,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$old3$,$new3$
declare g text;part_count integer;source_count bigint;sample_count bigint;total_seconds numeric;at timestamptz;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed' then raise exception 'ar_historical_duration_maintenance_context';end if;
 if p_platform is null or p_platform<>btrim(p_platform) or length(p_platform) not between 1 and 200 or p_platform ~ '[[:cntrl:]]'
  or p_day is null or not isfinite(p_day) or p_day>=date '2026-10-10' then raise exception 'invalid_ar_historical_duration_partition';end if;
 -- The advisory barrier serializes finalization with whole-day invalidation; ACCESS SHARE only protects source DDL.
 -- ACCESS SHARE blocks destructive DDL/TRUNCATE but is compatible with normal source DML and autovacuum.
 lock table public.ar_collected_orders in access share mode nowait;
 -- Never queue an exclusive maintenance barrier behind source writers.
 if not pg_try_advisory_xact_lock(hashtextextended('ar-historical-duration:source-barrier:v1',0)) then
  raise exception using errcode='55P03',message='ar_historical_duration_maintenance_busy';end if;
 g:=private.ar_historical_duration_generation();if g is null then raise exception 'ar_historical_duration_generation_invalid';end if;
 select count(*),sum(c.source_row_count),sum(c.duration_sample_count),sum(c.duration_total_seconds)
 into part_count,source_count,sample_count,total_seconds
 from private.ar_historical_duration_hour_parts c where c.country_code='IN' and c.platform=p_platform and c.data_date=p_day and c.generation=g;
 if part_count<>24 then raise exception 'ar_historical_duration_hours_incomplete';end if;
 at:=clock_timestamp();
 insert into private.ar_historical_duration_cache(country_code,platform,data_date,source_row_count,duration_sample_count,duration_total_seconds,generation,generated_at)
 values('IN',p_platform,p_day,source_count,sample_count,total_seconds,g,at)
 on conflict(country_code,platform,data_date) do update set source_row_count=excluded.source_row_count,duration_sample_count=excluded.duration_sample_count,
  duration_total_seconds=excluded.duration_total_seconds,generation=excluded.generation,generated_at=excluded.generated_at;
 return jsonb_build_object('platform',p_platform,'date',p_day,'hours',part_count,'sourceCount',source_count,'durationSampleCount',sample_count,'durationTotalSeconds',total_seconds,
  'avgSeconds',total_seconds/nullif(sample_count,0),'generation',g,'generatedAt',at);
end;
$new3$);
 execute definition;
 select md5(q.prosrc) hash,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid='private.finalize_ar_historical_duration_day(text,date)'::regprocedure;
 if p.hash<>'17811807bf452cd1675d7ce54487c145' or p.metadata is distinct from before_meta then raise exception 'AR_DURATION_BARRIER_METADATA_CHANGED';end if;
 select to_jsonb(q)-'prosrc' metadata,pg_get_functiondef(q.oid) definition into p from pg_proc q where q.oid='private.ar_historical_duration_generation()'::regprocedure;
 before_meta:=p.metadata;definition:=p.definition;
 if (length(definition)-length(replace(definition,$old4$
 select case when count(*)=4 and bool_and(t.tgenabled='O' and t.tgfoid='private.invalidate_ar_historical_duration_cache()'::regprocedure)
  and bool_and(md5(pg_get_triggerdef(t.oid))=case t.tgname when 'ar_historical_duration_insert' then '7759e8593839433f70fa4db5cb685e56' when 'ar_historical_duration_delete' then '19cbae393493bbb34acc0fbc002ed9b3' when 'ar_historical_duration_update' then 'e7d54f457601aa92e955fc3b90ba5e8a' when 'ar_historical_duration_truncate' then 'e7fc978a9f501ca4eb10553c23cefad0' end)
  and bool_and(p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}' and md5(p.prosrc)='19242ee751f4827f31cda6142f0876df')
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration(text,date)'::regprocedure
   and md5(z.prosrc)='c1ca787546f804af858c5316305b7f70' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure
   and md5(z.prosrc)='3e7e5666a6e7b869a02513221597da1a' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='s'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_cache'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_cache_write_guard' then 31 when 'ar_historical_duration_cache_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_cache'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.guard_ar_historical_duration_cache_write()'::regprocedure
   and md5(z.prosrc)='04489bed3f818d1c75e8d0a0c73eef64' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_hour_parts'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_hour_write_guard' then 31 when 'ar_historical_duration_hour_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_hour_parts'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration_hour(text,date,integer)'::regprocedure
   and md5(z.prosrc)='e2ef925cccf651717fc387264ee7aac0' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.finalize_ar_historical_duration_day(text,date)'::regprocedure
   and md5(z.prosrc)='bc79b2a57df0df1bd80258a821d51755' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  then md5('ar_native_historical_duration_v2:e2ef925cccf651717fc387264ee7aac0:bc79b2a57df0df1bd80258a821d51755:19242ee751f4827f31cda6142f0876df:c1ca787546f804af858c5316305b7f70:04489bed3f818d1c75e8d0a0c73eef64:3e7e5666a6e7b869a02513221597da1a:'||(select string_agg(x.oid::text||':'||x.xmin::text||':'||pg_get_triggerdef(x.oid),',' order by x.tgname)
   from pg_trigger x where x.tgrelid=any(array['private.ar_historical_duration_cache'::regclass,'private.ar_historical_duration_hour_parts'::regclass]) and not x.tgisinternal)||':'||string_agg(t.oid::text||':'||t.xmin::text||':'||pg_get_triggerdef(t.oid),',' order by t.tgname)) end
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid='public.ar_collected_orders'::regclass and not t.tgisinternal
  and t.tgname in('ar_historical_duration_insert','ar_historical_duration_update','ar_historical_duration_delete','ar_historical_duration_truncate');
$old4$,'')))/length($old4$
 select case when count(*)=4 and bool_and(t.tgenabled='O' and t.tgfoid='private.invalidate_ar_historical_duration_cache()'::regprocedure)
  and bool_and(md5(pg_get_triggerdef(t.oid))=case t.tgname when 'ar_historical_duration_insert' then '7759e8593839433f70fa4db5cb685e56' when 'ar_historical_duration_delete' then '19cbae393493bbb34acc0fbc002ed9b3' when 'ar_historical_duration_update' then 'e7d54f457601aa92e955fc3b90ba5e8a' when 'ar_historical_duration_truncate' then 'e7fc978a9f501ca4eb10553c23cefad0' end)
  and bool_and(p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}' and md5(p.prosrc)='19242ee751f4827f31cda6142f0876df')
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration(text,date)'::regprocedure
   and md5(z.prosrc)='c1ca787546f804af858c5316305b7f70' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure
   and md5(z.prosrc)='3e7e5666a6e7b869a02513221597da1a' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='s'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_cache'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_cache_write_guard' then 31 when 'ar_historical_duration_cache_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_cache'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.guard_ar_historical_duration_cache_write()'::regprocedure
   and md5(z.prosrc)='04489bed3f818d1c75e8d0a0c73eef64' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_hour_parts'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_hour_write_guard' then 31 when 'ar_historical_duration_hour_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_hour_parts'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration_hour(text,date,integer)'::regprocedure
   and md5(z.prosrc)='e2ef925cccf651717fc387264ee7aac0' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.finalize_ar_historical_duration_day(text,date)'::regprocedure
   and md5(z.prosrc)='bc79b2a57df0df1bd80258a821d51755' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  then md5('ar_native_historical_duration_v2:e2ef925cccf651717fc387264ee7aac0:bc79b2a57df0df1bd80258a821d51755:19242ee751f4827f31cda6142f0876df:c1ca787546f804af858c5316305b7f70:04489bed3f818d1c75e8d0a0c73eef64:3e7e5666a6e7b869a02513221597da1a:'||(select string_agg(x.oid::text||':'||x.xmin::text||':'||pg_get_triggerdef(x.oid),',' order by x.tgname)
   from pg_trigger x where x.tgrelid=any(array['private.ar_historical_duration_cache'::regclass,'private.ar_historical_duration_hour_parts'::regclass]) and not x.tgisinternal)||':'||string_agg(t.oid::text||':'||t.xmin::text||':'||pg_get_triggerdef(t.oid),',' order by t.tgname)) end
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid='public.ar_collected_orders'::regclass and not t.tgisinternal
  and t.tgname in('ar_historical_duration_insert','ar_historical_duration_update','ar_historical_duration_delete','ar_historical_duration_truncate');
$old4$)<>1 then raise exception 'AR_DURATION_BARRIER_ANCHOR_DRIFT';end if;
 definition:=replace(definition,$old4$
 select case when count(*)=4 and bool_and(t.tgenabled='O' and t.tgfoid='private.invalidate_ar_historical_duration_cache()'::regprocedure)
  and bool_and(md5(pg_get_triggerdef(t.oid))=case t.tgname when 'ar_historical_duration_insert' then '7759e8593839433f70fa4db5cb685e56' when 'ar_historical_duration_delete' then '19cbae393493bbb34acc0fbc002ed9b3' when 'ar_historical_duration_update' then 'e7d54f457601aa92e955fc3b90ba5e8a' when 'ar_historical_duration_truncate' then 'e7fc978a9f501ca4eb10553c23cefad0' end)
  and bool_and(p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}' and md5(p.prosrc)='19242ee751f4827f31cda6142f0876df')
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration(text,date)'::regprocedure
   and md5(z.prosrc)='c1ca787546f804af858c5316305b7f70' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure
   and md5(z.prosrc)='3e7e5666a6e7b869a02513221597da1a' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='s'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_cache'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_cache_write_guard' then 31 when 'ar_historical_duration_cache_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_cache'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.guard_ar_historical_duration_cache_write()'::regprocedure
   and md5(z.prosrc)='04489bed3f818d1c75e8d0a0c73eef64' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_hour_parts'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_hour_write_guard' then 31 when 'ar_historical_duration_hour_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_hour_parts'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration_hour(text,date,integer)'::regprocedure
   and md5(z.prosrc)='e2ef925cccf651717fc387264ee7aac0' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.finalize_ar_historical_duration_day(text,date)'::regprocedure
   and md5(z.prosrc)='bc79b2a57df0df1bd80258a821d51755' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  then md5('ar_native_historical_duration_v2:e2ef925cccf651717fc387264ee7aac0:bc79b2a57df0df1bd80258a821d51755:19242ee751f4827f31cda6142f0876df:c1ca787546f804af858c5316305b7f70:04489bed3f818d1c75e8d0a0c73eef64:3e7e5666a6e7b869a02513221597da1a:'||(select string_agg(x.oid::text||':'||x.xmin::text||':'||pg_get_triggerdef(x.oid),',' order by x.tgname)
   from pg_trigger x where x.tgrelid=any(array['private.ar_historical_duration_cache'::regclass,'private.ar_historical_duration_hour_parts'::regclass]) and not x.tgisinternal)||':'||string_agg(t.oid::text||':'||t.xmin::text||':'||pg_get_triggerdef(t.oid),',' order by t.tgname)) end
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid='public.ar_collected_orders'::regclass and not t.tgisinternal
  and t.tgname in('ar_historical_duration_insert','ar_historical_duration_update','ar_historical_duration_delete','ar_historical_duration_truncate');
$old4$,$new4$
 select case when count(*)=4 and bool_and(t.tgenabled='O' and t.tgfoid='private.invalidate_ar_historical_duration_cache()'::regprocedure)
  and bool_and(md5(pg_get_triggerdef(t.oid))=case t.tgname when 'ar_historical_duration_insert' then '7759e8593839433f70fa4db5cb685e56' when 'ar_historical_duration_delete' then '19cbae393493bbb34acc0fbc002ed9b3' when 'ar_historical_duration_update' then 'e7d54f457601aa92e955fc3b90ba5e8a' when 'ar_historical_duration_truncate' then 'e7fc978a9f501ca4eb10553c23cefad0' end)
  and bool_and(p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}' and md5(p.prosrc)='d9542829c2bb82345f27d5b00080d7c0')
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration(text,date)'::regprocedure
   and md5(z.prosrc)='bc6b303925ab3eda045c3f3725220c89' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure
   and md5(z.prosrc)='3e7e5666a6e7b869a02513221597da1a' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='s'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_cache'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_cache_write_guard' then 31 when 'ar_historical_duration_cache_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_cache'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.guard_ar_historical_duration_cache_write()'::regprocedure
   and md5(z.prosrc)='04489bed3f818d1c75e8d0a0c73eef64' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_class c where c.oid='private.ar_historical_duration_hour_parts'::regclass
   and c.relkind='r' and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity and not c.relforcerowsecurity
   and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)
   and not exists(select 1 from pg_policy x where x.polrelid=c.oid))
  and (select count(*)=2 and bool_and(x.tgenabled='O' and x.tgfoid='private.guard_ar_historical_duration_cache_write()'::regprocedure and x.tgnargs=0
   and x.tgqual is null and x.tgtype=case x.tgname when 'ar_historical_duration_hour_write_guard' then 31 when 'ar_historical_duration_hour_truncate_guard' then 34 end)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_hour_parts'::regclass and not x.tgisinternal)
  and exists(select 1 from pg_proc z where z.oid='private.refresh_ar_historical_duration_hour(text,date,integer)'::regprocedure
   and md5(z.prosrc)='d8fc73594da699c74c13afddd8d9ed70' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  and exists(select 1 from pg_proc z where z.oid='private.finalize_ar_historical_duration_day(text,date)'::regprocedure
   and md5(z.prosrc)='17811807bf452cd1675d7ce54487c145' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  then md5('ar_native_historical_duration_v2:d8fc73594da699c74c13afddd8d9ed70:17811807bf452cd1675d7ce54487c145:d9542829c2bb82345f27d5b00080d7c0:bc6b303925ab3eda045c3f3725220c89:04489bed3f818d1c75e8d0a0c73eef64:3e7e5666a6e7b869a02513221597da1a:'||(select string_agg(x.oid::text||':'||x.xmin::text||':'||pg_get_triggerdef(x.oid),',' order by x.tgname)
   from pg_trigger x where x.tgrelid=any(array['private.ar_historical_duration_cache'::regclass,'private.ar_historical_duration_hour_parts'::regclass]) and not x.tgisinternal)||':'||string_agg(t.oid::text||':'||t.xmin::text||':'||pg_get_triggerdef(t.oid),',' order by t.tgname)) end
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid='public.ar_collected_orders'::regclass and not t.tgisinternal
  and t.tgname in('ar_historical_duration_insert','ar_historical_duration_update','ar_historical_duration_delete','ar_historical_duration_truncate');
$new4$);
 execute definition;
 select md5(q.prosrc) hash,to_jsonb(q)-'prosrc' metadata into p from pg_proc q where q.oid='private.ar_historical_duration_generation()'::regprocedure;
 if p.hash<>'a6f3c885ea14511edb6fcf48ee32113c' or p.metadata is distinct from before_meta then raise exception 'AR_DURATION_BARRIER_METADATA_CHANGED';end if;
 if private.ar_historical_duration_generation() is null then raise exception 'AR_DURATION_BARRIER_POSTCHECK';end if;
end;$barrier_upgrade$;
commit;
