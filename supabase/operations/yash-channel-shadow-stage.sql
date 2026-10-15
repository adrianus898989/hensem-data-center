-- One-time, internal deployment staging. No cron, new worker, auth bypass or source writes.
-- All published jobs/heads remain untouched until preflight + migration + promote commit.
do $clone$
declare spec jsonb;definition text;pair jsonb;
begin
 if current_user<>'postgres' then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 perform private.yash_channel_shadow_dependency_token('{}');
 if not private.provider_snapshot_kernel_contract_current()then raise exception 'yash_shadow_kernel_changed';end if;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid='private.provider_snapshot_complete(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure
   and md5(p.prosrc)='86a3e91204ae4bfc540b5685caa4cf7d'and pg_get_userbyid(p.proowner)='postgres'
   and not p.prosecdef and p.provolatile='v'and p.proconfig=array['search_path=""']
   and p.prorettype='jsonb'::regtype and p.proacl::text='{postgres=X/postgres}'and l.lanname='plpgsql')
 then raise exception 'yash_shadow_completion_contract_changed';end if;
 for spec in select value from jsonb_array_elements('[
 {"old":"dashboard_admin_yash_order_source","args":"","new":"yash_channel_shadow_order_source","replace":[["private.dashboard_admin_yash_provider(y.supplier) as provider","private.yash_channel_shadow_order_provider(y.order_type,y.supplier,y.channel) as provider"]]},
 {"old":"provider_snapshot_orders_raw_kernel","args":"jsonb,jsonb","new":"yash_channel_shadow_orders_raw_kernel","replace":[["private.dashboard_admin_yash_order_source()","private.yash_channel_shadow_order_source()"]]},
 {"old":"provider_snapshot_submission_kernel","args":"jsonb,jsonb","new":"yash_channel_shadow_submission_kernel","replace":[["private.dashboard_admin_yash_provider(y.supplier)","private.yash_channel_shadow_order_provider(y.order_type,y.supplier,y.channel)"]]},
 {"old":"provider_snapshot_compute_payload","args":"jsonb,jsonb,text","new":"yash_channel_shadow_compute_payload","replace":[["private.provider_snapshot_orders_raw_kernel(","private.yash_channel_shadow_orders_raw_kernel("],["private.provider_snapshot_submission_kernel(","private.yash_channel_shadow_submission_kernel("]]}
 ]'::jsonb)loop
  definition:=pg_get_functiondef(to_regprocedure('private.'||(spec->>'old')||'('||(spec->>'args')||')'));
  if definition is null then raise exception 'yash_shadow_missing_source';end if;
  definition:=replace(definition,'FUNCTION private.'||(spec->>'old')||'(','FUNCTION private.'||(spec->>'new')||'(');
  for pair in select value from jsonb_array_elements(spec->'replace')loop
   if (length(definition)-length(replace(definition,pair->>0,'')))/length(pair->>0)<>1 then raise exception 'yash_shadow_clone_anchor_changed: %',spec->>'old';end if;
   definition:=replace(definition,pair->>0,pair->>1);
  end loop;
  execute definition;
  execute 'revoke all on function private.'||(spec->>'new')||'('||(spec->>'args')||') from public,anon,authenticated,service_role';
 end loop;
 -- Retain the complete installed per-item publication protocol. Only its three
 -- repeated semantic checks use this transaction's verified 18-target context.
 definition:=pg_get_functiondef('private.provider_snapshot_complete(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure);
 definition:=replace(definition,'FUNCTION private.provider_snapshot_complete(','FUNCTION private.yash_channel_shadow_complete(');
 if (length(definition)-length(replace(definition,$guards$ if not private.provider_snapshot_kernel_contract_current()then return jsonb_build_object('published',false,'reason','kernel_contract_changed');end if;
 if not private.provider_snapshot_target_current(j.target)then return jsonb_build_object('published',false,'reason','target_changed');end if;
 if j.dependency_token is distinct from private.provider_snapshot_dependency_token(j.target)then return jsonb_build_object('published',false,'reason','dependency_changed');end if;$guards$,'')))/length($guards$ if not private.provider_snapshot_kernel_contract_current()then return jsonb_build_object('published',false,'reason','kernel_contract_changed');end if;
 if not private.provider_snapshot_target_current(j.target)then return jsonb_build_object('published',false,'reason','target_changed');end if;
 if j.dependency_token is distinct from private.provider_snapshot_dependency_token(j.target)then return jsonb_build_object('published',false,'reason','dependency_changed');end if;$guards$)<>1
 then raise exception 'yash_shadow_completion_anchor_changed';end if;
 definition:=replace(definition,$guards$ if not private.provider_snapshot_kernel_contract_current()then return jsonb_build_object('published',false,'reason','kernel_contract_changed');end if;
 if not private.provider_snapshot_target_current(j.target)then return jsonb_build_object('published',false,'reason','target_changed');end if;
 if j.dependency_token is distinct from private.provider_snapshot_dependency_token(j.target)then return jsonb_build_object('published',false,'reason','dependency_changed');end if;$guards$,
 $verified$ if not private.yash_channel_shadow_completion_context(p_run_id,j.target,j.dependency_token)then return jsonb_build_object('published',false,'reason','unverified_release_context');end if;$verified$);
 execute definition;
 revoke all on function private.yash_channel_shadow_complete(uuid,uuid,bigint,jsonb,jsonb)from public,anon,authenticated,service_role;
end;$clone$;

create table private.yash_channel_shadow_batches(
 id uuid primary key default gen_random_uuid(),status text not null default 'staging' check(status in('staging','promoted')),
 targets jsonb not null,tokens jsonb not null,head_manifest jsonb not null default '[]',anchor_cohort uuid,
 clone_fingerprint text not null,promotion_xid text,completion_verified_xid text,created_at timestamptz not null default clock_timestamp(),promoted_at timestamptz
);
create table private.yash_channel_shadow_items(
 batch_id uuid not null references private.yash_channel_shadow_batches(id),job_id uuid not null,source_snapshot uuid not null,
 source_job jsonb not null,source_artifact jsonb not null,future_token text not null,
 mode text not null check(mode in('reuse_equivalent','recompute_yash')),
 payload jsonb,provenance jsonb,prepared_at timestamptz,new_snapshot uuid,
 primary key(batch_id,job_id),check((payload is null)=(provenance is null))
);
alter table private.yash_channel_shadow_batches enable row level security;
alter table private.yash_channel_shadow_items enable row level security;
revoke all on private.yash_channel_shadow_batches,private.yash_channel_shadow_items from public,anon,authenticated,service_role;

create function private.yash_channel_shadow_completion_context(p_batch uuid,p_target jsonb,p_dependency text)returns boolean language sql stable security invoker set search_path=''as $fn$
 select current_user='postgres'and exists(select 1 from private.yash_channel_shadow_batches b
  where b.id=p_batch and b.status='staging'and b.promotion_xid=pg_current_xact_id()::text
   and b.completion_verified_xid=b.promotion_xid and exists(select 1 from jsonb_array_elements(b.targets)t where t=p_target)
   and p_dependency=b.tokens#>>array[p_target->>'id','after']);
$fn$;
revoke all on function private.yash_channel_shadow_completion_context(uuid,jsonb,text)from public,anon,authenticated,service_role;

create function private.yash_channel_shadow_fingerprint()returns text language sql stable security invoker set search_path='' as $fn$
 select md5(coalesce(jsonb_agg(to_jsonb(p)-'oid' order by p.proname)::text,'')) from pg_proc p
 where p.pronamespace='private'::regnamespace and p.proname in('yash_channel_shadow_order_provider','yash_channel_shadow_order_source','yash_channel_shadow_orders_raw_kernel','yash_channel_shadow_submission_kernel','yash_channel_shadow_compute_payload','yash_channel_shadow_dependency_token','yash_channel_shadow_complete','yash_channel_shadow_completion_context','provider_snapshot_complete');
$fn$;
revoke all on function private.yash_channel_shadow_fingerprint()from public,anon,authenticated,service_role;
create function private.yash_channel_shadow_head_manifest()returns jsonb language sql stable security invoker set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_array(h.job_id,h.snapshot_id,to_jsonb(j))order by h.job_id),'[]'::jsonb)
 from private.provider_snapshot_heads h join private.provider_snapshot_jobs j on j.id=h.job_id;
