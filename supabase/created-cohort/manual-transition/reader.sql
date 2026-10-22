create or replace function private.dashboard_created_manual_transition(q jsonb,t jsonb,dep text)
returns jsonb language plpgsql stable set search_path='' as $function$
declare c jsonb;b jsonb;m record;v jsonb;
begin
 -- This private helper is reached only after original reader role/page/native
 -- authorization. Explicit created mode and ambiguous old requests never enter.
 if not coalesce(q->>'successBasis'in('success','source_updated'),false)or not(q?'successStartAt'and q?'successEndAt')
 or private.prepared_aggregate_request_reason(q,t)is not null then return null;end if;
 c:=private.prepared_aggregate_canonical_request(q,t);
 b:=private.prepared_aggregate_canonical_request(private.prepared_aggregate_base_request(q,t),t);
 select z.*,a.payload,a.computed_at,a.expires_at,a.cutoff,a.source_complete into m
 from private.created_cohort_manual_transition z
 join private.prepared_aggregate_jobs j on j.id=z.job_id
 join private.prepared_aggregate_heads h on h.job_id=z.job_id and h.artifact_id=z.artifact_id
 join private.prepared_aggregate_artifacts a on a.id=z.artifact_id and a.job_id=z.job_id
 where z.target=t and z.new_dependency=dep and statement_timestamp()<z.valid_until
 and statement_timestamp()>=z.installed_at and z.old_dependency<>z.new_dependency
 and j.target=t and j.request=z.request and j.request_key=z.request_key
 and j.request_fingerprint=md5(z.request_key::text)
 and j.dependency in(z.old_dependency,z.new_dependency)and j.revision in(z.revision,z.revision+1)
 and z.request_key=private.prepared_aggregate_key(z.request,t)
 and a.dependency=z.old_dependency and a.revision=z.revision and a.fence=z.fence
 and md5(a.payload::text)=z.payload_hash and a.computed_at is not null
 and a.expires_at>a.computed_at and isfinite(a.cutoff)and a.source_complete is not null
 and z.request->>'successBasis'=c->>'successBasis'
 and (private.prepared_aggregate_canonical_request(z.request,t)=b or(
  z.request->>'view'='full'and z.request->>'durationVersion'='2'and z.request->>'direction'='all'
  and not(z.request?'durationRange')and coalesce(z.request->>'status','all')='all'
  and case when c->>'view'='providers'then
   coalesce(z.request->'providers','[]'::jsonb)='[]'::jsonb
   and(private.prepared_aggregate_canonical_request(z.request,t)-array['view','durationVersion','amountBands','direction','providers'])=(c-array['view','durationVersion','amountBands','direction','providers'])
  else(private.prepared_aggregate_canonical_request(z.request,t)-array['durationVersion','direction']-case when not(c?'amountBands')then array['amountBands']else array[]::text[]end)=(c-array['durationVersion','direction'])end))
 order by case when z.request->>'view'='full'and z.request->>'durationVersion'='2'then 0 else 1 end,
  case when t->>'currency'='IDR'and not(c?'amountBands')and z.request->'amountBands'=private.dashboard_serving_default_amount_bands('IDR')then 0 else 1 end,
  a.computed_at desc,z.job_id limit 1;
 if not found then return null;end if;
 b:=private.prepared_aggregate_canonical_request(m.request,t);v:=m.payload;
 if b->>'view'='full'and b->>'durationVersion'='2'and not(b?'durationRange')then
  if c->>'view'='full'and not(c?'amountBands')then
   v:=jsonb_set(v-array['amountBands','amountBandsVersion'],'{groups}',(v->'groups')-array['amount_range','matrix_range']);b:=b-'amountBands';
  end if;
  v:=private.prepared_aggregate_master_projection(v,b,c);
 elsif c->>'view'='providers'then v:=private.dashboard_prepared_provider_projection(v,b,c);
 elsif b->>'direction'='all'then v:=private.dashboard_prepared_direction_projection(v,b,c);end if;
 return jsonb_build_object('publication',jsonb_build_object('id',m.artifact_id,'generation',m.revision::text||':'||m.fence::text,
  'computedAt',m.computed_at,'expiresAt',m.expires_at,'cutoff',m.cutoff,'calculationComplete',true,'sourceComplete',m.source_complete,
  'freshness','refresh_due','semanticTransition','manual_previous_dependency','transitionExpiresAt',m.valid_until),
  'result',private.prepared_aggregate_echo(v,q,t));
end;$function$;
revoke all on function private.dashboard_created_manual_transition(jsonb,jsonb,text)from public,anon,authenticated,service_role;
