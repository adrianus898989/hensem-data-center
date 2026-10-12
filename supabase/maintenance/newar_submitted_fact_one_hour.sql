-- Owner-only derived-field repair. Change only the three constants below for one native hour.
-- No source writes, no handling-time substitution, no method/count/coverage changes.
-- Narrow fact IDs drive native-PK reads; only the first 1000 eligible IDs are locked.
begin isolation level read committed;
set local statement_timeout='3s';
set local lock_timeout='1s';
select set_config('newar_submit_repair.platform','MAANWIN',true),
 set_config('newar_submit_repair.from','2026-10-09T18:30:00Z',true),
 set_config('newar_submit_repair.to','2026-10-09T19:30:00Z',true);
do $guard$
declare p record;c record;v_platform text:=current_setting('newar_submit_repair.platform');
 v_from timestamptz:=current_setting('newar_submit_repair.from')::timestamptz;
 v_to timestamptz:=current_setting('newar_submit_repair.to')::timestamptz;
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed'
  or v_platform not in('MAANWIN','DhaniWin') or not isfinite(v_from) or not isfinite(v_to)
  or v_from<timestamp '2026-10-10' at time zone 'Asia/Kolkata' or v_to<=v_from or v_to-v_from>interval '1 hour'
  or not exists(select 1 from public.newar_detail_platforms n where n.platform=v_platform and n.country_code='IN' and n.timezone='Asia/Kolkata')
  then raise exception 'NEWAR_SUBMIT_REPAIR_SCOPE_INVALID';end if;
 for p in select q.*,x.expected_hash from pg_proc q join(values
  ('private.newar_withdraw_fact(public.newar_detail_records)','244fe0b21d3b785a40c6409807b358bc'),
  ('private.newar_stats_time(text)','5789c6b60e5bf5789b1ac1733df85c34'))x(signature,expected_hash)
  on q.oid=to_regprocedure(x.signature) loop
  if md5(p.prosrc)<>p.expected_hash or pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
   then raise exception 'NEWAR_SUBMIT_REPAIR_FUNCTION_DRIFT';end if;
 end loop;
 if (select count(*) from pg_proc where oid in(to_regprocedure('private.newar_withdraw_fact(public.newar_detail_records)'),to_regprocedure('private.newar_stats_time(text)')))<>2
  then raise exception 'NEWAR_SUBMIT_REPAIR_FUNCTION_MISSING';end if;
 select q.* into c from pg_class q where q.oid='private.newar_withdraw_facts'::regclass;
 if pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or c.relforcerowsecurity
  or exists(select 1 from pg_policy where polrelid=c.oid)
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner)
  then raise exception 'NEWAR_SUBMIT_REPAIR_FACT_SECURITY_DRIFT';end if;
end;$guard$;
with params as materialized (
 select current_setting('newar_submit_repair.platform') platform,
  current_setting('newar_submit_repair.from')::timestamptz lo,current_setting('newar_submit_repair.to')::timestamptz hi
), candidates as materialized (
 select f.record_id,f.platform,f.source_id,f.created_at
 from params p join private.newar_withdraw_facts f
  on f.platform=p.platform and f.created_at>=p.lo and f.created_at<p.hi
 where f.submitted_at is null
 order by f.created_at,f.record_id
), eligible as materialized (
 select n.id,n.platform,n.source_id,n.created_at,t.submitted_at,
  b."businessSchemaVersion" schema_version,b."sourceSubmittedSourceField" submitted_source,b."sourceSubmittedAt" submitted_text
 from candidates f cross join lateral (
  select n.id,n.platform,n.dataset,n.source_id,n.created_at,n.raw
  from public.newar_detail_records n
  where n.id=f.record_id offset 0
 ) n
 cross join lateral jsonb_to_record(case when jsonb_typeof(n.raw)='object' then n.raw else '{}'::jsonb end)
  b("businessSchemaVersion" text,"sourceSubmittedSourceField" text,"sourceSubmittedAt" text)
 cross join lateral (
  select private.newar_stats_time(b."sourceSubmittedAt") submitted_at offset 0
 ) t
 where n.platform=f.platform and n.dataset='withdraw' and n.source_id=f.source_id and n.created_at=f.created_at
  and b."businessSchemaVersion"='2' and b."sourceSubmittedSourceField"='submittedTime'
  and t.submitted_at is not null
 limit 1000
), locked as materialized (
 select n.id,n.platform,n.source_id,n.created_at,e.submitted_at
 from eligible e cross join lateral (
  select n.id,n.platform,n.dataset,n.source_id,n.created_at,n.raw
  from public.newar_detail_records n where n.id=e.id
  for share of n skip locked offset 0
 ) n
 where n.platform=e.platform and n.dataset='withdraw' and n.source_id=e.source_id and n.created_at=e.created_at
  and n.raw->>'businessSchemaVersion'=e.schema_version
  and n.raw->>'sourceSubmittedSourceField'=e.submitted_source
  and n.raw->>'sourceSubmittedAt'=e.submitted_text
), repaired as (
 update private.newar_withdraw_facts f set submitted_at=p.submitted_at
 from locked p where f.record_id=p.id and p.submitted_at is not null
  and case when f.platform=p.platform and f.source_id=p.source_id and f.created_at=p.created_at
   then f.submitted_at is null else false end
 returning f.record_id
)
select current_setting('newar_submit_repair.platform') platform,
 current_setting('newar_submit_repair.from') interval_start,current_setting('newar_submit_repair.to') interval_end,
 (select count(*) from candidates) missing_fact_candidates,(select count(*) from eligible) eligible_candidates,
 (select count(*) from locked) source_rows_checked,(select count(*) from repaired) submitted_facts_repaired,
 '0 repairs is not proof of whole-day/source completeness'::text completeness_limit;
commit;
