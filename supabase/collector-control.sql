-- First-release process control. Apply after the current dashboard roles.
-- Additive, service-only storage: does not alter collector/order/business tables.
-- Human authorization is checked by the Edge handler on each request.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Preserve every existing page, request, permission and function ACL. Never
-- replace the live catalog with a generated frontend snapshot.
do $register_collector_control$
declare
 before_catalog jsonb;
 after_catalog jsonb;
 before_meta jsonb;
 pages jsonb;
 new_page constant jsonb := '{"id":"collector_control","moduleId":"system","moduleLabel":"系统管理后台","label":"采集管理","actions":[{"id":"view","label":"查看电脑与任务"},{"id":"edit","label":"连接电脑与启停任务","sensitive":true}],"requests":["collectorControl"]}'::jsonb;
 new_permissions constant jsonb := '[{"key":"collector_control.view"},{"key":"collector_control.edit"}]'::jsonb;
 function_id oid := to_regprocedure('private.dashboard_role_catalog()');
 body_hash text;
 definition_hash text;
begin
 if function_id is null then raise exception 'collector_control_catalog_missing';end if;
 select to_jsonb(p)-'prosrc',md5(p.prosrc),md5(pg_get_functiondef(p.oid))
 into before_meta,body_hash,definition_hash from pg_proc p where p.oid=function_id;
 if (select pg_get_userbyid(proowner)<>'postgres'
   or proacl::text is distinct from '{postgres=X/postgres}' or prosecdef
   or provolatile<>'i' or prolang<>(select oid from pg_language where lanname='sql')
   or proconfig is distinct from array['search_path=""']
   from pg_proc where oid=function_id) then
  raise exception 'collector_control_catalog_metadata_drift';
 end if;
 -- Replays accept the exact final definition; partial registration fails closed.
 if body_hash='39bf5d400a9c26c2c8614b18bf459ebc'
  and definition_hash='7da689e746c4d5302f4507078454d4bd' then return;end if;
 -- Verified production baseline includes daily comparison, success analysis,
 -- delegated IP editing and the current query routes.
 if body_hash<>'a8d63fb20a46abf508c3bf9e07e0027d'
  or definition_hash<>'573d702c8135b4bb667feb23365054e5' then
  raise exception 'collector_control_catalog_baseline_drift';
 end if;
 before_catalog:=private.dashboard_role_catalog();
 if (select count(*) from jsonb_array_elements(before_catalog->'pages') p where p->>'id'='access')<>1
  or exists(select 1 from jsonb_array_elements(before_catalog->'pages') p where p->>'id'='collector_control')
  or exists(select 1 from jsonb_array_elements(before_catalog->'permissions') p where p->>'key' like 'collector_control.%') then
  raise exception 'collector_control_catalog_entry_drift';
 end if;
 select jsonb_agg(inserted.p order by original.ord,inserted.ord) into pages
 from jsonb_array_elements(before_catalog->'pages') with ordinality original(p,ord)
 cross join lateral jsonb_array_elements(case when original.p->>'id'='access'
  then jsonb_build_array(original.p,new_page) else jsonb_build_array(original.p) end)
  with ordinality inserted(p,ord);
 after_catalog:=jsonb_set(jsonb_set(before_catalog,'{pages}',pages),'{permissions}',(before_catalog->'permissions')||new_permissions);
 execute format('create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as %L',
  'select '||quote_literal(after_catalog::text)||'::jsonb');
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid=function_id) is distinct from before_meta then
  raise exception 'collector_control_catalog_metadata_changed';
 end if;
 if private.dashboard_role_catalog() is distinct from after_catalog
  or (select md5(prosrc)<>'39bf5d400a9c26c2c8614b18bf459ebc'
   or md5(pg_get_functiondef(oid))<>'7da689e746c4d5302f4507078454d4bd'
   from pg_proc where oid=function_id) then
  raise exception 'collector_control_catalog_output_changed';
 end if;
