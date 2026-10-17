-- Synthetic local-only scale fixture: 90 real-protocol anchor heads plus the
-- requested bounded number (default 1,494) of
-- historical heads. No source orders, credentials, production data or network.
-- The completed-head seed uses the actual tables, immutability and quota triggers.
with targets as materialized(select target,private.provider_snapshot_dependency_token(target)dep from private.provider_snapshot_targets),
windows as(select t.*,g,coalesce(nullif(current_setting('yash.test_component',true),''),case when coalesce(nullif(current_setting('yash.test_extra_count',true),''),'1494')::integer>=2102
 then case when g<=46 then'orders'when g<=70 then'submission'else'intake'end
 else case when g<=50 then case when g%2=0 then'orders'else'submission'end else'intake'end end)component,
 (coalesce(nullif(current_setting('yash.test_base_date',true),''),'2025-01-01')::date+g)::timestamp at time zone'Asia/Kolkata'f,
 ((coalesce(nullif(current_setting('yash.test_base_date',true),''),'2025-01-01')::date+g+1)::timestamp at time zone'Asia/Kolkata')-case when current_setting('yash.test_hot',true)='true'then interval'1minute'else interval'0'end e,
 row_number()over(order by g,(t.target->>'source'='kb')desc,t.target->>'id')ordinal from targets t cross join generate_series(1,ceil(coalesce(nullif(current_setting('yash.test_extra_count',true),''),'1494')::numeric/18)::integer)g),
requests as(select *,jsonb_build_object('action','aggregate','view','providers','platformId',target->'id',
 'startAt',private.provider_snapshot_iso(f),'endAt',private.provider_snapshot_iso(e),'direction','charge','status','all','currency','INR','offset',0,'limit',20)q from windows where ordinal<=coalesce(nullif(current_setting('yash.test_extra_count',true),''),'1494')::integer),
jobs as(insert into private.provider_snapshot_jobs(request_key,target,request,component,platform_id,window_from,window_to,dependency_token,status,run_id,fence)
 select jsonb_build_object('version',1,'target',target,'component',component,'request',q),target,q,component,(target->>'id')::uuid,f,e,dep,'ready',gen_random_uuid(),1 from requests returning *),
data as(select j.*,jsonb_build_object('version',case component when'submission'then 3 else 1 end,
 'platform',jsonb_build_object('id',target->'id','source',target->'source','sourceName',target->'source_name','scopeGroup',target->'scope_group','currency',target->'currency','timezone',target->'timezone'),
 'startAt',request->'startAt','endAt',request->'endAt','syntheticPadding',repeat('x',coalesce(nullif(current_setting('yash.test_padding',true),''),'12000')::integer))||
 case component when'orders'then jsonb_build_object('summary','[]'::jsonb,'groups',jsonb_build_object('provider','[]'::jsonb),'rows','[]'::jsonb)
 when'submission'then jsonb_build_object('metrics','[]'::jsonb,'coverage','{}'::jsonb,'rows',null,'members',null)
 else jsonb_build_object('snapshotWindow',jsonb_build_object('startAt',request->'startAt','endAt',request->'endAt'),'rows','[]'::jsonb)end payload,
 jsonb_build_object('computationComplete',true,'upstreamComplete',false,'sourceWatermark',jsonb_build_object('kind','synthetic-original'),
 'sourceReadStartedAt',private.provider_snapshot_iso(clock_timestamp()),'sourceReadCompletedAt',private.provider_snapshot_iso(clock_timestamp()))provenance from jobs j),
artifacts as(insert into private.provider_snapshot_artifacts(job_id,run_id,fence,revision,dependency_token,payload,payload_hash,stored_bytes,provenance)
 select id,run_id,fence,revision,dependency_token,payload,md5(payload::text),octet_length(payload::text)+octet_length(provenance::text),provenance from data returning id,job_id)
insert into private.provider_snapshot_heads(job_id,snapshot_id)select job_id,id from artifacts;
