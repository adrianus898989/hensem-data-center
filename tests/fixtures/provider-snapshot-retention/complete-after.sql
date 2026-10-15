create or replace function private.provider_snapshot_complete(p_job_id uuid,p_run_id uuid,p_fence bigint,p_payload jsonb,p_provenance jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare j private.provider_snapshot_jobs%rowtype;s uuid;f timestamptz;e timestamptz;
begin
 select *into j from private.provider_snapshot_jobs where id=p_job_id for update;
 if not found or j.run_id is distinct from p_run_id or j.fence is distinct from p_fence then return jsonb_build_object('published',false,'reason','obsolete');end if;
 if not private.provider_snapshot_kernel_contract_current()then return jsonb_build_object('published',false,'reason','kernel_contract_changed');end if;
 if not private.provider_snapshot_target_current(j.target)then return jsonb_build_object('published',false,'reason','target_changed');end if;
 if j.dependency_token is distinct from private.provider_snapshot_dependency_token(j.target)then return jsonb_build_object('published',false,'reason','dependency_changed');end if;
 if j.status='ready'then
  select a.id into s from private.provider_snapshot_heads h join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
   where h.job_id=j.id and a.run_id=p_run_id and a.fence=p_fence and a.payload=p_payload and a.provenance=p_provenance;
  if found then return jsonb_build_object('published',true,'snapshotId',s,'replayed',true);end if;
  return jsonb_build_object('published',false,'reason','replay_mismatch');
 end if;
 if j.status<>'running'or j.lease_until<=clock_timestamp()then return jsonb_build_object('published',false,'reason','obsolete');end if;
 if jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>4194304 or jsonb_typeof(p_provenance)is distinct from'object'or octet_length(p_provenance::text)>65536
  or p_provenance->'computationComplete'is distinct from'true'::jsonb or jsonb_typeof(p_provenance->'upstreamComplete')is distinct from'boolean'
  or jsonb_typeof(p_provenance->'sourceWatermark')is distinct from'object'
  or jsonb_typeof(p_provenance->'sourceReadStartedAt')is distinct from'string'or jsonb_typeof(p_provenance->'sourceReadCompletedAt')is distinct from'string'
  or p_provenance->>'sourceReadStartedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'or p_provenance->>'sourceReadCompletedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
  or p_provenance?'nextDueAt'and p_provenance->'nextDueAt'<>'null'::jsonb and(jsonb_typeof(p_provenance->'nextDueAt')is distinct from'string'or p_provenance->>'nextDueAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$')
 then raise exception using errcode='22023',message='incomplete_snapshot';end if;
 f:=(p_provenance->>'sourceReadStartedAt')::timestamptz;e:=(p_provenance->>'sourceReadCompletedAt')::timestamptz;
 if not isfinite(f)or not isfinite(e)or e<f or e>clock_timestamp()+interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_provenance';end if;
 if j.component in('orders','submission','intake')then
  if p_payload->'version'is distinct from to_jsonb(case when j.component='submission'then 3 else 1 end) or p_payload#>>'{platform,id}'is distinct from j.target->>'id'
   or p_payload#>>'{platform,source}'is distinct from j.target->>'source'or p_payload#>>'{platform,sourceName}'is distinct from j.target->>'source_name'
   or p_payload#>>'{platform,scopeGroup}'is distinct from j.target->>'scope_group'or p_payload#>>'{platform,currency}'is distinct from j.target->>'currency'
   or p_payload#>>'{platform,timezone}'is distinct from j.target->>'timezone'
   or(case when j.component='intake'then p_payload#>>'{snapshotWindow,startAt}'else p_payload->>'startAt'end)::timestamptz is distinct from j.window_from or(case when j.component='intake'then p_payload#>>'{snapshotWindow,endAt}'else p_payload->>'endAt'end)::timestamptz is distinct from j.window_to
  then raise exception using errcode='22023',message='snapshot_scope_mismatch';end if;
 end if;
 if j.component='orders'and(jsonb_typeof(p_payload->'summary')is distinct from'array'or jsonb_typeof(p_payload#>'{groups,provider}')is distinct from'array'or p_payload->'rows'is distinct from'[]'::jsonb)then raise exception using errcode='22023',message='invalid_orders_snapshot';end if;
 if j.component='submission'and(jsonb_typeof(p_payload->'metrics')is distinct from'array'or jsonb_typeof(p_payload->'coverage')is distinct from'object'
  or p_payload->'rows'is not null and p_payload->'rows'<>'null'::jsonb or p_payload->'members'is not null and p_payload->'members'<>'null'::jsonb)then raise exception using errcode='22023',message='invalid_submission_snapshot';end if;
 if j.component='intake'and(p_payload->'version'is distinct from'1'::jsonb or jsonb_typeof(p_payload->'rows')is distinct from'array')then raise exception using errcode='22023',message='invalid_intake_snapshot';end if;
 -- Independent atomic quota admission is enforced by the table accounting trigger.
 insert into private.provider_snapshot_artifacts(job_id,run_id,fence,revision,dependency_token,payload,payload_hash,stored_bytes,provenance,next_due_at)
 values(j.id,j.run_id,j.fence,j.revision,j.dependency_token,p_payload,md5(p_payload::text),octet_length(p_payload::text)+octet_length(p_provenance::text),p_provenance,coalesce(j.next_due_at,case when jsonb_typeof(p_provenance->'nextDueAt')='string'then(p_provenance->>'nextDueAt')::timestamptz end))returning id into s;
 insert into private.provider_snapshot_heads(job_id,snapshot_id)values(j.id,s)on conflict(job_id)do update set snapshot_id=excluded.snapshot_id,published_at=clock_timestamp();
 update private.provider_snapshot_jobs set status='ready',lease_until=null,worker=null,last_error_code=null,updated_at=clock_timestamp(),
 next_due_at=coalesce(next_due_at,case when jsonb_typeof(p_provenance->'nextDueAt')='string'then(p_provenance->>'nextDueAt')::timestamptz end) where id=j.id;
 return jsonb_build_object('published',true,'snapshotId',s);
end;$fn$;
revoke all on function private.provider_snapshot_complete(uuid,uuid,bigint,jsonb,jsonb)from public,anon,authenticated,service_role;

