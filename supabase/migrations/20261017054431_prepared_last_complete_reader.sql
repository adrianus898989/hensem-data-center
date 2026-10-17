-- Opt-in last-complete reader. No producer, dependency function, TTL or cron is changed.
-- Generic dependency includes this reader body: existing generic canaries need rebuilding.
-- Old provider dependency does not include this function and remains unchanged.
-- Legacy callers remain expiry-strict. All batch authorization precedes admission.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';
do $guard$
begin
 if current_user<>'postgres'then raise exception 'prepared_last_complete_install_denied';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_read(text,jsonb)'::regprocedure
  and md5(prosrc)='c897af7b756e0b485e07ffa75f98f340'and prosecdef and provolatile='v'and proconfig=array['search_path=""']
  and pg_get_userbyid(proowner)='postgres'and pg_get_function_arguments(oid)='p_page text, p_request jsonb'
  and proacl::text='{postgres=X/postgres}'and pg_get_function_result(oid)='jsonb'and not proretset and pronargs=2 and pronargdefaults=0
  and prolang=(select oid from pg_language where lanname='plpgsql')and proparallel='u'and not proisstrict and not proleakproof and procost=100 and prorows=0)then
  raise exception 'prepared_last_complete_reader_drift';end if;
end;$guard$;
create or replace function private.prepared_aggregate_read(p_page text,p_request jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''as $$
declare access jsonb;page jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;items jsonb:='[]';reason text;dep text;k jsonb;j private.prepared_aggregate_jobs%rowtype;a private.prepared_aggregate_artifacts%rowtype;status text;v_id uuid;v_actor uuid:=auth.uid();budget integer;ctx jsonb;baseq jsonb;payload jsonb;commons jsonb:='{}';scope text;common text;v2 boolean;force_refresh boolean;freshness text;
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
   if v2 and(force_refresh or(a.expires_at<=clock_timestamp()and coalesce(j.next_due_at,a.expires_at)<=clock_timestamp()))then
    update private.prepared_aggregate_jobs z set status='queued',attempts=0,not_before=clock_timestamp()
     where z.id=j.id and z.status='ready'and z.revision=j.revision and z.dependency=dep and z.target=t;
    select *into j from private.prepared_aggregate_jobs where id=j.id;
    if j.revision is distinct from a.revision or j.dependency is distinct from dep or j.target is distinct from t then
     items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','stale','publication',null,'result',null));continue;
    end if;
   end if;
   freshness:=case when a.expires_at>clock_timestamp()then'fresh'else'refresh_due'end;
   payload:=case when baseq->>'view'='full'and baseq->>'durationVersion'='2'and not(baseq?'durationRange')then private.prepared_aggregate_master_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))when coalesce(q->>'view','full')='providers'then private.dashboard_prepared_provider_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))when baseq->>'direction'='all'then private.dashboard_prepared_direction_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))else a.payload end;
   update private.prepared_aggregate_jobs set last_requested_at=clock_timestamp()where id=j.id and last_requested_at<clock_timestamp()-interval'5minutes';
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','publication',jsonb_build_object('id',a.id,'generation',a.revision::text||':'||a.fence::text,'computedAt',a.computed_at,'expiresAt',a.expires_at,'cutoff',a.cutoff,'calculationComplete',true,'sourceComplete',a.source_complete)||case when v2 then jsonb_build_object('freshness',freshness,'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end)else'{}'::jsonb end,
    'result',private.prepared_aggregate_echo(coalesce(payload,a.payload),q,t)));
  else
   status:=case when a.id is not null then 'stale'when j.status in('queued','running')then'building'else'missing'end;
   -- Count newly observed exact requests only. Exceeding admission budget never
   -- reveals another scope or falls back to a synchronous source scan.
   if j.id is null then
    insert into private.prepared_aggregate_admissions(actor,day,total)values(v_actor,current_date,1)on conflict(actor,day)do update set total=private.prepared_aggregate_admissions.total+1 where private.prepared_aggregate_admissions.total<1000 returning total into budget;
    if budget is not null then perform private.prepared_aggregate_enqueue(baseq,t,dep,20::smallint);end if;
   else
    perform private.prepared_aggregate_enqueue(baseq,t,dep,20::smallint);
    update private.prepared_aggregate_jobs z set status='queued',not_before=clock_timestamp()where z.id=j.id and z.status='ready'and(a.expires_at<=clock_timestamp()or a.id is null);
   end if;
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status',status,'publication',null,'result',null));
  end if;
 end loop;
 return jsonb_build_object('version',case when v2 then 2 else 1 end,'items',items);
end;$$;
commit;
