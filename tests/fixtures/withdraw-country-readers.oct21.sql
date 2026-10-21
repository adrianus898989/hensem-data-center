CREATE OR REPLACE FUNCTION private.withdraw_prepared_read(q jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s jsonb;c jsonb;r jsonb;k jsonb;dep text;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;budget integer;v_admitted uuid;v_status text;v_refresh text;v_at timestamptz:=clock_timestamp();progress jsonb;
BEGIN
 -- The original native auth/session/IP/scope checks remain live on every read.
 PERFORM private.withdraw_prepared_validate(private.withdraw_window_legacy(q));s:=private.dashboard_admin_live_scope();
 SELECT coalesce(jsonb_agg(to_jsonb(p)ORDER BY p.id),'[]')INTO c FROM private.dashboard_admin_live_platforms()p;
 IF NOT private.withdraw_prepared_source_contract_current()THEN RETURN jsonb_build_object('prepared',jsonb_build_object('status','failed','reason','source_contract_changed','contract','withdraw-independent-windows-v2'),'rows',null,'totals',null,'total',null);END IF;
 r:=private.withdraw_prepared_canonical(q);k:=jsonb_build_array('withdraw-independent-windows-v2',s,c,r);dep:=private.withdraw_prepared_dependency();
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE fingerprint=md5(k::text)AND request_key=k;
 SELECT x.*INTO a FROM private.withdraw_prepared_heads h JOIN private.withdraw_prepared_artifacts x ON x.id=h.artifact_id WHERE h.job_id=j.id;
 -- Expiry is a refresh deadline, not a loss of a complete, same-semantics
 -- publication. Permissions/catalog and notes still resolve live above/below.
 IF a.id IS NOT NULL AND a.job_id=j.id AND a.revision=j.revision AND a.dependency=dep AND j.dependency=dep
 AND a.payload->>'contract'='withdraw-independent-windows-v2' AND a.payload->'request'=r AND a.payload->'scope'=s AND a.payload->'catalog'=c
 AND jsonb_typeof(a.payload->'secondary')='object' AND jsonb_typeof(a.payload->'game66')='object'
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['wg','yash','newar','ar','duoli','arHistory'])part WHERE jsonb_typeof(a.payload->part)IS DISTINCT FROM'array')THEN
  PERFORM private.withdraw_prepared_admit_default_template(j.id,r,s,c);
  -- Refresh only the same ready job. Never reset a running lease or the retry
  -- limit of a failed refresh, and never extend the artifact's expiry/time.
  UPDATE private.withdraw_prepared_jobs SET status='queued',not_before=v_at
   WHERE id=j.id AND revision=a.revision AND dependency=dep AND status='ready'AND a.expires_at<=v_at;
  SELECT status INTO v_refresh FROM private.withdraw_prepared_jobs WHERE id=j.id;
  UPDATE private.withdraw_prepared_jobs SET last_requested_at=v_at WHERE id=j.id AND last_requested_at<v_at-interval'5minutes';
  RETURN private.auto_team_previous_projection(q,a.payload,(private.withdraw_window_result(r,private.withdraw_prepared_render(private.withdraw_window_legacy(q),a.payload),a.payload)||jsonb_build_object('prepared',jsonb_build_object('status','ready','contract','withdraw-independent-windows-v2','publicationVersion',2,'generation',a.id,'computedAt',a.computed_at,'expiresAt',a.expires_at,'calculationComplete',true,'freshness',CASE WHEN a.expires_at>v_at THEN'fresh'ELSE'refresh_due'END,'refreshState',CASE WHEN v_refresh IN('queued','running','failed')THEN v_refresh ELSE'idle'END))),r);
 END IF;
 v_status:=CASE WHEN j.status='failed'AND j.attempts>=3 THEN'failed'WHEN a.id IS NOT NULL THEN'stale'WHEN j.status IN('queued','running')THEN'building'ELSE'missing'END;
 IF j.id IS NULL THEN
  INSERT INTO private.withdraw_prepared_admissions(actor,day,total)VALUES(auth.uid(),current_date,1)ON CONFLICT(actor,day)DO UPDATE SET total=private.withdraw_prepared_admissions.total+1 WHERE private.withdraw_prepared_admissions.total<200 RETURNING total INTO budget;
  IF budget IS NOT NULL THEN v_admitted:=private.withdraw_prepared_enqueue(r,s,c,dep);PERFORM private.withdraw_prepared_admit_default_template(v_admitted,r,s,c);END IF;
 ELSE
  v_admitted:=private.withdraw_prepared_enqueue(r,s,c,dep);PERFORM private.withdraw_prepared_admit_default_template(v_admitted,r,s,c);
  -- This branch has no usable head, even if an incompatible artifact is
  -- still within its expiry. Preserve it, but admit the exact current work.
  UPDATE private.withdraw_prepared_jobs SET status='queued',not_before=clock_timestamp()
   WHERE id=v_admitted AND request_key=k AND dependency=dep AND status='ready';
 END IF;
 -- First authorized wait for this queued job, not a click counter. Polls
 -- share the same wire request and must never extend this two-minute window.
 -- Usable publications return above; refreshing them remains background work.
 UPDATE private.withdraw_prepared_jobs SET interactive_requested_at=v_at
  WHERE id=v_admitted AND request_key=k AND dependency=dep
   AND request_key->>0='withdraw-independent-windows-v2'
   AND status IN('queued','failed')AND attempts<3 AND isfinite(not_before)
   AND interactive_requested_at IS NULL;
 -- Only the authenticated exact current request may see opaque progress.
 -- Reads never touch checkpoint time or renew the interactive priority marker.
 SELECT jsonb_build_object('contract','withdraw-stages-v1',
  'generation',md5(jsonb_build_array(j2.id,j2.revision,j2.dependency,b.id)::text),
  'doneParts',(SELECT count(*)FROM private.withdraw_prepared_parts p WHERE p.build_id=b.id AND p.status='done'),
  'pendingParts',(SELECT count(*)FROM private.withdraw_prepared_parts p WHERE p.build_id=b.id AND p.status='pending'),
  'running',coalesce(j2.status='running'AND j2.lease_until>clock_timestamp(),false),'lastProgressAt',b.updated_at)
 INTO progress FROM private.withdraw_prepared_jobs j2 JOIN private.withdraw_prepared_builds b ON b.job_id=j2.id
 WHERE j2.id=v_admitted AND j2.request_key=k AND j2.request=r AND j2.scope=s AND j2.catalog=c
  AND j2.dependency=dep AND j2.status IN('queued','running')
  AND b.revision=j2.revision AND b.dependency=dep AND b.request=r AND b.scope=s AND b.catalog=c;
 SELECT *INTO j FROM private.withdraw_prepared_jobs WHERE id=v_admitted AND request_key=k AND dependency=dep;
 v_status:=CASE WHEN j.status='failed'AND j.attempts>=3 THEN'failed'WHEN progress IS NOT NULL THEN'building'
  WHEN a.id IS NOT NULL THEN'stale'WHEN j.status IN('queued','running')THEN'building'ELSE'missing'END;
 RETURN jsonb_build_object('prepared',jsonb_build_object('status',v_status,'contract','withdraw-independent-windows-v2','computedAt',a.computed_at,'expiresAt',a.expires_at)||CASE WHEN progress IS NOT NULL THEN jsonb_build_object('progress',progress)ELSE '{}'::jsonb END,'rows',null,'totals',null,'total',null);
