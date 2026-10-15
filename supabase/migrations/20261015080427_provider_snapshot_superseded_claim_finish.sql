-- Fenced finish of explicit dependency supersession. No queue reset, retry, payload or account writes.
begin;
set local statement_timeout='3s';set local lock_timeout='1s';
do $patch$
declare e jsonb;actual jsonb;metadata jsonb;definition text;
begin
if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_worker_installer_denied';end if;
for e in select value from jsonb_array_elements($deps$[{"signature":"private.provider_snapshot_complete(uuid, uuid, bigint, jsonb, jsonb)","body_md5":"57bb4fb51423ddbf59e356e54fee99b2","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":5,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950 2950 20 3802 3802","allargtypes":null,"argmodes":null,"argnames":"{p_job_id,p_run_id,p_fence,p_payload,p_provenance}","arguments":"p_job_id uuid, p_run_id uuid, p_fence bigint, p_payload jsonb, p_provenance jsonb","result":"jsonb"},{"signature":"private.provider_snapshot_fail(uuid, uuid, bigint, text)","body_md5":"f4b9c34e2ec3fe64f347894ec67f8182","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":4,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"2950 2950 20 25","allargtypes":null,"argmodes":null,"argnames":"{p_job_id,p_run_id,p_fence,p_error_code}","arguments":"p_job_id uuid, p_run_id uuid, p_fence bigint, p_error_code text","result":"boolean"}]$deps$::jsonb)loop
 select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
 if actual is distinct from e then raise exception using errcode='55000',message='snapshot_worker_dependency_drift',detail=e->>'signature';end if;
end loop;
e:=$before${"signature":"private.provider_snapshot_run_claimed(text)","body_md5":"e835c7b23fe9acfd314ced1961b85ef5","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25","allargtypes":null,"argmodes":null,"argnames":"{p_worker}","arguments":"p_worker text","result":"jsonb"}$before$::jsonb;
select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
if actual is null or actual-'body_md5' is distinct from e-'body_md5' then raise exception using errcode='55000',message='snapshot_worker_metadata_drift';end if;
if actual->>'body_md5'='6a5a418cb1fabf6fdbe6b7c59ebcfcd9'then return;end if;
if actual is distinct from e then raise exception using errcode='55000',message='snapshot_worker_body_drift';end if;
select to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid)into metadata,definition from pg_proc p where p.oid='private.provider_snapshot_run_claimed(text)'::regprocedure;
if (length(definition)-length(replace(definition,$old$  return jsonb_build_object('status',case when r->'published'='true'::jsonb then'published'else'superseded'end,'jobId',j.id,'snapshotId',r->'snapshotId');$old$,'')))/length($old$  return jsonb_build_object('status',case when r->'published'='true'::jsonb then'published'else'superseded'end,'jobId',j.id,'snapshotId',r->'snapshotId');$old$)<>1 then raise exception using errcode='55000',message='snapshot_worker_anchor_drift';end if;
execute replace(definition,$old$  return jsonb_build_object('status',case when r->'published'='true'::jsonb then'published'else'superseded'end,'jobId',j.id,'snapshotId',r->'snapshotId');$old$,$new$  -- Only a still-owned active claim may record these configuration failures.
  -- The existing fail() enforces run/fence/status/lease and preserves attempts,
  -- revision and the last-good head. Obsolete/replay paths never invoke fail().
  if r->'published' is distinct from 'true'::jsonb
    and r->>'reason' in ('dependency_changed','kernel_contract_changed','target_changed') then
   perform private.provider_snapshot_fail(j.id,j.run_id,j.fence,'dependency_changed');
  end if;
  return jsonb_build_object('status',case when r->'published'='true'::jsonb then'published'else'superseded'end,'jobId',j.id,'snapshotId',r->'snapshotId')
   || case when r->'published' is distinct from 'true'::jsonb
      and r->>'reason' in ('dependency_changed','kernel_contract_changed','target_changed','obsolete','replay_mismatch')
     then jsonb_build_object('reason',r->>'reason') else '{}'::jsonb end;$new$);
if(select to_jsonb(p)-'prosrc' from pg_proc p where p.oid='private.provider_snapshot_run_claimed(text)'::regprocedure)is distinct from metadata then raise exception using errcode='55000',message='snapshot_worker_metadata_changed';end if;
e:=$after${"signature":"private.provider_snapshot_run_claimed(text)","body_md5":"6a5a418cb1fabf6fdbe6b7c59ebcfcd9","language":"plpgsql","owner":"postgres","prosecdef":false,"provolatile":"v","proparallel":"u","proisstrict":false,"proleakproof":false,"proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","procost":100,"prorows":0,"pronargs":1,"pronargdefaults":0,"variadic":0,"prokind":"f","proretset":false,"argtypes":"25","allargtypes":null,"argmodes":null,"argnames":"{p_worker}","arguments":"p_worker text","result":"jsonb"}$after$::jsonb;
select to_jsonb(q)into actual from(select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
md5(p.prosrc)body_md5,l.lanname language,pg_get_userbyid(p.proowner)owner,p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,
p.proconfig,p.proacl::text acl,p.procost,p.prorows,p.pronargs,p.pronargdefaults,p.provariadic::int variadic,
p.prokind,p.proretset,p.proargtypes::text argtypes,p.proallargtypes::text allargtypes,p.proargmodes::text argmodes,p.proargnames::text argnames,
pg_get_function_arguments(p.oid)arguments,pg_get_function_result(p.oid)result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(e->>'signature'))q;
if actual is distinct from e then raise exception using errcode='55000',message='snapshot_worker_postcondition_drift';end if;
end;$patch$;
notify pgrst,'reload schema';
commit;
