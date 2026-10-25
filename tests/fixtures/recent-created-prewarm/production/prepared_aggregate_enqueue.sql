CREATE OR REPLACE FUNCTION private.prepared_aggregate_enqueue(q jsonb, t jsonb, dep text, p_priority smallint DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare k jsonb:=private.prepared_aggregate_key(q,t);j private.prepared_aggregate_jobs%rowtype;
begin
 if private.prepared_aggregate_request_reason(q,t)is not null then raise exception using errcode='22023',message='prepared_request_unsupported';end if;
 select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k for update;
 if found then
  update private.prepared_aggregate_jobs set last_requested_at=clock_timestamp(),priority=greatest(priority,p_priority),
   revision=revision+case when dependency<>dep or target<>t then 1 else 0 end,
   status=case when dependency<>dep or target<>t or last_error='superseded_by_full_master' then 'queued' when status='failed'and attempts<3 and not_before<=clock_timestamp()then'queued'else status end,
   attempts=case when dependency<>dep or target<>t or last_error='superseded_by_full_master' then 0 else attempts end,dependency=dep,target=t,not_before=case when dependency<>dep or target<>t or last_error='superseded_by_full_master' then clock_timestamp()else not_before end,
   last_error=case when last_error='superseded_by_full_master'then null else last_error end,
   lease_until=case when dependency<>dep or target<>t then null else lease_until end where id=j.id;
  return j.id;
 end if;
 if not pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_admission_v1',0))then return null;end if;
 if (select count(*)from(select 1 from private.prepared_aggregate_jobs limit 10000)s)>=10000 then return null;end if;
 insert into private.prepared_aggregate_jobs(request_key,target,request,dependency,priority)values(k,t,q,dep,p_priority)
 on conflict(request_fingerprint)do update set last_requested_at=excluded.last_requested_at where private.prepared_aggregate_jobs.request_key=excluded.request_key returning id into j.id;
 return j.id;
end;$function$