$fn$;
revoke all on function private.yash_channel_shadow_head_manifest()from public,anon,authenticated,service_role;

create function private.yash_channel_shadow_cohort_valid(p_batch uuid,p_cohort uuid)returns boolean language sql stable security invoker set search_path=''as $fn$
 select exists(select 1 from private.yash_channel_shadow_batches b join private.provider_snapshot_cohorts c on c.id=p_cohort
 where b.id=p_batch and c.status='ready'and c.targets=b.targets and c.roster_token=md5(b.targets::text)
 and(select count(*)from private.provider_snapshot_cohort_jobs where cohort_id=c.id)=90
 and not exists(select 1 from jsonb_array_elements(b.targets)t
  cross join(values('orders',0),('orders',1),('intake',0),('intake',1),('submission',0))expected(component,prior)
  where not exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.yash_channel_shadow_items i on i.batch_id=b.id and i.job_id=cj.job_id
   where cj.cohort_id=c.id and i.source_job->'target'=t and i.source_job->>'component'=expected.component
    and(i.source_job->>'window_from')::timestamptz=(c.local_date-expected.prior)::timestamp at time zone'Asia/Kolkata'
    and(i.source_job->>'window_to')::timestamptz=((c.cutoff at time zone'Asia/Kolkata')-make_interval(days=>expected.prior))at time zone'Asia/Kolkata')));
