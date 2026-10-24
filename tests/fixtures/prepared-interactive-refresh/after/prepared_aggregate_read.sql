CREATE OR REPLACE FUNCTION private.prepared_aggregate_read(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare access jsonb;page jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;items jsonb:='[]';reason text;dep text;k jsonb;j private.prepared_aggregate_jobs%rowtype;a private.prepared_aggregate_artifacts%rowtype;status text;v_id uuid;v_actor uuid:=auth.uid();budget integer;ctx jsonb;baseq jsonb;payload jsonb;commons jsonb:='{}';scope text;common text;v2 boolean;force_refresh boolean;freshness text;admitted_id uuid;preparation jsonb;transition jsonb;recent_due timestamptz;
begin
 access:=private.dashboard_role_access();
 if (access->>'canView')::boolean is not true then raise exception using errcode='42501',message='preview_denied';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages')where value->>'id'=p_page;
 if page is null or not(page->'requests'?'aggregate')or not(page->'requests'?'aggregatePrepared')then raise exception using errcode='42501',message='page_action_denied';end if;
 if access->>'mode'='assigned'then
  if not private.dashboard_role_context_valid()or not(access->'permissions'?&array[p_page||'.view',p_page||'.query'])then raise exception using errcode='42501',message='role_permission_denied';end if;
  ctx:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb->'payload';
  if ctx->>'page'is distinct from p_page or ctx->>'rpc'is distinct from 'dashboard_admin_live_aggregate_prepared'or ctx->>'action'is distinct from 'aggregatePrepared'then raise exception using errcode='42501',message='page_action_denied';end if;
 end if;
 if p_request is null or jsonb_typeof(p_request)<>'object'or p_request-array['requests','publicationVersion','forceRefresh']<>'{}'::jsonb or octet_length(p_request::text)>1048576
 or jsonb_typeof(p_request->'requests')is distinct from 'array'or jsonb_array_length(p_request->'requests')not between 1 and 50 then raise exception using errcode='22023',message='invalid_prepared_batch';end if;
 if p_request?'publicationVersion'and p_request->'publicationVersion'<>'2'::jsonb or p_request?'forceRefresh'and(jsonb_typeof(p_request->'forceRefresh')<>'boolean'or p_request->'publicationVersion'is distinct from '2'::jsonb)then raise exception using errcode='22023',message='invalid_prepared_publication_version';end if;
 v2:=coalesce(p_request->'publicationVersion'='2'::jsonb,false);force_refresh:=coalesce((p_request->>'forceRefresh')::boolean,false);
 -- Includes profile/session/IP/grant and exact native scope authorization.
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  begin v_id:=(q->>'platformId')::uuid;exception when others then raise exception using errcode='22023',message='invalid_platform';end;
  select value into t from jsonb_array_elements(catalog)where value->>'id'=v_id::text;
  if t is null then raise exception using errcode='42501',message='platform_denied';end if;
  targets:=targets||jsonb_build_array(t);
 end loop;
 for q,t in select r.value,x.value from jsonb_array_elements(p_request->'requests')with ordinality r(value,n)join jsonb_array_elements(targets)with ordinality x(value,n)using(n)loop
  reason:=private.prepared_aggregate_request_reason(q,t);
  if reason is not null then items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','unsupported','reason',reason,'publication',null,'result',null));continue;end if;
  scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;dep:=private.prepared_aggregate_dependency(t,common);baseq:=private.prepared_aggregate_base_request(q,t);k:=private.prepared_aggregate_key(baseq,t);payload:=null;
  select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
  select a0.*into a from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
  if a.id is not null and a.revision=j.revision and a.dependency=dep and j.dependency=dep and j.target=t and(v2 or a.expires_at>clock_timestamp())then
   -- Time expiry is a refresh signal, not a new semantic revision. Only a
   -- ready job is re-queued; running leases and failed retry budgets survive.
   recent_due:=case when v2 then private.dashboard_serving_recent_refresh_at(baseq,t,a.computed_at,statement_timestamp())else null end;
   if v2 and(force_refresh or recent_due<=clock_timestamp()or(a.expires_at<=clock_timestamp()and coalesce(j.next_due_at,a.expires_at)<=clock_timestamp()))then
    update private.prepared_aggregate_jobs z set status='queued',attempts=0,not_before=clock_timestamp(),
     priority=case when recent_due<=clock_timestamp()then greatest(z.priority,20)else z.priority end,
     interactive_requested_at=case when recent_due<=clock_timestamp()then coalesce(z.interactive_requested_at,clock_timestamp())else z.interactive_requested_at end
     where z.id=j.id and z.status='ready'and z.revision=j.revision and z.dependency=dep and z.target=t
      -- A delayed read may not requeue a newer publication that completed meanwhile.
      and(force_refresh or z.fence=a.fence and exists(select 1 from private.prepared_aggregate_heads h where h.job_id=z.id and h.artifact_id=a.id));
    select *into j from private.prepared_aggregate_jobs where id=j.id;
    select a0.*into a from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
    if a.id is null or a.dependency is distinct from dep or j.revision is distinct from a.revision or j.dependency is distinct from dep or j.target is distinct from t then
     items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','stale','publication',null,'result',null));continue;
    end if;
   end if;
   recent_due:=case when v2 then private.dashboard_serving_recent_refresh_at(baseq,t,a.computed_at,statement_timestamp())else null end;
   freshness:=case when a.expires_at>clock_timestamp()and(recent_due is null or recent_due>clock_timestamp())then'fresh'else'refresh_due'end;
   payload:=case when baseq->>'view'='full'and baseq->>'durationVersion'='2'and not(baseq?'durationRange')then private.prepared_aggregate_master_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))when coalesce(q->>'view','full')='providers'then private.dashboard_prepared_provider_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))when baseq->>'direction'='all'then private.dashboard_prepared_direction_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))else a.payload end;
   update private.prepared_aggregate_jobs set last_requested_at=clock_timestamp()where id=j.id and last_requested_at<clock_timestamp()-interval'5minutes';
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','publication',jsonb_build_object('id',a.id,'generation',a.revision::text||':'||a.fence::text,'computedAt',a.computed_at,'expiresAt',a.expires_at,'cutoff',a.cutoff,'calculationComplete',true,'sourceComplete',a.source_complete)||case when v2 then jsonb_build_object('freshness',freshness,'interactiveRefreshAt',recent_due,'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end)else'{}'::jsonb end,
    'result',private.prepared_aggregate_echo(coalesce(payload,a.payload),q,t)));
  else
   transition:=case when v2 and not force_refresh then private.dashboard_created_manual_transition(q,t,dep)else null end;
   admitted_id:=null;preparation:=jsonb_build_object('state','unavailable','retryable',false);
   status:=case when a.id is not null then 'stale'when j.status in('queued','running')then'building'else'missing'end;
   -- Count newly observed exact requests only. Exceeding admission budget never
   -- reveals another scope or falls back to a synchronous source scan.
   if j.id is null then
    insert into private.prepared_aggregate_admissions(actor,day,total)values(v_actor,current_date,1)on conflict(actor,day)do update set total=private.prepared_aggregate_admissions.total+1 where private.prepared_aggregate_admissions.total<1000 returning total into budget;
    if budget is not null then admitted_id:=private.prepared_aggregate_enqueue(baseq,t,dep,20::smallint);end if;
   else
    admitted_id:=private.prepared_aggregate_enqueue(baseq,t,dep,20::smallint);
    update private.prepared_aggregate_jobs z set status='queued',not_before=clock_timestamp()where z.id=j.id and z.status='ready'and(a.expires_at<=clock_timestamp()or a.id is null);
   end if;

   -- First authorized wait only; polling must not renew the priority age.
   -- Existing usable v2 publications return above and keep background refresh.
   -- The marker never enters the semantic key, permission scope or payload.
   update private.prepared_aggregate_jobs z set interactive_requested_at=clock_timestamp()
    where z.id=admitted_id and z.request_key=k and z.dependency=dep and z.target=t
     and z.status='queued'and z.attempts<3 and isfinite(z.not_before)
     and z.interactive_requested_at is null;
   select *into j from private.prepared_aggregate_jobs z
    where z.id=admitted_id and z.request_key=k and z.dependency=dep and z.target=t;
   if found then
    preparation:=jsonb_build_object('state',
     case when j.status='queued'and j.attempts<3 and isfinite(j.not_before)then'queued'
      when j.status='running'and j.lease_until>clock_timestamp()then'running'
      when j.status='failed'then'failed'else'unavailable'end,
     'retryable',(j.status='queued'and j.attempts<3 and isfinite(j.not_before))
      or(j.status='running'and coalesce(j.lease_until>clock_timestamp(),false)));
   end if;
   if transition is not null and preparation->>'state'in('idle','queued','running','failed')then
    -- Same original queue admission, same authorization; old manual facts keep
    -- their old generation and timestamps and can never answer created mode.
    items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready',
     'publication',(transition->'publication')||jsonb_build_object('refreshState',preparation->>'state','nextRefreshAt',j.next_due_at),
     'result',transition->'result'));
   else
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status',status,'publication',null,'result',null,'preparation',preparation));
   end if;
  end if;
 end loop;
 return jsonb_build_object('version',case when v2 then 2 else 1 end,'items',items);
end;$function$

