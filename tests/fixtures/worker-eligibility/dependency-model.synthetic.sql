-- Synthetic dependency model for the runtime install/rollback tests only.
-- This is NOT a production fingerprint implementation or a production snapshot.
-- It models body/ACL/security metadata, per-family data, native identity and scope.
-- The runtime-only dispatcher is deliberately outside this semantic model.
create table private.fixture_worker_semantics(family text primary key, revision integer not null);
insert into private.fixture_worker_semantics values('common',1),('native',1),('provider',1),('withdraw',1),('base',1);
create function private.fixture_worker_semantic_kernel(p_value text)returns text
 language sql immutable set search_path=''as $$select p_value$$;
revoke all on function private.fixture_worker_semantic_kernel(text)from public,anon,authenticated,service_role;
create function private.fixture_worker_semantic_token(p_family text,p_identity jsonb)returns text
 language sql stable set search_path=''as $$
 select md5(jsonb_build_object('model','synthetic-worker-semantic-v1','family',p_family,
  'identity',p_identity,'revision',s.revision,
  'kernel',jsonb_build_array(p.oid::regprocedure::text,md5(p.prosrc),
   pg_get_userbyid(p.proowner),p.proacl::text,p.proconfig,p.prosecdef,p.provolatile,
   p.proparallel,p.proisstrict,p.proleakproof,l.lanname,
   pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows))::text)
 from private.fixture_worker_semantics s cross join pg_proc p
 join pg_language l on l.oid=p.prolang
 where s.family=p_family and p.oid=to_regprocedure('private.fixture_worker_semantic_kernel(text)');
$$;
create function private.prepared_aggregate_dependency_common(p_scope text)returns text
 language sql stable set search_path=''as $$select private.fixture_worker_semantic_token('common',jsonb_build_object('scope',p_scope))$$;
create function private.prepared_aggregate_dependency(p_target jsonb,p_common text)returns text
 language sql stable set search_path=''as $$select case when p_common is not null then private.fixture_worker_semantic_token('native',jsonb_build_object('target',p_target,'common',p_common))end$$;
create function private.provider_snapshot_dependency_token(p_target jsonb)returns text
 language sql stable set search_path=''as $$select private.fixture_worker_semantic_token('provider',p_target)$$;
create function private.withdraw_prepared_dependency()returns text
 language sql stable set search_path=''as $$select private.fixture_worker_semantic_token('withdraw','{}'::jsonb)$$;
create function private.daily_provider_base_reuse_semantics()returns text
 language sql stable set search_path=''as $$select private.fixture_worker_semantic_token('base','{}'::jsonb)$$;