$fn$;
revoke all on function private.yash_channel_shadow_cohort_valid(uuid,uuid)from public,anon,authenticated,service_role;

create function private.yash_channel_shadow_refresh(p_batch uuid)returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare b private.yash_channel_shadow_batches%rowtype;r jsonb;t jsonb;manifest jsonb;c uuid;changed integer;total integer;
begin
 if current_user<>'postgres'then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 select *into b from private.yash_channel_shadow_batches where id=p_batch for update;
 if not found or b.status<>'staging'then raise exception 'yash_shadow_invalid_stage';end if;
 if b.clone_fingerprint<>private.yash_channel_shadow_fingerprint()then raise exception 'yash_shadow_clone_changed';end if;
 select coalesce(jsonb_agg(target order by platform_id),'[]')into r from private.provider_snapshot_targets where enabled and private.provider_snapshot_target_current(target);
 if r<>b.targets then raise exception 'yash_shadow_roster_changed';end if;
 for t in select value from jsonb_array_elements(r)loop
  if private.provider_snapshot_dependency_token(t) is distinct from b.tokens#>>array[t->>'id','before']
   or private.yash_channel_shadow_dependency_token(t) is distinct from b.tokens#>>array[t->>'id','after'] then raise exception 'yash_shadow_dependency_changed';end if;
 end loop;
 manifest:=private.yash_channel_shadow_head_manifest();
 -- One INSERT statement observes one MVCC snapshot. Reset only source jobs that drifted.
 insert into private.yash_channel_shadow_items(batch_id,job_id,source_snapshot,source_job,source_artifact,future_token,mode)
 select b.id,j.id,a.id,to_jsonb(j),to_jsonb(a),b.tokens#>>array[j.target->>'id','after'],
  case when j.target->>'source'='kb'and j.target->>'source_name'='YASH.BET'and j.component in('orders','submission')then'recompute_yash'else'reuse_equivalent'end
 from private.provider_snapshot_jobs j join private.provider_snapshot_heads h on h.job_id=j.id join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
 where j.status='ready'and a.revision=j.revision and a.dependency_token=b.tokens#>>array[j.target->>'id','before']
  and a.provenance->'computationComplete'='true'::jsonb and j.target=any(array(select value from jsonb_array_elements(b.targets)))
 on conflict(batch_id,job_id)do update set source_snapshot=excluded.source_snapshot,source_job=excluded.source_job,source_artifact=excluded.source_artifact,
  future_token=excluded.future_token,mode=excluded.mode,payload=null,provenance=null,prepared_at=null,new_snapshot=null
 where private.yash_channel_shadow_items.source_snapshot is distinct from excluded.source_snapshot or private.yash_channel_shadow_items.source_job is distinct from excluded.source_job;
 get diagnostics changed=row_count;
 delete from private.yash_channel_shadow_items i where i.batch_id=b.id and not exists(
  select 1 from private.provider_snapshot_heads h join private.provider_snapshot_jobs j on j.id=h.job_id join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
  where j.id=i.job_id and h.snapshot_id=i.source_snapshot and j.status='ready'and a.revision=j.revision and a.dependency_token=b.tokens#>>array[j.target->>'id','before']);
 if manifest<>private.yash_channel_shadow_head_manifest()then raise exception 'yash_shadow_refresh_raced';end if;
 select count(*)into total from private.yash_channel_shadow_items where batch_id=b.id;
 if total not between 90 and 2048 then raise exception 'yash_shadow_incomplete_or_oversize';end if;
 -- Require a full existing 18-platform current/previous orders+intake and current submission cohort.
 select x.id into c from private.provider_snapshot_cohorts x where private.yash_channel_shadow_cohort_valid(b.id,x.id)
 order by x.cutoff desc,x.created_at desc limit 1;
 if c is null then raise exception 'yash_shadow_no_complete_cohort';end if;
 update private.yash_channel_shadow_batches set head_manifest=manifest,anchor_cohort=c where id=b.id;
 return jsonb_build_object('batchId',b.id,'items',total,'changedItems',changed,'pending',(select count(*)from private.yash_channel_shadow_items where batch_id=b.id and payload is null));
end;$fn$;
revoke all on function private.yash_channel_shadow_refresh(uuid)from public,anon,authenticated,service_role;

create function private.yash_channel_shadow_begin()returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare r jsonb;t jsonb;tokens jsonb:='{}';id uuid;
begin
 if current_user<>'postgres'then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 if exists(select 1 from private.yash_channel_shadow_batches where status<>'promoted')then raise exception 'yash_shadow_stage_exists';end if;
 select coalesce(jsonb_agg(target order by platform_id),'[]')into r from private.provider_snapshot_targets where enabled and private.provider_snapshot_target_current(target);
 if jsonb_array_length(r)<>18 or not exists(select 1 from jsonb_array_elements(r)entry where entry->>'source'='kb'and entry->>'source_name'='YASH.BET')then raise exception 'yash_shadow_full_roster_required';end if;
 for t in select value from jsonb_array_elements(r)loop
  tokens:=tokens||jsonb_build_object(t->>'id',jsonb_build_object('before',private.provider_snapshot_dependency_token(t),'after',private.yash_channel_shadow_dependency_token(t)));
 end loop;
 insert into private.yash_channel_shadow_batches(targets,tokens,clone_fingerprint)values(r,tokens,private.yash_channel_shadow_fingerprint())returning yash_channel_shadow_batches.id into id;
 return private.yash_channel_shadow_refresh(id);
end;$fn$;
revoke all on function private.yash_channel_shadow_begin()from public,anon,authenticated,service_role;

create function private.yash_channel_shadow_step(p_batch uuid)returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare b private.yash_channel_shadow_batches%rowtype;i private.yash_channel_shadow_items%rowtype;x jsonb;t jsonb;
begin
 if current_user<>'postgres'then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 if current_setting('statement_timeout')::interval<=interval'0'or current_setting('statement_timeout')::interval>interval'50seconds'then raise exception 'yash_shadow_deadline_required';end if;
 select *into b from private.yash_channel_shadow_batches where id=p_batch for update;
 if not found or b.status<>'staging'then raise exception 'yash_shadow_invalid_stage';end if;
 if b.clone_fingerprint<>private.yash_channel_shadow_fingerprint()then raise exception 'yash_shadow_clone_changed';end if;
 select *into i from private.yash_channel_shadow_items where batch_id=b.id and payload is null and mode='recompute_yash'order by job_id for update limit 1;
 if not found then return jsonb_build_object('status',case when exists(select 1 from private.yash_channel_shadow_items where batch_id=b.id and payload is null)then'copy_required'else'prepared'end,'batchId',b.id);end if;
 t:=i.source_job->'target';
 if not private.provider_snapshot_target_current(t)or private.provider_snapshot_dependency_token(t) is distinct from b.tokens#>>array[t->>'id','before']
  or private.yash_channel_shadow_dependency_token(t) is distinct from i.future_token then raise exception 'yash_shadow_dependency_changed';end if;
 if not exists(select 1 from private.provider_snapshot_heads h join private.provider_snapshot_jobs j on j.id=h.job_id where h.job_id=i.job_id and h.snapshot_id=i.source_snapshot and to_jsonb(j)=i.source_job)then return jsonb_build_object('status','refresh_required','jobId',i.job_id);end if;
  if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))
   or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))
   or exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())
   then return jsonb_build_object('status','busy','jobId',i.job_id);end if;
  x:=private.yash_channel_shadow_compute_payload(t,i.source_job->'request',i.source_job->>'component');
 if jsonb_typeof(x->'payload')is distinct from'object'or x#>'{provenance,computationComplete}'is distinct from'true'::jsonb
  or octet_length((x->'payload')::text)>4194304 or octet_length((x->'provenance')::text)>64000 then raise exception 'yash_shadow_invalid_computation';end if;
 x:=jsonb_set(x,'{provenance}',(x->'provenance')||jsonb_build_object('semanticMigration',jsonb_build_object('contract','yash-pair-classification-v1','mode',i.mode,'sourceSnapshotId',i.source_snapshot,'sourcePayloadHash',i.source_artifact->>'payload_hash','preparedAt',private.provider_snapshot_iso(clock_timestamp()))));
 if(select coalesce(sum(octet_length(payload::text)+octet_length(provenance::text)),0)from private.yash_channel_shadow_items)+octet_length(x::text)>268435456 then raise exception 'yash_shadow_capacity';end if;
 update private.yash_channel_shadow_items set payload=x->'payload',provenance=x->'provenance',prepared_at=clock_timestamp()where batch_id=b.id and job_id=i.job_id;
 return jsonb_build_object('status','staged','jobId',i.job_id,'mode',i.mode,'remaining',(select count(*)from private.yash_channel_shadow_items where batch_id=b.id and payload is null));
