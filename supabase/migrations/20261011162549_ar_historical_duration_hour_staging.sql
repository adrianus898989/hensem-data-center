-- Hour-sized owner maintenance for historical native duration; no automatic historical scan or cache publication.
-- Existing whole-day maintenance remains available for small partitions. Source business changes invalidate the WHOLE native day.
begin;
set local lock_timeout='2s';
do $upgrade_guard$
declare p record;f record;upgraded boolean;
begin
 select md5(prosrc)='0f46df284b4ad2feb4ffb0f6a0393d10' into upgraded from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure;
 if not coalesce(upgraded,false) and (to_regclass('private.ar_historical_duration_hour_parts') is not null
  or to_regprocedure('private.refresh_ar_historical_duration_hour(text,date,integer)') is not null
  or to_regprocedure('private.finalize_ar_historical_duration_day(text,date)') is not null) then raise exception 'AR_DURATION_HOUR_UNEXPECTED_OBJECT';end if;
 for f in select * from(values ('private.invalidate_ar_historical_duration_cache()','449b1519da934e2da7034f698d42fb9a','19242ee751f4827f31cda6142f0876df',true,'v'),('private.guard_ar_historical_duration_cache_write()','8ec77a15af7089409cc9368db595a5e7','04489bed3f818d1c75e8d0a0c73eef64',false,'v'),('private.ar_historical_duration_generation()','059d6bd465ec451839f0db41aad2ea0e','0f46df284b4ad2feb4ffb0f6a0393d10',false,'s'),('private.refresh_ar_historical_duration(text,date)','c1ca787546f804af858c5316305b7f70','c1ca787546f804af858c5316305b7f70',false,'v'),('private.dashboard_admin_ar_historical_duration_days(jsonb,jsonb,date,date)','9a7bba61d4cdb9b185c7fb7a07c8dc03','9a7bba61d4cdb9b185c7fb7a07c8dc03',false,'s')) v(sig,old_hash,new_hash,definer,volatility) loop
  select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid=to_regprocedure(f.sig);
  if not found or md5(p.prosrc)<>(case when upgraded then f.new_hash else f.old_hash end)
   or p.owner_name<>'postgres' or p.prosecdef is distinct from f.definer or p.provolatile::text<>f.volatility
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}' then
   raise exception 'AR_DURATION_HOUR_BASELINE_DRIFT';end if;
 end loop;
 if private.ar_historical_duration_generation() is null then raise exception 'AR_DURATION_HOUR_GENERATION_INVALID';end if;
end;$upgrade_guard$;
create table if not exists private.ar_historical_duration_hour_parts(
 country_code text not null,platform text not null,data_date date not null,native_hour integer not null,
 source_row_count bigint not null,duration_sample_count bigint not null,duration_total_seconds numeric not null,generation text not null,generated_at timestamptz not null,
 primary key(country_code,platform,data_date,native_hour),
 constraint ar_history_duration_hour_scope check(country_code='IN' and isfinite(data_date) and data_date<date '2026-10-10' and length(platform) between 1 and 200 and native_hour between 0 and 23),
 constraint ar_history_duration_hour_counts check(duration_sample_count>=0 and source_row_count>=duration_sample_count and duration_total_seconds>=0),
 constraint ar_history_duration_hour_generation check(generation ~ '^[0-9a-f]{32}$')
);
do $hour_privacy$
declare c record;
begin
 select * into c from pg_class where oid='private.ar_historical_duration_hour_parts'::regclass;
 if pg_get_userbyid(c.relowner)<>'postgres' then raise exception 'AR_DURATION_HOUR_TABLE_DRIFT';end if;
 if not c.relrowsecurity then alter table private.ar_historical_duration_hour_parts enable row level security;end if;
 if c.relacl::text is distinct from '{postgres=arwdDxtm/postgres}' then revoke all on private.ar_historical_duration_hour_parts from public,anon,authenticated,service_role;end if;
