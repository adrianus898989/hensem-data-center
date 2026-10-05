-- Keep existing open pages on their operation-date contract until they refresh.
-- The new original-order reconciliation explicitly requests submission dates.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $compatibility$
declare p record;h record;auth_role oid;definition text;before_meta jsonb;after_meta jsonb;
 old_text constant text:=$old$if p_query->>'view'='missing' and p_query->>'country' in ('IN','印度') and coalesce(p_query->'filters'->>'issueKind','') in ('','deposit') then$old$;
 new_text constant text:=$new$if p_query->>'view'='missing' and p_query->>'country' in ('IN','印度') and coalesce(p_query->'filters'->>'issueKind','') in ('','deposit')
  and p_query->'filters'->>'dateBasis'='submission' then$new$;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_workorder_records(jsonb)');
 select oid into auth_role from pg_roles where rolname='authenticated';
 if p.oid is null or md5(p.prosrc) not in ('3a9be0fed844c7d3e05dd05392210c18','2fb4df122737456d9d5bbd8307786183')
  or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s' or not p.prosecdef or p.pronargdefaults<>0
  or p.proconfig is distinct from array['search_path=""','statement_timeout=20s']::text[] then raise exception 'REGISTRATION_COMPATIBILITY_ROUTER_CHANGED';end if;
 if auth_role is null or not exists(select 1 from aclexplode(p.proacl) a where a.grantee=auth_role and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,auth_role) or a.grantee=auth_role and a.is_grantable) then raise exception 'REGISTRATION_COMPATIBILITY_ACL_CHANGED';end if;
 select * into h from pg_proc where oid=to_regprocedure('private.dashboard_admin_workorder_registration(jsonb)');
 if h.oid is null or md5(h.prosrc)<>'2b9461f02a6850891f574899cdb326b0' or h.prosecdef or h.provolatile<>'s' or h.prorettype<>'jsonb'::regtype
  or h.proconfig is distinct from array['search_path=""']::text[] or h.proowner<>p.proowner
  or exists(select 1 from aclexplode(coalesce(h.proacl,acldefault('f',h.proowner))) a where a.grantee<>h.proowner) then raise exception 'REGISTRATION_COMPATIBILITY_HELPER_CHANGED';end if;
 if md5(p.prosrc)='2fb4df122737456d9d5bbd8307786183' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc';
 definition:=pg_get_functiondef(p.oid);
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'REGISTRATION_COMPATIBILITY_FRAGMENT_CHANGED';end if;
 execute replace(definition,old_text,new_text);
 select to_jsonb(f)-'prosrc' into after_meta from pg_proc f where f.oid=p.oid;
 if before_meta is distinct from after_meta then raise exception 'REGISTRATION_COMPATIBILITY_METADATA_CHANGED';end if;
 if (select md5(prosrc) from pg_proc where oid=p.oid)<>'2fb4df122737456d9d5bbd8307786183' then raise exception 'REGISTRATION_COMPATIBILITY_RESULT_CHANGED';end if;
end;$compatibility$;
notify pgrst,'reload schema';
commit;