end;$fn$;
revoke all on function private.yash_channel_shadow_step(uuid)from public,anon,authenticated,service_role;

-- Copy at most 100 unchanged artifacts / 8 MiB in one short transaction. No source read,
-- new watermark or upstream-completeness assertion is made for these artifacts.
create function private.yash_channel_shadow_copy(p_batch uuid,p_limit integer default 100)returns jsonb language plpgsql volatile security invoker set search_path=''as $fn$
declare b private.yash_channel_shadow_batches%rowtype;ids uuid[];t jsonb;n integer;phase integer;
begin
 if current_user<>'postgres'then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 or current_setting('statement_timeout')::interval<=interval'0'or current_setting('statement_timeout')::interval>interval'15seconds'then raise exception 'yash_shadow_copy_budget_required';end if;
 select *into b from private.yash_channel_shadow_batches where id=p_batch for update;
 if not found or b.status<>'staging'then raise exception 'yash_shadow_invalid_stage';end if;
 select array_agg(job_id order by job_id)into ids from(select job_id,sum((source_artifact->>'stored_bytes')::bigint+1024)over(order by job_id)bytes
  from(select job_id,source_artifact from private.yash_channel_shadow_items where batch_id=b.id and mode='reuse_equivalent'and payload is null order by job_id limit p_limit)pending)selected where bytes<=8388608;
 if ids is null then
  if exists(select 1 from private.yash_channel_shadow_items where batch_id=b.id and mode='reuse_equivalent'and payload is null)then raise exception 'yash_shadow_copy_item_oversize';end if;
  return jsonb_build_object('status','copied','items',0,'remaining',0);
 end if;
 for phase in 1..2 loop
  if b.clone_fingerprint<>private.yash_channel_shadow_fingerprint()or not private.provider_snapshot_kernel_contract_current()then raise exception 'yash_shadow_contract_changed';end if;
  for t in select distinct source_job->'target'from private.yash_channel_shadow_items where batch_id=b.id and job_id=any(ids)loop
   if not private.provider_snapshot_target_current(t)or private.provider_snapshot_dependency_token(t)is distinct from b.tokens#>>array[t->>'id','before']
    or private.yash_channel_shadow_dependency_token(t)is distinct from b.tokens#>>array[t->>'id','after']then raise exception 'yash_shadow_dependency_changed';end if;
  end loop;
  if exists(select 1 from private.yash_channel_shadow_items i where i.batch_id=b.id and i.job_id=any(ids)and not exists(select 1 from private.provider_snapshot_heads h join private.provider_snapshot_jobs j on j.id=h.job_id where j.id=i.job_id and h.snapshot_id=i.source_snapshot and to_jsonb(j)=i.source_job))then raise exception 'yash_shadow_refresh_required';end if;
  if phase=1 then
   if exists(select 1 from private.yash_channel_shadow_items i where i.batch_id=b.id and i.job_id=any(ids)
    and(jsonb_typeof(i.source_artifact->'payload')is distinct from'object'or i.source_artifact#>'{provenance,computationComplete}'is distinct from'true'::jsonb
      or octet_length((i.source_artifact->'payload')::text)>4194304 or octet_length((i.source_artifact->'provenance')::text)>64000))then raise exception 'yash_shadow_invalid_computation';end if;
   update private.yash_channel_shadow_items i set payload=i.source_artifact->'payload',
    provenance=(i.source_artifact->'provenance')||jsonb_build_object('semanticMigration',jsonb_build_object('contract','yash-pair-classification-v1','mode',i.mode,'sourceSnapshotId',i.source_snapshot,'sourcePayloadHash',i.source_artifact->>'payload_hash','preparedAt',private.provider_snapshot_iso(clock_timestamp()))),prepared_at=clock_timestamp()
    where i.batch_id=b.id and i.job_id=any(ids);
   get diagnostics n=row_count;
   if(select coalesce(sum(octet_length(payload::text)+octet_length(provenance::text)),0)from private.yash_channel_shadow_items)>268435456 then raise exception 'yash_shadow_capacity';end if;
  end if;
 end loop;
 return jsonb_build_object('status','copied','items',n,'remaining',(select count(*)from private.yash_channel_shadow_items where batch_id=b.id and mode='reuse_equivalent'and payload is null));
