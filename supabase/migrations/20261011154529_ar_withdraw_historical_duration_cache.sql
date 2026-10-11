-- Historical native duration only. No existing report counts, projection/readiness, or source rows are changed.
-- Installation performs no historical aggregate scan; explicit owner maintenance fills individual native days later.
begin;
set local lock_timeout='2s';
do $guard$
declare c record;p record;entry record;columns jsonb;
begin
 select *,pg_get_userbyid(relowner) owner_name into c from pg_class where oid='public.ar_collected_orders'::regclass;
 if c.relkind<>'r' or c.owner_name<>'postgres' then raise exception 'AR_HISTORY_DURATION_SOURCE_DRIFT';end if;
 if exists(select 1 from (values('source_system','text'),('country_code','text'),('platform','text'),('order_kind','text'),('applied_at','timestamp without time zone'),('completed_at','timestamp without time zone'))v(n,t)
   where not exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname=v.n and format_type(a.atttypid,a.atttypmod)=v.t and not a.attisdropped))
  or not exists(select 1 from pg_attribute where attrelid=c.oid and attname='applied_at' and atttypid='timestamp'::regtype and not attisdropped)
  or not exists(select 1 from pg_attribute where attrelid=c.oid and attname='completed_at' and atttypid='timestamp'::regtype and not attisdropped)
  then raise exception 'AR_HISTORY_DURATION_SOURCE_TYPE_DRIFT';end if;
 select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid='private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'::regprocedure;
 if md5(p.prosrc)<>'3e7e5666a6e7b869a02513221597da1a' or p.owner_name<>'postgres' or p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
  then raise exception 'AR_HISTORY_DURATION_READER_DRIFT';end if;
 for entry in select * from(values ('private.invalidate_ar_historical_duration_cache()','449b1519da934e2da7034f698d42fb9a',true,'v'),('private.refresh_ar_historical_duration(text,date)','c1ca787546f804af858c5316305b7f70',false,'v'),('private.guard_ar_historical_duration_cache_write()','8ec77a15af7089409cc9368db595a5e7',false,'v'),('private.ar_historical_duration_generation()','059d6bd465ec451839f0db41aad2ea0e',false,'s'),('private.dashboard_admin_ar_historical_duration_days(jsonb,jsonb,date,date)','9a7bba61d4cdb9b185c7fb7a07c8dc03',false,'s'))f(sig,hash,definer,volatility) loop
  if to_regprocedure(entry.sig) is not null then
   select q.*,pg_get_userbyid(q.proowner) owner_name into p from pg_proc q where q.oid=to_regprocedure(entry.sig);
   if md5(p.prosrc)<>entry.hash or p.owner_name<>'postgres' or p.prosecdef is distinct from entry.definer
    or p.provolatile::text<>entry.volatility or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
    then raise exception 'AR_HISTORY_DURATION_FUNCTION_DRIFT';end if;
  end if;
 end loop;
 if to_regclass('private.ar_historical_duration_cache') is not null then
  select *,pg_get_userbyid(relowner) owner_name into c from pg_class where oid='private.ar_historical_duration_cache'::regclass;
  if c.relkind<>'r' or c.owner_name<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity
   or c.relacl::text is distinct from '{postgres=arwdDxtm/postgres}' or exists(select 1 from pg_policy where polrelid=c.oid)
   then raise exception 'AR_HISTORY_DURATION_TABLE_DRIFT';end if;
 end if;
end;
$guard$;
create table if not exists private.ar_historical_duration_cache(
 country_code text not null,platform text not null,data_date date not null,source_row_count bigint not null,
 duration_sample_count bigint not null,duration_total_seconds numeric not null,generation text not null,generated_at timestamptz not null,
 primary key(country_code,platform,data_date),
 constraint ar_history_duration_scope check(country_code='IN' and isfinite(data_date) and data_date<date '2026-10-10' and length(platform) between 1 and 200),
 constraint ar_history_duration_counts check(duration_sample_count>=0 and source_row_count>=duration_sample_count and duration_total_seconds>=0),
 constraint ar_history_duration_generation check(generation ~ '^[0-9a-f]{32}$')
);
do $table_privacy$
declare c record;
begin
 select * into c from pg_class where oid='private.ar_historical_duration_cache'::regclass;
 if pg_get_userbyid(c.relowner)<>'postgres' then alter table private.ar_historical_duration_cache owner to postgres;end if;
 if not c.relrowsecurity then alter table private.ar_historical_duration_cache enable row level security;end if;
 if c.relacl::text is distinct from '{postgres=arwdDxtm/postgres}' then
  revoke all on private.ar_historical_duration_cache from public,anon,authenticated,service_role;
 end if;
