-- UPI capabilities for independently managed employee roles. No employee assignment or source workorder is changed.
begin;set local statement_timeout='3s';set local lock_timeout='1s';
lock table public.workorder_portal_accounts in access exclusive mode nowait;
do $install$
declare spec jsonb;body text;metadata jsonb;installed boolean;
begin
 if current_user<>'postgres' then raise exception 'workorder_permission_owner_required';end if;
if not exists(select 1 from pg_class c where c.oid='public.workorder_portal_accounts'::regclass and c.relowner='postgres'::regrole and c.relkind='r' and c.relrowsecurity and not c.relforcerowsecurity and c.relacl::text='{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}')
 or exists(select 1 from pg_inherits where inhparent='public.workorder_portal_accounts'::regclass or inhrelid='public.workorder_portal_accounts'::regclass)
 or not exists(select 1 from pg_constraint where conrelid='public.workorder_portal_accounts'::regclass and conname='workorder_permissions_valid' and convalidated and pg_get_constraintdef(oid)='CHECK (private.workorder_permissions_valid(role, permissions))')
 or not exists(select 1 from pg_index i join pg_constraint k on k.conindid=i.indexrelid where i.indrelid='public.workorder_portal_accounts'::regclass and i.indisprimary and i.indisvalid and i.indisready and i.indislive and pg_get_constraintdef(k.oid)='PRIMARY KEY (auth_user_id)')
 or not exists(select 1 from pg_constraint where conrelid='public.workorder_portal_accounts'::regclass and conname='workorder_portal_accounts_role_check' and convalidated and pg_get_constraintdef(oid)='CHECK ((role = ANY (ARRAY[''supervisor''::text, ''agent''::text, ''auditor''::text])))')
 then raise exception 'workorder_permission_source_drift';end if;
 installed:=to_regclass('private.workorder_permission_roles') is not null;
 if installed then
