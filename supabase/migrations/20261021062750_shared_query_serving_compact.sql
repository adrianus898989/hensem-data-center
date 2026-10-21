-- Reuse an existing exact full publication through the original reader. This
-- serving adapter is deliberately outside prepared_aggregate_%: publication
-- computation and semantic fingerprints stay unchanged.
create temporary table dashboard_serving_install_guard as
 select 'dependencies'::text name,jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope)) value
 from unnest(array['IN','ID','BR','MX','CL','CO'])scope
 union all select 'wrapper_metadata',to_jsonb(p)-'prosrc'from pg_proc p
 where p.oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure;

create or replace function private.dashboard_serving_master_reuse(p_page text,p_request jsonb)
returns jsonb language plpgsql set search_path='' as $function$
declare catalog jsonb;targets jsonb:='[]';requests jsonb:='[]';originals jsonb:='[]';
 q jsonb;t jsonb;c jsonb;b jsonb;dep text;common text;scope text;commons jsonb:='{}';
 master record;response jsonb;item jsonb;result jsonb;direction_caps jsonb;items jsonb:='[]';i integer:=0;different boolean:=false;
begin
 -- The caller has already checked page/session/query grants. Native scope is
 -- checked again here, before touching a head. No external role can call this
 -- helper directly. Unsupported or partially unavailable batches do no work.
 if p_request->'publicationVersion'is distinct from'2'::jsonb
  or jsonb_typeof(p_request->'requests')is distinct from'array'
  or jsonb_array_length(p_request->'requests')not between 1 and 3 then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  select value into t from jsonb_array_elements(catalog)where value->>'id'=q->>'platformId';
  if t is null or private.prepared_aggregate_request_reason(q,t)is not null
   or coalesce(q->>'view','full')not in('full','providers')or q?'durationRange'
   or coalesce(q->>'status','all')<>'all'
  then return null;end if;
  c:=private.prepared_aggregate_canonical_request(q,t);
  scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;
  common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  -- Metadata only until exact target, both clocks, all financial selectors,
  -- current dependency and fenced revision have matched. Amount-band-only
  -- differences are irrelevant to a providers DTO; full custom bands remain
  -- exact. Old and current dates follow the same proof.
  with candidates as materialized(
   select j.*from private.prepared_aggregate_jobs j
   where j.target=t and j.dependency=dep and j.request->>'platformId'=c->>'platformId'
    and (j.request->>'startAt')::timestamptz=(c->>'startAt')::timestamptz
    and (j.request->>'endAt')::timestamptz=(c->>'endAt')::timestamptz
    and coalesce(j.request->>'successStartAt',j.request->>'startAt')::timestamptz=(c->>'successStartAt')::timestamptz
    and coalesce(j.request->>'successEndAt',j.request->>'endAt')::timestamptz=(c->>'successEndAt')::timestamptz
    and j.request->>'view'='full'and j.request->>'durationVersion'='2')
  select j.request,a.id into master
   from candidates j
   join private.prepared_aggregate_heads h on h.job_id=j.id
   join private.prepared_aggregate_artifacts a on a.id=h.artifact_id
   where j.target=t and j.dependency=dep and a.dependency=dep and a.revision=j.revision
    and j.request_key=private.prepared_aggregate_key(j.request,t)
    and j.request_fingerprint=md5(j.request_key::text)
    and j.request->>'view'='full'and j.request->>'durationVersion'='2'
    and j.request->>'direction'='all'and not(j.request?'durationRange')
    and coalesce(j.request->>'status','all')='all'
    and a.computed_at is not null and a.cutoff is not null and isfinite(a.cutoff)
    and a.expires_at>a.computed_at and a.source_complete is not null
    and case when c->>'view'='providers'then
     coalesce(j.request->'providers','[]'::jsonb)='[]'::jsonb
     and(private.prepared_aggregate_canonical_request(j.request,t)-array['view','durationVersion','amountBands','direction','providers'])
       =(c-array['view','durationVersion','amountBands','direction','providers'])
    else
     (private.prepared_aggregate_canonical_request(j.request,t)-array['durationVersion','direction']-case when not(c?'amountBands')then array['amountBands']else array[]::text[]end)
       =(c-array['durationVersion','direction'])
    end
   order by a.computed_at desc,j.id limit 1;
  if not found then return null;end if;
  different:=different or private.prepared_aggregate_key(private.prepared_aggregate_base_request(q,t),t)
     is distinct from private.prepared_aggregate_key(master.request,t);
  requests:=requests||jsonb_build_array(master.request);originals:=originals||jsonb_build_array(q);targets:=targets||jsonb_build_array(t);
 end loop;
 if not different then return null;end if;
 -- The existing reader remains the only owner of authorization revalidation,
 -- refresh admission, last_requested_at, leases and retry budgets. No second
 -- scheduler and no synchronous source query are introduced.
 response:=private.prepared_aggregate_read(p_page,(p_request-array['requests','providerReuseNames','providerLeafAliases'])||jsonb_build_object('requests',requests));
 if response->>'version'is distinct from'2'or jsonb_typeof(response->'items')is distinct from'array'
  or jsonb_array_length(response->'items')<>jsonb_array_length(requests)then raise exception using errcode='22023',message='dashboard_serving_response_invalid';end if;
 for item in select value from jsonb_array_elements(response->'items')loop
  q:=originals->i;t:=targets->i;b:=private.prepared_aggregate_canonical_request(requests->i,t);c:=private.prepared_aggregate_canonical_request(q,t);
  if item->'request'is distinct from requests->i then raise exception using errcode='22023',message='dashboard_serving_response_scope';end if;
  -- A concurrent semantic/head change keeps the existing reader's admission
  -- result for this master. Never enqueue the alternate key as a second job.
  if item->>'status'is distinct from'ready'then
   items:=items||jsonb_build_array(jsonb_set(item,'{request}',q));i:=i+1;continue;
  end if;
  result:=item->'result';
  -- The original all-direction read strips this internal map after applying
  -- its all-direction capability. Restore only the map from that same immutable
  -- returned artifact so the final projection selects the requested direction.
  select a.payload->'_preparedDirectionCapabilities'into direction_caps
   from private.prepared_aggregate_artifacts a where a.id=(item->'publication'->>'id')::uuid;
  if direction_caps is not null then result:=result||jsonb_build_object('_preparedDirectionCapabilities',direction_caps);end if;
  -- Unrequested range charts are the only removed fields. Exact-amount bins,
  -- totals, source evidence and both metric clocks remain byte-for-byte facts.
  if c->>'view'='full'and not(c?'amountBands')then
   result:=jsonb_set(result-array['amountBands','amountBandsVersion'],'{groups}',(result->'groups')-array['amount_range','matrix_range']);
   b:=b-'amountBands';
  end if;
  result:=private.prepared_aggregate_master_projection(result,b,c);
  items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','publication',item->'publication','result',private.prepared_aggregate_echo(result,q,t)));
  i:=i+1;
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 if octet_length(response::text)>16*1024*1024 then raise exception using errcode='54000',message='dashboard_serving_response_capacity';end if;
 return response;