end;$table_privacy$;
create or replace function private.invalidate_ar_historical_duration_cache() returns trigger
language plpgsql security definer set search_path='' AS $function$
begin
 if TG_RELID<>'public.ar_collected_orders'::regclass or TG_WHEN<>'AFTER' then raise exception 'ar_historical_duration_trigger_context';end if;
 if TG_OP='TRUNCATE' then
  if TG_LEVEL<>'STATEMENT' then raise exception 'ar_historical_duration_trigger_context';end if;
  delete from private.ar_historical_duration_cache;return null;
 end if;
 if TG_LEVEL<>'ROW' then raise exception 'ar_historical_duration_trigger_context';end if;
 -- Capture-only, status and operator updates cannot change this time-only pool.
 if TG_OP='UPDATE' and row(OLD.source_system,OLD.country_code,OLD.platform,OLD.order_kind,OLD.applied_at,OLD.completed_at)
  is not distinct from row(NEW.source_system,NEW.country_code,NEW.platform,NEW.order_kind,NEW.applied_at,NEW.completed_at) then return null;end if;
 if TG_OP in('UPDATE','DELETE') and OLD.source_system='AR' and OLD.country_code='IN' and OLD.order_kind='withdraw'
  and isfinite(OLD.applied_at) and OLD.applied_at<timestamp '2026-10-10' then
  delete from private.ar_historical_duration_cache c where c.country_code=OLD.country_code and c.platform=OLD.platform and c.data_date=OLD.applied_at::date;
 end if;
 if TG_OP in('UPDATE','INSERT') and NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw'
  and isfinite(NEW.applied_at) and NEW.applied_at<timestamp '2026-10-10' then
  delete from private.ar_historical_duration_cache c where c.country_code=NEW.country_code and c.platform=NEW.platform and c.data_date=NEW.applied_at::date;
 end if;
 return null;
end;
$function$;

create or replace function private.refresh_ar_historical_duration(p_platform text,p_day date) returns jsonb
language plpgsql volatile set search_path='' AS $function$
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
$function$;

create or replace function private.guard_ar_historical_duration_cache_write() returns trigger
language plpgsql set search_path='' AS $function$
begin
 if current_user<>'postgres' or TG_RELID<>'private.ar_historical_duration_cache'::regclass or TG_WHEN<>'BEFORE'
  or (TG_OP='TRUNCATE' and TG_LEVEL<>'STATEMENT') or (TG_OP<>'TRUNCATE' and TG_LEVEL<>'ROW') then
  raise exception 'ar_historical_duration_cache_write_denied';end if;
 if TG_OP='DELETE' then return OLD;elsif TG_OP='TRUNCATE' then return null;else return NEW;end if;
end;
$function$;

