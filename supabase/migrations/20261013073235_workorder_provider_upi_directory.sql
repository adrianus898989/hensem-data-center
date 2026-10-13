begin;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $install$
declare actual jsonb;expected jsonb:=$meta${"tables":[{"acl":"{postgres=arwdDxtm/postgres,service_role=a/postgres}","rls":true,"kind":"r","name":"workorder_provider_upi_audit","owner":"postgres","forced":false,"columns":[{"name":"id","type":"bigint","default":null,"notnull":true,"identity":"a","generated":""},{"name":"directory_id","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"actor_id","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"actor_role","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"platform","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"action","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"after_value","type":"jsonb","default":null,"notnull":true,"identity":"","generated":""},{"name":"created_at","type":"timestamp with time zone","default":"clock_timestamp()","notnull":true,"identity":"","generated":""}],"indexes":[{"live":true,"ready":true,"valid":true,"definition":"CREATE UNIQUE INDEX workorder_provider_upi_audit_pkey ON private.workorder_provider_upi_audit USING btree (id)"}],"inherits":0,"policies":0,"triggers":0,"constraints":[{"name":"workorder_provider_upi_audit_action_check","type":"c","validated":true,"deferrable":false,"definition":"CHECK ((action = 'add'::text))"},{"name":"workorder_provider_upi_audit_actor_id_fkey","type":"f","validated":true,"deferrable":false,"definition":"FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT"},{"name":"workorder_provider_upi_audit_directory_id_fkey","type":"f","validated":true,"deferrable":false,"definition":"FOREIGN KEY (directory_id) REFERENCES private.workorder_provider_upis(id) ON DELETE RESTRICT"},{"name":"workorder_provider_upi_audit_pkey","type":"p","validated":true,"deferrable":false,"definition":"PRIMARY KEY (id)"}]},{"acl":"{postgres=arwdDxtm/postgres,service_role=ar/postgres}","rls":true,"kind":"r","name":"workorder_provider_upis","owner":"postgres","forced":false,"columns":[{"name":"id","type":"uuid","default":"gen_random_uuid()","notnull":true,"identity":"","generated":""},{"name":"country","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"provider","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"upi_id","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"upi_key","type":"text","default":"lower((upi_id COLLATE \"C\"))","notnull":false,"identity":"","generated":"s"},{"name":"source_platform","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"created_by","type":"uuid","default":null,"notnull":true,"identity":"","generated":""},{"name":"creator_name","type":"text","default":null,"notnull":true,"identity":"","generated":""},{"name":"created_at","type":"timestamp with time zone","default":"clock_timestamp()","notnull":true,"identity":"","generated":""}],"indexes":[{"live":true,"ready":true,"valid":true,"definition":"CREATE UNIQUE INDEX workorder_provider_upis_country_provider_upi_key_key ON private.workorder_provider_upis USING btree (country, provider, upi_key)"},{"live":true,"ready":true,"valid":true,"definition":"CREATE INDEX workorder_provider_upis_list_idx ON private.workorder_provider_upis USING btree (country, provider, created_at DESC, id)"},{"live":true,"ready":true,"valid":true,"definition":"CREATE INDEX workorder_provider_upis_lookup_idx ON private.workorder_provider_upis USING btree (country, upi_key, provider)"},{"live":true,"ready":true,"valid":true,"definition":"CREATE UNIQUE INDEX workorder_provider_upis_pkey ON private.workorder_provider_upis USING btree (id)"}],"inherits":0,"policies":0,"triggers":0,"constraints":[{"name":"workorder_provider_upis_country_check","type":"c","validated":true,"deferrable":false,"definition":"CHECK ((country = '印度'::text))"},{"name":"workorder_provider_upis_country_provider_upi_key_key","type":"u","validated":true,"deferrable":false,"definition":"UNIQUE (country, provider, upi_key)"},{"name":"workorder_provider_upis_created_by_fkey","type":"f","validated":true,"deferrable":false,"definition":"FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT"},{"name":"workorder_provider_upis_pkey","type":"p","validated":true,"deferrable":false,"definition":"PRIMARY KEY (id)"},{"name":"workorder_provider_upis_provider_check","type":"c","validated":true,"deferrable":false,"definition":"CHECK ((((length(provider) >= 1) AND (length(provider) <= 200)) AND (provider = btrim(provider)) AND (provider !~ '[[:cntrl:]]'::text)))"},{"name":"workorder_provider_upis_upi_id_check","type":"c","validated":true,"deferrable":false,"definition":"CHECK ((upi_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z][A-Za-z0-9.-]{1,63}$'::text))"}]}],"functions":[{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"562f78bbf7e2c439cf46192ba5da0916","set":false,"args":"p_actor uuid","cost":100,"lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","definer":false,"defaults":0,"parallel":"u","variadic":"0","signature":"private.workorder_upi_actor(uuid)","volatility":"s"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"dcaf795bfe238fcbece24499c44864fe","set":true,"args":"p_platforms jsonb","cost":100,"lang":"sql","rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(provider text)","definer":false,"defaults":0,"parallel":"u","variadic":"0","signature":"private.workorder_upi_providers(jsonb)","volatility":"s"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","md5":"0973f4effe326351bef6b8a16775bcb8","set":false,"args":"p_actor uuid, p_request jsonb","cost":100,"lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","definer":false,"defaults":0,"parallel":"u","variadic":"0","signature":"workorder_provider_upi(uuid,jsonb)","volatility":"v"}]}$meta$::jsonb;existing integer;
begin
 if current_user<>'postgres' then raise exception 'upi_install_owner_required';end if;
 if md5((select prosrc from pg_proc where oid=to_regprocedure('public.workorder_followup_list(jsonb,jsonb,integer,integer)'))) is distinct from 'b8d147e4ae4b72b31e697c6775e762aa'
 or md5((select prosrc from pg_proc where oid=to_regprocedure('public.workorder_followup_mirror(jsonb)'))) is distinct from '8ed91351508b2151b7f7cd78bd277d2d' then raise exception 'upi_existing_followup_drift';end if;
 if exists(select 1 from(values('workorder_portal_accounts','auth_user_id','uuid'),('workorder_portal_accounts','role','text'),('workorder_portal_accounts','team','text'),('workorder_portal_accounts','platforms','text[]'),('workorder_portal_accounts','active','boolean'),('dashboard_platform_team_map','country_code','text'),('dashboard_platform_team_map','platform_name','text'),('dashboard_platform_team_map','team_name','text'),('dashboard_platform_team_map','active','boolean'),('game66_platforms','platform_name','text'),('game66_platforms','team_name','text'),('third_party_rates','country','text'),('third_party_rates','third_party','text'),('third_party_platform_status','country','text'),('third_party_platform_status','platform','text'),('third_party_platform_status','third_party','text'))s(t,c,typ) where not exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||s.t) and a.attname=s.c and not a.attisdropped and format_type(a.atttypid,a.atttypmod)=s.typ)) then raise exception 'upi_source_schema_drift';end if;
 select count(*) into existing from(values(to_regclass('private.workorder_provider_upis')::oid),(to_regclass('private.workorder_provider_upi_audit')::oid),(to_regprocedure('private.workorder_upi_actor(uuid)')::oid),(to_regprocedure('private.workorder_upi_providers(jsonb)')::oid),(to_regprocedure('public.workorder_provider_upi(uuid,jsonb)')::oid))x(id) where id is not null;
 if existing=0 then execute $objects$-- New directory only. No collected order or employee-entered workorder changes.
create table private.workorder_provider_upis (
 id uuid primary key default pg_catalog.gen_random_uuid(),
 country text not null check(country='印度'),
 provider text not null check(length(provider) between 1 and 200 and provider=btrim(provider) and provider !~ '[[:cntrl:]]'),
 upi_id text not null check(upi_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z][A-Za-z0-9.-]{1,63}$'),
 upi_key text generated always as(lower(upi_id collate "C")) stored,
 source_platform text not null,
 created_by uuid not null references auth.users(id) on delete restrict,
 creator_name text not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(country,provider,upi_key)
);
create index workorder_provider_upis_lookup_idx on private.workorder_provider_upis(country,upi_key,provider);
create index workorder_provider_upis_list_idx on private.workorder_provider_upis(country,provider,created_at desc,id);
create table private.workorder_provider_upi_audit (
 id bigint generated always as identity primary key,
 directory_id uuid not null references private.workorder_provider_upis(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 actor_role text not null,
 platform text not null,
 action text not null check(action='add'),
 after_value jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.workorder_provider_upis enable row level security;
alter table private.workorder_provider_upi_audit enable row level security;
revoke all on private.workorder_provider_upis,private.workorder_provider_upi_audit from public,anon,authenticated,service_role;
grant select,insert on private.workorder_provider_upis to service_role;
grant insert on private.workorder_provider_upi_audit to service_role;
revoke all on sequence private.workorder_provider_upi_audit_id_seq from public,anon,authenticated,service_role;
grant usage,select on sequence private.workorder_provider_upi_audit_id_seq to service_role;

create function private.workorder_upi_actor(p_actor uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
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
  'platforms',coalesce(jsonb_agg(platform order by platform),'[]'::jsonb)) into result from visible;
 if jsonb_array_length(result->'platforms')=0 then raise exception using errcode='42501',message='scope_denied';end if;
 return result;
end;
$fn$;

create function private.workorder_upi_providers(p_platforms jsonb)
returns table(provider text) language sql stable security invoker set search_path='' as $fn$
 select distinct btrim(x.provider) from (
  select r.third_party provider from public.third_party_rates r where r.country='印度'
  union all
  select p.third_party from public.third_party_platform_status p where p.country='印度' and p_platforms ? p.platform
 ) x where nullif(btrim(x.provider),'') is not null and length(btrim(x.provider))<=200 and x.provider !~ '[[:cntrl:]]';
$fn$;

create function public.workorder_provider_upi(p_actor uuid,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
<<request_context>>
declare scope jsonb; action text; platform text; provider text; upi text; upi_key text; query text;
 off integer:=0; lim integer:=50; v record; result jsonb; other_providers jsonb; allowed_providers text[]; scope_providers text[];
begin
 scope:=private.workorder_upi_actor(p_actor);
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
  return jsonb_build_object('ok',true,'version',1,'platform',platform,'providers',to_jsonb(allowed_providers),'canAdd',scope->>'role'<>'auditor');
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
   if scope->>'role'='auditor' then raise exception using errcode='42501',message='readonly_account';end if;
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
  'total',(select count(*) from filtered),'hasMore',(select count(*) from filtered)>off+lim,'canAdd',scope->>'role'<>'auditor',
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'country',p.country,'provider',p.provider,'upiId',p.upi_id,'createdAt',p.created_at,'createdBy',p.created_by,'creatorName',p.creator_name) order by p.created_at desc,p.id) from page p),'[]'::jsonb)) into result;
 return result;
end;
$fn$;
revoke all on function private.workorder_upi_actor(uuid),private.workorder_upi_providers(jsonb),public.workorder_provider_upi(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.workorder_upi_actor(uuid),private.workorder_upi_providers(jsonb),public.workorder_provider_upi(uuid,jsonb) to service_role;
$objects$;elsif existing<>5 then raise exception 'upi_partial_install';end if;
 select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,'acl',c.relacl::text,
  'policies',(select count(*) from pg_policy p where p.polrelid=c.oid),
  'inherits',(select count(*) from pg_inherits i where i.inhparent=c.oid or i.inhrelid=c.oid),
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'type',x.contype,'validated',x.convalidated,'deferrable',x.condeferrable,'definition',pg_get_constraintdef(x.oid)) order by x.conname) from pg_constraint x where x.conrelid=c.oid and x.contype<>'n'),
  'indexes',(select jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=c.oid),
  'triggers',(select count(*) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname)
  from pg_class c where c.oid in(to_regclass('private.workorder_provider_upis'),to_regclass('private.workorder_provider_upi_audit'))),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'result',pg_get_function_result(p.oid),'args',pg_get_function_arguments(p.oid),'defaults',p.pronargdefaults,'variadic',p.provariadic,'set',p.proretset,'cost',p.procost,'rows',p.prorows,'lang',(select l.lanname from pg_language l where l.oid=p.prolang)) order by p.oid::regprocedure::text)
  from pg_proc p where p.oid in(to_regprocedure('private.workorder_upi_actor(uuid)'),to_regprocedure('private.workorder_upi_providers(jsonb)'),to_regprocedure('public.workorder_provider_upi(uuid,jsonb)')))
) into actual;
 if actual is distinct from expected then raise exception 'upi_installed_metadata_drift';end if;
end;
$install$;
notify pgrst,'reload schema';
commit;
