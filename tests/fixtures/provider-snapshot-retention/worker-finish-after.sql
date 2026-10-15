-- Private one-component computation after a separately COMMITTED claim.
-- The caller must establish the top-level 50s deadline before this statement.
CREATE OR REPLACE FUNCTION private.provider_snapshot_run_claimed(p_worker text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $worker$
declare j private.provider_snapshot_jobs%rowtype;x jsonb;r jsonb;code text;budget interval;claimed jsonb;backend_started timestamptz;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='provider_snapshot_worker_denied';end if;
 if p_worker is null or p_worker!~'^[-a-zA-Z0-9_:]{1,80}$'then raise exception using errcode='22023',message='invalid_snapshot_worker';end if;
 if current_setting('transaction_isolation')<>'read committed'then raise exception using errcode='22023',message='provider_snapshot_read_committed_required';end if;
 budget:=current_setting('statement_timeout')::interval;
 if budget<=interval'0 seconds'or budget>interval'50 seconds'then raise exception using errcode='22023',message='provider_snapshot_outer_deadline_required';end if;
 claimed:=nullif(current_setting('provider_snapshot.claim',true),'')::jsonb;
 if claimed is null then return jsonb_build_object('status','idle');end if;
 select backend_start into backend_started from pg_catalog.pg_stat_activity where pid=pg_backend_pid();
 if claimed->>'worker'is distinct from p_worker or claimed->>'pid'is distinct from pg_backend_pid()::text
  or(claimed->>'backendStart')::timestamptz is distinct from backend_started then raise exception using errcode='42501',message='provider_snapshot_claim_connection_changed';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into j from private.provider_snapshot_jobs where id=(claimed->>'jobId')::uuid and run_id=(claimed->>'runId')::uuid and fence=(claimed->>'fence')::bigint
  and worker=p_worker and status='running'and lease_until>clock_timestamp()
  and claim_backend_pid=pg_backend_pid()and claim_backend_start=backend_started for update skip locked;
 if not found then perform set_config('provider_snapshot.claim','',false);return jsonb_build_object('status','idle');end if;
 perform set_config('provider_snapshot.claim','',false);
 begin
  -- A STABLE expression reads all source rows from one consistent SQL snapshot.
  select private.provider_snapshot_compute_payload(j.target,j.request,j.component)into x;
  if x#>'{provenance,computationComplete}'is distinct from'true'::jsonb then raise exception using errcode='22023',message='provider_snapshot_incomplete_result';end if;
  -- Fresh READ COMMITTED SPI visibility; the durable attempt is never reset.
  r:=private.provider_snapshot_complete(j.id,j.run_id,j.fence,x->'payload',x->'provenance');
  -- Only a still-owned active claim may record these configuration failures.
  -- The existing fail() enforces run/fence/status/lease and preserves attempts,
  -- revision and the last-good head. Obsolete/replay paths never invoke fail().
  if r->'published' is distinct from 'true'::jsonb
    and r->>'reason' in ('dependency_changed','kernel_contract_changed','target_changed') then
   perform private.provider_snapshot_fail(j.id,j.run_id,j.fence,'dependency_changed');
  end if;
  return jsonb_build_object('status',case when r->'published'='true'::jsonb then'published'else'superseded'end,'jobId',j.id,'snapshotId',r->'snapshotId')
   || case when r->'published' is distinct from 'true'::jsonb
      and r->>'reason' in ('dependency_changed','kernel_contract_changed','target_changed','obsolete','replay_mismatch')
     then jsonb_build_object('reason',r->>'reason') else '{}'::jsonb end;
 exception
  when query_canceled then
   -- Roll back this compute transaction only. The earlier claim and its attempt
   -- survive; lease expiry is reclaimed fairly or parked after the third attempt.
   raise;
  when others then
   code:=case when SQLSTATE='40001'then'dependency_changed'when SQLERRM='provider_snapshot_incomplete_result'then'source_incomplete'else'compute_failed'end;
   perform private.provider_snapshot_fail(j.id,j.run_id,j.fence,code);
   return jsonb_build_object('status','failed','jobId',j.id,'errorCode',code);
 end;
end;$worker$;
REVOKE ALL ON FUNCTION private.provider_snapshot_run_claimed(text) FROM PUBLIC,anon,authenticated,service_role;
