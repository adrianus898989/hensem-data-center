-- Manifest-only staging upgrade. Existing staging must be empty; old heads remain untouched.
begin;
set local statement_timeout='15s';set local lock_timeout='500ms';
do $guard$
declare spec jsonb;
begin
 if current_user<>'postgres'then raise exception 'yash_shadow_denied' using errcode='42501';end if;
 lock table private.yash_channel_shadow_batches,private.yash_channel_shadow_items in access exclusive mode;
 if exists(select 1 from private.yash_channel_shadow_batches)or exists(select 1 from private.yash_channel_shadow_items)then raise exception 'yash_shadow_patch_requires_empty_stage';end if;
 for spec in select value from jsonb_array_elements('[{"signature":"private.yash_channel_shadow_refresh(uuid)","before":"c7c3c25c3aca3b83f5ef5983bdb390e6","after":"5a7eb6b322415de279001d5ae82df3db"},{"signature":"private.yash_channel_shadow_step(uuid)","before":"c5c75005603570e969d4567aa7df27d5","after":"f77fad9a6874a674952b2c2b5b26e66d"},{"signature":"private.yash_channel_shadow_copy(uuid,integer)","before":"1ceb21f335d36802a5c36ad392475f34","after":"344b579b0fd99728e33eee94a664f6a2"},{"signature":"private.yash_channel_shadow_promote(uuid)","before":"6591374e2962ecb242d799f9f06906f5","after":"558ae1b2b1afd6a3a48c236c7684786b"}]'::jsonb)loop
  if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure(spec->>'signature')and md5(p.prosrc)in(spec->>'before',spec->>'after')
    and pg_get_userbyid(p.proowner)='postgres'and not p.prosecdef and p.provolatile='v'
    and p.proconfig=array['search_path=""']and p.prorettype='jsonb'::regtype
    and p.proacl::text='{postgres=X/postgres}'and l.lanname='plpgsql')
   then raise exception 'yash_shadow_installed_helper_changed: %',spec->>'signature';end if;
 end loop;
end;$guard$;
create or replace function private.yash_channel_shadow_refresh(p_batch uuid)returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
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
 -- Capture only immutable identity and size here. The full payload/provenance
 -- is fetched once, in the bounded copy batch, never during manifest refresh.
 select b.id,j.id,a.id,to_jsonb(j),jsonb_build_object('id',a.id,'job_id',a.job_id,'run_id',a.run_id,'fence',a.fence,'revision',a.revision,
  'dependency_token',a.dependency_token,'payload_hash',a.payload_hash,'stored_bytes',a.stored_bytes,'computed_at',a.computed_at,'next_due_at',a.next_due_at),b.tokens#>>array[j.target->>'id','after'],
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
 if total not between 90 and 8192 then raise exception 'yash_shadow_incomplete_or_oversize';end if;
 -- Reserve one prepared payload plus metadata/provenance overhead, not a second
 -- copy of the source payload. Per-item and actual prepared-size guards remain.
 if(select coalesce(sum(coalesce((source_artifact->>'prepared_bytes')::bigint,(source_artifact->>'stored_bytes')::bigint)+octet_length(source_job::text)+octet_length(source_artifact::text)+1024),0)
  from private.yash_channel_shadow_items where batch_id=b.id)>268435456 then raise exception 'yash_shadow_capacity';end if;
 -- Require a full existing 18-platform current/previous orders+intake and current submission cohort.
 select x.id into c from private.provider_snapshot_cohorts x where private.yash_channel_shadow_cohort_valid(b.id,x.id)
 order by x.cutoff desc,x.created_at desc limit 1;
 if c is null then raise exception 'yash_shadow_no_complete_cohort';end if;
 update private.yash_channel_shadow_batches set head_manifest=manifest,anchor_cohort=c where id=b.id;
 return jsonb_build_object('batchId',b.id,'items',total,'changedItems',changed,'pending',(select count(*)from private.yash_channel_shadow_items where batch_id=b.id and payload is null));
end;$fn$;
revoke all on function private.yash_channel_shadow_refresh(uuid) from public,anon,authenticated,service_role;

create or replace function private.yash_channel_shadow_step(p_batch uuid)returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
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
 update private.yash_channel_shadow_items set payload=x->'payload',provenance=x->'provenance',prepared_at=clock_timestamp(),
  source_artifact=jsonb_set(source_artifact,'{prepared_bytes}',to_jsonb(octet_length((x->'payload')::text)+octet_length((x->'provenance')::text)))where batch_id=b.id and job_id=i.job_id;
 if(select coalesce(sum(coalesce((source_artifact->>'prepared_bytes')::bigint,(source_artifact->>'stored_bytes')::bigint)+octet_length(source_job::text)+octet_length(source_artifact::text)+1024),0)from private.yash_channel_shadow_items)>268435456 then raise exception 'yash_shadow_capacity';end if;
 return jsonb_build_object('status','staged','jobId',i.job_id,'mode',i.mode,'remaining',(select count(*)from private.yash_channel_shadow_items where batch_id=b.id and payload is null));