END;$function$;


CREATE OR REPLACE FUNCTION private.withdraw_prepared_prewarm()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE t private.withdraw_prepared_templates%rowtype;d date;offset_day integer;n integer:=0;r jsonb;dep text;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 IF current_setting('statement_timeout')::interval<=interval'0seconds'OR current_setting('statement_timeout')::interval>interval'3seconds'THEN RAISE EXCEPTION 'withdraw_prepared_maintenance_deadline_required';END IF;
 dep:=private.withdraw_prepared_dependency();
 FOR t IN SELECT *FROM private.withdraw_prepared_templates WHERE enabled ORDER BY id LIMIT 100 LOOP
  IF NOT private.withdraw_prepared_catalog_current(t.catalog)THEN CONTINUE;END IF;
  FOR offset_day IN 0..1 LOOP
   d:=(clock_timestamp()AT TIME ZONE t.timezone)::date-offset_day;
   r:=private.withdraw_window_default_day(t.request,d);
   IF private.withdraw_prepared_enqueue(r,t.scope,t.catalog,dep)IS NOT NULL THEN n:=n+1;END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('expected',n);
END;$function$;


CREATE OR REPLACE FUNCTION private.withdraw_prepared_admit_default_template(p_job uuid, p_request jsonb, p_scope jsonb, p_catalog jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j private.withdraw_prepared_jobs%rowtype;target jsonb;zones text[];resolved integer;wanted integer;
 all_default boolean;has_unknown_zone boolean;tz text;d date;tid uuid;old_lock text:=current_setting('lock_timeout');
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='withdraw_prepared_worker_denied';end if;
 select *into j from private.withdraw_prepared_jobs where id=p_job;
 if not found or j.request is distinct from p_request or j.scope is distinct from p_scope or j.catalog is distinct from p_catalog
 or j.request_key is distinct from jsonb_build_array('withdraw-independent-windows-v2',p_scope,p_catalog,p_request)
 or j.request->'windowVersion'is distinct from'2'::jsonb
 or coalesce(j.request->>'view','')not in('auto','operators')or nullif(j.request->>'account','')is not null
 or private.withdraw_window_whole_days(j.request)is not true
 or left(j.request->>'startAt',10)is distinct from left(j.request->>'endAt',10)
 or j.request->>'startAt'is distinct from j.request->>'successStartAt'
 or j.request->>'endAt'is distinct from j.request->>'successEndAt'then return null;end if;
 -- Already configured exact scopes need no repeated alias/team proof. Fresh
 -- request/scope/catalog/job identity was still checked above on every read.
 select id into tid from private.withdraw_prepared_templates t
 where t.fingerprint=md5(jsonb_build_array(j.request-array['startAt','endAt','successStartAt','successEndAt'],j.scope,j.catalog)::text)
 and t.request=j.request-array['startAt','endAt','successStartAt','successEndAt']and t.scope=j.scope and t.catalog=j.catalog and t.enabled;
 if found then return tid;end if;
 -- Explicit target countries survive team combinations. No wider country or
 -- team population is substituted for the request that was actually authorized.
 target:=case when j.request?'scopeTargets'then j.request->'scopeTargets'else jsonb_build_array(jsonb_build_object(
  'country',j.request->'country','platforms',case when nullif(j.request->>'platform','')is not null then jsonb_build_array(j.request->'platform')else coalesce(j.request->'platforms','[]'::jsonb)end))end;
 with targets as materialized(select value t,n from jsonb_array_elements(target)with ordinality a(value,n)),
 candidates as materialized(
  select t.n,t.t->>'country'country,p.value->>'id'id,p.value->>'team'team,p.value->>'timezone'zone,
   private.dashboard_admin_live_deposit_platform_key(t.t->>'country',p.value->>'name')name_key,
   private.dashboard_admin_live_deposit_platform_key(t.t->>'country',p.value->>'source_name')source_key,
   -- Existing owner-confirmed UI display alias, limited to this native
   -- team/country/backend (live-report-data.js confirmedRaja/normalizeIdentity).
   -- This proves coverage only; job request, native IDs and kernel stay exact.
   case when t.t->>'country'='印度'and p.value->>'country'='印度'and p.value->>'team'='M8'
    and p.value->>'scope_group'='IN'and p.value->>'source'='ar'and upper(btrim(p.value->>'name'))in('RAJA','RAJALOTTERY')then'RAJA'end display_key,
   jsonb_array_length(t.t->'platforms')=0 is_all
  from targets t cross join lateral jsonb_array_elements(j.catalog)p
  where p.value->>'source'in('ar','newar','kb','lg','game66','duoli','wg')
  and t.t->>'country'=case
   when p.value->>'scope_group'in('HK_TEAM','HONG_KONG','GAME66_HK','香港')then'香港'
   when p.value->>'scope_group'in('RED_CRAB','GAME66_RED_CRAB','紅膏蟹','红膏蟹')then'红膏蟹'
   when p.value->>'scope_group'='BR_PANGHU'then'胖虎巴西'
   else p.value->>'country'end),
 requested as materialized(
  select t.n,p.value platform,private.dashboard_admin_live_deposit_platform_key(t.t->>'country',p.value)key
  from targets t cross join lateral jsonb_array_elements_text(t.t->'platforms')p),
 matches as materialized(
  select c.*,r.platform from candidates c left join requested r on r.n=c.n and r.key in(c.name_key,c.source_key,c.display_key)
  where c.is_all or r.platform is not null),
 selected_teams as materialized(select distinct n,team from matches),
 proof as materialized(select
  -- Count raw requested labels, so aliases must all resolve, even when several
  -- labels refer to the same native identity.
  (select count(*)from requested)wanted,
  (select count(*)from requested r where exists(select 1 from matches m where m.n=r.n and m.platform=r.platform))resolved,
  (select count(*)from targets)targets_wanted,
  (select count(distinct n)from matches)targets_resolved,
  exists(select 1 from matches where zone is null or zone='')unknown_zone,
  -- Explicit platform scopes qualify only when they cover whole known teams
  -- inside each exact target. Arbitrary platform subsets stay non-recurring.
  not exists(select 1 from matches where not is_all and(team is null or team=''or left(team,2)='__'))
  and not exists(select 1 from candidates c join selected_teams s on s.n=c.n and s.team=c.team
   where not c.is_all and not exists(select 1 from matches m where m.n=c.n and m.id=c.id))whole_teams)
 select array_agg(distinct m.zone),max(p.resolved),max(p.wanted),
  bool_and(p.whole_teams and p.targets_resolved=p.targets_wanted),bool_or(p.unknown_zone)
 into zones,resolved,wanted,all_default,has_unknown_zone from proof p left join matches m on true;
 if resolved is distinct from wanted or all_default is not true or has_unknown_zone is not false
 or cardinality(zones)is distinct from 1 or zones[1]is null or zones[1]=''
 or not exists(select 1 from pg_timezone_names where name=zones[1])then return null;end if;
 tz:=zones[1];d:=left(j.request->>'startAt',10)::date;
 if d is null or d not in((clock_timestamp()at time zone tz)::date,(clock_timestamp()at time zone tz)::date-1)then return null;end if;
 if(select count(*)from private.withdraw_prepared_templates)>=100 then return null;end if;
 begin
  perform set_config('lock_timeout','100ms',true);
  -- Existing owner/full-day/account/catalog/capacity/advisory-lock guards stay
  -- authoritative inside this function, including a fresh catalog check.
  tid:=private.withdraw_prepared_register_template(j.id,tz);
 exception when lock_not_available then
  perform set_config('lock_timeout',old_lock,true);return null;
 when raise_exception then
  if sqlerrm not in('withdraw_prepared_template_capacity','withdraw_prepared_template_invalid','withdraw_prepared_timezone_invalid')then raise;end if;
  perform set_config('lock_timeout',old_lock,true);return null;
 end;
 perform set_config('lock_timeout',old_lock,true);return tid;
end;$function$;