end;$hour_privacy$;
create or replace function private.invalidate_ar_historical_duration_cache() returns trigger
language plpgsql security definer set search_path='' AS $function$
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
$function$;
create or replace function private.guard_ar_historical_duration_cache_write() returns trigger
language plpgsql set search_path='' AS $function$
begin
 if current_user<>'postgres' or TG_RELID<>all(array['private.ar_historical_duration_cache'::regclass,'private.ar_historical_duration_hour_parts'::regclass]) or TG_WHEN<>'BEFORE'
  or (TG_OP='TRUNCATE' and TG_LEVEL<>'STATEMENT') or (TG_OP<>'TRUNCATE' and TG_LEVEL<>'ROW') then
  raise exception 'ar_historical_duration_cache_write_denied';end if;
 if TG_OP='DELETE' then return OLD;elsif TG_OP='TRUNCATE' then return null;else return NEW;end if;
end;
$function$;
create or replace function private.refresh_ar_historical_duration_hour(p_platform text,p_day date,p_hour integer) returns jsonb
language plpgsql volatile set search_path='' AS $function$
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
$function$;
create or replace function private.finalize_ar_historical_duration_day(p_platform text,p_day date) returns jsonb
language plpgsql volatile set search_path='' AS $function$
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
$function$;
alter function private.refresh_ar_historical_duration_hour(text,date,integer) owner to postgres;
revoke all on function private.refresh_ar_historical_duration_hour(text,date,integer) from public,anon,authenticated,service_role;
alter function private.finalize_ar_historical_duration_day(text,date) owner to postgres;
revoke all on function private.finalize_ar_historical_duration_day(text,date) from public,anon,authenticated,service_role;
create or replace function private.ar_historical_duration_generation() returns text
language sql stable set search_path='' AS $function$
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
$function$;
do $hour_triggers$
begin
 if not exists(select 1 from pg_trigger where tgrelid='private.ar_historical_duration_hour_parts'::regclass and tgname='ar_historical_duration_hour_write_guard' and not tgisinternal) then
 create trigger ar_historical_duration_hour_write_guard before insert or update or delete on private.ar_historical_duration_hour_parts for each row execute function private.guard_ar_historical_duration_cache_write();end if;
 if not exists(select 1 from pg_trigger where tgrelid='private.ar_historical_duration_hour_parts'::regclass and tgname='ar_historical_duration_hour_truncate_guard' and not tgisinternal) then
 create trigger ar_historical_duration_hour_truncate_guard before truncate on private.ar_historical_duration_hour_parts for each statement execute function private.guard_ar_historical_duration_cache_write();end if;
end;$hour_triggers$;
do $hour_post$
declare cols jsonb;c record;f record;
begin
 select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum) into cols
 from pg_attribute where attrelid='private.ar_historical_duration_hour_parts'::regclass and attnum>0 and not attisdropped;
 if cols is distinct from '[ ["country_code","text",true],["platform","text",true],["data_date","date",true],["native_hour","integer",true],["source_row_count","bigint",true],["duration_sample_count","bigint",true],["duration_total_seconds","numeric",true],["generation","text",true],["generated_at","timestamp with time zone",true] ]'::jsonb then raise exception 'AR_DURATION_HOUR_COLUMNS_DRIFT';end if;
 if (select count(*) from pg_constraint where conrelid='private.ar_historical_duration_hour_parts'::regclass and contype<>'n')<>4
  or not exists(select 1 from pg_constraint where conrelid='private.ar_historical_duration_hour_parts'::regclass and contype='p' and conkey=array[1,2,3,4]::smallint[] and not condeferrable) then raise exception 'AR_DURATION_HOUR_CONSTRAINT_DRIFT';end if;
 select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) order by conname) into cols from pg_constraint where conrelid='private.ar_historical_duration_hour_parts'::regclass and contype='c';
 if cols is distinct from '[["ar_history_duration_hour_counts", "CHECK (((duration_sample_count >= 0) AND (source_row_count >= duration_sample_count) AND (duration_total_seconds >= (0)::numeric)))"], ["ar_history_duration_hour_generation", "CHECK ((generation ~ ''^[0-9a-f]{32}$''::text))"], ["ar_history_duration_hour_scope", "CHECK (((country_code = ''IN''::text) AND isfinite(data_date) AND (data_date < ''2026-10-10''::date) AND ((length(platform) >= 1) AND (length(platform) <= 200)) AND ((native_hour >= 0) AND (native_hour <= 23))))"]]'::jsonb then raise exception 'AR_DURATION_HOUR_CHECK_DRIFT';end if;
 if private.ar_historical_duration_generation() is null then raise exception 'AR_DURATION_HOUR_POSTCHECK';end if;
end;$hour_post$;
commit;