end;$fn$;
revoke all on function private.yash_channel_shadow_step(uuid) from public,anon,authenticated,service_role;

create or replace function private.yash_channel_shadow_copy(p_batch uuid,p_limit integer default 100)returns jsonb language plpgsql volatile security invoker set search_path=''as $fn$
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
   if exists(select 1 from private.yash_channel_shadow_items i left join private.provider_snapshot_artifacts a on a.id=i.source_snapshot where i.batch_id=b.id and i.job_id=any(ids)
    and(a.id is null or a.job_id<>i.job_id or a.payload_hash is distinct from i.source_artifact->>'payload_hash'
      or jsonb_typeof(a.payload)is distinct from'object'or a.provenance->'computationComplete'is distinct from'true'::jsonb
      or octet_length(a.payload::text)>4194304 or octet_length(a.provenance::text)>64000))then raise exception 'yash_shadow_invalid_computation';end if;
   -- Serialize only this bounded batch once for size accounting. The global
   -- budget sums server-computed metadata, never all previously copied payloads.
   with copies as materialized(select i.job_id,a.payload,
    a.provenance||jsonb_build_object('semanticMigration',jsonb_build_object('contract','yash-pair-classification-v1','mode',i.mode,'sourceSnapshotId',i.source_snapshot,'sourcePayloadHash',i.source_artifact->>'payload_hash','preparedAt',private.provider_snapshot_iso(clock_timestamp())))provenance
    from private.yash_channel_shadow_items i join private.provider_snapshot_artifacts a on a.id=i.source_snapshot where i.batch_id=b.id and i.job_id=any(ids))
   update private.yash_channel_shadow_items i set payload=c.payload,provenance=c.provenance,prepared_at=clock_timestamp(),
    source_artifact=jsonb_set(i.source_artifact,'{prepared_bytes}',to_jsonb(octet_length(c.payload::text)+octet_length(c.provenance::text)))
    from copies c where i.batch_id=b.id and i.job_id=c.job_id;
   get diagnostics n=row_count;
   if(select coalesce(sum(coalesce((source_artifact->>'prepared_bytes')::bigint,(source_artifact->>'stored_bytes')::bigint)+octet_length(source_job::text)+octet_length(source_artifact::text)+1024),0)from private.yash_channel_shadow_items)>268435456 then raise exception 'yash_shadow_capacity';end if;
  end if;
 end loop;
 return jsonb_build_object('status','copied','items',n,'remaining',(select count(*)from private.yash_channel_shadow_items where batch_id=b.id and mode='reuse_equivalent'and payload is null));
end;$fn$;
revoke all on function private.yash_channel_shadow_copy(uuid,integer) from public,anon,authenticated,service_role;

create or replace function private.yash_channel_shadow_promote(p_batch uuid)returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
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
  if i.mode='reuse_equivalent'and i.payload is distinct from(select a.payload from private.provider_snapshot_artifacts a where a.id=i.source_snapshot and a.job_id=i.job_id)then raise exception 'yash_shadow_copy_changed';end if;
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
revoke all on function private.yash_channel_shadow_promote(uuid) from public,anon,authenticated,service_role;
do $verify$
declare spec jsonb;
begin
 for spec in select value from jsonb_array_elements('[{"signature":"private.yash_channel_shadow_refresh(uuid)","before":"c7c3c25c3aca3b83f5ef5983bdb390e6","after":"5a7eb6b322415de279001d5ae82df3db"},{"signature":"private.yash_channel_shadow_step(uuid)","before":"c5c75005603570e969d4567aa7df27d5","after":"f77fad9a6874a674952b2c2b5b26e66d"},{"signature":"private.yash_channel_shadow_copy(uuid,integer)","before":"1ceb21f335d36802a5c36ad392475f34","after":"344b579b0fd99728e33eee94a664f6a2"},{"signature":"private.yash_channel_shadow_promote(uuid)","before":"6591374e2962ecb242d799f9f06906f5","after":"558ae1b2b1afd6a3a48c236c7684786b"}]'::jsonb)loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(spec->>'signature')and md5(p.prosrc)=spec->>'after'
   and pg_get_userbyid(p.proowner)='postgres'and not p.prosecdef and p.provolatile='v'
   and p.proconfig=array['search_path=""']and p.proacl::text='{postgres=X/postgres}')
  then raise exception 'yash_shadow_replacement_mismatch: %',spec->>'signature';end if;
 end loop;
end;$verify$;
commit;
