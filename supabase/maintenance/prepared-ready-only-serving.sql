-- An explicit read-only transport phase for existing V2 provider publications.
-- It never admits, refreshes or computes. Missing/expired follow-up remains with
-- the existing bounded client queue and the original authorized prepared reader.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';
create temporary table dashboard_ready_install_guard on commit drop as
 select 'dependencies'::text name,jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))value
 from unnest(array['IN','ID','BR','MX','CL','CO'])scope
 union all select 'wrapper_metadata',to_jsonb(p)-'prosrc'from pg_proc p
 where p.oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure;

create function private.dashboard_serving_ready_read(p_page text,p_request jsonb)
returns jsonb language plpgsql stable set search_path=''as $function$
declare catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;c jsonb;baseq jsonb;k jsonb;
 commons jsonb:='{}';scope text;common text;dep text;reason text;items jsonb:='[]';response jsonb;payload jsonb;
 a timestamptz;b timestamptz;local_a timestamp;local_b timestamp;at timestamptz:=statement_timestamp();
 j private.prepared_aggregate_jobs%rowtype;artifact private.prepared_aggregate_artifacts%rowtype;master record;
begin
 -- The unchanged wrapper has already verified page/query/session/context.
 -- This helper is private, invoker-only, and cannot be called by API roles.
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_ready_worker_denied';end if;
 if p_page is distinct from'providers'or p_request is null or jsonb_typeof(p_request)is distinct from'object'
  or p_request-array['requests','publicationVersion','readMode']<>'{}'::jsonb
  or p_request->'readMode'is distinct from'"ready-only-v1"'::jsonb
  or p_request->'publicationVersion'is distinct from'2'::jsonb
  or jsonb_typeof(p_request->'requests')is distinct from'array'
  or jsonb_array_length(p_request->'requests')not between 1 and 50
  or octet_length(p_request::text)>128000
  or exists(select 1 from jsonb_array_elements(p_request->'requests')r group by r having count(*)>1)
 then raise exception using errcode='22023',message='prepared_ready_envelope_invalid';end if;
 -- Native scope is revalidated before any head lookup. No presentation alias
 -- or client-supplied native metadata can authorize a platform.
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  if jsonb_typeof(q)is distinct from'object'or q->>'action'is distinct from'aggregate'
   or q->>'view'is distinct from'providers'then raise exception using errcode='22023',message='prepared_ready_query_invalid';end if;
  select value into t from jsonb_array_elements(catalog)where value->>'id'=q->>'platformId';
  if t is null then raise exception using errcode='42501',message='platform_denied';end if;
  reason:=private.prepared_aggregate_request_reason(q,t);
  if reason is not null then raise exception using errcode='22023',message='prepared_ready_query_invalid';end if;
  targets:=targets||jsonb_build_array(t);
 end loop;
 for q,t in select r.value,x.value from jsonb_array_elements(p_request->'requests')with ordinality r(value,n)
  join jsonb_array_elements(targets)with ordinality x(value,n)using(n)loop
  c:=private.prepared_aggregate_canonical_request(q,t);
  a:=(c->>'startAt')::timestamptz;b:=(c->>'endAt')::timestamptz;
  local_a:=a at time zone(t->>'timezone');local_b:=b at time zone(t->>'timezone');
  if c->>'status'<>'all'or c?'durationRange'or c->>'successBasis'<>'success'
   or a is distinct from(c->>'successStartAt')::timestamptz or b is distinct from(c->>'successEndAt')::timestamptz
   or local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)
   or local_b::date-local_a::date<>1 or b>at
  then
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','miss','reason','ready_query_not_supported','publication',null,'result',null));continue;
  end if;
  scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;
  common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  baseq:=private.prepared_aggregate_base_request(q,t);k:=private.prepared_aggregate_key(baseq,t);
  -- Match the existing wrapper priority: a proven full master precedes an
  -- exact provider base, even when both immutable heads are present. Unlike
  -- the old all-or-nothing batch adapter, one miss does not block ready peers.
   with candidates as materialized(
    select z.*from private.prepared_aggregate_jobs z where z.target=t and z.dependency=dep
     and z.request->>'platformId'=c->>'platformId'
     and(z.request->>'startAt')::timestamptz=a and(z.request->>'endAt')::timestamptz=b
     and coalesce(z.request->>'successStartAt',z.request->>'startAt')::timestamptz=(c->>'successStartAt')::timestamptz
     and coalesce(z.request->>'successEndAt',z.request->>'endAt')::timestamptz=(c->>'successEndAt')::timestamptz
     and z.request->>'view'='full'and z.request->>'durationVersion'='2')
   select z.id job_id,x.id artifact_id into master from candidates z
    join private.prepared_aggregate_heads h on h.job_id=z.id
    join private.prepared_aggregate_artifacts x on x.id=h.artifact_id and x.job_id=z.id
    where x.dependency=dep and x.revision=z.revision
     and z.request_key=private.prepared_aggregate_key(z.request,t)and z.request_fingerprint=md5(z.request_key::text)
     and z.request->>'direction'='all'and not(z.request?'durationRange')and coalesce(z.request->>'status','all')='all'
     and coalesce(z.request->'providers','[]'::jsonb)='[]'::jsonb
     and(private.prepared_aggregate_canonical_request(z.request,t)-array['view','durationVersion','amountBands','direction','providers'])
       =(c-array['view','durationVersion','amountBands','direction','providers'])
     and x.computed_at is not null and x.expires_at is not null and x.cutoff is not null
     and isfinite(x.computed_at)and isfinite(x.expires_at)and isfinite(x.cutoff)
     and x.computed_at<=at and x.expires_at>x.computed_at and x.source_complete is not null
    order by x.computed_at desc,z.id limit 1;
  if found then
   select *into j from private.prepared_aggregate_jobs where id=master.job_id;
   select *into artifact from private.prepared_aggregate_artifacts where id=master.artifact_id;
   baseq:=j.request;
  else
  select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
  select a0.*into artifact from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0
   on a0.id=h.artifact_id and a0.job_id=j.id where h.job_id=j.id;
  -- Time expiry is not a semantic revision in V2. Preserve it as refresh_due;
  -- generation, cutoff, sourceComplete and retry/lease state are never rewritten.
  if artifact.id is null or j.target is distinct from t or j.dependency is distinct from dep
   or artifact.revision is distinct from j.revision or artifact.dependency is distinct from dep
   or j.request_key is distinct from private.prepared_aggregate_key(j.request,t)
   or artifact.computed_at is null or artifact.expires_at is null or artifact.cutoff is null
   or not isfinite(artifact.computed_at)or not isfinite(artifact.expires_at)or not isfinite(artifact.cutoff)
   or artifact.computed_at>at or artifact.expires_at<=artifact.computed_at or artifact.source_complete is null

  then
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','miss','reason','ready_head_missing','publication',null,'result',null));continue;
  end if;
  end if;
  if jsonb_typeof(artifact.payload)is distinct from'object'
   or jsonb_typeof(artifact.payload#>'{groups,provider}')is distinct from'array'
  then raise exception using errcode='22023',message='prepared_ready_publication_invalid';end if;
  payload:=case when baseq->>'view'='full'and baseq->>'durationVersion'='2'and not(baseq?'durationRange')
   then private.prepared_aggregate_master_projection(artifact.payload,private.prepared_aggregate_canonical_request(baseq,t),c)
   else private.dashboard_prepared_provider_projection(artifact.payload,private.prepared_aggregate_canonical_request(baseq,t),c)end;
  items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','publication',jsonb_build_object(
   'id',artifact.id,'generation',artifact.revision::text||':'||artifact.fence::text,'computedAt',artifact.computed_at,
   'expiresAt',artifact.expires_at,'cutoff',artifact.cutoff,'calculationComplete',true,'sourceComplete',artifact.source_complete,
   'freshness',case when artifact.expires_at>at then'fresh'else'refresh_due'end,'nextRefreshAt',j.next_due_at,
   'refreshState',case when j.status='ready'then'idle'else j.status end),
   'result',private.prepared_aggregate_echo(payload,q,t)));
 end loop;
 response:=jsonb_build_object('version',2,'readMode','ready-only-v1','items',items);
 if octet_length(response::text)>16*1024*1024 then raise exception using errcode='54000',message='prepared_ready_response_capacity';end if;
 return response;
