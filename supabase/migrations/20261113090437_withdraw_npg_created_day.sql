-- Scope-limited NPG report-serving compatibility. Existing native bundles and queue are untouched.
begin;
set local lock_timeout='500ms';
set local statement_timeout='8s';
create temporary table npg_created_day_guard on commit drop as
 select to_jsonb(p)-'prosrc' as metadata,private.withdraw_prepared_dependency() as financial_dependency
 from pg_proc p where p.oid='private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)'::regprocedure;
do $guard$
begin
 if current_user<>'postgres' or not pg_try_advisory_xact_lock(hashtext('withdraw_duoli_daily_fallback_v1')) then
  raise exception 'npg_created_day_install_busy_or_denied';
 end if;
 if exists(select 1 from(values
 ('dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)','ce1baf7d1ec8999a8a4646485b3aac9f'),
 ('dashboard_withdraw_npg_template_zone(jsonb,jsonb,jsonb)','f6c5005c9d895fa2e76586fbf54ff4ee'),
 ('withdraw_prepared_render(jsonb,jsonb)','8035e437fd2421568754ec1005ca16d4'),
 ('withdraw_window_result(jsonb,jsonb,jsonb)','f5097173ef6236c708c1199d7507fd27'),
 ('auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)','9ee2927b3f363062b4c37e6df56f6ec4')
 )x(signature,body_hash) left join pg_proc p on p.oid=to_regprocedure('private.'||x.signature)
 where p.oid is null or md5(p.prosrc)<>x.body_hash or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proacl::text is distinct from'{postgres=X/postgres}'or p.proconfig is distinct from array['search_path=""']
  or p.prosecdef or p.provolatile<>'s' or p.proretset or p.proparallel<>'u' or p.proisstrict or p.proleakproof)
 then raise exception 'npg_created_day_contract_drift';end if;
end;$guard$;
create or replace function private.dashboard_withdraw_npg_template_read(q jsonb,r jsonb,s jsonb,c jsonb,dep text)
returns jsonb language plpgsql stable set search_path=''as $function$
declare base_request jsonb;k jsonb;zone text;j private.withdraw_prepared_jobs%rowtype;
 a private.withdraw_prepared_artifacts%rowtype;at timestamptz:=statement_timestamp();v jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='withdraw_prepared_worker_denied';end if;
 -- This narrowly reviewed equivalence must not silently survive changed report
 -- mapping/render contracts. The existing mapping helper also pins the actual
 -- NPG receipt/coverage reader and the original source contracts on every read.
 if exists(select 1 from(values
  ('dashboard_withdraw_npg_template_zone(jsonb,jsonb,jsonb)','f6c5005c9d895fa2e76586fbf54ff4ee'),
  ('withdraw_prepared_render(jsonb,jsonb)','8035e437fd2421568754ec1005ca16d4'),
  ('withdraw_window_result(jsonb,jsonb,jsonb)','f5097173ef6236c708c1199d7507fd27'),
  ('auto_team_previous_projection(jsonb,jsonb,jsonb,jsonb)','9ee2927b3f363062b4c37e6df56f6ec4'))x(signature,body_hash)
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
 -- Start with the same-option country bundle. The sole additional candidate is
 -- the old default for this same whole creation day when success was not requested.
 -- All other selectors, authorization, native identity and clocks must match.
 base_request:=jsonb_set(r,'{platforms}','[]'::jsonb);
 if private.dashboard_withdraw_npg_template_zone(base_request,s,c)is distinct from zone then return null;end if;
 for base_request in
  select t.candidate from (values (1,base_request),
   (2,case when r->'includeSecondary'='false'::jsonb
    and r->>'successBasis'='success' and r->>'successStartAt'=r->>'startAt'
    and r->>'successEndAt'=r->>'endAt' and nullif(r->>'account','')is null
    then base_request-'includeSecondary' end))t(priority,candidate)
  where t.candidate is not null order by t.priority
 loop
  k:=jsonb_build_array('withdraw-independent-windows-v2',s,c,base_request);
  select *into j from private.withdraw_prepared_jobs where fingerprint=md5(k::text)and request_key=k;
  if not found then continue;end if;
  if j.request is distinct from base_request or j.scope is distinct from s or j.catalog is distinct from c
   or j.dependency is distinct from dep then return null;end if;
  select x.*into a from private.withdraw_prepared_heads h join private.withdraw_prepared_artifacts x on x.id=h.artifact_id
   where h.job_id=j.id and x.job_id=j.id;
  exit when found;
 end loop;
 if a.id is null or a.revision is distinct from j.revision or a.dependency is distinct from dep
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
 -- Empty native data is proven above. Match the canonical secondary DTO as well,
 -- then render the requested option using the existing no-scan omission branch.
 if r->'includeSecondary'='false'::jsonb and not (base_request?'includeSecondary')then
  if a.payload->'secondary' is distinct from private.withdraw_window_secondary(base_request,s,c)then return null;end if;
  a.payload:=jsonb_set(a.payload,'{secondary}',private.withdraw_window_secondary(r,s,c));
 end if;
 -- These empty native arrays contain no NPG totals. The unchanged renderer
 -- reads verified NPG heads/receipts now, under q's original scope and selectors,
 -- for both current and comparison dates; missing days remain unavailable.
 v:=private.withdraw_window_result(r,private.withdraw_prepared_render(private.withdraw_window_legacy(q),a.payload),a.payload)
  ||jsonb_build_object('prepared',jsonb_build_object('status','ready','contract','withdraw-independent-windows-v2',
   'publicationVersion',2,'generation',a.id,'computedAt',a.computed_at,'expiresAt',a.expires_at,'calculationComplete',true,
   'freshness',case when a.expires_at>at then'fresh'else'refresh_due'end,
   'refreshState',case when j.status in('queued','running','failed')then j.status else'idle'end));
 return private.auto_team_previous_projection(q,a.payload,v,base_request);
end;$function$;
do $check$
begin
 if not exists(select 1 from pg_temp.npg_created_day_guard g join pg_proc p on p.oid='private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)'::regprocedure
  where to_jsonb(p)-'prosrc'=g.metadata and md5(p.prosrc)='bbe2e55d3aadf719eabeabe5ef811bf2'
  and private.withdraw_prepared_dependency()=g.financial_dependency)
 then raise exception 'npg_created_day_verification_failed';end if;
end;$check$;
commit;
