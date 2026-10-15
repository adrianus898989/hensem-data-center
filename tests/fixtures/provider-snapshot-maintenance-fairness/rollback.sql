-- Bounded fair retirement with one-hour backoff; original head proofs, GC and cron commands unchanged.
begin;set local statement_timeout='3s';set local lock_timeout='500ms';
do $install$
declare e jsonb;actual jsonb;definition text;metadata jsonb;cron_before jsonb;
begin
if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_maintenance_installer_denied';end if;
if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))then raise exception using errcode='55000',message='snapshot_maintenance_busy';end if;
if not private.provider_snapshot_kernel_contract_current()then raise exception using errcode='55000',message='snapshot_kernel_contract_changed';end if;
select(select coalesce(jsonb_agg(jsonb_build_object('jobname',jobname,'schedule',schedule,'commandMd5',md5(command),'username',username,'database',database,'active',active)order by jobname),'[]')from cron.job where jobname in('provider-snapshot-dispatch-v1','provider-snapshot-maintenance-v1','provider-snapshot-worker-v1'))into cron_before;
if cron_before is distinct from $cron_expected$[{"jobname":"provider-snapshot-dispatch-v1","schedule":"* * * * *","commandMd5":"ef7406d0250c91fc2d71dae1f0affea8","username":"postgres","database":"postgres","active":true},{"jobname":"provider-snapshot-maintenance-v1","schedule":"*/5 * * * *","commandMd5":"7013a5f440c5c815295e0fb2c03766c0","username":"postgres","database":"postgres","active":true},{"jobname":"provider-snapshot-worker-v1","schedule":"1 second","commandMd5":"efbde623f216123103b3d455464f797c","username":"postgres","database":"postgres","active":true}]$cron_expected$::jsonb then raise exception using errcode='55000',message='snapshot_maintenance_cron_drift';end if;
e:=$dep0${"signature":"private.provider_snapshot_cohort_complete(uuid)","body_md5":"e95595fac5efd0adb90d6cb7c0eaa831","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950","allargtypes":null,"argmodes":null,"argnames":"{p_id}","arguments":"p_id uuid","result":"boolean"}$dep0$::jsonb;select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
if actual is distinct from e then raise exception using errcode='55000',message='snapshot_maintenance_function_drift',detail=e->>'signature';end if;
e:=$dep1${"signature":"private.provider_snapshot_gc_versions(integer)","body_md5":"1c1128cfefcf962d938f1c30f8286853","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"23","allargtypes":null,"argmodes":null,"argnames":"{p_limit}","arguments":"p_limit integer DEFAULT 100","result":"jsonb"}$dep1$::jsonb;select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
if actual is distinct from e then raise exception using errcode='55000',message='snapshot_maintenance_function_drift',detail=e->>'signature';end if;
e:=$dep2${"signature":"private.provider_snapshot_retire_intraday(uuid)","body_md5":"1981546b68bf4fca5388a929cdcce94e","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950","allargtypes":null,"argmodes":null,"argnames":"{p_cohort_id}","arguments":"p_cohort_id uuid","result":"jsonb"}$dep2$::jsonb;select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
if actual is distinct from e then raise exception using errcode='55000',message='snapshot_maintenance_function_drift',detail=e->>'signature';end if;
e:=$before${"signature":"private.provider_snapshot_maintain(integer)","body_md5":"217672cdf4956ce3b28abb6ffafc54aa","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"23","allargtypes":null,"argmodes":null,"argnames":"{p_artifact_limit}","arguments":"p_artifact_limit integer DEFAULT 100","result":"jsonb"}$before$::jsonb;select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
if actual is null or actual-'body_md5'is distinct from e-'body_md5'then raise exception using errcode='55000',message='snapshot_maintenance_metadata_drift';end if;
if actual->>'body_md5'='956ed6a67f0943ec8a37b633abdd4ab4'then
if to_regclass('private.provider_snapshot_retention_backoff')is not null then raise exception using errcode='55000',message='snapshot_maintenance_rollback_table_present';end if;
return;end if;
if actual is distinct from e then raise exception using errcode='55000',message='snapshot_maintenance_body_drift';end if;
select to_jsonb(q)into actual from(select n.nspname||'.'||c.relname name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner)owner,c.relacl::text acl,
(select coalesce(jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))order by a.attnum),'[]')from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)columns,
(select coalesce(jsonb_agg(jsonb_build_array(k.conname,k.contype,pg_get_constraintdef(k.oid,true),k.convalidated,k.condeferrable,k.condeferred)order by k.conname),'[]')from pg_constraint k where k.conrelid=c.oid and k.contype<>'n')constraints,
(select coalesce(jsonb_agg(jsonb_build_array(i.indexrelid::regclass::text,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive,i.indisunique,i.indimmediate)order by i.indexrelid::regclass::text),'[]')from pg_index i where i.indrelid=c.oid)indexes,
(select coalesce(jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true))order by t.tgname),'[]')from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)triggers,
(select count(*)from pg_policy pol where pol.polrelid=c.oid)policies,
(select count(*)from pg_inherits h where h.inhparent=c.oid or h.inhrelid=c.oid)inheritance
from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid=to_regclass('private.provider_snapshot_retention_backoff'))q;
if actual is distinct from $backoff_expected${"name":"private.provider_snapshot_retention_backoff","relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","columns":[["cohort_id","uuid",true,"","",null],["not_before","timestamp with time zone",true,"","",null],["last_reason","text",true,"","",null]],"constraints":[["provider_snapshot_retention_backoff_cohort_id_fkey","f","FOREIGN KEY (cohort_id) REFERENCES private.provider_snapshot_cohorts(id) ON DELETE CASCADE",true,false,false],["provider_snapshot_retention_backoff_last_reason_check","c","CHECK (last_reason = ANY (ARRAY['no_complete_replacement'::text, 'protected'::text, 'active_jobs_protected'::text, 'invalid_cohort_membership'::text]))",true,false,false],["provider_snapshot_retention_backoff_pkey","p","PRIMARY KEY (cohort_id)",true,false,false]],"indexes":[["private.provider_snapshot_retention_backoff_pkey","CREATE UNIQUE INDEX provider_snapshot_retention_backoff_pkey ON private.provider_snapshot_retention_backoff USING btree (cohort_id)",true,true,true,true,true]],"triggers":[],"policies":0,"inheritance":0}$backoff_expected$::jsonb then raise exception using errcode='55000',message='snapshot_maintenance_backoff_drift';end if;
select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'into definition,metadata from pg_proc p where p.oid='private.provider_snapshot_maintain(integer)'::regprocedure;
if(length(definition)-length(replace(definition,$oldbody$
declare c uuid;r jsonb;g jsonb;budget interval;v_stop timestamptz;v_checked integer:=0;v_blocked integer:=0;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_artifact_limit is null or p_artifact_limit not between 1 and 200 or budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_gc_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 -- Stop starting checks with two seconds left for GC. This cannot preempt an
 -- already running proof; the unchanged outer deadline remains authoritative.
 v_stop:=clock_timestamp()+greatest(interval'0seconds',budget-interval'2seconds');
 for c in
  select o.id from private.provider_snapshot_cohorts o
  left join private.provider_snapshot_retention_backoff b on b.cohort_id=o.id
  where o.lane='current'and o.status in('ready','failed','obsolete')
   and o.cutoff<(o.local_date+1)::timestamp at time zone'Asia/Kolkata'and o.updated_at<clock_timestamp()-interval'1hour'
   and(b.not_before is null or b.not_before<=clock_timestamp())
   and not exists(select 1 from private.provider_snapshot_retired_cohorts t where t.cohort_id=o.id)
   and not exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_jobs j on j.id=cj.job_id where cj.cohort_id=o.id and j.status in('queued','running','failed'))
   and exists(select 1 from private.provider_snapshot_cohorts n where n.local_date=o.local_date and n.roster_token=o.roster_token and n.targets=o.targets and n.cutoff>o.cutoff and n.status='ready')
  -- Today's removable cohorts keep their service capacity even with years of protected history.
  -- Null/old attempt times rotate finite candidate sets rather than retrying a fixed prefix.
  order by(o.local_date=(statement_timestamp()at time zone'Asia/Kolkata')::date)desc,b.not_before nulls first,o.cutoff,o.id limit 4
 loop
  exit when clock_timestamp()>=v_stop;
  r:=private.provider_snapshot_retire_intraday(c);v_checked:=v_checked+1;
  if r->>'status'in('retired','already_retired')then
   delete from private.provider_snapshot_retention_backoff where cohort_id=c;
   exit; -- At most one 90-slot retirement per tick; GC stays at the caller's original cap.
  elsif r->>'status'in('no_complete_replacement','protected','active_jobs_protected','invalid_cohort_membership')then
   insert into private.provider_snapshot_retention_backoff(cohort_id,not_before,last_reason)
    values(c,clock_timestamp()+interval'1hour',r->>'status')
    on conflict(cohort_id)do update set not_before=excluded.not_before,last_reason=excluded.last_reason;
   v_blocked:=v_blocked+1;
  elsif r->>'status'='busy'then return jsonb_build_object('status','busy');
  else raise exception using errcode='55000',message='snapshot_retirement_result_changed';end if;
 end loop;
 g:=private.provider_snapshot_gc_versions(p_artifact_limit);
 return jsonb_build_object('retirement',r,'gc',g,'checkedCohorts',v_checked,'deferredCohorts',v_blocked);
end;$oldbody$,'')))/length($oldbody$
declare c uuid;r jsonb;g jsonb;budget interval;v_stop timestamptz;v_checked integer:=0;v_blocked integer:=0;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_artifact_limit is null or p_artifact_limit not between 1 and 200 or budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_gc_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 -- Stop starting checks with two seconds left for GC. This cannot preempt an
 -- already running proof; the unchanged outer deadline remains authoritative.
 v_stop:=clock_timestamp()+greatest(interval'0seconds',budget-interval'2seconds');
 for c in
  select o.id from private.provider_snapshot_cohorts o
  left join private.provider_snapshot_retention_backoff b on b.cohort_id=o.id
  where o.lane='current'and o.status in('ready','failed','obsolete')
   and o.cutoff<(o.local_date+1)::timestamp at time zone'Asia/Kolkata'and o.updated_at<clock_timestamp()-interval'1hour'
   and(b.not_before is null or b.not_before<=clock_timestamp())
   and not exists(select 1 from private.provider_snapshot_retired_cohorts t where t.cohort_id=o.id)
   and not exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_jobs j on j.id=cj.job_id where cj.cohort_id=o.id and j.status in('queued','running','failed'))
   and exists(select 1 from private.provider_snapshot_cohorts n where n.local_date=o.local_date and n.roster_token=o.roster_token and n.targets=o.targets and n.cutoff>o.cutoff and n.status='ready')
  -- Today's removable cohorts keep their service capacity even with years of protected history.
  -- Null/old attempt times rotate finite candidate sets rather than retrying a fixed prefix.
  order by(o.local_date=(statement_timestamp()at time zone'Asia/Kolkata')::date)desc,b.not_before nulls first,o.cutoff,o.id limit 4
 loop
  exit when clock_timestamp()>=v_stop;
  r:=private.provider_snapshot_retire_intraday(c);v_checked:=v_checked+1;
  if r->>'status'in('retired','already_retired')then
   delete from private.provider_snapshot_retention_backoff where cohort_id=c;
   exit; -- At most one 90-slot retirement per tick; GC stays at the caller's original cap.
  elsif r->>'status'in('no_complete_replacement','protected','active_jobs_protected','invalid_cohort_membership')then
   insert into private.provider_snapshot_retention_backoff(cohort_id,not_before,last_reason)
    values(c,clock_timestamp()+interval'1hour',r->>'status')
    on conflict(cohort_id)do update set not_before=excluded.not_before,last_reason=excluded.last_reason;
   v_blocked:=v_blocked+1;
  elsif r->>'status'='busy'then return jsonb_build_object('status','busy');
  else raise exception using errcode='55000',message='snapshot_retirement_result_changed';end if;
 end loop;
 g:=private.provider_snapshot_gc_versions(p_artifact_limit);
 return jsonb_build_object('retirement',r,'gc',g,'checkedCohorts',v_checked,'deferredCohorts',v_blocked);