end;$fn$;
revoke all on function private.yash_channel_shadow_copy(uuid,integer)from public,anon,authenticated,service_role;

create function private.yash_channel_shadow_preflight(p_batch uuid)returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare b private.yash_channel_shadow_batches%rowtype;r jsonb;t jsonb;n integer;
begin
 if current_user<>'postgres'then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then raise exception 'yash_shadow_busy';end if;
 lock table private.provider_snapshot_jobs,private.provider_snapshot_heads,private.provider_snapshot_cohorts,private.provider_snapshot_cohort_jobs in share row exclusive mode;
 select *into b from private.yash_channel_shadow_batches where id=p_batch for update;
 if not found or b.status<>'staging'then raise exception 'yash_shadow_invalid_stage';end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then raise exception 'yash_shadow_active_lease';end if;
 select coalesce(jsonb_agg(target order by platform_id),'[]')into r from private.provider_snapshot_targets where enabled and private.provider_snapshot_target_current(target);
 if r<>b.targets or b.clone_fingerprint<>private.yash_channel_shadow_fingerprint()then raise exception 'yash_shadow_contract_changed';end if;
 for t in select value from jsonb_array_elements(r)loop
  if private.provider_snapshot_dependency_token(t) is distinct from b.tokens#>>array[t->>'id','before'] or private.yash_channel_shadow_dependency_token(t) is distinct from b.tokens#>>array[t->>'id','after']then raise exception 'yash_shadow_dependency_changed';end if;
 end loop;
 if b.head_manifest<>private.yash_channel_shadow_head_manifest()then raise exception 'yash_shadow_heads_changed';end if;
 -- Pending/retried jobs can still expose their last-good payload. Never strand
 -- any currently eligible old head when the global semantic dependency changes.
 if exists(select 1 from private.provider_snapshot_heads h join private.provider_snapshot_jobs j on j.id=h.job_id
  join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
  where j.target=any(array(select value from jsonb_array_elements(b.targets)))and a.dependency_token=b.tokens#>>array[j.target->>'id','before']
   and not exists(select 1 from private.yash_channel_shadow_items staged where staged.batch_id=b.id and staged.job_id=j.id
    and staged.source_snapshot=a.id and staged.source_job=to_jsonb(j)))then raise exception 'yash_shadow_unstaged_live_head';end if;

 select count(*)into n from private.yash_channel_shadow_items where batch_id=b.id;
 if n<90 or exists(select 1 from private.yash_channel_shadow_items where batch_id=b.id and payload is null)then raise exception 'yash_shadow_incomplete';end if;
 if not private.yash_channel_shadow_cohort_valid(b.id,b.anchor_cohort)then raise exception 'yash_shadow_cohort_changed';end if;
 update private.yash_channel_shadow_batches set promotion_xid=pg_current_xact_id()::text where id=b.id;
 return jsonb_build_object('ready',true,'items',n,'anchorCohort',b.anchor_cohort);
