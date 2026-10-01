-- Unified IP inventory and live assigned-role authorization. No account grants or
-- existing allowlist entries are changed by this migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$
begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.application_security_admin(uuid,uuid,text,text,text,jsonb)')) is distinct from '58da2401f564677622e4e5875750bf3d' then
  raise exception 'application_security_admin_baseline_drift';
 end if;
end $guard$;
alter table public.dashboard_ip_whitelist add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table private.application_account_ip_rules add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table private.workorder_ip_rules add column if not exists updated_by uuid references auth.users(id) on delete set null;

create or replace function private.application_security_account_authorized(p_actor uuid,p_target uuid,p_surface text,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select private.dashboard_actor_has_permission(p_actor,p_permission) and
 case when exists(select 1 from public.dashboard_profiles where auth_user_id=p_actor and active and role='owner') then
  private.application_account_exists(p_target,p_surface,false)
 when p_surface='dashboard' then private.dashboard_actor_can_manage_account(p_actor,p_target,p_permission)
 when p_surface='workorder' then private.dashboard_actor_data_scope(p_actor)->>'mode'='all'
  and exists(select 1 from public.workorder_portal_accounts where auth_user_id=p_target and role='agent')
 else false end;
$$;
create or replace function private.application_security_unified_rules(p_actor uuid,p_surface text,p_all_scope boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(row_data order by scope_order,username,network,id),'[]'::jsonb)
 from (
  select 0 scope_order,null::text username,r.ip network,r.id,jsonb_build_object('id',r.id,'scope','global','user_id',null,'username',null,'network',r.ip,'note',r.note,'active',r.active,'version',r.security_version,'updated_by',coalesce(u.username,c.username),'updated_at',r.updated_at) row_data
   from public.dashboard_ip_whitelist r left join public.dashboard_profiles u on u.auth_user_id=r.updated_by left join public.dashboard_profiles c on c.auth_user_id=r.created_by
   where p_surface='dashboard' and p_all_scope and private.dashboard_actor_has_permission(p_actor,'ip.view')
  union all
  select 0,null,r.network::text,r.id,jsonb_build_object('id',r.id,'scope','global','user_id',null,'username',null,'network',r.network::text,'note',r.note,'active',r.active,'version',r.version,'updated_by',u.username,'updated_at',r.updated_at)
   from private.workorder_ip_rules r left join public.dashboard_profiles u on u.auth_user_id=r.updated_by where p_surface='workorder' and p_all_scope and private.dashboard_actor_has_permission(p_actor,'ip.view')
  union all
  select 1,a.username,r.network::text,r.id,jsonb_build_object('id',r.id,'scope','account','user_id',r.user_id,'username',a.username,'network',r.network::text,'note',r.note,'active',r.active,'version',s.version,'ip_mode',s.ip_mode,'updated_by',u.username,'updated_at',r.updated_at)
   from private.application_account_ip_rules r join private.application_account_security s on s.user_id=r.user_id and s.surface=r.surface
   join (select auth_user_id,username from public.dashboard_profiles where p_surface='dashboard' union all select auth_user_id,username from public.workorder_portal_accounts where p_surface='workorder') a on a.auth_user_id=r.user_id
   left join public.dashboard_profiles u on u.auth_user_id=r.updated_by where r.surface=p_surface and private.application_security_account_authorized(p_actor,r.user_id,p_surface,'ip.view')
 ) x;
$$;
create or replace function public.application_security_admin(p_actor uuid,p_session_id uuid,p_ip text,p_surface text,p_action text,p_body jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare pol private.application_security_policies%rowtype; target uuid; st private.application_account_security%rowtype;
 net cidr; ip inet; rid bigint; expected integer; enabled boolean; policy jsonb; rules jsonb; state jsonb; ver integer; count_accounts integer; owner_actor boolean; all_scope boolean; caps jsonb; original_action text:=p_action; account_options jsonb; desired_scope text; requested_permission text; auto_account boolean:=false;
begin
 if p_surface not in ('dashboard','workorder') or not private.application_session_allowed(p_actor,p_session_id,'dashboard') then
  raise exception using errcode='42501',message='security_permission_denied'; end if;
 owner_actor:=exists(select 1 from public.dashboard_profiles where auth_user_id=p_actor and active and role='owner');
 all_scope:=coalesce(private.dashboard_actor_data_scope(p_actor)->>'mode'='all',false);
 caps:=jsonb_build_object('view',private.dashboard_actor_has_permission(p_actor,'ip.view'),
  'manage_global',all_scope and private.dashboard_actor_has_permission(p_actor,'ip.edit'),
  'manage_account',private.dashboard_actor_has_permission(p_actor,'ip.edit'),
  'manage_policy',all_scope and private.dashboard_actor_has_permission(p_actor,'access.edit'));
 -- Unified operations never move an existing record between scopes/accounts.
 if p_action in ('upsert-ip-rule','set-ip-rule-active','delete-ip-rule') then
  desired_scope:=p_body->>'scope';
  if desired_scope='global' and nullif(p_body->>'user_id','') is null then
   p_action:=case p_action when 'upsert-ip-rule' then 'upsert-rule' when 'set-ip-rule-active' then 'set-rule-active' else 'delete-rule' end;
  elsif desired_scope='account' and nullif(p_body->>'user_id','') is not null then
   auto_account:=p_action='upsert-ip-rule';
   p_action:=case p_action when 'upsert-ip-rule' then 'upsert-account-ip-rule' when 'set-ip-rule-active' then 'set-account-ip-rule-active' else 'delete-account-ip-rule' end;
  else raise exception using errcode='22023',message='invalid_scope'; end if;
 end if;
 if p_action in ('upsert-rule','set-rule-active','delete-rule') then
  if not (caps->>'manage_global')::boolean then raise exception using errcode='42501',message='security_permission_denied'; end if;
 elsif p_action='list-rules' then
  if not (caps->>'view')::boolean then raise exception using errcode='42501',message='security_permission_denied'; end if;
 elsif p_action='policy' then
  if p_body ? 'patch' then
   if (p_body->'patch' ? 'failure_limit') and not (all_scope and private.dashboard_actor_has_permission(p_actor,'access.edit')) then raise exception using errcode='42501',message='security_permission_denied'; end if;
   if (p_body->'patch' ? 'ip_enabled') and not (caps->>'manage_global')::boolean then raise exception using errcode='42501',message='security_permission_denied'; end if;
  elsif not private.dashboard_actor_has_permission(p_actor,'access.view') and not (caps->>'view')::boolean then raise exception using errcode='42501',message='security_permission_denied'; end if;
 elsif p_action='list-account-security' then
  if not private.dashboard_actor_has_permission(p_actor,'access.view') then raise exception using errcode='42501',message='security_permission_denied'; end if;
 elsif p_action in ('account-security','account-ip-rules','set-account-policy','unlock-account','set-account-ip-mode','upsert-account-ip-rule','set-account-ip-rule-active','delete-account-ip-rule') then
  target:=(p_body->>'user_id')::uuid;
  requested_permission:=case when p_action='account-security' then 'access.view' when p_action='account-ip-rules' then 'ip.view' when p_action='set-account-policy' then 'access.edit' when p_action='unlock-account' then 'access.status' else 'ip.edit' end;
  if not private.application_security_account_authorized(p_actor,target,p_surface,requested_permission) then raise exception using errcode='42501',message='security_permission_denied'; end if;
 else raise exception using errcode='22023',message='invalid_action'; end if;
 begin ip:=p_ip::inet; exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_ip'; end;
 if not private.application_ip_allowed('dashboard',ip,p_actor) then raise exception using errcode='42501',message='ip_denied'; end if;
 -- Serialize whitelist changes per surface, including check-current-IP protection.
 select * into pol from private.application_security_policies where surface=p_surface for update;
 if p_surface='dashboard' then
  select ip_whitelist_enabled into enabled from public.dashboard_security_settings where id=1 for update;
 else enabled:=pol.ip_enabled; end if;
 if enabled is null then raise exception 'security_settings_missing'; end if;
 if p_action='policy' and p_body ? 'patch' then
  if jsonb_typeof(p_body->'patch')<>'object' or exists(select 1 from jsonb_object_keys(p_body->'patch') k where k not in ('failure_limit','ip_enabled')) then raise exception using errcode='22023',message='invalid_policy'; end if;
  if (p_body->>'expected_version')::integer is distinct from pol.version then raise exception using errcode='40001',message='version_conflict'; end if;
  if p_body->'patch' ? 'failure_limit' then
   if jsonb_typeof(p_body->'patch'->'failure_limit')<>'number' or (p_body->'patch'->>'failure_limit')::integer not between 1 and 20 then raise exception using errcode='22023',message='invalid_failure_limit'; end if;
   pol.failure_limit:=(p_body->'patch'->>'failure_limit')::integer;
  end if;
  if p_body->'patch' ? 'ip_enabled' then
   if jsonb_typeof(p_body->'patch'->'ip_enabled')<>'boolean' then raise exception using errcode='22023',message='invalid_policy'; end if;
   enabled:=(p_body->'patch'->>'ip_enabled')::boolean;
   if p_surface='dashboard' and not enabled then raise exception using errcode='22023',message='backend_whitelist_required'; end if;
  end if;
  update private.application_security_policies set failure_limit=pol.failure_limit,ip_enabled=case when p_surface='workorder' then enabled else false end,version=version+1,updated_at=now() where surface=p_surface returning * into pol;
  if p_surface='dashboard' then update public.dashboard_security_settings set ip_whitelist_enabled=enabled,updated_by=p_actor,updated_at=now(),security_version=security_version+1 where id=1; end if;
 elsif p_action in ('upsert-rule','set-rule-active','delete-rule') then
  if p_body ? 'id' then rid:=(p_body->>'id')::bigint; end if;
  if p_action<>'upsert-rule' or rid is not null then
   if p_surface='dashboard' then select security_version into ver from public.dashboard_ip_whitelist where id=rid for update;
   else select version into ver from private.workorder_ip_rules where id=rid for update; end if;
   if ver is null then raise exception using errcode='P0002',message='rule_not_found'; end if;
   if (p_body->>'expected_version')::integer is distinct from ver then raise exception using errcode='40001',message='version_conflict'; end if;
  end if;
  if p_action='upsert-rule' then
   net:=private.application_network(p_body->>'network');
   if net is null or length(coalesce(p_body->>'note',''))>100 or (p_body ? 'active' and jsonb_typeof(p_body->'active')<>'boolean') then raise exception using errcode='22023',message='invalid_network'; end if;
   if p_surface='dashboard' then
    if exists(select 1 from public.dashboard_ip_whitelist r where private.application_network(r.ip)=net and (rid is null or r.id<>rid)) then raise exception using errcode='23505',message='rule_exists'; end if;
    if rid is null then insert into public.dashboard_ip_whitelist(ip,note,active,created_by) values(net::text,coalesce(p_body->>'note',''),coalesce((p_body->>'active')::boolean,true),p_actor);
    else update public.dashboard_ip_whitelist set ip=net::text,note=coalesce(p_body->>'note',''),active=coalesce((p_body->>'active')::boolean,active),updated_by=p_actor,security_version=security_version+1,updated_at=now() where id=rid; end if;
   else
    if rid is null then insert into private.workorder_ip_rules(network,note,updated_by,active) values(net,coalesce(p_body->>'note',''),p_actor,coalesce((p_body->>'active')::boolean,true));
    else update private.workorder_ip_rules set network=net,note=coalesce(p_body->>'note',''),active=coalesce((p_body->>'active')::boolean,active),updated_by=p_actor,version=version+1,updated_at=now() where id=rid; end if;
   end if;
  elsif p_action='delete-rule' then
   if p_surface='dashboard' then delete from public.dashboard_ip_whitelist where id=rid; else delete from private.workorder_ip_rules where id=rid; end if;
  else
   if jsonb_typeof(p_body->'active')<>'boolean' then raise exception using errcode='22023',message='invalid_active'; end if;
   if p_surface='dashboard' then update public.dashboard_ip_whitelist set active=(p_body->>'active')::boolean,updated_by=p_actor,security_version=security_version+1,updated_at=now() where id=rid;
   else update private.workorder_ip_rules set active=(p_body->>'active')::boolean,updated_by=p_actor,version=version+1,updated_at=now() where id=rid; end if;
  end if;
 elsif p_action in ('account-security','account-ip-rules','set-account-policy','unlock-account','set-account-ip-mode','upsert-account-ip-rule','set-account-ip-rule-active','delete-account-ip-rule') then
  target:=(p_body->>'user_id')::uuid;
  if not private.application_account_exists(target,p_surface,false) then raise exception using errcode='P0002',message='account_not_found'; end if;
  if p_action not in ('account-security','account-ip-rules') then
   insert into private.application_account_security(user_id,surface) values(target,p_surface) on conflict do nothing;
   select * into st from private.application_account_security where user_id=target and surface=p_surface for update;
   if (p_body->>'expected_version')::integer is distinct from st.version then raise exception using errcode='40001',message='version_conflict'; end if;
   if p_action='set-account-policy' then
    if not (p_body ? 'failure_limit') or jsonb_typeof(p_body->'failure_limit') not in ('null','number') or (p_body->>'failure_limit')::integer not between 1 and 20 then raise exception using errcode='22023',message='invalid_failure_limit'; end if;
    update private.application_account_security set failure_limit=(p_body->>'failure_limit')::integer,version=version+1 where user_id=target and surface=p_surface;
   elsif p_action='unlock-account' then
    update private.application_account_security set failed_count=0,locked_at=null,version=version+1 where user_id=target and surface=p_surface;
    -- Unlock never reactivates a disabled account or revoked session.
   elsif p_action='set-account-ip-mode' then
    if p_body->>'ip_mode' is null or p_body->>'ip_mode' not in ('inherit','allowlist') then raise exception using errcode='22023',message='invalid_ip_mode'; end if;
    if p_body->>'ip_mode'='allowlist' and not exists(select 1 from private.application_account_ip_rules where user_id=target and surface=p_surface and active) then
     raise exception using errcode='22023',message='account_whitelist_required'; end if;
    update private.application_account_security set ip_mode=p_body->>'ip_mode',version=version+1 where user_id=target and surface=p_surface;
   else
    rid:=null;
    if p_body ? 'id' then rid:=(p_body->>'id')::bigint; end if;
    if p_action<>'upsert-account-ip-rule' or rid is not null then
     perform 1 from private.application_account_ip_rules where id=rid and user_id=target and surface=p_surface for update;
     if not found then raise exception using errcode='P0002',message='rule_not_found'; end if;
    end if;
    if p_action='upsert-account-ip-rule' then
     net:=private.application_network(p_body->>'network');
     if net is null or length(coalesce(p_body->>'note',''))>100 or (p_body ? 'active' and jsonb_typeof(p_body->'active')<>'boolean') then raise exception using errcode='22023',message='invalid_network'; end if;
     if rid is null then
      if (select count(*) from private.application_account_ip_rules where user_id=target and surface=p_surface)>=100 then raise exception using errcode='22023',message='rule_limit_exceeded'; end if;
      insert into private.application_account_ip_rules(user_id,surface,network,note,active,updated_by) values(target,p_surface,net,coalesce(p_body->>'note',''),coalesce((p_body->>'active')::boolean,true),p_actor);
     else update private.application_account_ip_rules set network=net,note=coalesce(p_body->>'note',''),updated_by=p_actor,active=coalesce((p_body->>'active')::boolean,active),updated_at=now() where id=rid and user_id=target and surface=p_surface; end if;
    elsif p_action='delete-account-ip-rule' then delete from private.application_account_ip_rules where id=rid and user_id=target and surface=p_surface;
    else
     if jsonb_typeof(p_body->'active') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_active'; end if;
     update private.application_account_ip_rules set active=(p_body->>'active')::boolean,updated_by=p_actor,updated_at=now() where id=rid and user_id=target and surface=p_surface;
    end if;
    if auto_account then
     if not exists(select 1 from private.application_account_ip_rules where user_id=target and surface=p_surface and active) then raise exception using errcode='22023',message='account_whitelist_required'; end if;
     update private.application_account_security set ip_mode='allowlist' where user_id=target and surface=p_surface;
    end if;
    update private.application_account_security set version=version+1 where user_id=target and surface=p_surface;
   end if;
   if p_action in ('set-account-ip-mode','upsert-account-ip-rule','set-account-ip-rule-active','delete-account-ip-rule') then
    if target=p_actor and p_surface='dashboard' and not private.application_ip_allowed('dashboard',ip,p_actor) then raise exception using errcode='22023',message='current_ip_would_be_blocked'; end if;
    update private.application_sessions s set revoked_at=now() where s.user_id=target and s.surface=p_surface and s.revoked_at is null and not private.application_ip_allowed(p_surface,s.login_ip,target);
   end if;
  end if;
  state:=private.application_security_state(target,p_surface)-'user_id';
  if not private.application_security_account_authorized(p_actor,target,p_surface,'ip.view') then state:=state||jsonb_build_object('ip_rules','[]'::jsonb); end if;
  caps:=jsonb_build_object('manage_ip',private.application_security_account_authorized(p_actor,target,p_surface,'ip.edit'),
   'manage_account_policy',private.application_security_account_authorized(p_actor,target,p_surface,'access.edit'),
   'unlock',private.application_security_account_authorized(p_actor,target,p_surface,'access.status'));
 elsif p_action='list-account-security' then
  select count(*) into count_accounts from (select auth_user_id from public.dashboard_profiles where p_surface='dashboard' union all select auth_user_id from public.workorder_portal_accounts where p_surface='workorder') a;
  if count_accounts>5000 then raise exception using errcode='22023',message='account_limit_exceeded'; end if;
  select coalesce(jsonb_agg(case when private.application_security_account_authorized(p_actor,auth_user_id,p_surface,'ip.view') then private.application_security_state(auth_user_id,p_surface) else private.application_security_state(auth_user_id,p_surface)||jsonb_build_object('ip_rules','[]'::jsonb) end order by auth_user_id),'[]'::jsonb) into state
  from (select auth_user_id from public.dashboard_profiles where p_surface='dashboard' union all select auth_user_id from public.workorder_portal_accounts where p_surface='workorder') a
  where private.application_security_account_authorized(p_actor,auth_user_id,p_surface,'access.view');
 elsif p_action not in ('policy','list-rules') then raise exception using errcode='22023',message='invalid_action'; end if;
 if p_action in ('upsert-rule','set-rule-active','delete-rule') or (p_action='policy' and p_body ? 'patch') then
  update private.application_sessions ss set revoked_at=now() where ss.surface=p_surface and ss.revoked_at is null and not private.application_ip_allowed(p_surface,ss.login_ip,ss.user_id);
 end if;
 -- Only dashboard administration protects the owner's own current address.
 -- A workorder whitelist may intentionally contain no administrator address.
 if p_surface='dashboard' and not private.application_ip_allowed('dashboard',ip,p_actor) then raise exception using errcode='22023',message='current_ip_would_be_blocked'; end if;
 if p_action not in ('account-security','account-ip-rules','list-account-security','list-rules') and (p_action<>'policy' or p_body ? 'patch') then
  insert into private.application_security_audit(actor_id,surface,action,target_id) values(p_actor,p_surface,original_action,target);
 end if;
 if p_action='list-account-security' then return jsonb_build_object('ok',true,'states',state,'currentIp',host(ip),'capabilities',caps); end if;
 if state is not null and original_action not in ('upsert-ip-rule','set-ip-rule-active','delete-ip-rule') then return jsonb_build_object('ok',true,'security',state,'currentIp',host(ip),'capabilities',caps); end if;
 caps:=jsonb_build_object('view',private.dashboard_actor_has_permission(p_actor,'ip.view'),'manage_global',all_scope and private.dashboard_actor_has_permission(p_actor,'ip.edit'),'manage_account',private.dashboard_actor_has_permission(p_actor,'ip.edit'),'manage_policy',all_scope and private.dashboard_actor_has_permission(p_actor,'access.edit'));
 policy:=jsonb_build_object('failure_limit',pol.failure_limit,'ip_enabled',enabled,'version',pol.version);
 rules:=case when private.dashboard_actor_has_permission(p_actor,'ip.view') then private.application_security_unified_rules(p_actor,p_surface,all_scope) else '[]'::jsonb end;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.auth_user_id,'username',a.username,'active',a.active,'ip_mode',coalesce(s.ip_mode,'inherit'),'version',coalesce(s.version,1)) order by a.username),'[]'::jsonb) into account_options
 from (select auth_user_id,username,active from public.dashboard_profiles where p_surface='dashboard' union all select auth_user_id,username,active from public.workorder_portal_accounts where p_surface='workorder') a
 left join private.application_account_security s on s.user_id=a.auth_user_id and s.surface=p_surface
 where private.application_security_account_authorized(p_actor,a.auth_user_id,p_surface,'ip.view');
 return jsonb_build_object('ok',true,'policy',policy,'rules',rules,'accounts',account_options,'currentIp',host(ip),'capabilities',caps);

end $$;

revoke all on function private.application_security_account_authorized(uuid,uuid,text,text),private.application_security_unified_rules(uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.application_security_admin(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.application_security_admin(uuid,uuid,text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