end;$oldbody$)<>1 then raise exception using errcode='55000',message='snapshot_maintenance_anchor_drift';end if;
execute replace(definition,$oldbody$
declare c uuid;r jsonb;g jsonb;budget interval;v_stop timestamptz;v_checked integer:=0;v_blocked integer:=0;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_artifact_limit is null or p_artifact_limit not between 1 and 200 or budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_gc_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 -- Stop starting checks with two seconds left for GC. This cannot preempt an
 -- already running proof; the unchanged outer deadline remains authoritative.
 v_stop:=clock_timestamp()+greatest(interval'0seconds',budget-interval'2seconds');
 for c in
  select o.id from private.provider_snapshot_cohorts o
  left join private.provider_snapshot_retention_backoff b on b.cohort_id=o.id
  where o.lane='current'and o.status in('ready','failed','obsolete')
   and o.cutoff<(o.local_date+1)::timestamp at time zone'Asia/Kolkata'and o.updated_at<clock_timestamp()-interval'1hour'
   and(b.not_before is null or b.not_before<=clock_timestamp())
   and not exists(select 1 from private.provider_snapshot_retired_cohorts t where t.cohort_id=o.id)
   and not exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_jobs j on j.id=cj.job_id where cj.cohort_id=o.id and j.status in('queued','running','failed'))
   and exists(select 1 from private.provider_snapshot_cohorts n where n.local_date=o.local_date and n.roster_token=o.roster_token and n.targets=o.targets and n.cutoff>o.cutoff and n.status='ready')
  -- Today's removable cohorts keep their service capacity even with years of protected history.
  -- Null/old attempt times rotate finite candidate sets rather than retrying a fixed prefix.
  order by(o.local_date=(statement_timestamp()at time zone'Asia/Kolkata')::date)desc,b.not_before nulls first,o.cutoff,o.id limit 4
 loop
  exit when clock_timestamp()>=v_stop;
  r:=private.provider_snapshot_retire_intraday(c);v_checked:=v_checked+1;
  if r->>'status'in('retired','already_retired')then
   delete from private.provider_snapshot_retention_backoff where cohort_id=c;
   exit; -- At most one 90-slot retirement per tick; GC stays at the caller's original cap.
  elsif r->>'status'in('no_complete_replacement','protected','active_jobs_protected','invalid_cohort_membership')then
   insert into private.provider_snapshot_retention_backoff(cohort_id,not_before,last_reason)
    values(c,clock_timestamp()+interval'1hour',r->>'status')
    on conflict(cohort_id)do update set not_before=excluded.not_before,last_reason=excluded.last_reason;
   v_blocked:=v_blocked+1;
  elsif r->>'status'='busy'then return jsonb_build_object('status','busy');
  else raise exception using errcode='55000',message='snapshot_retirement_result_changed';end if;
 end loop;
 g:=private.provider_snapshot_gc_versions(p_artifact_limit);
 return jsonb_build_object('retirement',r,'gc',g,'checkedCohorts',v_checked,'deferredCohorts',v_blocked);
