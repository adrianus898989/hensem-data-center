CREATE OR REPLACE FUNCTION private.dashboard_withdraw_npg_template_read(q jsonb, r jsonb, s jsonb, c jsonb, dep text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare base_request jsonb;k jsonb;zone text;j private.withdraw_prepared_jobs%rowtype;
 a private.withdraw_prepared_artifacts%rowtype;at timestamptz:=statement_timestamp();v jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='withdraw_prepared_worker_denied';end if;
 -- This narrowly reviewed equivalence must not silently survive changed report
 -- mapping/render contracts. The existing mapping helper also pins the actual
 -- NPG receipt/coverage reader and the original source contracts on every read.
 if exists(select 1 from(values
  ('dashboard_withdraw_npg_template_zone(jsonb,jsonb,jsonb)','f6c5005c9d895fa2e76586fbf54ff4ee'),
  ('withdraw_prepared_render(jsonb,jsonb)','06baadf5408d14fd71b12e93c7ee8b68'),
  ('withdraw_window_result(jsonb,jsonb,jsonb)','5399e6d1730498e5ab35099ed0e369ea'),
  ('auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)','13092e904fca6d7cef7ec75052e0abb7'))x(signature,body_hash)
  left join pg_proc p on p.oid=to_regprocedure('private.'||x.signature)
  where p.oid is null or md5(p.prosrc)<>x.body_hash or pg_get_userbyid(p.proowner)<>'postgres'
   or p.proacl::text is distinct from'{postgres=X/postgres}'or p.proconfig is distinct from array['search_path=""']
   or p.prosecdef or p.provolatile<>'s' or p.proretset or p.proparallel<>'u' or p.proisstrict or p.proleakproof)
 then return null;end if;
 if r->>'view'is distinct from'auto'or not private.withdraw_window_whole_days(r)
  or left(r->>'startAt',10)is distinct from left(r->>'endAt',10)
  or jsonb_typeof(r->'platforms')is distinct from'array'or jsonb_array_length(r->'platforms')<>1
  or r is distinct from private.withdraw_prepared_canonical(q)
  or dep is distinct from private.withdraw_prepared_dependency()then return null;end if;
 zone:=private.dashboard_withdraw_npg_template_zone(r,s,c);
 if zone is null then return null;end if;
 -- Only platforms changes, from the uniquely mapped NPG singleton to []. All
 -- other fields (including both clocks, account, view and scopeTargets) stay exact.
 base_request:=jsonb_set(r,'{platforms}','[]'::jsonb);
 if private.dashboard_withdraw_npg_template_zone(base_request,s,c)is distinct from zone then return null;end if;
 k:=jsonb_build_array('withdraw-independent-windows-v2',s,c,base_request);
 select *into j from private.withdraw_prepared_jobs where fingerprint=md5(k::text)and request_key=k;
 if not found or j.request is distinct from base_request or j.scope is distinct from s or j.catalog is distinct from c
  or j.dependency is distinct from dep then return null;end if;
 select x.*into a from private.withdraw_prepared_heads h join private.withdraw_prepared_artifacts x on x.id=h.artifact_id
  where h.job_id=j.id and x.job_id=j.id;
 if not found or a.revision is distinct from j.revision or a.dependency is distinct from dep
  or not isfinite(a.computed_at)or not isfinite(a.expires_at)or a.computed_at>at or a.expires_at<=a.computed_at
  or a.payload->>'contract'is distinct from'withdraw-independent-windows-v2'
  or a.payload->'request'is distinct from base_request or a.payload->'scope'is distinct from s or a.payload->'catalog'is distinct from c
  or a.payload->'game66'is distinct from'{}'::jsonb
  or exists(select 1 from unnest(array['wg','yash','newar','ar','duoli','arHistory'])part where a.payload->part is distinct from'[]'::jsonb)
  or a.payload#>'{secondary,rows}'is distinct from'[]'::jsonb
  or a.payload#>>'{secondary,startAt}'is distinct from r->>'successStartAt'
  or a.payload#>>'{secondary,endAt}'is distinct from r->>'successEndAt'
  or a.payload#>>'{secondary,basis}'is distinct from r->>'successBasis'
  or a.payload#>'{secondary,createdIntersection}'is distinct from'false'::jsonb
  or a.payload#>'{secondary,complete}'is distinct from'false'::jsonb then return null;end if;
 -- These empty native arrays contain no NPG totals. The unchanged renderer
 -- reads verified NPG heads/receipts now, under q's original scope and selectors,
 -- for both current and comparison dates; missing days remain unavailable.
 v:=private.withdraw_window_result(r,private.withdraw_prepared_render(private.withdraw_window_legacy(q),a.payload),a.payload)
  ||jsonb_build_object('prepared',jsonb_build_object('status','ready','contract','withdraw-independent-windows-v2',
   'publicationVersion',2,'generation',a.id,'computedAt',a.computed_at,'expiresAt',a.expires_at,'calculationComplete',true,
   'freshness',case when a.expires_at>at then'fresh'else'refresh_due'end,
   'refreshState',case when j.status in('queued','running','failed')then j.status else'idle'end));
 return private.auto_team_previous_projection(q,a.payload,v,base_request);
end;$function$