create or replace function private.ar_historical_duration_generation() returns text
language sql stable set search_path='' AS $function$
 select case when count(*)=4 and bool_and(t.tgenabled='O' and t.tgfoid='private.invalidate_ar_historical_duration_cache()'::regprocedure)
  and bool_and(md5(pg_get_triggerdef(t.oid))=case t.tgname when 'ar_historical_duration_insert' then '7759e8593839433f70fa4db5cb685e56' when 'ar_historical_duration_delete' then '19cbae393493bbb34acc0fbc002ed9b3' when 'ar_historical_duration_update' then 'e7d54f457601aa92e955fc3b90ba5e8a' when 'ar_historical_duration_truncate' then 'e7fc978a9f501ca4eb10553c23cefad0' end)
  and bool_and(p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}' and md5(p.prosrc)='449b1519da934e2da7034f698d42fb9a')
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
   and md5(z.prosrc)='8ec77a15af7089409cc9368db595a5e7' and pg_get_userbyid(z.proowner)='postgres' and not z.prosecdef and z.provolatile='v'
   and z.proconfig=array['search_path=""']::text[] and z.proacl::text='{postgres=X/postgres}')
  then md5('ar_native_historical_duration_v1:449b1519da934e2da7034f698d42fb9a:c1ca787546f804af858c5316305b7f70:8ec77a15af7089409cc9368db595a5e7:3e7e5666a6e7b869a02513221597da1a:'||(select string_agg(x.oid::text||':'||x.xmin::text||':'||pg_get_triggerdef(x.oid),',' order by x.tgname)
   from pg_trigger x where x.tgrelid='private.ar_historical_duration_cache'::regclass and not x.tgisinternal)||':'||string_agg(t.oid::text||':'||t.xmin::text||':'||pg_get_triggerdef(t.oid),',' order by t.tgname)) end
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid='public.ar_collected_orders'::regclass and not t.tgisinternal
  and t.tgname in('ar_historical_duration_insert','ar_historical_duration_update','ar_historical_duration_delete','ar_historical_duration_truncate');
$function$;

create or replace function private.dashboard_admin_ar_historical_duration_days(p_request jsonb,p_scope jsonb,p_start date,p_end date)
returns table(data_date date,country text,platform_key text,alias_keys text[],duration_sample_count bigint,duration_total_seconds numeric,generated_at timestamptz)
language plpgsql stable set search_path='' AS $function$
begin
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<p_start or p_end-p_start>61 then
  raise exception using errcode='22023',message='invalid_ar_historical_duration_range';end if;
 return query
 WITH supported(code,name) AS (VALUES
  ('BR','POP555'),('BR','POP678'),('BR','POP888'),('BR','POPBEM'),('BR','POPBRA'),('BR','POPCEU'),('BR','POPLUA'),('BR','POPPG'),
  ('ID','55FIVE'),
  ('IN','51GAME'),('IN','55CLUB'),('IN','6CLUB'),('IN','82LOTTERY'),('IN','91CLUB'),('IN','BIGMUMBAI'),('IN','IN999'),
  ('IN','JAICLUB'),('IN','JALWA'),('IN','LOTTERY7'),('IN','OKWIN'),('IN','RAJA'),('IN','SHREEWIN'),('IN','TPPLAY'),('IN','Veer.Game'),
  ('MM','6LOTTERY'),('MY','MZPLAY'),('NG','FB999'),
  ('PK','92.GAME'),('PK','92COCO'),('PK','92DADU'),('PK','92GLORY'),('PK','92GO'),('PK','92PKR'),('PK','92R'),('PK','92STAR'),('PK','92STRIKE'),('PK','YAYWIN'),
  ('VN','66CLUB'),('VN','82VN'),('VN','92LOTTERY'),('VN','VN168')
 ), targets AS MATERIALIZED (
  SELECT t->>'country' country,CASE WHEN jsonb_typeof(t->'platforms')='array'
    THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(x) FROM jsonb_array_elements_text(t->'platforms')x) END platforms
  FROM jsonb_array_elements(CASE WHEN p_request?'scopeTargets' THEN p_request->'scopeTargets'
    ELSE jsonb_build_array(jsonb_build_object('country',p_request->>'country','platforms',null)) END)t
 ), requested AS (
  SELECT CASE WHEN nullif(p_request->>'platform','') IS NOT NULL THEN ARRAY[private.dashboard_admin_live_withdraw_key(p_request->>'platform')]
   WHEN p_request?'platforms' AND jsonb_array_length(p_request->'platforms')>0 THEN ARRAY(SELECT private.dashboard_admin_live_withdraw_key(x) FROM jsonb_array_elements_text(p_request->'platforms')x) END platforms
 ), catalog AS MATERIALIZED (
  SELECT m.*,s.name canonical_name,
   ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[m.source_name,m.name,s.name])x WHERE x IS NOT NULL) aliases,
   ARRAY(SELECT DISTINCT private.dashboard_admin_live_withdraw_key(x)
    FROM unnest(ARRAY[m.source_name,m.name,s.name])x WHERE x IS NOT NULL) alias_keys
  FROM private.dashboard_admin_live_platforms()m
  JOIN supported s ON s.code=m.scope_group AND private.dashboard_admin_live_withdraw_key(s.name)=private.dashboard_admin_live_withdraw_key(m.source_name)
  WHERE m.source='ar'
 ), scopes AS MATERIALIZED (
  -- The existing catalog already checks authentication and independent grants.
  -- Keep its source name and country identity; never infer a country from a label.
  SELECT DISTINCT ON(m.scope_group,private.dashboard_admin_live_withdraw_key(m.source_name))
   m.scope_group code,m.country,m.name platform,private.dashboard_admin_live_withdraw_key(m.source_name) platform_key,
   m.aliases,m.alias_keys
  FROM catalog m
  JOIN targets t ON t.country=m.country AND (t.platforms IS NULL OR m.alias_keys&&t.platforms)
  CROSS JOIN requested r
  WHERE (r.platforms IS NULL OR m.alias_keys&&r.platforms)
   AND private.dashboard_scope_allows(p_scope,m.country,m.name)
  ORDER BY m.scope_group,private.dashboard_admin_live_withdraw_key(m.source_name),m.name,m.source_name

 ), generation as materialized (select private.ar_historical_duration_generation() id), partitions as materialized (
  select s.*,n.native_alias,dt.d::date data_date
  from scopes s cross join lateral unnest(s.aliases)n(native_alias)
   cross join generate_series(p_start::timestamp,least(p_end,date '2026-10-09')::timestamp,interval '1 day')dt(d)
  where s.code='IN'
 )
 select q.data_date,q.country,q.platform_key,q.alias_keys,sum(c.duration_sample_count)::bigint,sum(c.duration_total_seconds),max(c.generated_at)
 from partitions q cross join generation g left join private.ar_historical_duration_cache c
  on c.country_code=q.code and c.platform=q.native_alias and c.data_date=q.data_date and c.generation=g.id
 group by q.data_date,q.country,q.platform_key,q.alias_keys
 having bool_and(c.data_date is not null);
