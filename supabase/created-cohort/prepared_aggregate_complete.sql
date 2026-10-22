CREATE OR REPLACE FUNCTION private.prepared_aggregate_complete(p_job uuid, p_run uuid, p_fence bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j private.prepared_aggregate_jobs%rowtype;aid uuid;dep text;computed timestamptz:=clock_timestamp();cutoff timestamptz;expires timestamptz;bytes integer;secondary text;missing_direction text;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 select *into j from private.prepared_aggregate_jobs where id=p_job for update;
 if not found or j.status<>'running'or j.run_id is distinct from p_run or j.fence<>p_fence or j.lease_until<=clock_timestamp()then return jsonb_build_object('published',false,'reason','obsolete_claim');end if;
 dep:=private.prepared_aggregate_dependency(j.target);
 if dep<>j.dependency or not private.prepared_aggregate_target_current(j.target)then
  update private.prepared_aggregate_jobs set status='queued',revision=revision+1,dependency=dep,lease_until=null,not_before=clock_timestamp(),attempts=0 where id=j.id;
  return jsonb_build_object('published',false,'reason','dependency_changed');end if;
 bytes:=octet_length(p_payload::text);
 if p_payload is null or jsonb_typeof(p_payload)<>'object'or bytes>4194304
 or p_payload->>'version'is distinct from '1'or p_payload->'rows'is distinct from '[]'::jsonb
 or jsonb_typeof(p_payload->'summary')is distinct from'array'or jsonb_typeof(p_payload->'groups')is distinct from'object'
 or jsonb_typeof(p_payload#>'{groups,provider}')is distinct from'array'
 or p_payload->'partial'='true'::jsonb or p_payload->'complete'='false'::jsonb or p_payload?'error'
 or exists(select 1 from jsonb_each(p_payload->'groups')x where jsonb_typeof(x.value)<>'array')
 or p_payload->>'successBasis'is distinct from coalesce(j.request->>'successBasis',case when j.target->>'source'='duoli'then'source_updated'else'success'end)
 or(j.request->>'durationVersion'='2'and p_payload->>'durationVersion'is distinct from'2')
 or(j.request?'durationRange'and p_payload->'durationRange'is distinct from j.request->'durationRange')
 or(coalesce(j.request->>'view','full')='full'and not(p_payload->'groups'?&array['provider','hourly','daily','amount','matrix','latency','pending_age']))
 or p_payload#>>'{platform,id}'is distinct from j.target->>'id'
 or p_payload#>>'{platform,source}'is distinct from j.target->>'source'
 or p_payload#>>'{platform,sourceName}'is distinct from j.target->>'source_name'
 or p_payload#>>'{platform,country}'is distinct from j.target->>'country'
 or p_payload#>>'{platform,scopeGroup}'is distinct from j.target->>'scope_group'
 or p_payload#>>'{platform,currency}'is distinct from j.target->>'currency'
 or p_payload#>>'{platform,timezone}'is distinct from j.target->>'timezone'
 or(p_payload->>'startAt')::timestamptz is distinct from(j.request->>'startAt')::timestamptz
 or(p_payload->>'endAt')::timestamptz is distinct from(j.request->>'endAt')::timestamptz
 or(case when j.request->>'successBasis'='created'then p_payload?'successStartAt'or p_payload?'successEndAt'
   or p_payload#>>'{capabilities,successCohort}'is distinct from'created_at_current_stored_status'
   or p_payload#>'{capabilities,independentSuccessWindow}'is distinct from'false'::jsonb
  else(p_payload->>'successStartAt')::timestamptz is distinct from coalesce(j.request->>'successStartAt',j.request->>'startAt')::timestamptz
   or(p_payload->>'successEndAt')::timestamptz is distinct from coalesce(j.request->>'successEndAt',j.request->>'endAt')::timestamptz end)
 then raise exception using errcode='22023',message='prepared_incomplete_or_scope_mismatch';end if;
 secondary:=private.prepared_aggregate_secondary_reason(j.request,j.target);
 if secondary is not null then
  missing_direction:=case when j.target->>'source'='wg'and coalesce(j.request->>'direction','all')='all'then'withdraw'when j.target->>'source'='game66'and j.request->>'successBasis'='source_updated'and coalesce(j.request->>'direction','all')='all'then'charge'else'all'end;
  if private.prepared_aggregate_mask_secondary(p_payload,secondary,missing_direction)is distinct from p_payload or(j.request->>'status'='success'and(p_payload->'total'is distinct from'null'::jsonb or p_payload->'hasMore'is distinct from'null'::jsonb))then raise exception using errcode='22023',message='prepared_missing_secondary_capability';end if;
 end if;
 cutoff:=(p_payload->>'asOf')::timestamptz;
 if cutoff is null or not isfinite(cutoff)or cutoff>computed or cutoff<computed-interval'2minutes'then raise exception using errcode='22023',message='prepared_invalid_cutoff';end if;
 -- Current/mutable dates get ten-minute freshness; closed requests six hours.
 expires:=computed+case when greatest((j.request->>'endAt')::timestamptz,coalesce(j.request->>'successEndAt',j.request->>'endAt')::timestamptz)>computed-interval'24hours'then interval'10minutes'else interval'6hours'end;
 if(select coalesce(sum(a0.bytes),0)from private.prepared_aggregate_artifacts a0)+bytes>536870912 then raise exception using errcode='54000',message='prepared_storage_budget';end if;
 insert into private.prepared_aggregate_artifacts(job_id,run_id,fence,revision,dependency,payload,computed_at,expires_at,cutoff,source_complete,bytes)
 values(j.id,p_run,p_fence,j.revision,dep,p_payload,computed,expires,cutoff,false,bytes)returning id into aid;
 insert into private.prepared_aggregate_heads(job_id,artifact_id)values(j.id,aid)on conflict(job_id)do update set artifact_id=excluded.artifact_id;
 update private.prepared_aggregate_jobs set status='ready',lease_until=null,next_due_at=coalesce(private.prepared_aggregate_scheduled_due(j.request,j.target,computed,computed),expires-interval'2minutes'),attempts=0,last_error=null where id=j.id;
 return jsonb_build_object('published',true,'id',aid,'generation',j.revision::text||':'||j.fence::text);
end;$function$