end;$function$;
revoke all on function private.dashboard_serving_master_reuse(text,jsonb)from public,anon,authenticated,service_role;

-- Transport-only projection: the requested statistics, publication, source
-- evidence and both metric clocks are unchanged. Omitted groups stay absent.
create or replace function private.dashboard_serving_compact_read(p_page text,p_request jsonb)
returns jsonb language plpgsql set search_path='' as $function$
declare profile text:=p_request->>'responseProfile';request jsonb;response jsonb;item jsonb;q jsonb;result jsonb;
 groups text[];projected jsonb;items jsonb:='[]';i integer:=0;
begin
 -- This helper is reached only after the existing wrapper's page/session/query
 -- authorization. The unchanged reader repeats its normal native checks.
 if jsonb_typeof(p_request)is distinct from'object'
  or p_request-array['requests','publicationVersion','forceRefresh','responseProfile']<>'{}'::jsonb
  or p_request->'publicationVersion'is distinct from'2'::jsonb
  or jsonb_typeof(p_request->'responseProfile')is distinct from'string'
  or profile is distinct from(case p_page when'time'then'time-v1'when'amount'then'amount-v1'when'latency'then'latency-v1'else null end)
  or profile is null or octet_length(p_request::text)>1048576
  or jsonb_typeof(p_request->'requests')is distinct from'array'
 then raise exception using errcode='22023',message='dashboard_serving_profile_invalid';end if;
 if jsonb_array_length(p_request->'requests')not between 1 and 3
  or p_request?'forceRefresh'and jsonb_typeof(p_request->'forceRefresh')is distinct from'boolean'
 then raise exception using errcode='22023',message='dashboard_serving_profile_invalid';end if;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  if jsonb_typeof(q)is distinct from'object'or q->>'action'is distinct from'aggregate'
   or coalesce(q->>'view','full')<>'full'or q?'durationRange'
   or profile='latency-v1'and q->'durationVersion'is distinct from'2'::jsonb
  then raise exception using errcode='22023',message='dashboard_serving_profile_query';end if;
 end loop;
 -- Full requests cannot use the provider-only daily rollup. Select the same
 -- existing master path, or its original reader fallback, exactly once.
 -- Never pass the transport hint into a canonical key or admission request.
 request:=p_request-'responseProfile';
 response:=private.dashboard_serving_master_reuse(p_page,request);
 if response is null then response:=private.prepared_aggregate_read(p_page,request);end if;
 if response->'version'is distinct from'2'::jsonb or jsonb_typeof(response->'items')is distinct from'array'
 then raise exception using errcode='22023',message='dashboard_serving_profile_response';end if;
 if jsonb_array_length(response->'items')<>jsonb_array_length(request->'requests')
 then raise exception using errcode='22023',message='dashboard_serving_profile_response';end if;
 for item in select value from jsonb_array_elements(response->'items')loop
  q:=request->'requests'->i;
  if item->'request'is distinct from q or item?'resultGroups'
  then raise exception using errcode='22023',message='dashboard_serving_profile_scope';end if;
  if item->>'status'='ready'then
   result:=item->'result';
   groups:=case profile when'time-v1'then array['hourly','provider']
    when'amount-v1'then case when q?'amountBands'then array['amount','amount_range','provider']else array['amount','provider']end
    when'latency-v1'then array['latency','latency_thresholds']end;
   if jsonb_typeof(result)is distinct from'object'or jsonb_typeof(result->'groups')is distinct from'object'
    or result?'_parts'or result?'_preparedPublication'
    or exists(select 1 from unnest(groups)g where jsonb_typeof(result->'groups'->g)is distinct from'array')
   then raise exception using errcode='22023',message='dashboard_serving_profile_groups';end if;
   select jsonb_object_agg(g,result->'groups'->g)into projected from unnest(groups)g;
   item:=jsonb_set(item,'{result,groups}',projected)||jsonb_build_object('resultGroups',
    jsonb_build_object('contract','prepared-result-groups-v1','profile',profile,'groups',to_jsonb(groups)));
  end if;
  items:=items||jsonb_build_array(item);i:=i+1;
 end loop;
 response:=jsonb_set(response,'{items}',items);
 if octet_length(response::text)>16*1024*1024 then raise exception using errcode='54000',message='dashboard_serving_response_capacity';end if;
 return response;
