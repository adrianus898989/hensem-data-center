CREATE OR REPLACE FUNCTION private.withdraw_prepared_read(q jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s jsonb;c jsonb;r jsonb;k jsonb;dep text;j private.withdraw_prepared_jobs%rowtype;a private.withdraw_prepared_artifacts%rowtype;budget integer;v_admitted uuid;v_status text;v_refresh text;v_at timestamptz:=clock_timestamp();progress jsonb;last_complete jsonb;
BEGIN
 -- The original native auth/session/IP/scope checks remain live on every read.
 PERFORM private.withdraw_prepared_validate(private.withdraw_window_legacy(q));s:=private.dashboard_admin_live_scope();
 SELECT coalesce(jsonb_agg(to_jsonb(p)ORDER BY p.id),'[]')INTO c FROM private.dashboard_admin_live_platforms()p;
 IF NOT private.withdraw_prepared_source_contract_current()THEN RETURN jsonb_build_object('prepared',jsonb_build_object('status','failed','reason','source_contract_changed','contract','withdraw-independent-windows-v2'),'rows',null,'totals',null,'total',null);END IF;
 r:=private.withdraw_prepared_canonical(q);c:=private.dashboard_withdraw_country_catalog(r,c);k:=jsonb_build_array('withdraw-independent-windows-v2',s,c,r);dep:=private.withdraw_prepared_dependency();
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
 -- NPG empty-template serving: exact authorized singleton only.
 last_complete:=private.dashboard_withdraw_npg_template_read(q,r,s,c,dep);
 IF last_complete IS NOT NULL THEN RETURN last_complete;END IF;
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
 last_complete:=private.dashboard_withdraw_country_last_complete(q,r,s,c,dep,j.status);
 IF last_complete IS NOT NULL THEN RETURN last_complete;END IF;
 RETURN jsonb_build_object('prepared',jsonb_build_object('status',v_status,'contract','withdraw-independent-windows-v2','computedAt',a.computed_at,'expiresAt',a.expires_at)||CASE WHEN progress IS NOT NULL THEN jsonb_build_object('progress',progress)ELSE '{}'::jsonb END,'rows',null,'totals',null,'total',null);
END;$function$