end;
$function$;
alter function private.invalidate_ar_historical_duration_cache() owner to postgres;
revoke all on function private.invalidate_ar_historical_duration_cache() from public,anon,authenticated,service_role;
alter function private.refresh_ar_historical_duration(text,date) owner to postgres;
revoke all on function private.refresh_ar_historical_duration(text,date) from public,anon,authenticated,service_role;
alter function private.guard_ar_historical_duration_cache_write() owner to postgres;
revoke all on function private.guard_ar_historical_duration_cache_write() from public,anon,authenticated,service_role;
alter function private.ar_historical_duration_generation() owner to postgres;
revoke all on function private.ar_historical_duration_generation() from public,anon,authenticated,service_role;
alter function private.dashboard_admin_ar_historical_duration_days(jsonb,jsonb,date,date) owner to postgres;
revoke all on function private.dashboard_admin_ar_historical_duration_days(jsonb,jsonb,date,date) from public,anon,authenticated,service_role;
do $triggers$
begin
 if not exists(select 1 from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar_historical_duration_insert' and not tgisinternal) then
 create trigger ar_historical_duration_insert after insert on public.ar_collected_orders for each row
  when(NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw' and isfinite(NEW.applied_at) and NEW.applied_at<timestamp '2026-10-10') execute function private.invalidate_ar_historical_duration_cache();end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar_historical_duration_delete' and not tgisinternal) then
 create trigger ar_historical_duration_delete after delete on public.ar_collected_orders for each row
  when(OLD.source_system='AR' and OLD.country_code='IN' and OLD.order_kind='withdraw' and isfinite(OLD.applied_at) and OLD.applied_at<timestamp '2026-10-10') execute function private.invalidate_ar_historical_duration_cache();end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar_historical_duration_update' and not tgisinternal) then
 create trigger ar_historical_duration_update after update on public.ar_collected_orders for each row
  when((OLD.source_system='AR' and OLD.country_code='IN' and OLD.order_kind='withdraw' and isfinite(OLD.applied_at) and OLD.applied_at<timestamp '2026-10-10')
   or (NEW.source_system='AR' and NEW.country_code='IN' and NEW.order_kind='withdraw' and isfinite(NEW.applied_at) and NEW.applied_at<timestamp '2026-10-10')) execute function private.invalidate_ar_historical_duration_cache();end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname='ar_historical_duration_truncate' and not tgisinternal) then
 create trigger ar_historical_duration_truncate after truncate on public.ar_collected_orders for each statement execute function private.invalidate_ar_historical_duration_cache();end if;
 if not exists(select 1 from pg_trigger where tgrelid='private.ar_historical_duration_cache'::regclass and tgname='ar_historical_duration_cache_write_guard' and not tgisinternal) then
 create trigger ar_historical_duration_cache_write_guard before insert or update or delete on private.ar_historical_duration_cache for each row execute function private.guard_ar_historical_duration_cache_write();end if;
 if not exists(select 1 from pg_trigger where tgrelid='private.ar_historical_duration_cache'::regclass and tgname='ar_historical_duration_cache_truncate_guard' and not tgisinternal) then
 create trigger ar_historical_duration_cache_truncate_guard before truncate on private.ar_historical_duration_cache for each statement execute function private.guard_ar_historical_duration_cache_write();end if;
