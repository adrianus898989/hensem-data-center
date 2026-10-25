CREATE OR REPLACE FUNCTION private.prepared_aggregate_retire_replaced(q jsonb, t jsonb, baseq jsonb, dep text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare oldkey jsonb:=private.prepared_aggregate_key(q,t);basekey jsonb:=private.prepared_aggregate_key(baseq,t);n integer;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if oldkey=basekey then return false;end if;
 if not exists(select 1 from private.prepared_aggregate_jobs j join private.prepared_aggregate_heads h on h.job_id=j.id join private.prepared_aggregate_artifacts a on a.id=h.artifact_id
  where j.request_fingerprint=md5(basekey::text)and j.request_key=basekey and j.target=t and j.dependency=dep and a.dependency=dep and a.revision=j.revision and a.expires_at>clock_timestamp())then return false;end if;
 update private.prepared_aggregate_jobs set status='failed',attempts=3,last_error='superseded_by_full_master',next_due_at=null,lease_until=null
 where request_fingerprint=md5(oldkey::text)and request_key=oldkey and target=t and status<>'running'and last_error is distinct from'superseded_by_full_master';
 get diagnostics n=row_count;return n>0;
end;$function$

