-- Synthetic protocol fixtures only. Real identity, quota, immutability and
-- persistent-class triggers run on every row; no source-business rows exist.
with c as materialized(select *from private.provider_snapshot_cohorts where id=current_setting('test.cohort')::uuid),
t as materialized(select t.target,private.provider_snapshot_dependency_token(t.target)dep from private.provider_snapshot_targets t),
slots as(select t.*,v.component,((c.local_date-v.prior)::timestamp at time zone'Asia/Kolkata')f,
 ((c.cutoff at time zone'Asia/Kolkata')-v.prior*interval'1day')at time zone'Asia/Kolkata'e
 from c cross join t cross join(values('orders',0),('orders',1),('intake',0),('intake',1),('submission',0))v(component,prior)),
q as(select *,jsonb_build_object('action','aggregate','view','providers','platformId',target->'id','startAt',private.provider_snapshot_iso(f),'endAt',private.provider_snapshot_iso(e),'direction','charge','status','all','currency','INR','offset',0,'limit',20)request from slots),
jobs as(insert into private.provider_snapshot_jobs(request_key,target,request,component,platform_id,window_from,window_to,dependency_token,status,run_id,fence)
 select jsonb_build_object('version',1,'target',target,'component',component,'request',request),target,request,component,(target->>'id')::uuid,f,e,dep,'ready',gen_random_uuid(),1 from q on conflict(request_key)do nothing returning *),
data as(select j.*,jsonb_build_object('version',case component when'submission'then 3 else 1 end,'platform',jsonb_build_object('id',target->'id','source',target->'source','sourceName',target->'source_name','scopeGroup',target->'scope_group','currency',target->'currency','timezone',target->'timezone'),'startAt',request->'startAt','endAt',request->'endAt')||
 case component when'orders'then jsonb_build_object('summary','[]'::jsonb,'groups',jsonb_build_object('provider','[]'::jsonb),'rows','[]'::jsonb)
 when'submission'then jsonb_build_object('metrics','[]'::jsonb,'coverage','{}'::jsonb,'rows',null,'members',null)
 else jsonb_build_object('snapshotWindow',jsonb_build_object('startAt',request->'startAt','endAt',request->'endAt'),'rows','[]'::jsonb)end payload,
 jsonb_build_object('computationComplete',true,'upstreamComplete',false,'sourceWatermark',jsonb_build_object('kind','synthetic'),'sourceReadStartedAt',private.provider_snapshot_iso(clock_timestamp()),'sourceReadCompletedAt',private.provider_snapshot_iso(clock_timestamp()))provenance from jobs j),
a as(insert into private.provider_snapshot_artifacts(job_id,run_id,fence,revision,dependency_token,payload,payload_hash,stored_bytes,provenance,computed_at)
 select id,run_id,fence,revision,dependency_token,payload,md5(payload::text),octet_length(payload::text)+octet_length(provenance::text),provenance,clock_timestamp()-interval'2hours'from data returning id,job_id)
insert into private.provider_snapshot_heads(job_id,snapshot_id)select job_id,id from a;
insert into private.provider_snapshot_cohort_jobs
select c.id,j.id from private.provider_snapshot_cohorts c join private.provider_snapshot_jobs j on c.targets@>jsonb_build_array(j.target)
 and(j.window_from=c.local_date::timestamp at time zone'Asia/Kolkata'and j.window_to=c.cutoff
 or j.component<>'submission'and j.window_from=(c.local_date-1)::timestamp at time zone'Asia/Kolkata'
 and j.window_to=((c.cutoff at time zone'Asia/Kolkata')-interval'1day')at time zone'Asia/Kolkata')
where c.id=current_setting('test.cohort')::uuid;