end;$function$;
revoke all on function private.dashboard_serving_compact_read(text,jsonb)from public,anon,authenticated,service_role;

do $install$
declare definition text;patched text;
begin
 if not exists(select 1 from pg_proc p where p.oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure
  and md5(p.prosrc)='5afc0a7616a2a0c2e3049ea418f9e3df'and pg_get_userbyid(p.proowner)='postgres'
  and p.proacl::text='{postgres=X/postgres}'and not p.prosecdef and to_jsonb(p.proconfig)='["search_path=\"\""]'::jsonb)
 then raise exception'dashboard_serving_entry_drift';end if;
 select pg_get_functiondef('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure)into definition;
 patched:=replace(definition,' <<complete_days>>',E' -- Exact master reuse follows all existing page/context/envelope validation.\n response:=private.dashboard_serving_master_reuse(p_page,p_request);\n if response is not null then return response;end if;\n <<complete_days>>');
 if patched=definition then raise exception'dashboard_serving_entry_anchor_missing';end if;
 definition:=patched;
 patched:=replace(definition,' -- Optional display-name hints never become financial filters or identity.',E' -- Explicit compact transport runs after unchanged page/session/query grants.\n if p_request?''responseProfile''then return private.dashboard_serving_compact_read(p_page,p_request);end if;\n -- Optional display-name hints never become financial filters or identity.');
 if patched=definition then raise exception'dashboard_serving_profile_anchor_missing';end if;
 execute patched;
end;$install$;

do $verify$
begin
 if(select value from pg_temp.dashboard_serving_install_guard where name='dependencies')is distinct from
  (select jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))from unnest(array['IN','ID','BR','MX','CL','CO'])scope)
 then raise exception'dashboard_serving_semantics_changed';end if;
 if(select value from pg_temp.dashboard_serving_install_guard where name='wrapper_metadata')is distinct from
  (select to_jsonb(p)-'prosrc'from pg_proc p where p.oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure)
 then raise exception'dashboard_serving_wrapper_metadata_changed';end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role'])r
  cross join unnest(array['private.dashboard_serving_master_reuse(text,jsonb)','private.dashboard_serving_compact_read(text,jsonb)'])f
  where has_function_privilege(r,f,'EXECUTE'))
 then raise exception'dashboard_serving_external_grant';end if;
end;$verify$;
drop table pg_temp.dashboard_serving_install_guard;