end $register_collector_control$;
create schema if not exists private;
create table if not exists private.collector_control_devices (
 id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 1 and 80 and name !~ '[[:cntrl:]]'),
 token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'), agent_version text not null,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 last_seen_at timestamptz, revoked_at timestamptz
);
create table if not exists private.collector_control_pairings (
 code_hash text primary key check (code_hash ~ '^[a-f0-9]{64}$'), name text not null,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null
);
create table if not exists private.collector_control_tasks (
 device_id uuid not null references private.collector_control_devices(id) on delete cascade,
 task_id text not null check (task_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$'),
 label text not null check (length(label) between 1 and 80 and label !~ '[[:cntrl:]]'),
 desired_state text not null default 'stopped' check (desired_state in ('running','stopped')),
 revision bigint not null default 0 check (revision between 0 and 9007199254740991),
 observed_state text not null default 'stopped' check (observed_state in ('stopped','starting','running','stopping','failed','blocked','external_running')),
 pid integer check (pid>0), detail_code text not null default 'stopped', available boolean not null default true,
 requested_by uuid, updated_at timestamptz not null default clock_timestamp(),
 primary key (device_id,task_id)
);
create table if not exists private.collector_control_audit (
 id bigint generated by default as identity primary key, actor_id uuid, device_id uuid,
 task_id text, action text not null check (action in ('pairing_created','paired','revoked','running','stopped')),
 revision bigint, created_at timestamptz not null default clock_timestamp()
);
create index if not exists collector_control_audit_created_idx on private.collector_control_audit(created_at);
create index if not exists collector_control_pairing_actor_idx on private.collector_control_pairings(created_by,expires_at);
alter table private.collector_control_devices enable row level security;
alter table private.collector_control_pairings enable row level security;
alter table private.collector_control_tasks enable row level security;
alter table private.collector_control_audit enable row level security;
revoke all on private.collector_control_devices,private.collector_control_pairings,private.collector_control_tasks,private.collector_control_audit from public,anon,authenticated;
revoke all on sequence private.collector_control_audit_id_seq from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update,delete on private.collector_control_devices,private.collector_control_pairings,private.collector_control_tasks,private.collector_control_audit to service_role;
grant usage,select on sequence private.collector_control_audit_id_seq to service_role;

create or replace function private.collector_control_audit_event(p_actor uuid,p_device uuid,p_task text,p_action text,p_revision bigint default null)
returns void language plpgsql volatile security invoker set search_path='' as $$
begin
 insert into private.collector_control_audit(actor_id,device_id,task_id,action,revision) values(p_actor,p_device,p_task,p_action,p_revision);
 -- Only control actions are audited; 15-second heartbeats do not accumulate rows.
 delete from private.collector_control_audit where created_at<clock_timestamp()-interval '30 days';
 delete from private.collector_control_audit where id in
  (select id from private.collector_control_audit order by id desc offset 10000);
end;$$;
revoke all on function private.collector_control_audit_event(uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function private.collector_control_audit_event(uuid,uuid,text,text,bigint) to service_role;

create or replace function public.collector_control_create_pairing(p_actor uuid,p_name text,p_code_hash text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare expiry timestamptz:=clock_timestamp()+interval '10 minutes';
begin
 if p_actor is null or p_name is null or length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]' or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'code','invalid_request');end if;
 -- Serializes limits and creation, not the device polling path.
 lock table private.collector_control_pairings in share row exclusive mode;
 delete from private.collector_control_pairings where expires_at<=clock_timestamp();
 if (select count(*) from private.collector_control_pairings where created_by=p_actor)>=20 or (select count(*) from private.collector_control_pairings)>=100 then return jsonb_build_object('ok',false,'code','pairing_limit');end if;
 insert into private.collector_control_pairings(code_hash,name,created_by,expires_at) values(p_code_hash,btrim(p_name),p_actor,expiry);
 perform private.collector_control_audit_event(p_actor,null,null,'pairing_created');
 return jsonb_build_object('ok',true,'expiresAt',expiry);
end;$$;

create or replace function public.collector_control_pair(p_code_hash text,p_token_hash text,p_agent_version text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare pairing private.collector_control_pairings%rowtype; device uuid;
begin
 if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_agent_version is null or p_agent_version !~ '^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,39}$' then return jsonb_build_object('ok',false,'code','invalid_request');end if;
 -- Row-lock consumption and insert are a single transaction. Rollback restores code.
 select * into pairing from private.collector_control_pairings where code_hash=p_code_hash and expires_at>clock_timestamp() for update;
 if not found or pairing.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','invalid_pairing');end if;
 lock table private.collector_control_devices in share row exclusive mode;
 if (select count(*) from private.collector_control_devices where revoked_at is null)>=100 then return jsonb_build_object('ok',false,'code','device_limit');end if;
 delete from private.collector_control_pairings where code_hash=p_code_hash;
 insert into private.collector_control_devices(name,token_hash,agent_version,created_by) values(pairing.name,p_token_hash,p_agent_version,pairing.created_by) returning id into device;
 perform private.collector_control_audit_event(pairing.created_by,device,null,'paired');
 return jsonb_build_object('ok',true,'deviceId',device);
end;$$;

create or replace function public.collector_control_overview()
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('ok',true,'devices',coalesce(jsonb_agg(jsonb_build_object(
  'id',d.id,'name',d.name,'lastSeenAt',d.last_seen_at,'revokedAt',d.revoked_at,'agentVersion',d.agent_version,
  'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.task_id,'label',t.label,'desiredState',t.desired_state,
   'revision',t.revision,'observedState',t.observed_state,'pid',t.pid,'updatedAt',t.updated_at,'detailCode',t.detail_code) order by t.label,t.task_id)
   from private.collector_control_tasks t where t.device_id=d.id),'[]'::jsonb)) order by d.name,d.id),'[]'::jsonb))
 from (select * from private.collector_control_devices order by (revoked_at is null) desc,created_at desc limit 200) d;