end;$oldbody$,$newbody$
declare c uuid;r jsonb;g jsonb;budget interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_artifact_limit is null or p_artifact_limit not between 1 and 200 or budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_gc_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 select o.id into c from private.provider_snapshot_cohorts o where o.lane='current'and o.status in('ready','failed','obsolete')
  and o.cutoff<(o.local_date+1)::timestamp at time zone'Asia/Kolkata'and o.updated_at<clock_timestamp()-interval'1hour'
  and not exists(select 1 from private.provider_snapshot_retired_cohorts r where r.cohort_id=o.id)
  and not exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_jobs j on j.id=cj.job_id where cj.cohort_id=o.id and j.status in('queued','running','failed'))
  and exists(select 1 from private.provider_snapshot_cohorts n where n.local_date=o.local_date and n.roster_token=o.roster_token and n.targets=o.targets and n.cutoff>o.cutoff and n.status='ready')
  order by o.cutoff,o.id limit 1;
 if c is not null then r:=private.provider_snapshot_retire_intraday(c);end if;
 g:=private.provider_snapshot_gc_versions(p_artifact_limit);
 return jsonb_build_object('retirement',r,'gc',g);
end;$newbody$);
if(select to_jsonb(p)-'prosrc'from pg_proc p where p.oid='private.provider_snapshot_maintain(integer)'::regprocedure)is distinct from metadata then raise exception using errcode='55000',message='snapshot_maintenance_metadata_changed';end if;
drop table private.provider_snapshot_retention_backoff;
e:=$after${"signature":"private.provider_snapshot_maintain(integer)","body_md5":"956ed6a67f0943ec8a37b633abdd4ab4","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"23","allargtypes":null,"argmodes":null,"argnames":"{p_artifact_limit}","arguments":"p_artifact_limit integer DEFAULT 100","result":"jsonb"}$after$::jsonb;select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
if actual is distinct from e then raise exception using errcode='55000',message='snapshot_maintenance_function_drift',detail=e->>'signature';end if;
e:=$postdep0${"signature":"private.provider_snapshot_cohort_complete(uuid)","body_md5":"e95595fac5efd0adb90d6cb7c0eaa831","language":"sql","owner":"postgres","prosecdef":false,"provolatile":"s","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950","allargtypes":null,"argmodes":null,"argnames":"{p_id}","arguments":"p_id uuid","result":"boolean"}$postdep0$::jsonb;select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
if actual is distinct from e then raise exception using errcode='55000',message='snapshot_maintenance_function_drift',detail=e->>'signature';end if;
e:=$postdep1${"signature":"private.provider_snapshot_gc_versions(integer)","body_md5":"1c1128cfefcf962d938f1c30f8286853","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":1,"variadic":0,"prokind":"f","proretset":false,"argtypes":"23","allargtypes":null,"argmodes":null,"argnames":"{p_limit}","arguments":"p_limit integer DEFAULT 100","result":"jsonb"}$postdep1$::jsonb;select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
if actual is distinct from e then raise exception using errcode='55000',message='snapshot_maintenance_function_drift',detail=e->>'signature';end if;
e:=$postdep2${"signature":"private.provider_snapshot_retire_intraday(uuid)","body_md5":"1981546b68bf4fca5388a929cdcce94e","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950","allargtypes":null,"argmodes":null,"argnames":"{p_cohort_id}","arguments":"p_cohort_id uuid","result":"jsonb"}$postdep2$::jsonb;select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
if actual is distinct from e then raise exception using errcode='55000',message='snapshot_maintenance_function_drift',detail=e->>'signature';end if;
if(select coalesce(jsonb_agg(jsonb_build_object('jobname',jobname,'schedule',schedule,'commandMd5',md5(command),'username',username,'database',database,'active',active)order by jobname),'[]')from cron.job where jobname in('provider-snapshot-dispatch-v1','provider-snapshot-maintenance-v1','provider-snapshot-worker-v1'))is distinct from cron_before or not private.provider_snapshot_kernel_contract_current()then raise exception using errcode='55000',message='snapshot_maintenance_postcondition_drift';end if;
end;$install$;
notify pgrst,'reload schema';commit;