for spec in select value from jsonb_array_elements($spec$[{"signature":"private.workorder_custom_role_account_guard()","md5":"1c7f725241ef89bc35013b81c40ed34f","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_permission_keys(text)","md5":"e47ede2ff2b5507d3807d78dba0d8bc3","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_role text","cost":100,"kind":"f","lang":"sql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"text[]","defaults":0,"parallel":"u","variadic":"0","volatile":"i","leakproof":false}},{"signature":"private.workorder_permission_role_audit()","md5":"48c22516e67cbb350c21ffdfd60f0d1c","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_permission_role_guard()","md5":"8bc2512cd6660bbd27c4ba4a52a653a3","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_permissions_valid(text,jsonb)","md5":"e762ced36d8ed3cdc128e9a33507f176","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_role text, p_permissions jsonb","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"boolean","defaults":0,"parallel":"u","variadic":"0","volatile":"i","leakproof":false}},{"signature":"private.workorder_upi_actor(uuid)","md5":"433114f196078dbf734f33f8104b1b14","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"workorder_permission_role_admin(uuid,jsonb)","md5":"791262d18ea308e7bf4cbe184b0a080b","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid, p_request jsonb","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"workorder_portal_account_context(uuid)","md5":"d917c751720a14b6a751893ab2e01a58","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"workorder_portal_effective_access(uuid)","md5":"c90acb13f98ee98ed535565393c8bfb8","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"workorder_provider_upi(uuid,jsonb)","md5":"0504142d6461bbf5fad4346e3f29983b","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid, p_request jsonb","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_upi_providers(jsonb)","md5":"dcaf795bfe238fcbece24499c44864fe","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_platforms jsonb","cost":100,"kind":"f","lang":"sql","rows":1000,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":true,"strict":false,"returns":"TABLE(provider text)","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"private.workorder_portal_account_audit()","md5":"e9d5cda69ad36c330ed20c2dc61eeca1","metadata":{"acl":"{postgres=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":true,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_portal_account_guard()","md5":"481b77ba11ef1d935b68583d024775a6","metadata":{"acl":"{postgres=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":true,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}}]$spec$::jsonb) loop
 select md5(p.prosrc),jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'volatile',p.provolatile,'secdef',p.prosecdef,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'kind',p.prokind,'setret',p.proretset,'variadic',p.provariadic,'defaults',p.pronargdefaults,'args',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),'lang',l.lanname) into body,metadata from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
 if body is distinct from spec->>'md5' or metadata is distinct from spec->'metadata' then raise exception 'workorder_permission_installed_function_drift';end if;
 end loop;for spec in select value from jsonb_array_elements($relations$[{"relation":"private.workorder_permission_role_audit","metadata":{"acl":"{postgres=arwdDxtm/postgres,service_role=a/postgres}","rls":true,"kind":"r","owner":"postgres","forced":false,"columns":[{"name":"id","type":"bigint","default":null,"notnull":true,"identity":"a","generated":""},{"name":"role_id","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"actor_id","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"action","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"before_value","type":"jsonb","default":null,"notnull":false,"identity":"","generated":""},{"name":"after_value","type":"jsonb","default":null,"notnull":true,"identity":"","generated":""},{"name":"created_at","type":"timestamp with time zone","default":"clock_timestamp()","notnull":true,"identity":"","generated":""}],"indexes":[{"def":"CREATE UNIQUE INDEX workorder_permission_role_audit_pkey ON private.workorder_permission_role_audit USING btree (id)","live":true,"name":"workorder_permission_role_audit_pkey","ready":true,"valid":true}],"inherits":0,"policies":0,"triggers":null,"constraints":[{"def":"CHECK ((action = ANY (ARRAY['create-role'::text, 'update-role'::text])))","name":"workorder_permission_role_audit_action_check","valid":true},{"def":"FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT","name":"workorder_permission_role_audit_actor_id_fkey","valid":true},{"def":"PRIMARY KEY (id)","name":"workorder_permission_role_audit_pkey","valid":true},{"def":"FOREIGN KEY (role_id) REFERENCES private.workorder_permission_roles(id) ON DELETE RESTRICT","name":"workorder_permission_role_audit_role_id_fkey","valid":true}]}},{"relation":"private.workorder_permission_roles","metadata":{"acl":"{postgres=arwdDxtm/postgres,service_role=arw/postgres}","rls":true,"kind":"r","owner":"postgres","forced":false,"columns":[{"name":"id","type":"uuid","default":"gen_random_uuid()","notnull":true,"identity":"","generated":""},{"name":"name","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"base_role","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"permissions","type":"jsonb","default":"'{}'::jsonb","notnull":true,"identity":"","generated":""},{"name":"active","type":"boolean","default":"true","notnull":true,"identity":"","generated":""},{"name":"version","type":"integer","default":"1","notnull":true,"identity":"","generated":""},{"name":"created_by","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"updated_by","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"created_at","type":"timestamp with time zone","default":"clock_timestamp()","notnull":true,"identity":"","generated":""},{"name":"updated_at","type":"timestamp with time zone","default":"clock_timestamp()","notnull":true,"identity":"","generated":""}],"indexes":[{"def":"CREATE UNIQUE INDEX workorder_permission_roles_name_key ON private.workorder_permission_roles USING btree (name)","live":true,"name":"workorder_permission_roles_name_key","ready":true,"valid":true},{"def":"CREATE UNIQUE INDEX workorder_permission_roles_pkey ON private.workorder_permission_roles USING btree (id)","live":true,"name":"workorder_permission_roles_pkey","ready":true,"valid":true}],"inherits":0,"policies":0,"triggers":[{"def":"CREATE TRIGGER workorder_permission_role_audit AFTER INSERT OR UPDATE ON private.workorder_permission_roles FOR EACH ROW EXECUTE FUNCTION private.workorder_permission_role_audit()","name":"workorder_permission_role_audit","enabled":"O"},{"def":"CREATE TRIGGER workorder_permission_role_guard BEFORE INSERT OR UPDATE ON private.workorder_permission_roles FOR EACH ROW EXECUTE FUNCTION private.workorder_permission_role_guard()","name":"workorder_permission_role_guard","enabled":"O"}],"constraints":[{"def":"CHECK ((base_role = ANY (ARRAY['agent'::text, 'supervisor'::text, 'auditor'::text])))","name":"workorder_permission_roles_base_role_check","valid":true},{"def":"CHECK (private.workorder_permissions_valid(base_role, permissions))","name":"workorder_permission_roles_check","valid":true},{"def":"FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT","name":"workorder_permission_roles_created_by_fkey","valid":true},{"def":"CHECK ((((length(name) >= 1) AND (length(name) <= 100)) AND (name = btrim(name)) AND (name !~ '[[:cntrl:]]'::text)))","name":"workorder_permission_roles_name_check","valid":true},{"def":"UNIQUE (name)","name":"workorder_permission_roles_name_key","valid":true},{"def":"PRIMARY KEY (id)","name":"workorder_permission_roles_pkey","valid":true},{"def":"FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE RESTRICT","name":"workorder_permission_roles_updated_by_fkey","valid":true},{"def":"CHECK ((version > 0))","name":"workorder_permission_roles_version_check","valid":true}]}}]$relations$::jsonb) loop
 select jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,'inherits',(select count(*) from pg_inherits i where i.inhrelid=c.oid or i.inhparent=c.oid),'policies',(select count(*) from pg_policy x where x.polrelid=c.oid),'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'def',pg_get_constraintdef(x.oid),'valid',x.convalidated) order by x.conname) from pg_constraint x where x.conrelid=c.oid and x.contype<>'n'),'indexes',(select jsonb_agg(jsonb_build_object('name',ic.relname,'def',pg_get_indexdef(x.indexrelid),'valid',x.indisvalid,'ready',x.indisready,'live',x.indislive) order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=c.oid),'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'def',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) into metadata from pg_class c where c.oid=to_regclass(spec->>'relation');
 if metadata is distinct from spec->'metadata' then raise exception 'workorder_permission_relation_drift';end if;
 end loop;
 if not exists(select 1 from pg_attribute where attrelid='public.workorder_portal_accounts'::regclass and attname='custom_role_id' and atttypid='uuid'::regtype and not attnotnull and not attisdropped)
 or not exists(select 1 from pg_constraint where conrelid='public.workorder_portal_accounts'::regclass and conname='workorder_portal_accounts_custom_role_id_fkey' and convalidated and pg_get_constraintdef(oid)='FOREIGN KEY (custom_role_id) REFERENCES private.workorder_permission_roles(id) ON DELETE RESTRICT')
 or not exists(select 1 from pg_trigger where tgrelid='public.workorder_portal_accounts'::regclass and tgname='workorder_custom_role_account_guard' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER workorder_custom_role_account_guard BEFORE INSERT OR UPDATE ON public.workorder_portal_accounts FOR EACH ROW EXECUTE FUNCTION private.workorder_custom_role_account_guard()') then raise exception 'workorder_permission_account_drift';end if;
return;end if;
for spec in select value from jsonb_array_elements($spec$[{"signature":"private.workorder_upi_actor(uuid)","md5":"562f78bbf7e2c439cf46192ba5da0916","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"private.workorder_upi_providers(jsonb)","md5":"dcaf795bfe238fcbece24499c44864fe","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_platforms jsonb","cost":100,"kind":"f","lang":"sql","rows":1000,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":true,"strict":false,"returns":"TABLE(provider text)","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"workorder_provider_upi(uuid,jsonb)","md5":"0973f4effe326351bef6b8a16775bcb8","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid, p_request jsonb","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_portal_account_audit()","md5":"e9d5cda69ad36c330ed20c2dc61eeca1","metadata":{"acl":"{postgres=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":true,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_portal_account_guard()","md5":"481b77ba11ef1d935b68583d024775a6","metadata":{"acl":"{postgres=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":true,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_permissions_valid(text,jsonb)","md5":"2665e06e7f306a6c1376c39155ff4baa","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_role text, p_permissions jsonb","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"boolean","defaults":0,"parallel":"u","variadic":"0","volatile":"i","leakproof":false}}]$spec$::jsonb) loop
 select md5(p.prosrc),jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'volatile',p.provolatile,'secdef',p.prosecdef,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'kind',p.prokind,'setret',p.proretset,'variadic',p.provariadic,'defaults',p.pronargdefaults,'args',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),'lang',l.lanname) into body,metadata from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
 if body is distinct from spec->>'md5' or metadata is distinct from spec->'metadata' then raise exception 'workorder_permission_baseline_drift';end if;
 end loop;
 if to_regclass('private.workorder_permission_role_audit') is not null or exists(select 1 from pg_attribute where attrelid='public.workorder_portal_accounts'::regclass and attname='custom_role_id' and not attisdropped) then raise exception 'workorder_permission_partial_install';end if;
 if to_regprocedure('private.workorder_custom_role_account_guard()') is not null then raise exception 'workorder_permission_name_collision';end if;
 if to_regprocedure('private.workorder_permission_keys(text)') is not null then raise exception 'workorder_permission_name_collision';end if;
 if to_regprocedure('private.workorder_permission_role_audit()') is not null then raise exception 'workorder_permission_name_collision';end if;
 if to_regprocedure('private.workorder_permission_role_guard()') is not null then raise exception 'workorder_permission_name_collision';end if;
 if to_regprocedure('workorder_permission_role_admin(uuid,jsonb)') is not null then raise exception 'workorder_permission_name_collision';end if;
 if to_regprocedure('workorder_portal_account_context(uuid)') is not null then raise exception 'workorder_permission_name_collision';end if;
 if to_regprocedure('workorder_portal_effective_access(uuid)') is not null then raise exception 'workorder_permission_name_collision';end if;
 execute $definition_valid$CREATE OR REPLACE FUNCTION private.workorder_permissions_valid(p_role text, p_permissions jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare permitted text[];
begin
  if p_permissions is null then return true; end if;
  if jsonb_typeof(p_permissions)<>'object' then return false; end if;
  permitted:=case p_role
    when 'agent' then array['case.view','case.create','case.follow','case.close','case.link','proof.read','proof.upload','proof.remove','provider_upis.view','provider_upis.add']::text[]
    when 'supervisor' then array['case.view','case.view_team','case.create','case.follow','case.close','case.approve','case.reopen','case.link','case.assign','proof.read','proof.upload','proof.remove','report.view','activity.view','audit.view','provider_upis.view','provider_upis.add']::text[]
    when 'auditor' then array['case.view','case.view_team','proof.read','report.view','activity.view','audit.view','provider_upis.view']::text[]
    else array[]::text[] end;
  return not exists(select 1 from jsonb_each(p_permissions) e(key,value)
    where not(e.key=any(array['case.view','case.view_team','case.create','case.follow','case.close','case.approve','case.reopen','case.link','case.assign','proof.read','proof.upload','proof.remove','report.view','activity.view','audit.view','provider_upis.view','provider_upis.add']::text[])) or jsonb_typeof(e.value)<>'boolean'
       or(e.value='true'::jsonb and not(e.key=any(permitted))));
end;
$function$
;$definition_valid$;
 execute $definition_objects$-- Employee roles remain separate from dashboard roles and retain their base-role ceiling.
create table private.workorder_permission_roles (
 id uuid primary key default gen_random_uuid(),
 name text not null unique check(length(name) between 1 and 100 and name=btrim(name) and name !~ '[[:cntrl:]]'),
 base_role text not null check(base_role in ('agent','supervisor','auditor')),
 permissions jsonb not null default '{}'::jsonb check(private.workorder_permissions_valid(base_role,permissions)),
 active boolean not null default true,
 version integer not null default 1 check(version>0),
 created_by uuid not null references auth.users(id) on delete restrict,
 updated_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
alter table private.workorder_permission_roles enable row level security;
revoke all on private.workorder_permission_roles from public,anon,authenticated,service_role;
grant select,insert,update on private.workorder_permission_roles to service_role;
create table private.workorder_permission_role_audit (
 id bigint generated always as identity primary key,
 role_id uuid not null references private.workorder_permission_roles(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 action text not null check(action in ('create-role','update-role')),
 before_value jsonb,
 after_value jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.workorder_permission_role_audit enable row level security;
revoke all on private.workorder_permission_role_audit from public,anon,authenticated,service_role;
grant insert on private.workorder_permission_role_audit to service_role;
revoke all on sequence private.workorder_permission_role_audit_id_seq from public,anon,authenticated,service_role;
grant usage,select on sequence private.workorder_permission_role_audit_id_seq to service_role;
alter table public.workorder_portal_accounts add column custom_role_id uuid references private.workorder_permission_roles(id) on delete restrict;

create function private.workorder_permission_keys(p_role text)
returns text[] language sql immutable security invoker set search_path='' as $fn$
 select case p_role
 when 'agent' then array['case.view','case.create','case.follow','case.close','case.link','proof.read','proof.upload','proof.remove','provider_upis.view','provider_upis.add']::text[]
 when 'supervisor' then array['case.view','case.view_team','case.create','case.follow','case.close','case.approve','case.reopen','case.link','case.assign','proof.read','proof.upload','proof.remove','report.view','activity.view','audit.view','provider_upis.view','provider_upis.add']::text[]
 when 'auditor' then array['case.view','case.view_team','proof.read','report.view','activity.view','audit.view','provider_upis.view']::text[] else array[]::text[] end;
$fn$;
create function public.workorder_portal_effective_access(p_actor uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
declare a record; r record; prof record; allowed text[]; permissions jsonb; configured boolean:=false; role_valid boolean:=true;
begin
 select role,active into prof from public.dashboard_profiles where auth_user_id=p_actor;
 if found then
  if prof.active is not true or prof.role<>'owner' then raise exception using errcode='42501',message='account_denied';end if;
  return jsonb_build_object('permissions',jsonb_build_object('provider_upis.view',true,'provider_upis.add',true),'custom_role_id',null,'custom_role_name',null,'custom_role_version',null);
 end if;
 select * into a from public.workorder_portal_accounts where auth_user_id=p_actor and active;
 if not found or a.role not in ('agent','supervisor','auditor') then raise exception using errcode='42501',message='account_denied';end if;
 select null::text name,null::integer version,null::jsonb permissions into r;
 allowed:=private.workorder_permission_keys(a.role);
 if not private.workorder_permissions_valid(a.role,a.permissions) then raise exception using errcode='42501',message='permission_denied';end if;
 if a.custom_role_id is not null then
  configured:=true;
  select * into r from private.workorder_permission_roles where id=a.custom_role_id;
  role_valid:=found and r.active and r.base_role=a.role and private.workorder_permissions_valid(r.base_role,r.permissions);
 end if;
 select jsonb_object_agg(k, to_jsonb(coalesce(k=any(allowed)
   and (a.permissions is null or a.permissions->k='true'::jsonb)
   and (k<>all(array['provider_upis.view','provider_upis.add']) or not configured or (role_valid and r.permissions->k='true'::jsonb)),false))) into permissions
 from unnest(private.workorder_permission_keys('supervisor')) k;
 -- Missing keys are explicit false, never JSON null or inferred write permission.
 select jsonb_object_agg(key,coalesce(value,'false'::jsonb)) into permissions from jsonb_each(permissions);
 return jsonb_build_object('permissions',permissions,'custom_role_id',a.custom_role_id,
 'custom_role_name',case when configured then r.name end,'custom_role_version',case when configured then r.version end);
end;
$fn$;
create function public.workorder_portal_account_context(p_actor uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
declare a record; access jsonb; result jsonb;
begin
 select * into a from public.workorder_portal_accounts where auth_user_id=p_actor;
 if not found then return null;end if;
 if a.active then access:=public.workorder_portal_effective_access(p_actor);
 else select jsonb_build_object('permissions',jsonb_object_agg(k,false),'custom_role_id',a.custom_role_id,'custom_role_name',null,'custom_role_version',null) into access from unnest(private.workorder_permission_keys('supervisor')) k;end if;
 result:=jsonb_build_object('auth_user_id',a.auth_user_id,'username',a.username,'display_name',a.display_name,'role',a.role,'team',a.team,'platforms',a.platforms,'active',a.active,'created_at',a.created_at,'updated_at',a.updated_at);
 return result||access;
end;
$fn$;
create function private.workorder_custom_role_account_guard()
returns trigger language plpgsql security invoker set search_path='' as $fn$
declare r record;
begin
 if new.custom_role_id is not null then
  select base_role,active into r from private.workorder_permission_roles where id=new.custom_role_id for share;
  if not found or r.base_role<>new.role or (tg_op='INSERT' or new.custom_role_id is distinct from old.custom_role_id) and not r.active then
   raise exception using errcode='22023',message='invalid_role';end if;
 end if;
 return new;
end;
$fn$;
create trigger workorder_custom_role_account_guard before insert or update on public.workorder_portal_accounts for each row execute function private.workorder_custom_role_account_guard();
create function private.workorder_permission_role_guard()
returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
 if not exists(select 1 from public.dashboard_profiles where auth_user_id=new.updated_by and active and role='owner') then raise exception using errcode='42501',message='owner_required';end if;
 if tg_op='INSERT' then
  if new.created_by is distinct from new.updated_by or new.version<>1 then raise exception using errcode='22023',message='invalid_role';end if;
 else
  if new.id is distinct from old.id or new.base_role is distinct from old.base_role or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then raise exception using errcode='22023',message='role_identity_immutable';end if;
  new.version:=old.version+1;
 end if;
 new.updated_at:=clock_timestamp();return new;
end;
$fn$;
create trigger workorder_permission_role_guard before insert or update on private.workorder_permission_roles for each row execute function private.workorder_permission_role_guard();
create function private.workorder_permission_role_audit()
returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
 insert into private.workorder_permission_role_audit(role_id,actor_id,action,before_value,after_value)
 values(new.id,new.updated_by,case when tg_op='INSERT' then 'create-role' else 'update-role' end,case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new));return new;
end;
$fn$;
create trigger workorder_permission_role_audit after insert or update on private.workorder_permission_roles for each row execute function private.workorder_permission_role_audit();
create function public.workorder_permission_role_admin(p_actor uuid,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
<<role_request>>
declare act text; r private.workorder_permission_roles; expected integer; rid uuid; name text; base text; perms jsonb; active boolean; permission_catalog jsonb;
begin
 if not exists(select 1 from public.dashboard_profiles d where d.auth_user_id=p_actor and d.active and d.role='owner') then raise exception using errcode='42501',message='owner_required';end if;
 if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>8192 then raise exception using errcode='22023',message='invalid_request';end if;
 act:=p_request->>'action';
 if act='list-roles' then
  if p_request-array['action']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
  select jsonb_agg(jsonb_build_object('key',k,'label',k,'group',split_part(k,'.',1),'roles',(select jsonb_agg(x order by x) from unnest(array['agent','supervisor','auditor']) x where k=any(private.workorder_permission_keys(x)))) order by k) into permission_catalog from unnest(private.workorder_permission_keys('supervisor')) k;
  return jsonb_build_object('ok',true,'roles',coalesce((select jsonb_agg(to_jsonb(x)-array['created_by','updated_by'] order by x.name,x.id) from private.workorder_permission_roles x),'[]'::jsonb),'permission_catalog',permission_catalog,'system_roles',(select jsonb_agg(jsonb_build_object('role',x,'permissions',(select jsonb_object_agg(k,to_jsonb(k=any(private.workorder_permission_keys(x)))) from unnest(private.workorder_permission_keys('supervisor')) k))) from unnest(array['agent','supervisor','auditor']) x));
 elsif act='create-role' then
  if p_request-array['action','name','base_role','permissions','active']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
  name:=p_request->>'name';base:=p_request->>'base_role';perms:=coalesce(p_request->'permissions','{}'::jsonb);active:=true;
  if jsonb_typeof(p_request->'name') is distinct from 'string' or jsonb_typeof(p_request->'base_role') is distinct from 'string' or base not in ('agent','supervisor','auditor') or name is null or name<>btrim(name) or length(name) not between 1 and 100 or name~'[[:cntrl:]]' or not private.workorder_permissions_valid(base,perms) then raise exception using errcode='22023',message='invalid_role';end if;
  if p_request?'active' then if jsonb_typeof(p_request->'active') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_role';end if;active:=(p_request->>'active')::boolean;end if;
  insert into private.workorder_permission_roles(name,base_role,permissions,active,created_by,updated_by)values(name,base,perms,active,p_actor,p_actor) returning * into r;
 elsif act='update-role' then
  if p_request-array['action','id','expected_version','patch']<>'{}'::jsonb or jsonb_typeof(p_request->'id') is distinct from 'string' or p_request->>'id'!~'^[0-9a-fA-F-]{36}$' or jsonb_typeof(p_request->'expected_version') is distinct from 'number' or p_request->>'expected_version'!~'^[0-9]{1,9}$' or jsonb_typeof(p_request->'patch') is distinct from 'object' or p_request->'patch'='{}'::jsonb or (p_request->'patch')-array['name','permissions','active']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
  rid:=(p_request->>'id')::uuid;expected:=(p_request->>'expected_version')::integer;
  select * into r from private.workorder_permission_roles where id=rid for update;
  if not found or r.version<>expected then raise exception using errcode='40001',message='role_changed';end if;
  name:=r.name;perms:=r.permissions;active:=r.active;
  if (p_request->'patch')?'name' then if jsonb_typeof(p_request->'patch'->'name') is distinct from 'string' then raise exception using errcode='22023',message='invalid_role';end if;name:=p_request->'patch'->>'name';end if;
  if (p_request->'patch')?'permissions' then perms:=p_request->'patch'->'permissions';end if;
  if (p_request->'patch')?'active' then if jsonb_typeof(p_request->'patch'->'active') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_role';end if;active:=(p_request->'patch'->>'active')::boolean;end if;
  if name is null or name<>btrim(name) or length(name) not between 1 and 100 or name~'[[:cntrl:]]' or not private.workorder_permissions_valid(r.base_role,perms) then raise exception using errcode='22023',message='invalid_role';end if;
  update private.workorder_permission_roles set name=role_request.name,permissions=perms,active=role_request.active,updated_by=p_actor where id=rid returning * into r;
 else raise exception using errcode='22023',message='invalid_request';end if;
 return jsonb_build_object('ok',true,'role',to_jsonb(r)-array['created_by','updated_by']);
end;
$fn$;
revoke all on function private.workorder_permission_keys(text),public.workorder_portal_effective_access(uuid),public.workorder_portal_account_context(uuid),private.workorder_custom_role_account_guard(),private.workorder_permission_role_guard(),private.workorder_permission_role_audit(),public.workorder_permission_role_admin(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workorder_permission_keys(text),public.workorder_portal_effective_access(uuid),public.workorder_portal_account_context(uuid),private.workorder_custom_role_account_guard(),private.workorder_permission_role_guard(),private.workorder_permission_role_audit(),public.workorder_permission_role_admin(uuid,jsonb) to service_role;
;$definition_objects$;
 execute $definition_actor$CREATE OR REPLACE FUNCTION private.workorder_upi_actor(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare a record; prof record; result jsonb;
begin
 select p.role,p.active,p.username into prof from public.dashboard_profiles p where p.auth_user_id=p_actor;
 if found then
  if prof.role<>'owner' or prof.active is not true then raise exception using errcode='42501',message='account_denied'; end if;
  select 'owner'::text as role,''::text as team,prof.username::text as display_name,null::text[] as platforms into a;
 else
  select p.role,p.team,p.display_name,p.platforms into a from public.workorder_portal_accounts p where p.auth_user_id=p_actor and p.active;
  if not found or a.role not in ('agent','supervisor','auditor') then raise exception using errcode='42501',message='account_denied';end if;
 end if;
 -- The same native directory used by workorder-account-admin, including
 -- conflicting-team-name exclusion. Collector enabled does not grant access.
 with mapped as (
  select m.team_name team,m.platform_name platform from public.dashboard_platform_team_map m where m.active and m.country_code='IN'
  union all select g.team_name,g.platform_name from public.game66_platforms g where g.team_name in ('香港','红膏蟹')
 ), catalog as (
  select platform,min(team) team from mapped where nullif(btrim(platform),'') is not null and nullif(btrim(team),'') is not null
  group by platform having count(distinct team)=1
 ), visible as (
  select * from catalog where a.role='owner' or (team=a.team and platform=any(a.platforms))
 ) select jsonb_build_object('id',p_actor,'role',a.role,'name',case when a.role='owner' then prof.username else a.display_name end,
  'platforms',coalesce(jsonb_agg(platform order by platform),'[]'::jsonb),
  'permissions',(public.workorder_portal_effective_access(p_actor)->'permissions')) into result from visible;
 if jsonb_array_length(result->'platforms')=0 then raise exception using errcode='42501',message='scope_denied';end if;
 return result;
end;
$function$
;$definition_actor$;
 execute $definition_upi$CREATE OR REPLACE FUNCTION public.workorder_provider_upi(p_actor uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
<<request_context>>
declare scope jsonb; action text; platform text; provider text; upi text; upi_key text; query text;
 off integer:=0; lim integer:=50; v record; result jsonb; other_providers jsonb; allowed_providers text[]; scope_providers text[];
begin
 -- Permission changes serialize against an add before any directory lookup.
 if p_request->>'action'='add' then
  perform 1 from public.workorder_portal_accounts a where a.auth_user_id=p_actor for share;
  perform 1 from private.workorder_permission_roles r join public.workorder_portal_accounts a on a.custom_role_id=r.id where a.auth_user_id=p_actor for share of r;
 end if;
 scope:=private.workorder_upi_actor(p_actor);
 if scope->'permissions'->'provider_upis.view' is distinct from 'true'::jsonb then raise exception using errcode='42501',message='permission_denied';end if;
 if p_request->>'action'='add' and scope->'permissions'->'provider_upis.add' is distinct from 'true'::jsonb then raise exception using errcode='42501',message='permission_denied';end if;
 if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>4096
  or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['action','platform','provider','upiId','query','offset','limit'])) then
  raise exception using errcode='22023',message='invalid_request';end if;
 action:=p_request->>'action';
 if action is null or action not in ('catalog','list','add','lookup') then raise exception using errcode='22023',message='invalid_request';end if;
 if exists(select 1 from jsonb_each(p_request) x where x.key in ('action','platform','provider','upiId','query')
  and (jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>200 or x.value#>>'{}' ~ '[[:cntrl:]]')) then
  raise exception using errcode='22023',message='invalid_request';end if;
 platform:=nullif(btrim(p_request->>'platform'),'');
 if platform is null or not(scope->'platforms' ? platform) then raise exception using errcode='42501',message='scope_denied';end if;
 select coalesce(array_agg(p.provider order by p.provider),array[]::text[]) into allowed_providers from private.workorder_upi_providers(jsonb_build_array(platform)) p;
 if action='catalog' then
  if p_request-array['action','platform']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
  return jsonb_build_object('ok',true,'version',1,'platform',platform,'providers',to_jsonb(allowed_providers),'canView',true,'canAdd',scope->'permissions'->'provider_upis.add');
 end if;
 provider:=nullif(btrim(p_request->>'provider'),'');
 if provider is null or not(provider=any(allowed_providers)) then raise exception using errcode='22023',message='invalid_provider';end if;
 if action in ('add','lookup') then
  if p_request-array['action','platform','provider','upiId']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
  upi:=btrim(p_request->>'upiId');
  if upi is null or upi !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z][A-Za-z0-9.-]{1,63}$' then
   raise exception using errcode='22023',message='invalid_upi';end if;
  upi_key:=lower(upi collate "C");
  select coalesce(array_agg(p.provider),array[]::text[]) into scope_providers from private.workorder_upi_providers(scope->'platforms') p;
  if action='add' then
   if scope->'permissions'->'provider_upis.add' is distinct from 'true'::jsonb then raise exception using errcode='42501',message='permission_denied';end if;
   -- Writers for this one normalized ID serialize before testing visible
   -- duplicates. Unseen providers never leak existence or become a veto.
   perform pg_advisory_xact_lock(1975413013,hashtext(upi_key));
  end if;
  select * into v from private.workorder_provider_upis d where d.country='印度' and d.provider=request_context.provider and d.upi_key=request_context.upi_key;
  if found then
   if action='add' then return jsonb_build_object('ok',false,'version',1,'platform',platform,'code','upi_duplicate','matchedProviders',jsonb_build_array(provider));end if;
   return jsonb_build_object('ok',true,'version',1,'platform',platform,'status','matched','provider',provider,'matchedProviders',jsonb_build_array(provider),'scope','visible_providers');
  end if;
  select coalesce(jsonb_agg(d.provider order by d.provider),'[]'::jsonb) into other_providers
  from private.workorder_provider_upis d where d.country='印度' and d.upi_key=request_context.upi_key and d.provider=any(scope_providers);
  if action='lookup' then
   return jsonb_build_object('ok',true,'version',1,'platform',platform,'status',case when jsonb_array_length(other_providers)>0 then 'other_provider' else 'not_recorded' end,
    'provider',provider,'matchedProviders',other_providers,'scope','visible_providers');
  end if;
  if jsonb_array_length(other_providers)>0 then return jsonb_build_object('ok',false,'version',1,'platform',platform,'code','upi_provider_mismatch','matchedProviders',other_providers);end if;
  insert into private.workorder_provider_upis(country,provider,upi_id,source_platform,created_by,creator_name)
  values('印度',provider,upi,platform,p_actor,scope->>'name') returning * into v;
  result:=jsonb_build_object('id',v.id,'country',v.country,'provider',v.provider,'upiId',v.upi_id,'createdAt',v.created_at,'createdBy',v.created_by,'creatorName',v.creator_name);
  insert into private.workorder_provider_upi_audit(directory_id,actor_id,actor_role,platform,action,after_value)
  values(v.id,p_actor,scope->>'role',platform,'add',result);
  return jsonb_build_object('ok',true,'version',1,'platform',platform,'row',result);
 end if;
 if p_request-array['action','platform','provider','query','offset','limit']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
 if exists(select 1 from jsonb_each(p_request) x where x.key in ('offset','limit') and
  (jsonb_typeof(x.value)<>'number' or x.value#>>'{}' !~ '^[0-9]{1,7}$')) then raise exception using errcode='22023',message='invalid_pagination';end if;
 off:=coalesce((p_request->>'offset')::integer,0);lim:=coalesce((p_request->>'limit')::integer,50);query:=nullif(btrim(p_request->>'query'),'');
 if off>1000000 or lim<1 or lim>100 then raise exception using errcode='22023',message='invalid_pagination';end if;
 with filtered as materialized (
  select * from private.workorder_provider_upis d where d.country='印度' and d.provider=request_context.provider
   and (query is null or strpos(lower(d.upi_id collate "C"),lower(query collate "C"))>0)
 ), page as (
  select * from filtered order by created_at desc,id offset off limit lim
 ) select jsonb_build_object('ok',true,'version',1,'platform',platform,'provider',provider,'offset',off,'limit',lim,
  'total',(select count(*) from filtered),'hasMore',(select count(*) from filtered)>off+lim,'canView',true,'canAdd',scope->'permissions'->'provider_upis.add',
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'country',p.country,'provider',p.provider,'upiId',p.upi_id,'createdAt',p.created_at,'createdBy',p.created_by,'creatorName',p.creator_name) order by p.created_at desc,p.id) from page p),'[]'::jsonb)) into result;
 return result;
end;
$function$
;$definition_upi$;
for spec in select value from jsonb_array_elements($spec$[{"signature":"private.workorder_custom_role_account_guard()","md5":"1c7f725241ef89bc35013b81c40ed34f","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_permission_keys(text)","md5":"e47ede2ff2b5507d3807d78dba0d8bc3","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_role text","cost":100,"kind":"f","lang":"sql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"text[]","defaults":0,"parallel":"u","variadic":"0","volatile":"i","leakproof":false}},{"signature":"private.workorder_permission_role_audit()","md5":"48c22516e67cbb350c21ffdfd60f0d1c","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_permission_role_guard()","md5":"8bc2512cd6660bbd27c4ba4a52a653a3","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_permissions_valid(text,jsonb)","md5":"e762ced36d8ed3cdc128e9a33507f176","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_role text, p_permissions jsonb","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"boolean","defaults":0,"parallel":"u","variadic":"0","volatile":"i","leakproof":false}},{"signature":"private.workorder_upi_actor(uuid)","md5":"433114f196078dbf734f33f8104b1b14","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"workorder_permission_role_admin(uuid,jsonb)","md5":"791262d18ea308e7bf4cbe184b0a080b","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid, p_request jsonb","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"workorder_portal_account_context(uuid)","md5":"d917c751720a14b6a751893ab2e01a58","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"workorder_portal_effective_access(uuid)","md5":"c90acb13f98ee98ed535565393c8bfb8","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"workorder_provider_upi(uuid,jsonb)","md5":"0504142d6461bbf5fad4346e3f29983b","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid, p_request jsonb","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_upi_providers(jsonb)","md5":"dcaf795bfe238fcbece24499c44864fe","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_platforms jsonb","cost":100,"kind":"f","lang":"sql","rows":1000,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":true,"strict":false,"returns":"TABLE(provider text)","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"private.workorder_portal_account_audit()","md5":"e9d5cda69ad36c330ed20c2dc61eeca1","metadata":{"acl":"{postgres=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":true,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}},{"signature":"private.workorder_portal_account_guard()","md5":"481b77ba11ef1d935b68583d024775a6","metadata":{"acl":"{postgres=X/postgres}","args":"","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":true,"setret":false,"strict":false,"returns":"trigger","defaults":0,"parallel":"u","variadic":"0","volatile":"v","leakproof":false}}]$spec$::jsonb) loop
 select md5(p.prosrc),jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'volatile',p.provolatile,'secdef',p.prosecdef,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'kind',p.prokind,'setret',p.proretset,'variadic',p.provariadic,'defaults',p.pronargdefaults,'args',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),'lang',l.lanname) into body,metadata from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
 if body is distinct from spec->>'md5' or metadata is distinct from spec->'metadata' then raise exception 'workorder_permission_postcondition_drift';end if;
 end loop;for spec in select value from jsonb_array_elements($relations$[{"relation":"private.workorder_permission_role_audit","metadata":{"acl":"{postgres=arwdDxtm/postgres,service_role=a/postgres}","rls":true,"kind":"r","owner":"postgres","forced":false,"columns":[{"name":"id","type":"bigint","default":null,"notnull":true,"identity":"a","generated":""},{"name":"role_id","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"actor_id","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"action","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"before_value","type":"jsonb","default":null,"notnull":false,"identity":"","generated":""},{"name":"after_value","type":"jsonb","default":null,"notnull":true,"identity":"","generated":""},{"name":"created_at","type":"timestamp with time zone","default":"clock_timestamp()","notnull":true,"identity":"","generated":""}],"indexes":[{"def":"CREATE UNIQUE INDEX workorder_permission_role_audit_pkey ON private.workorder_permission_role_audit USING btree (id)","live":true,"name":"workorder_permission_role_audit_pkey","ready":true,"valid":true}],"inherits":0,"policies":0,"triggers":null,"constraints":[{"def":"CHECK ((action = ANY (ARRAY['create-role'::text, 'update-role'::text])))","name":"workorder_permission_role_audit_action_check","valid":true},{"def":"FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT","name":"workorder_permission_role_audit_actor_id_fkey","valid":true},{"def":"PRIMARY KEY (id)","name":"workorder_permission_role_audit_pkey","valid":true},{"def":"FOREIGN KEY (role_id) REFERENCES private.workorder_permission_roles(id) ON DELETE RESTRICT","name":"workorder_permission_role_audit_role_id_fkey","valid":true}]}},{"relation":"private.workorder_permission_roles","metadata":{"acl":"{postgres=arwdDxtm/postgres,service_role=arw/postgres}","rls":true,"kind":"r","owner":"postgres","forced":false,"columns":[{"name":"id","type":"uuid","default":"gen_random_uuid()","notnull":true,"identity":"","generated":""},{"name":"name","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"base_role","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"permissions","type":"jsonb","default":"'{}'::jsonb","notnull":true,"identity":"","generated":""},{"name":"active","type":"boolean","default":"true","notnull":true,"identity":"","generated":""},{"name":"version","type":"integer","default":"1","notnull":true,"identity":"","generated":""},{"name":"created_by","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"updated_by","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"created_at","type":"timestamp with time zone","default":"clock_timestamp()","notnull":true,"identity":"","generated":""},{"name":"updated_at","type":"timestamp with time zone","default":"clock_timestamp()","notnull":true,"identity":"","generated":""}],"indexes":[{"def":"CREATE UNIQUE INDEX workorder_permission_roles_name_key ON private.workorder_permission_roles USING btree (name)","live":true,"name":"workorder_permission_roles_name_key","ready":true,"valid":true},{"def":"CREATE UNIQUE INDEX workorder_permission_roles_pkey ON private.workorder_permission_roles USING btree (id)","live":true,"name":"workorder_permission_roles_pkey","ready":true,"valid":true}],"inherits":0,"policies":0,"triggers":[{"def":"CREATE TRIGGER workorder_permission_role_audit AFTER INSERT OR UPDATE ON private.workorder_permission_roles FOR EACH ROW EXECUTE FUNCTION private.workorder_permission_role_audit()","name":"workorder_permission_role_audit","enabled":"O"},{"def":"CREATE TRIGGER workorder_permission_role_guard BEFORE INSERT OR UPDATE ON private.workorder_permission_roles FOR EACH ROW EXECUTE FUNCTION private.workorder_permission_role_guard()","name":"workorder_permission_role_guard","enabled":"O"}],"constraints":[{"def":"CHECK ((base_role = ANY (ARRAY['agent'::text, 'supervisor'::text, 'auditor'::text])))","name":"workorder_permission_roles_base_role_check","valid":true},{"def":"CHECK (private.workorder_permissions_valid(base_role, permissions))","name":"workorder_permission_roles_check","valid":true},{"def":"FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT","name":"workorder_permission_roles_created_by_fkey","valid":true},{"def":"CHECK ((((length(name) >= 1) AND (length(name) <= 100)) AND (name = btrim(name)) AND (name !~ '[[:cntrl:]]'::text)))","name":"workorder_permission_roles_name_check","valid":true},{"def":"UNIQUE (name)","name":"workorder_permission_roles_name_key","valid":true},{"def":"PRIMARY KEY (id)","name":"workorder_permission_roles_pkey","valid":true},{"def":"FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE RESTRICT","name":"workorder_permission_roles_updated_by_fkey","valid":true},{"def":"CHECK ((version > 0))","name":"workorder_permission_roles_version_check","valid":true}]}}]$relations$::jsonb) loop
 select jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,'inherits',(select count(*) from pg_inherits i where i.inhrelid=c.oid or i.inhparent=c.oid),'policies',(select count(*) from pg_policy x where x.polrelid=c.oid),'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'def',pg_get_constraintdef(x.oid),'valid',x.convalidated) order by x.conname) from pg_constraint x where x.conrelid=c.oid and x.contype<>'n'),'indexes',(select jsonb_agg(jsonb_build_object('name',ic.relname,'def',pg_get_indexdef(x.indexrelid),'valid',x.indisvalid,'ready',x.indisready,'live',x.indislive) order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=c.oid),'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'def',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) into metadata from pg_class c where c.oid=to_regclass(spec->>'relation');
 if metadata is distinct from spec->'metadata' then raise exception 'workorder_permission_relation_drift';end if;
 end loop;
 if not exists(select 1 from pg_attribute where attrelid='public.workorder_portal_accounts'::regclass and attname='custom_role_id' and atttypid='uuid'::regtype and not attnotnull and not attisdropped)
 or not exists(select 1 from pg_constraint where conrelid='public.workorder_portal_accounts'::regclass and conname='workorder_portal_accounts_custom_role_id_fkey' and convalidated and pg_get_constraintdef(oid)='FOREIGN KEY (custom_role_id) REFERENCES private.workorder_permission_roles(id) ON DELETE RESTRICT')
 or not exists(select 1 from pg_trigger where tgrelid='public.workorder_portal_accounts'::regclass and tgname='workorder_custom_role_account_guard' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER workorder_custom_role_account_guard BEFORE INSERT OR UPDATE ON public.workorder_portal_accounts FOR EACH ROW EXECUTE FUNCTION private.workorder_custom_role_account_guard()') then raise exception 'workorder_permission_account_drift';end if;

end;$install$;
notify pgrst,'reload schema';commit;
