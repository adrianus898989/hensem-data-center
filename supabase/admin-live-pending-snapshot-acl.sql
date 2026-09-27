-- Forward-only correction for the known initial install's public-schema default ACL.
-- No function body, data, scope or authenticated permission is changed.
begin;
do $pending_acl_baseline$
declare v record;
begin
 for v in select * from (values
  ('private.dashboard_admin_pending_platform_key(text,text)','c826b3869d9a27c5aa5d5a46c5e07f43','text','i',false,
   array['postgres=X/postgres']::aclitem[],array['postgres=X/postgres']::aclitem[]),
  ('private.dashboard_admin_live_pending_snapshot(jsonb)','0e91728541c57d347eee54f44ca1b1f6','jsonb','s',true,
   array['postgres=X/postgres','authenticated=X/postgres']::aclitem[],array['postgres=X/postgres','authenticated=X/postgres']::aclitem[]),
  ('public.dashboard_admin_live_pending_snapshot(jsonb)','4c8bb7f884efcc45fa4c522606def602','jsonb','s',false,
   array['postgres=X/postgres','authenticated=X/postgres']::aclitem[],array['postgres=X/postgres','authenticated=X/postgres','service_role=X/postgres']::aclitem[])
 ) x(signature,body,return_type,volatility,definer,required_acl,allowed_acl)
 loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(v.signature)
   and p.proowner='postgres'::regrole and md5(p.prosrc)=v.body
   and p.prorettype=v.return_type::regtype and p.provolatile::text=v.volatility
   and p.prosecdef=v.definer and p.proconfig=array['search_path=""'] and p.prokind='f'
   and p.proacl @> v.required_acl and p.proacl <@ v.allowed_acl) then
   raise exception 'Pending snapshot ACL correction baseline changed: %',v.signature;
  end if;
 end loop;
end;
$pending_acl_baseline$;
revoke execute on function public.dashboard_admin_live_pending_snapshot(jsonb) from service_role;
notify pgrst,'reload schema';
commit;