end;
$triggers$;
do $post$
declare columns jsonb;checks jsonb;t record;expected record;
begin
 select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) order by attnum) into columns
 from pg_attribute where attrelid='private.ar_historical_duration_cache'::regclass and attnum>0 and not attisdropped;
 if columns is distinct from '[ ["country_code","text",true],["platform","text",true],["data_date","date",true],["source_row_count","bigint",true],["duration_sample_count","bigint",true],["duration_total_seconds","numeric",true],["generation","text",true],["generated_at","timestamp with time zone",true] ]'::jsonb
  then raise exception 'AR_HISTORY_DURATION_COLUMNS_DRIFT';end if;
 if (select count(*) from pg_constraint where conrelid='private.ar_historical_duration_cache'::regclass and contype<>'n')<>4
  or not exists(select 1 from pg_constraint where conrelid='private.ar_historical_duration_cache'::regclass and contype='p' and conkey=array[1,2,3]::smallint[] and not condeferrable)
  then raise exception 'AR_HISTORY_DURATION_CONSTRAINT_DRIFT';end if;
 select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) order by conname) into checks
 from pg_constraint where conrelid='private.ar_historical_duration_cache'::regclass and contype='c';
 if checks is distinct from '[ ["ar_history_duration_counts","CHECK (((duration_sample_count >= 0) AND (source_row_count >= duration_sample_count) AND (duration_total_seconds >= (0)::numeric)))"],["ar_history_duration_generation","CHECK ((generation ~ ''^[0-9a-f]{32}$''::text))"],["ar_history_duration_scope","CHECK (((country_code = ''IN''::text) AND isfinite(data_date) AND (data_date < ''2026-10-10''::date) AND ((length(platform) >= 1) AND (length(platform) <= 200))))"] ]'::jsonb
  then raise exception 'AR_HISTORY_DURATION_CHECK_DRIFT';end if;
 for expected in select * from(values ('ar_historical_duration_insert',5,'7759e8593839433f70fa4db5cb685e56'),('ar_historical_duration_delete',9,'19cbae393493bbb34acc0fbc002ed9b3'),('ar_historical_duration_update',17,'e7d54f457601aa92e955fc3b90ba5e8a'),('ar_historical_duration_truncate',32,'e7fc978a9f501ca4eb10553c23cefad0'))e(name,kind,definition_hash) loop
  select * into t from pg_trigger where tgrelid='public.ar_collected_orders'::regclass and tgname=expected.name and not tgisinternal;
  if not found or t.tgfoid<>'private.invalidate_ar_historical_duration_cache()'::regprocedure or t.tgenabled<>'O' or t.tgtype<>expected.kind
   or md5(pg_get_triggerdef(t.oid))<>expected.definition_hash or t.tgnargs<>0 or (expected.kind=32 and t.tgqual is not null) or (expected.kind<>32 and t.tgqual is null)
   then raise exception 'AR_HISTORY_DURATION_TRIGGER_DRIFT';end if;
 end loop;
 if private.ar_historical_duration_generation() is null then raise exception 'AR_HISTORY_DURATION_GENERATION_INVALID';end if;
end;
$post$;
commit;