end;$fn$;
revoke all on function private.yash_channel_shadow_preflight(uuid)from public,anon,authenticated,service_role;

create function private.yash_channel_shadow_promote(p_batch uuid)returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare b private.yash_channel_shadow_batches%rowtype;i private.yash_channel_shadow_items%rowtype;t jsonb;r jsonb;f bigint;n integer:=0;
begin
 if current_user<>'postgres'then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 select *into b from private.yash_channel_shadow_batches where id=p_batch for update;
 if not found or b.status<>'staging'or b.promotion_xid is distinct from pg_current_xact_id()::text then raise exception 'yash_shadow_atomic_transaction_required';end if;
 if not private.provider_snapshot_kernel_contract_current()or b.clone_fingerprint<>private.yash_channel_shadow_fingerprint()then raise exception 'yash_shadow_contract_changed';end if;
 for t in select value from jsonb_array_elements(b.targets)loop
  if not private.provider_snapshot_target_current(t)or private.provider_snapshot_dependency_token(t) is distinct from b.tokens#>>array[t->>'id','after']then raise exception 'yash_shadow_future_token_mismatch';end if;
 end loop;
 if b.head_manifest<>private.yash_channel_shadow_head_manifest()then raise exception 'yash_shadow_heads_changed';end if;
 update private.yash_channel_shadow_batches set completion_verified_xid=pg_current_xact_id()::text where id=b.id;
 for i in select *from private.yash_channel_shadow_items where batch_id=b.id order by job_id loop
  if i.payload is null then raise exception 'yash_shadow_incomplete';end if;
  if i.mode='reuse_equivalent'and i.payload is distinct from i.source_artifact->'payload'then raise exception 'yash_shadow_copy_changed';end if;
  -- The frozen normal completion protocol keeps every per-item scope, payload,
  -- provenance, lease/fence and quota check. Its transaction-only context reuses
  -- the exact target/dependency proof above, rechecked after the complete batch.
  update private.provider_snapshot_jobs set revision=revision+1,fence=fence+1,run_id=b.id,status='running',dependency_token=i.future_token,
   worker='yash-channel-release',claim_backend_pid=pg_backend_pid(),claim_backend_start=null,lease_until=clock_timestamp()+interval'5minutes'
   where id=i.job_id returning fence into f;
  r:=private.yash_channel_shadow_complete(i.job_id,b.id,f,i.payload,i.provenance);
  if r->'published'is distinct from'true'::jsonb then raise exception 'yash_shadow_publish_failed: %',r->>'reason';end if;
  update private.yash_channel_shadow_items set new_snapshot=(r->>'snapshotId')::uuid where batch_id=b.id and job_id=i.job_id;
  n:=n+1;
 end loop;
 -- A configuration or native catalog commit during publication invalidates the
 -- entire transaction; never publish a mixture of dependency generations.
 if not private.provider_snapshot_kernel_contract_current()or b.clone_fingerprint<>private.yash_channel_shadow_fingerprint()then raise exception 'yash_shadow_contract_changed';end if;
 for t in select value from jsonb_array_elements(b.targets)loop
  if not private.provider_snapshot_target_current(t)or private.provider_snapshot_dependency_token(t) is distinct from b.tokens#>>array[t->>'id','after']then raise exception 'yash_shadow_future_token_mismatch';end if;
 end loop;
 if exists(select 1 from private.yash_channel_shadow_items staged join private.provider_snapshot_jobs j on j.id=staged.job_id join private.provider_snapshot_heads h on h.job_id=j.id join private.provider_snapshot_artifacts a on a.id=h.snapshot_id where staged.batch_id=b.id and(h.snapshot_id<>staged.new_snapshot or a.revision<>j.revision or a.dependency_token<>staged.future_token or j.status<>'ready'))then raise exception 'yash_shadow_postcondition';end if;
 update private.yash_channel_shadow_batches set status='promoted',completion_verified_xid=null,promoted_at=clock_timestamp()where id=b.id;
 return jsonb_build_object('promoted',true,'generation',b.id,'items',n,'anchorCohort',b.anchor_cohort);
end;$fn$;
revoke all on function private.yash_channel_shadow_promote(uuid)from public,anon,authenticated,service_role;

create function private.yash_channel_shadow_discard(p_batch uuid)returns boolean language plpgsql volatile security invoker set search_path=''as $fn$
begin
 if current_user<>'postgres'then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 perform 1 from private.yash_channel_shadow_batches where id=p_batch and status='staging'for update;
 if not found then raise exception 'yash_shadow_invalid_stage';end if;
 delete from private.yash_channel_shadow_items where batch_id=p_batch;
 delete from private.yash_channel_shadow_batches where id=p_batch;
 return true;
end;$fn$;
revoke all on function private.yash_channel_shadow_discard(uuid)from public,anon,authenticated,service_role;