end;$function$;
revoke all on function private.dashboard_serving_ready_read(text,jsonb)from public,anon,authenticated,service_role;

do $install$
declare p record;d text;anchor text:=' -- Explicit compact transport runs after unchanged page/session/query grants.';
begin
 select *into p from pg_proc where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure;
 if md5(p.prosrc)<>'1dd076b75533d3a1333dd6c739e4c72c'or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proacl::text is distinct from'{postgres=X/postgres}'or p.proconfig is distinct from array['search_path=""']
  or p.prosecdef or p.provolatile<>'v'or p.proretset or p.proparallel<>'u'or p.proisstrict or p.proleakproof
 then raise exception'prepared_ready_entry_drift';end if;
 d:=pg_get_functiondef(p.oid);
 if(length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception'prepared_ready_entry_anchor';end if;
 execute replace(d,anchor,E' -- Explicit read-only phase follows all unchanged page/session/query grants.\n if p_request?''readMode''then return private.dashboard_serving_ready_read(p_page,p_request);end if;\n'||anchor);
 if(select value from pg_temp.dashboard_ready_install_guard where name='wrapper_metadata')is distinct from(select to_jsonb(x)-'prosrc'from pg_proc x where x.oid=p.oid)
  or(select value from pg_temp.dashboard_ready_install_guard where name='dependencies')is distinct from
   (select jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))from unnest(array['IN','ID','BR','MX','CL','CO'])scope)
 then raise exception'prepared_ready_semantics_changed';end if;
end;$install$;
commit;
