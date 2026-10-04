-- Bound concurrent cache-job creation per authenticated actor without waiting.
-- Only the existing volatile job RPC body changes; source/order data and the
-- >15 reader, grants, signature, owner, settings and gateway remain unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $patch$
declare p record;definition text;before_metadata jsonb;after_metadata jsonb;
 old_fragment text:=$old$  -- Only expired derived job data is removed; collected orders are never written.$old$;
 new_fragment text:=$new$  -- Serialize only this actor's short creation phase, so concurrent starts
  -- cannot race the per-actor cache bound. Do not wait on another query.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('dashboard_submission_streak_start:'||v_uid::text,0)) then
   raise exception using errcode='55000',message='analysis_busy';end if;
  -- Only expired derived job data is removed; collected orders are never written.$new$;
begin
 select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('private.dashboard_admin_live_submission_streak(jsonb)');
 if not found or p.provolatile<>'v' or not p.prosecdef or p.prorettype<>'jsonb'::regtype
  or p.proargtypes<>'3802'::oidvector or p.pronargs<>1 or p.pronargdefaults<>0
  or p.proconfig is distinct from array['search_path=""','jit=off','work_mem=64MB']::text[]
  or p.proacl::text[] is distinct from array['postgres=X/postgres','authenticated=X/postgres']::text[]
  or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' then
  raise exception 'submission_streak_creation_lock_metadata_drift';end if;
 if md5(p.prosrc)='d154681ef237219a38343c4d3cc0b083' then return;end if;
 if md5(p.prosrc)<>'a6ee0a0a94c33b99542eb8cc2c8c6c02' then raise exception 'submission_streak_creation_lock_body_drift';end if;
 before_metadata:=to_jsonb(p)-'prosrc';definition:=pg_catalog.pg_get_functiondef(p.oid);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception 'submission_streak_creation_lock_anchor_drift';end if;
 execute replace(definition,old_fragment,new_fragment);
 select to_jsonb(f)-'prosrc' into after_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
 if after_metadata is distinct from before_metadata
  or (select md5(prosrc) from pg_catalog.pg_proc where oid=p.oid)<>'d154681ef237219a38343c4d3cc0b083' then
  raise exception 'submission_streak_creation_lock_postcondition_drift';end if;
end;$patch$;
notify pgrst,'reload schema';
commit;
