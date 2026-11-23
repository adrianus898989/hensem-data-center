-- Amount analysis serving only; verified existing publications, no financial or queue writes.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $amount_ready$
declare
 reader regprocedure:='private.dashboard_serving_ready_read(text,jsonb)'::regprocedure;
 definition text; common_before jsonb; common_after jsonb;
 dependency record;
begin
 if current_user <> 'postgres' then raise exception using errcode='42501',message='amount_ready_release_owner_required';end if;
 for dependency in select * from (values
  ('private.dashboard_serving_compact_read(text,jsonb)','ac85fc32654644b51e18dc85812678ac'),
  ('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)','6d453d257b02b6bd5362abb49bb5d292'),
  ('private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)','0d13d39347899ee453179c1b7851d749')
 ) as deps(identity,definition_md5) loop
  if md5(pg_get_functiondef(to_regprocedure(dependency.identity))) is distinct from dependency.definition_md5
  then raise exception using errcode='22023',message='amount_ready_prerequisite_drift',detail=dependency.identity;end if;
 end loop;
 select pg_get_functiondef(p.oid) into definition from pg_proc p where p.oid=reader and
  pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}'
  and p.provolatile='s' and not p.prosecdef and md5(p.prosrc)='69773d5e6124c91bd58418f1fe65377f';

 if md5(definition) is distinct from '58805b3f199b0226850abc73efe162f2' then raise exception using errcode='22023',message='amount_ready_install_preflight_drift';end if;
 select jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope)) into common_before
  from unnest(array['IN','BR','VN','ID','PK','ZAR','MX','CO'])scope;
 definition:=replace(definition,
$old$ profile text:=p_request->>'responseProfile';full_transport boolean:=coalesce(p_request->>'responseProfile'='time-v1',false);$old$,
$new$ profile text:=p_request->>'responseProfile';full_transport boolean:=coalesce(profile in('time-v1','amount-v1'),false);
 profile_groups text[];projected jsonb;$new$);
 definition:=replace(definition,
$old$   jsonb_typeof(p_request->'responseProfile')='string' and profile='time-v1'
   and p_page in('teamops','teamcountries','teamplatforms','time')
   else p_page in('providers','provider_payout','overview','merchants','teamops','teamcountries','teamplatforms')end,false)$old$,
$new$   jsonb_typeof(p_request->'responseProfile')='string' and (
    profile='time-v1' and p_page in('teamops','teamcountries','teamplatforms','time')
    or profile='amount-v1' and p_page='amount')
   else p_page in('providers','provider_payout','overview','merchants','teamops','teamcountries','teamplatforms','amount')end,false)$new$);
 definition:=replace(definition,
$old$  or jsonb_array_length(p_request->'requests')not between 1 and 50$old$,
$new$  or jsonb_array_length(p_request->'requests')not between 1 and (case when p_page='amount' then 20 else 50 end)$new$);
 definition:=replace(definition,
$old$   or c->>'successBasis'<>'created'and(a is distinct from(c->>'successStartAt')::timestamptz or b is distinct from(c->>'successEndAt')::timestamptz)$old$,
$new$   or c->>'successBasis'<>'created'and(a is distinct from(c->>'successStartAt')::timestamptz or b is distinct from(c->>'successEndAt')::timestamptz)
   or p_page='amount' and (
    t->>'country' is distinct from '印度' or t->>'currency' is distinct from 'INR'
    or q->>'currency' is distinct from 'INR' or q->>'status' is distinct from 'all'
    or q->>'successBasis' is distinct from 'created'
    or q ?| array['successStartAt','successEndAt','amountMin','amountMax','amountMaxExclusive','durationRange'])$new$);
 definition:=replace(definition,
$old$  if full_transport then
   if jsonb_typeof(payload->'groups')is distinct from'object'
    or jsonb_typeof(payload#>'{groups,hourly}')is distinct from'array'
    or jsonb_typeof(payload#>'{groups,provider}')is distinct from'array'
   then raise exception using errcode='22023',message='prepared_ready_publication_invalid';end if;
   -- Same time-v1 transport as the ordinary compact reader, after the same
   -- full projection. All monetary totals, clocks and metadata remain intact.
   payload:=jsonb_set(payload,'{groups}',jsonb_build_object('hourly',payload#>'{groups,hourly}','provider',payload#>'{groups,provider}'));
  end if;$old$,
$new$  if full_transport then
   profile_groups:=case when profile='amount-v1' then
    case when q?'amountBands' then array['amount','amount_range','provider'] else array['amount','provider'] end
    else array['hourly','provider'] end;
   if jsonb_typeof(payload->'groups')is distinct from'object'
    or profile='amount-v1' and payload ?| array['_parts','_preparedPublication']
    or exists(select 1 from unnest(profile_groups) g where jsonb_typeof(payload->'groups'->g)is distinct from'array')
   then raise exception using errcode='22023',message='prepared_ready_publication_invalid';end if;
   select jsonb_object_agg(g,payload->'groups'->g) into projected from unnest(profile_groups) g;
   payload:=jsonb_set(payload,'{groups}',projected);
  end if;$new$);
 definition:=replace(definition,
$old$    jsonb_build_object('resultGroups',jsonb_build_object('contract','prepared-result-groups-v1','profile','time-v1','groups',jsonb_build_array('hourly','provider')))$old$,
$new$    jsonb_build_object('resultGroups',jsonb_build_object('contract','prepared-result-groups-v1','profile',profile,'groups',to_jsonb(profile_groups)))$new$);
 definition:=replace(definition,
$old$  if jsonb_typeof(artifact.payload)is distinct from'object'$old$,
$new$  -- Only the validated full-v2 publisher contract is admitted for the new
  -- amount transport. Legacy heads stay on their ordinary serving path.
  if p_page='amount' and full_transport and (
   baseq->>'view' is distinct from 'full' or baseq->>'durationVersion' is distinct from '2' or baseq?'durationRange')
  then
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','miss','reason','ready_head_missing','publication',null,'result',null));continue;
  end if;
  if jsonb_typeof(artifact.payload)is distinct from'object'$new$);
 if md5(definition) is distinct from 'a556549c122d06bc0c4a92a9a795aafc' then raise exception using errcode='22023',message='amount_ready_install_transform_drift';end if;
 execute definition;
 if not exists(select from pg_proc p where p.oid=reader and md5(pg_get_functiondef(p.oid))='a556549c122d06bc0c4a92a9a795aafc'
   and md5(p.prosrc)='966f086a1a862f926ff92967deaa6ec4' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}'
   and p.provolatile='s' and not p.prosecdef)
 then raise exception using errcode='22023',message='amount_ready_install_postflight_drift';end if;
 select jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope)) into common_after
  from unnest(array['IN','BR','VN','ID','PK','ZAR','MX','CO'])scope;
 if common_before is distinct from common_after then raise exception using errcode='22023',message='amount_ready_dependency_changed';end if;
end;$amount_ready$;
COMMIT;