$$;

create or replace function public.collector_control_revoke(p_actor uuid,p_device_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare device private.collector_control_devices%rowtype;
begin
 if p_actor is null or p_device_id is null then return jsonb_build_object('ok',false,'code','invalid_request');end if;
 select * into device from private.collector_control_devices where id=p_device_id for update;
 if not found then return jsonb_build_object('ok',false,'code','device_not_found');end if;
 if device.revoked_at is null then
  update private.collector_control_devices set revoked_at=clock_timestamp() where id=p_device_id;
  perform private.collector_control_audit_event(p_actor,p_device_id,null,'revoked');
 end if;
 -- Desired states are retained as history. This does not claim local processes stopped.
 return jsonb_build_object('ok',true);
end;$$;

create or replace function public.collector_control_set_desired(p_actor uuid,p_device_id uuid,p_task_id text,p_desired_state text,p_expected_revision bigint)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare device private.collector_control_devices%rowtype; task private.collector_control_tasks%rowtype;
begin
 if p_actor is null or p_device_id is null or p_task_id is null or p_task_id !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' or p_desired_state is null or p_desired_state not in ('running','stopped') or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>9007199254740991 then return jsonb_build_object('ok',false,'code','invalid_request');end if;
 -- Same lock order as poll/revoke prevents an instruction racing past revocation.
 select * into device from private.collector_control_devices where id=p_device_id for update;
 if not found then return jsonb_build_object('ok',false,'code','device_not_found');end if;
 if device.revoked_at is not null then return jsonb_build_object('ok',false,'code','device_revoked');end if;
 select * into task from private.collector_control_tasks where device_id=p_device_id and task_id=p_task_id for update;
 if not found then return jsonb_build_object('ok',false,'code','task_not_found');end if;
 if not task.available then return jsonb_build_object('ok',false,'code','task_unavailable');end if;
 if task.revision<>p_expected_revision or task.revision>=9007199254740991 then return jsonb_build_object('ok',false,'code','revision_conflict');end if;
 -- An unchanged request at the current revision adds neither a revision nor audit.
 if task.desired_state=p_desired_state then return jsonb_build_object('ok',true,'revision',task.revision);end if;
 update private.collector_control_tasks set desired_state=p_desired_state,revision=revision+1,requested_by=p_actor where device_id=p_device_id and task_id=p_task_id returning revision into task.revision;
 perform private.collector_control_audit_event(p_actor,p_device_id,p_task_id,p_desired_state,task.revision);
 return jsonb_build_object('ok',true,'revision',task.revision);
end;$$;

create or replace function public.collector_control_poll(p_device_id uuid,p_token_hash text,p_agent_version text,p_tasks jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare device private.collector_control_devices%rowtype; item jsonb; ids text[]:='{}'; result jsonb; stamp timestamptz:=clock_timestamp();
begin
 if p_device_id is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'code','device_denied');end if;
 select * into device from private.collector_control_devices where id=p_device_id for update;
 if not found or device.token_hash<>p_token_hash or device.revoked_at is not null then return jsonb_build_object('ok',false,'code','device_denied');end if;
 if p_agent_version is null or p_agent_version !~ '^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,39}$' or jsonb_typeof(p_tasks) is distinct from 'array' then return jsonb_build_object('ok',false,'code','invalid_request');end if;
 if jsonb_array_length(p_tasks)>100 or octet_length(p_tasks::text)>65536 then return jsonb_build_object('ok',false,'code','invalid_request');end if;
 for item in select value from jsonb_array_elements(p_tasks) loop
  if jsonb_typeof(item) is distinct from 'object' then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if item-array['id','label','observedState','pid','detailCode']<>'{}'::jsonb or not item ?& array['id','label','observedState','pid','detailCode']
   or jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' or item->>'id'=any(ids)
   or jsonb_typeof(item->'label') is distinct from 'string' or length(btrim(item->>'label')) not between 1 and 80 or item->>'label' ~ '[[:cntrl:]]'
   or jsonb_typeof(item->'observedState') is distinct from 'string' or item->>'observedState' not in ('stopped','starting','running','stopping','failed','blocked','external_running')
   or jsonb_typeof(item->'detailCode') is distinct from 'string' or item->>'detailCode' not in ('ok','starting','stopped','stop_requested','spawn_failed','exited','restart_backoff','restart_limit','stop_timeout','local_lock','external_running','unavailable','config_invalid','manager_restarted','orphaned_process','auth_unavailable','network_unavailable')
   or (jsonb_typeof(item->'pid') is distinct from 'null' and (jsonb_typeof(item->'pid') is distinct from 'number' or item->>'pid' !~ '^[1-9][0-9]{0,9}$'))
  then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if item->>'pid' is not null and (item->>'pid')::bigint>2147483647 then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  ids:=array_append(ids,item->>'id');
 end loop;
 if device.last_seen_at>stamp-interval '5 seconds' then return jsonb_build_object('ok',false,'code','poll_too_soon');end if;
 update private.collector_control_devices set last_seen_at=stamp,agent_version=p_agent_version where id=p_device_id;
 -- An absent task cannot keep a latent start instruction that fires on re-add.
 update private.collector_control_tasks set available=false,observed_state='blocked',detail_code='unavailable',pid=null,
  desired_state='stopped',revision=revision+case when desired_state='running' then 1 else 0 end,updated_at=stamp
  where device_id=p_device_id and available and not task_id=any(ids);
 for item in select value from jsonb_array_elements(p_tasks) loop
  insert into private.collector_control_tasks(device_id,task_id,label,observed_state,pid,detail_code,updated_at)
   values(p_device_id,item->>'id',item->>'label',item->>'observedState',(item->>'pid')::integer,item->>'detailCode',stamp)
   on conflict(device_id,task_id) do update set label=excluded.label,observed_state=excluded.observed_state,pid=excluded.pid,detail_code=excluded.detail_code,available=true,updated_at=excluded.updated_at
   where (collector_control_tasks.label,collector_control_tasks.observed_state,collector_control_tasks.pid,collector_control_tasks.detail_code,collector_control_tasks.available)
    is distinct from (excluded.label,excluded.observed_state,excluded.pid,excluded.detail_code,true);
 end loop;
 -- Retain up to 100 unavailable entries in addition to the current <=100 tasks.
 delete from private.collector_control_tasks where device_id=p_device_id and task_id in
  (select task_id from private.collector_control_tasks where device_id=p_device_id and not available order by updated_at desc,task_id offset 100);
 select coalesce(jsonb_agg(jsonb_build_object('id',task_id,'desiredState',desired_state,'revision',revision) order by task_id),'[]'::jsonb)
  into result from private.collector_control_tasks where device_id=p_device_id and available and task_id=any(ids);
 return jsonb_build_object('ok',true,'tasks',result);
end;$$;

revoke all on function public.collector_control_create_pairing(uuid,text,text),public.collector_control_pair(text,text,text),public.collector_control_overview(),public.collector_control_revoke(uuid,uuid),public.collector_control_set_desired(uuid,uuid,text,text,bigint),public.collector_control_poll(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.collector_control_create_pairing(uuid,text,text),public.collector_control_pair(text,text,text),public.collector_control_overview(),public.collector_control_revoke(uuid,uuid),public.collector_control_set_desired(uuid,uuid,text,text,bigint),public.collector_control_poll(uuid,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
