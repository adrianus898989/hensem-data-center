CREATE OR REPLACE FUNCTION private.dashboard_serving_master_reuse(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare catalog jsonb;targets jsonb:='[]';requests jsonb:='[]';originals jsonb:='[]';
 q jsonb;t jsonb;c jsonb;b jsonb;dep text;common text;scope text;commons jsonb:='{}';
 mapped jsonb:='[]';mixed_miss boolean:=false;mixed_allowed boolean:=true;correct_default_proved boolean:=false;
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
  -- Mixed remapping is confined to unbanded single ended IDR days. The
  -- existing 2--31 day rollup and explicit custom-band paths stay unchanged.
  mixed_allowed:=mixed_allowed and t->>'currency'='IDR'and not(c?'amountBands')
   and(c->>'successBasis'='created'or c->>'successBasis'=case when t->>'source'='duoli'then'source_updated'else'success'end)
   and(c->>'startAt')::timestamptz=coalesce(c->>'successStartAt',c->>'startAt')::timestamptz
   and(c->>'endAt')::timestamptz=coalesce(c->>'successEndAt',c->>'endAt')::timestamptz
   and(c->>'endAt')::timestamptz<=statement_timestamp()
   and((c->>'startAt')::timestamptz at time zone(t->>'timezone'))=date_trunc('day',(c->>'startAt')::timestamptz at time zone(t->>'timezone'))
   and((c->>'endAt')::timestamptz at time zone(t->>'timezone'))=date_trunc('day',(c->>'endAt')::timestamptz at time zone(t->>'timezone'))
   and((c->>'endAt')::timestamptz at time zone(t->>'timezone'))::date-((c->>'startAt')::timestamptz at time zone(t->>'timezone'))::date=1;
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
    and coalesce(j.request->>'successStartAt',j.request->>'startAt')::timestamptz=coalesce(c->>'successStartAt',c->>'startAt')::timestamptz
    and coalesce(j.request->>'successEndAt',j.request->>'endAt')::timestamptz=coalesce(c->>'successEndAt',c->>'endAt')::timestamptz
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
   -- Default consumers prefer the current currency contract over a newer
   -- obsolete-band head. The selected head keeps its actual age and cutoff.
   order by case when t->>'currency'='IDR'and not(c?'amountBands')
    and j.request->'amountBands'=private.dashboard_serving_default_amount_bands('IDR')then 0 else 1 end,
    a.computed_at desc,j.id limit 1;
  if not found then
   mixed_miss:=true;requests:=requests||jsonb_build_array(q);originals:=originals||jsonb_build_array(q);
   targets:=targets||jsonb_build_array(t);mapped:=mapped||'false'::jsonb;continue;
  end if;
  mapped:=mapped||'true'::jsonb;
  correct_default_proved:=correct_default_proved or(t->>'currency'='IDR'and not(c?'amountBands')
   and coalesce(master.request->'amountBands'=private.dashboard_serving_default_amount_bands('IDR'),false));
  different:=different or private.prepared_aggregate_key(private.prepared_aggregate_base_request(q,t),t)
     is distinct from private.prepared_aggregate_key(master.request,t);
  requests:=requests||jsonb_build_array(master.request);originals:=originals||jsonb_build_array(q);targets:=targets||jsonb_build_array(t);
 end loop;
 if not different or mixed_miss and(not mixed_allowed or not correct_default_proved)then return null;end if;
 -- The existing reader remains the only owner of authorization revalidation,
 -- refresh admission, last_requested_at, leases and retry budgets. No second
 -- scheduler and no synchronous source query are introduced.
 response:=private.prepared_aggregate_read(p_page,(p_request-array['requests','providerReuseNames','providerLeafAliases'])||jsonb_build_object('requests',requests));
 if response->>'version'is distinct from'2'or jsonb_typeof(response->'items')is distinct from'array'
  or jsonb_array_length(response->'items')<>jsonb_array_length(requests)then raise exception using errcode='22023',message='dashboard_serving_response_invalid';end if;
 for item in select value from jsonb_array_elements(response->'items')loop
  q:=originals->i;t:=targets->i;b:=private.prepared_aggregate_canonical_request(requests->i,t);c:=private.prepared_aggregate_canonical_request(q,t);
  if item->'request'is distinct from requests->i then raise exception using errcode='22023',message='dashboard_serving_response_scope';end if;
  -- A missing peer is read once under its original DTO; it cannot return a
  -- proven peer to the old default key. No extra read or projection is needed.
  if mapped->i='false'::jsonb then items:=items||jsonb_build_array(item);i:=i+1;continue;end if;
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
end;$function$
