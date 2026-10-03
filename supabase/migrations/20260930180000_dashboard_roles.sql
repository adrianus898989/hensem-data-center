-- Custom detailed-backend roles. Existing Auth identities, passwords, coarse
-- roles, active flags, data scopes and legacy assignments remain unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Known-version replay only; never replace an unrelated implementation.
do $preflight$
declare spec record;p record;
begin
 for spec in select * from (values
  ('private.dashboard_role_hmac(text,bytea)','913316a119ea8dde2ff9a546116464f7'),
  ('private.dashboard_role_catalog()','de973caa62402e8b5e07f7626010ee99'),
  ('private.dashboard_role_permissions_valid(jsonb)','953c7976534b1936849a40fabf83d75a'),
  ('private.dashboard_role_access()','274a0bfe3c8636c013bb9d1005281f84'),
  ('public.dashboard_role_access()','93f491b7653f5c5dfc8e04f2df409654'),
  ('private.dashboard_role_context_valid()','4fe8d4b2586aef960d9ad5d0b826e426'),
  ('private.dashboard_role_require_gateway()','0e9013820396aab2c7230dc133c3888b'),
  ('private.dashboard_role_legacy_allowed()','1c96180c728287e427c4760cda344684'),
  ('public.dashboard_role_manage(jsonb)','f7c1917834e93bfb5e6436496109cb85'),
  ('public.dashboard_admin_execute(text,jsonb)','5b0f510650b88193eed498c3d7424238')
 ) v(signature,body_hash) loop
  select prosrc,proowner into p from pg_proc where oid=to_regprocedure(spec.signature);
  if found and (p.proowner<>(select oid from pg_roles where rolname=current_user) or md5(p.prosrc)<>spec.body_hash) then
   raise exception 'dashboard_role_new_function_drift: %',spec.signature;
  end if;
 end loop;
end;$preflight$;

create table if not exists private.dashboard_roles (
 id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name)) between 1 and 80),
 description text not null default '' check(length(description)<=500),
 permissions text[] not null default '{}',active boolean not null default true,
 version bigint not null default 1 check(version>=1),created_by uuid not null,updated_by uuid not null,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists dashboard_roles_active_name on private.dashboard_roles(lower(btrim(name))) where active;
create table if not exists private.dashboard_role_assignments (
 auth_user_id uuid primary key references public.dashboard_profiles(auth_user_id) on delete cascade,
 role_id uuid not null references private.dashboard_roles(id) on delete restrict,
 version bigint not null default 1 check(version>=1),updated_by uuid not null,updated_at timestamptz not null default clock_timestamp()
);
create table if not exists private.dashboard_role_audit (
 id bigint generated always as identity primary key,actor_id uuid not null,operation text not null,
 entity_id uuid,before_value jsonb,after_value jsonb,created_at timestamptz not null default clock_timestamp()
);
create table if not exists private.dashboard_role_context_secret (
 singleton boolean primary key default true check(singleton),secret bytea not null check(octet_length(secret)=32)
);
insert into private.dashboard_role_context_secret(singleton,secret)
 values(true,decode(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'hex')) on conflict(singleton) do nothing;
revoke all on private.dashboard_roles,private.dashboard_role_assignments,private.dashboard_role_audit,private.dashboard_role_context_secret from public,anon,authenticated,service_role;
revoke all on sequence private.dashboard_role_audit_id_seq from public,anon,authenticated,service_role;
alter table private.dashboard_roles enable row level security;
alter table private.dashboard_role_assignments enable row level security;
alter table private.dashboard_role_audit enable row level security;
alter table private.dashboard_role_context_secret enable row level security;

-- PostgreSQL-core HMAC-SHA256; no dependency on an extension's installation
-- schema. Fixed private key is 32 bytes; padding follows RFC 2104 exactly.
create or replace function private.dashboard_role_hmac(p_value text,p_key bytea)
returns text language plpgsql immutable strict set search_path='' as $$
declare k bytea:=p_key;ipad bytea;opad bytea;i integer;
begin
 if octet_length(k)>64 then k:=sha256(k);end if;
 k:=k||decode(repeat('00',64-octet_length(k)),'hex');ipad:=k;opad:=k;
 for i in 0..63 loop ipad:=set_byte(ipad,i,get_byte(k,i)#54);opad:=set_byte(opad,i,get_byte(k,i)#92);end loop;
 return encode(sha256(opad||sha256(ipad||convert_to(p_value,'UTF8'))),'hex');
end;$$;
revoke all on function private.dashboard_role_hmac(text,bytea) from public,anon,authenticated,service_role;

create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='' as $catalog$
 select $data${"version":1,"pages":[{"id":"overview","moduleId":"dashboard","moduleLabel":"Dashboard","label":"总览","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","workorders","pendingSnapshot","autoWithdraw","details","query"]},{"id":"collected_data","moduleId":"dashboard","moduleLabel":"Dashboard","label":"平台数据接入","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","collectedData","reportSummary","payoutConfig"]},{"id":"teamops","moduleId":"team","moduleLabel":"团队运营中心","label":"团队经营","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query"]},{"id":"teamcountries","moduleId":"team","moduleLabel":"团队运营中心","label":"团队国家分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query"]},{"id":"teamplatforms","moduleId":"team","moduleLabel":"团队运营中心","label":"团队平台分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query"]},{"id":"merchants","moduleId":"merchant","moduleLabel":"商户运营中心","label":"平台汇总","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query"]},{"id":"merchantproviders","moduleId":"merchant","moduleLabel":"商户运营中心","label":"平台三方分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query"]},{"id":"payout_config","moduleId":"merchant","moduleLabel":"商户运营中心","label":"自动出款配置","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","payoutConfig"]},{"id":"auto_withdraw","moduleId":"merchant","moduleLabel":"商户运营中心","label":"自动出款","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"},{"id":"edit","label":"编辑出款备注","sensitive":true}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","autoWithdraw","withdrawReasons","withdrawNote"]},{"id":"withdraw_operators","moduleId":"merchant","moduleLabel":"商户运营中心","label":"操作人统计","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","autoWithdraw","withdrawReasons"]},{"id":"workorders","moduleId":"workorder","moduleLabel":"工单运营中心","label":"工单未到账","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","workorderRecords","workorders"]},{"id":"deposit_tracking","moduleId":"workorder","moduleLabel":"工单运营中心","label":"存款未到账-跟进记录","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","depositIssues"]},{"id":"deposit_statistics","moduleId":"workorder","moduleLabel":"工单运营中心","label":"存款未到账-统计","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","depositStatistics","depositIssues"]},{"id":"workorder_reconciliation","moduleId":"workorder","moduleLabel":"工单运营中心","label":"漏登与状态核对","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","workorderRecords"]},{"id":"workorder_workload","moduleId":"workorder","moduleLabel":"工单运营中心","label":"员工工作量","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","workorderRecords"]},{"id":"workorder_permissions","moduleId":"workorder","moduleLabel":"工单运营中心","label":"权限与预警","actions":[{"id":"view","label":"查看目录与页面"}],"requests":[]},{"id":"providers","moduleId":"provider","moduleLabel":"三方通道中心","label":"代收汇总","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","workorders","submissionAnalysis","memberDaily"]},{"id":"provider_payout","moduleId":"provider","moduleLabel":"三方通道中心","label":"代付汇总","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","workorders","submissionAnalysis","memberDaily"]},{"id":"provider_daily","moduleId":"provider","moduleLabel":"三方通道中心","label":"代收代付成功率","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","workorders","submissionAnalysis","memberDaily"]},{"id":"channelquality","moduleId":"provider","moduleLabel":"三方通道中心","label":"稳定性与占比","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","workorders","submissionAnalysis","memberDaily"]},{"id":"rates","moduleId":"provider","moduleLabel":"三方通道中心","label":"费率表","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","rates","ratesSheet"]},{"id":"risk","moduleId":"risk","moduleLabel":"智能风控中心","label":"三方风控汇总","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query"]},{"id":"events","moduleId":"risk","moduleLabel":"智能风控中心","label":"刷单风控","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","submissionAnalysis","memberDaily","aggregate"]},{"id":"stuck","moduleId":"risk","moduleLabel":"智能风控中心","label":"代付中与卡单分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","pendingAnalysis","pendingSnapshot"]},{"id":"rules","moduleId":"risk","moduleLabel":"智能风控中心","label":"预警规则","actions":[{"id":"view","label":"查看目录与页面"}],"requests":[]},{"id":"time","moduleId":"analysis","moduleLabel":"数据分析中心","label":"时间段分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","memberDaily"]},{"id":"amount","moduleId":"analysis","moduleLabel":"数据分析中心","label":"金额段分析","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","memberDaily"]},{"id":"matrix","moduleId":"analysis","moduleLabel":"数据分析中心","label":"时间段 × 金额段","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","memberDaily"]},{"id":"latency","moduleId":"analysis","moduleLabel":"数据分析中心","label":"充值 / 提款到账时效","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query","memberDaily"]},{"id":"orders","moduleId":"analysis","moduleLabel":"数据分析中心","label":"订单明细","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query"]},{"id":"collection","moduleId":"analysis","moduleLabel":"数据分析中心","label":"代收订单","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query"]},{"id":"payout","moduleId":"analysis","moduleLabel":"数据分析中心","label":"代付订单","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"detail","label":"查看明细"},{"id":"export","label":"导出已查询数据"}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","aggregate","rates","reportSummary","collectedData","details","query"]},{"id":"access","moduleId":"system","moduleLabel":"系统管理后台","label":"账号与角色权限","actions":[{"id":"view","label":"查看目录与页面"},{"id":"create","label":"新建账号","sensitive":true},{"id":"edit","label":"修改账号","sensitive":true},{"id":"status","label":"启用 / 停用账号","sensitive":true},{"id":"reset_password","label":"重置账号密码","sensitive":true},{"id":"delete","label":"删除账号","sensitive":true}],"requests":[]},{"id":"provider_config","moduleId":"system","moduleLabel":"系统管理后台","label":"三方配置","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"},{"id":"edit","label":"修改三方归类","sensitive":true}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","providerConfig","configurationAccess","configurationWrite"]},{"id":"teams","moduleId":"system","moduleLabel":"系统管理后台","label":"团队 / 平台归属","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"},{"id":"edit","label":"修改平台归属","sensitive":true}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage","platformAssignments","configurationAccess","configurationWrite"]},{"id":"ip","moduleId":"system","moduleLabel":"系统管理后台","label":"IP 白名单","actions":[{"id":"view","label":"查看目录与页面"}],"requests":[]},{"id":"data_health","moduleId":"system","moduleLabel":"系统管理后台","label":"采集与数据健康","actions":[{"id":"view","label":"查看目录与页面"},{"id":"query","label":"查询数据"},{"id":"export","label":"导出已查询数据"},{"id":"refresh","label":"手动同步数据","sensitive":true}],"requests":["catalog","providerOptions","syncHealth","intakeCoverage"]},{"id":"login_logs","moduleId":"system","moduleLabel":"系统管理后台","label":"登录日志","actions":[{"id":"view","label":"查看目录与页面"}],"requests":[]},{"id":"operation_logs","moduleId":"system","moduleLabel":"系统管理后台","label":"操作日志","actions":[{"id":"view","label":"查看目录与页面"}],"requests":[]}],"permissions":[{"key":"overview.view"},{"key":"overview.query"},{"key":"overview.detail"},{"key":"overview.export"},{"key":"collected_data.view"},{"key":"collected_data.query"},{"key":"collected_data.detail"},{"key":"collected_data.export"},{"key":"teamops.view"},{"key":"teamops.query"},{"key":"teamops.detail"},{"key":"teamops.export"},{"key":"teamcountries.view"},{"key":"teamcountries.query"},{"key":"teamcountries.detail"},{"key":"teamcountries.export"},{"key":"teamplatforms.view"},{"key":"teamplatforms.query"},{"key":"teamplatforms.detail"},{"key":"teamplatforms.export"},{"key":"merchants.view"},{"key":"merchants.query"},{"key":"merchants.detail"},{"key":"merchants.export"},{"key":"merchantproviders.view"},{"key":"merchantproviders.query"},{"key":"merchantproviders.detail"},{"key":"merchantproviders.export"},{"key":"payout_config.view"},{"key":"payout_config.query"},{"key":"payout_config.export"},{"key":"auto_withdraw.view"},{"key":"auto_withdraw.query"},{"key":"auto_withdraw.detail"},{"key":"auto_withdraw.export"},{"key":"auto_withdraw.edit"},{"key":"withdraw_operators.view"},{"key":"withdraw_operators.query"},{"key":"withdraw_operators.detail"},{"key":"withdraw_operators.export"},{"key":"workorders.view"},{"key":"workorders.query"},{"key":"workorders.detail"},{"key":"workorders.export"},{"key":"deposit_tracking.view"},{"key":"deposit_tracking.query"},{"key":"deposit_tracking.detail"},{"key":"deposit_tracking.export"},{"key":"deposit_statistics.view"},{"key":"deposit_statistics.query"},{"key":"deposit_statistics.detail"},{"key":"deposit_statistics.export"},{"key":"workorder_reconciliation.view"},{"key":"workorder_reconciliation.query"},{"key":"workorder_reconciliation.detail"},{"key":"workorder_reconciliation.export"},{"key":"workorder_workload.view"},{"key":"workorder_workload.query"},{"key":"workorder_workload.detail"},{"key":"workorder_workload.export"},{"key":"workorder_permissions.view"},{"key":"providers.view"},{"key":"providers.query"},{"key":"providers.detail"},{"key":"providers.export"},{"key":"provider_payout.view"},{"key":"provider_payout.query"},{"key":"provider_payout.detail"},{"key":"provider_payout.export"},{"key":"provider_daily.view"},{"key":"provider_daily.query"},{"key":"provider_daily.detail"},{"key":"provider_daily.export"},{"key":"channelquality.view"},{"key":"channelquality.query"},{"key":"channelquality.detail"},{"key":"channelquality.export"},{"key":"rates.view"},{"key":"rates.query"},{"key":"rates.export"},{"key":"risk.view"},{"key":"risk.query"},{"key":"risk.detail"},{"key":"risk.export"},{"key":"events.view"},{"key":"events.query"},{"key":"events.detail"},{"key":"events.export"},{"key":"stuck.view"},{"key":"stuck.query"},{"key":"stuck.detail"},{"key":"stuck.export"},{"key":"rules.view"},{"key":"time.view"},{"key":"time.query"},{"key":"time.detail"},{"key":"time.export"},{"key":"amount.view"},{"key":"amount.query"},{"key":"amount.detail"},{"key":"amount.export"},{"key":"matrix.view"},{"key":"matrix.query"},{"key":"matrix.detail"},{"key":"matrix.export"},{"key":"latency.view"},{"key":"latency.query"},{"key":"latency.detail"},{"key":"latency.export"},{"key":"orders.view"},{"key":"orders.query"},{"key":"orders.detail"},{"key":"orders.export"},{"key":"collection.view"},{"key":"collection.query"},{"key":"collection.detail"},{"key":"collection.export"},{"key":"payout.view"},{"key":"payout.query"},{"key":"payout.detail"},{"key":"payout.export"},{"key":"access.view"},{"key":"access.create"},{"key":"access.edit"},{"key":"access.status"},{"key":"access.reset_password"},{"key":"access.delete"},{"key":"provider_config.view"},{"key":"provider_config.query"},{"key":"provider_config.export"},{"key":"provider_config.edit"},{"key":"teams.view"},{"key":"teams.query"},{"key":"teams.export"},{"key":"teams.edit"},{"key":"ip.view"},{"key":"data_health.view"},{"key":"data_health.query"},{"key":"data_health.export"},{"key":"data_health.refresh"},{"key":"login_logs.view"},{"key":"operation_logs.view"}]}$data$::jsonb;
$catalog$;
revoke all on function private.dashboard_role_catalog() from public,anon,authenticated,service_role;

create or replace function private.dashboard_role_permissions_valid(p_permissions jsonb)
returns boolean language plpgsql stable set search_path='' as $$
begin
 if jsonb_typeof(p_permissions) is distinct from 'array' then return false;end if;
 return jsonb_array_length(p_permissions)<=500
 and not exists(select 1 from jsonb_array_elements(p_permissions) p where jsonb_typeof(p)<>'string'
   or not exists(select 1 from jsonb_array_elements(private.dashboard_role_catalog()->'permissions') c where c->>'key'=p#>>'{}'))
 and (select count(*)=count(distinct value) from jsonb_array_elements_text(p_permissions))
 and not exists(select 1 from jsonb_array_elements_text(p_permissions) p where right(p,5)<>'.view' and not p_permissions ? (split_part(p,'.',1)||'.view'));
end;$$;
revoke all on function private.dashboard_role_permissions_valid(jsonb) from public,anon,authenticated,service_role;

create or replace function private.dashboard_role_access()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.dashboard_profiles%rowtype;a private.dashboard_role_assignments%rowtype;r private.dashboard_roles%rowtype;v_view boolean;v_permissions jsonb;
begin
 if auth.uid() is null then raise exception using errcode='28000',message='login_required';end if;
 select * into p from public.dashboard_profiles where auth_user_id=auth.uid();
 if not found or p.active is not true or coalesce(p.role,'') not in ('owner','admin','viewer') then raise exception using errcode='42501',message='profile_denied';end if;
 if p.role='owner' then
  select coalesce(jsonb_agg(c->>'key' order by c->>'key'),'[]'::jsonb) into v_permissions from jsonb_array_elements(private.dashboard_role_catalog()->'permissions') c;
  return jsonb_build_object('mode','owner','roleId',null,'roleName',null,'version',0,'assignmentVersion',0,'permissions',v_permissions,'canView',true);
 end if;
 select * into a from private.dashboard_role_assignments where auth_user_id=p.auth_user_id;
 v_view:=exists(select 1 from public.dashboard_admin_preview_grants g where g.auth_user_id=p.auth_user_id and g.can_view);
 if a.auth_user_id is null then
  select coalesce(jsonb_agg(c->>'key' order by c->>'key'),'[]'::jsonb) into v_permissions from jsonb_array_elements(private.dashboard_role_catalog()->'permissions') c;
  return jsonb_build_object('mode','legacy','roleId',null,'roleName',null,'version',0,'assignmentVersion',0,'permissions',v_permissions,'canView',v_view);
 end if;
 select * into r from private.dashboard_roles where id=a.role_id;
 if not found then raise exception using errcode='42501',message='role_unavailable';end if;
 return jsonb_build_object('mode','assigned','roleId',r.id,'roleName',r.name,'version',r.version,'assignmentVersion',a.version,
   'permissions',case when r.active then to_jsonb(r.permissions) else '[]'::jsonb end,
   'canView',v_view and r.active and exists(select 1 from unnest(r.permissions) k where right(k,5)='.view'));
end;$$;
revoke all on function private.dashboard_role_access() from public,anon,authenticated,service_role;
create or replace function public.dashboard_role_access()
returns jsonb language sql stable security definer set search_path='' as $$ select private.dashboard_role_access(); $$;
revoke all on function public.dashboard_role_access() from public,anon,service_role;
grant execute on function public.dashboard_role_access() to authenticated;

create or replace function private.dashboard_role_context_valid()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v jsonb;payload jsonb;k bytea;a private.dashboard_role_assignments%rowtype;r private.dashboard_roles%rowtype;
begin
 v:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb;payload:=v->'payload';
 if jsonb_typeof(v)<>'object' or jsonb_typeof(payload)<>'object'
  or coalesce(payload->>'page','')='' or coalesce(payload->>'rpc','')='' or coalesce(payload->>'action','')='' or coalesce(payload->>'capability','')=''
  or payload->>'uid' is distinct from auth.uid()::text
  or payload->>'txid' is distinct from pg_current_xact_id()::text or payload->>'pid' is distinct from pg_backend_pid()::text then return false;end if;
 select secret into k from private.dashboard_role_context_secret where singleton;
 if k is null or v->>'signature' is distinct from private.dashboard_role_hmac(payload::text,k) then return false;end if;
 select * into a from private.dashboard_role_assignments where auth_user_id=auth.uid();
 if not found then return false;end if;
 select * into r from private.dashboard_roles where id=a.role_id;
 return found and r.active and payload->>'roleId'=r.id::text and payload->>'roleVersion'=r.version::text
  and payload->>'assignmentVersion'=a.version::text
  and exists(select 1 from public.dashboard_profiles p where p.auth_user_id=auth.uid() and p.active and p.role in ('admin','viewer'))
  and exists(select 1 from public.dashboard_admin_preview_grants g where g.auth_user_id=auth.uid() and g.can_view);
exception when others then return false;
end;$$;
revoke all on function private.dashboard_role_context_valid() from public,anon,authenticated,service_role;

create or replace function private.dashboard_role_require_gateway()
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from public.dashboard_profiles p where p.auth_user_id=auth.uid() and p.active and p.role='owner') then return;end if;
 if exists(select 1 from private.dashboard_role_assignments where auth_user_id=auth.uid()) and not private.dashboard_role_context_valid() then
  raise exception using errcode='42501',message='role_gateway_required';
 end if;
end;$$;
revoke all on function private.dashboard_role_require_gateway() from public,anon,authenticated,service_role;

create or replace function private.dashboard_role_legacy_allowed()
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from public.dashboard_profiles p where p.auth_user_id=auth.uid() and p.active and p.role='owner') then return true;end if;
 return not exists(select 1 from private.dashboard_role_assignments where auth_user_id=auth.uid()) or private.dashboard_role_context_valid();
end;$$;
revoke all on function private.dashboard_role_legacy_allowed() from public,anon,authenticated,service_role;

create or replace function public.dashboard_role_manage(p_request jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.dashboard_profiles%rowtype;target public.dashboard_profiles%rowtype;r private.dashboard_roles%rowtype;
 a private.dashboard_role_assignments%rowtype;op text;v_before jsonb;v_after jsonb;rid uuid;aid uuid;expected bigint;
 v_permissions text[];v_name text;v_description text;v_result jsonb;
begin
 select * into actor from public.dashboard_profiles where auth_user_id=auth.uid();
 if not found or actor.active is not true or actor.role is distinct from 'owner' then raise exception using errcode='42501',message='owner_required';end if;
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>65536
  or jsonb_typeof(p_request->'operation') is distinct from 'string' then raise exception using errcode='22023',message='invalid_request';end if;
 op:=p_request->>'operation';
 if op='list' then
  if p_request-array['operation']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request';end if;
  return jsonb_build_object('roles',coalesce((select jsonb_agg(to_jsonb(x) order by x.active desc,x.name,x.id) from
    (select id,name,description,permissions,active,version,created_at,updated_at from private.dashboard_roles) x),'[]'::jsonb),
   'accounts',coalesce((select jsonb_agg(jsonb_build_object('auth_user_id',p.auth_user_id,'username',p.username,'role',p.role,'active',p.active,
     'role_id',a.role_id,'role_name',r.name,'assignment_version',coalesce(a.version,0),'data_scope',p.data_scope) order by p.username,p.auth_user_id)
    from public.dashboard_profiles p left join private.dashboard_role_assignments a using(auth_user_id) left join private.dashboard_roles r on r.id=a.role_id),'[]'::jsonb));
 elsif op='create' then
  if p_request-array['operation','name','description','permissions']<>'{}'::jsonb or jsonb_typeof(p_request->'name') is distinct from 'string'
   or not coalesce(private.dashboard_role_permissions_valid(coalesce(p_request->'permissions','[]'::jsonb)),false) then raise exception using errcode='22023',message='invalid_role';end if;
  v_name:=btrim(p_request->>'name');if length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='invalid_role_name';end if;
  select coalesce(array_agg(value order by value),'{}') into v_permissions from jsonb_array_elements_text(coalesce(p_request->'permissions','[]'::jsonb));
  v_description:=btrim(coalesce(p_request->>'description',''));
  if p_request ? 'description' and jsonb_typeof(p_request->'description') is distinct from 'string' or length(coalesce(p_request->>'description',''))>500 then raise exception using errcode='22023',message='invalid_description';end if;
  insert into private.dashboard_roles(name,description,permissions,created_by,updated_by) values(v_name,v_description,v_permissions,actor.auth_user_id,actor.auth_user_id) returning * into r;
  v_after:=to_jsonb(r);rid:=r.id;v_result:=jsonb_build_object('role',v_after);
 elsif op in ('update','archive') then
  if p_request-array['operation','roleId','expectedVersion','name','description','permissions']<>'{}'::jsonb
   or op='archive' and p_request-array['operation','roleId','expectedVersion']<>'{}'::jsonb
   or jsonb_typeof(p_request->'roleId') is distinct from 'string'
   or jsonb_typeof(p_request->'expectedVersion') is distinct from 'number' or p_request->>'expectedVersion' !~ '^[1-9][0-9]{0,15}$'
  then raise exception using errcode='22023',message='invalid_request';end if;
  rid:=(p_request->>'roleId')::uuid;expected:=(p_request->>'expectedVersion')::bigint;
  select * into r from private.dashboard_roles where id=rid for update;
  if not found then raise exception using errcode='22023',message='role_not_found';end if;
  if r.version<>expected then raise exception using errcode='40001',message='role_version_conflict';end if;
  if not r.active then raise exception using errcode='22023',message='role_archived';end if;
  v_before:=to_jsonb(r);v_name:=r.name;v_description:=r.description;v_permissions:=r.permissions;
  if op='update' then
   if p_request ? 'name' then
    if jsonb_typeof(p_request->'name') is distinct from 'string' then raise exception using errcode='22023',message='invalid_role_name';end if;
    v_name:=btrim(p_request->>'name');if length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='invalid_role_name';end if;
   end if;
   if p_request ? 'description' then
    if jsonb_typeof(p_request->'description') is distinct from 'string' or length(p_request->>'description')>500 then raise exception using errcode='22023',message='invalid_description';end if;
    v_description:=btrim(p_request->>'description');
   end if;
   if p_request ? 'permissions' then
    if not coalesce(private.dashboard_role_permissions_valid(p_request->'permissions'),false) then raise exception using errcode='22023',message='invalid_permissions';end if;
    select coalesce(array_agg(value order by value),'{}') into v_permissions from jsonb_array_elements_text(p_request->'permissions');
   end if;
  end if;
  update private.dashboard_roles set name=v_name,description=v_description,permissions=v_permissions,active=(op<>'archive'),version=version+1,updated_by=actor.auth_user_id,updated_at=clock_timestamp() where id=rid returning * into r;
  v_after:=to_jsonb(r);v_result:=jsonb_build_object('role',v_after);
 elsif op='assign' then
  if p_request-array['operation','accountId','roleId','expectedVersion']<>'{}'::jsonb
   or jsonb_typeof(p_request->'accountId') is distinct from 'string' or jsonb_typeof(p_request->'roleId') is distinct from 'string'
   or jsonb_typeof(p_request->'expectedVersion') is distinct from 'number' or p_request->>'expectedVersion' !~ '^(0|[1-9][0-9]{0,15})$'
  then raise exception using errcode='22023',message='invalid_assignment';end if;
  aid:=(p_request->>'accountId')::uuid;rid:=(p_request->>'roleId')::uuid;expected:=(p_request->>'expectedVersion')::bigint;
  select * into target from public.dashboard_profiles where auth_user_id=aid for update;
  if not found or coalesce(target.role,'') not in ('admin','viewer') then raise exception using errcode='42501',message='assignment_target_denied';end if;
  select * into r from private.dashboard_roles where id=rid for share;
  if not found or not r.active then raise exception using errcode='22023',message='role_unavailable';end if;
  select * into a from private.dashboard_role_assignments where auth_user_id=aid for update;
  if coalesce(a.version,0)<>expected then raise exception using errcode='40001',message='assignment_version_conflict';end if;
  v_before:=case when a.auth_user_id is not null then to_jsonb(a) end;
  insert into private.dashboard_role_assignments(auth_user_id,role_id,updated_by) values(aid,rid,actor.auth_user_id)
   on conflict(auth_user_id) do update set role_id=excluded.role_id,version=dashboard_role_assignments.version+1,updated_by=excluded.updated_by,updated_at=clock_timestamp() returning * into a;
  insert into public.dashboard_admin_preview_grants(auth_user_id,can_view,granted_by,updated_at)
   values(aid,true,actor.auth_user_id,clock_timestamp())
   on conflict(auth_user_id) do update set can_view=excluded.can_view,granted_by=excluded.granted_by,updated_at=excluded.updated_at;
  v_after:=to_jsonb(a);v_result:=jsonb_build_object('account',jsonb_build_object('auth_user_id',target.auth_user_id,'username',target.username,'role',target.role,'active',target.active,
   'role_id',r.id,'role_name',r.name,'assignment_version',a.version,'data_scope',target.data_scope));
 else raise exception using errcode='22023',message='invalid_operation';end if;
 insert into private.dashboard_role_audit(actor_id,operation,entity_id,before_value,after_value)
  values(actor.auth_user_id,op,coalesce(aid,rid),v_before,v_after);
 if to_regclass('public.dashboard_audit_log') is not null then
  execute 'insert into public.dashboard_audit_log(actor_user_id,actor_username,action,target_username,details) values($1,$2,$3,$4,$5)'
   using actor.auth_user_id,actor.username,'role_'||op,coalesce(target.username,r.name),jsonb_build_object('entityId',coalesce(aid,rid),'before',v_before,'after',v_after);
 end if;
 return v_result;
end;$$;
revoke all on function public.dashboard_role_manage(jsonb) from public,anon,service_role;
grant execute on function public.dashboard_role_manage(jsonb) to authenticated;

-- Only this entry point creates a signed, transaction-local authorization context.
-- Function names come from the fixed map below, never request text.
create or replace function public.dashboard_admin_execute(p_page text,p_request jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a jsonb;page jsonb;action text;capability text;rpc text;payload jsonb;signature text;k bytea;
 args jsonb;result jsonb;prior text;v_view text;v_operation text;needed text[];
begin
 a:=private.dashboard_role_access();
 if a->>'mode'<>'assigned' or not (a->>'canView')::boolean then raise exception using errcode='42501',message='assigned_role_required';end if;
 if p_page is null or p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>65536
  or jsonb_typeof(p_request->'action') is distinct from 'string' then raise exception using errcode='22023',message='invalid_request';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages') where value->>'id'=p_page;
 action:=p_request->>'action';v_operation:=p_request->>'operation';v_view:=p_request->>'view';
 if page is null or action='portalOperationLogs' or not (page->'requests') ? action
  or not (a->'permissions') ? (p_page||'.view') then raise exception using errcode='42501',message='page_action_denied';end if;
 capability:=case when action in ('catalog','providerOptions','configurationAccess') then 'view'
   when action='withdrawNote' then 'edit' when action='configurationWrite' and v_operation='grant' then 'grant'
   when action='configurationWrite' then 'edit' else 'query' end;
 needed:=array[p_page||'.view',p_page||'.'||capability];
 if action in ('details','query') or action='aggregate' and v_view='drilldown'
  or action='submissionAnalysis' and v_operation='members'
  or action='workorderRecords' and v_operation in ('detail','orderDetail')
  or action='depositStatistics' and (p_request->>'section'='details' or p_request->>'section'='kyc' and p_request->>'dimension'='orders')
  or action='depositIssues' and p_page='deposit_statistics'
 then needed:=array_append(needed,p_page||'.detail');end if;
 if not (a->'permissions') ?& needed then raise exception using errcode='42501',message='role_permission_denied';end if;
 if action='configurationWrite' and not (v_operation='grant' and p_page in ('provider_config','teams')
  or v_operation='provider' and p_page='provider_config' or v_operation='platform' and p_page='teams') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='workorderRecords' and not (p_page='workorders' and coalesce(v_view,'records') in ('records','orders')
  or p_page='workorder_reconciliation' and v_view='missing' or p_page='workorder_workload' and v_view='workload') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 if action='autoWithdraw' and (p_page='withdraw_operators' and coalesce(v_view,'auto')<>'operators'
  or p_page in ('auto_withdraw','overview') and coalesce(v_view,'auto')<>'auto') then
  raise exception using errcode='42501',message='page_action_denied';end if;
 rpc:=case action
  when 'submissionAnalysis' then 'dashboard_admin_live_submission_analysis'
  when 'memberDaily' then 'dashboard_admin_live_member_daily'
  when 'pendingSnapshot' then 'dashboard_admin_live_pending_snapshot'
  when 'pendingAnalysis' then 'dashboard_admin_live_pending_analysis'
  when 'depositStatistics' then 'dashboard_admin_deposit_statistics'
  when 'workorderRecords' then 'dashboard_admin_live_workorder_records'
  when 'intakeCoverage' then 'dashboard_admin_live_intake_coverage'
  when 'reportSummary' then 'dashboard_admin_live_report_summary'
  when 'syncHealth' then 'dashboard_admin_live_sync_health'
  when 'collectedData' then 'dashboard_admin_live_collected_data'
  when 'rates' then 'dashboard_admin_live_rates'
  when 'ratesSheet' then 'dashboard_admin_live_rate_sheet'
  when 'payoutConfig' then 'dashboard_admin_live_payout_config'
  when 'autoWithdraw' then 'dashboard_admin_live_auto_withdraw'
  when 'withdrawReasons' then 'dashboard_admin_live_withdraw_reasons'
  when 'withdrawNote' then 'dashboard_admin_live_withdraw_note'
  when 'depositIssues' then 'dashboard_admin_live_deposit_issues'
  when 'workorders' then 'dashboard_admin_live_workorders'
  when 'providerConfig' then 'dashboard_admin_live_provider_config'
  when 'platformAssignments' then 'dashboard_admin_live_platform_assignments'
  when 'providerOptions' then 'dashboard_admin_live_provider_options'
  when 'configurationAccess' then 'dashboard_admin_live_configuration_access'
  when 'configurationWrite' then 'dashboard_admin_live_configuration_write'
  when 'aggregate' then case when v_view='drilldown' then 'dashboard_admin_live_drilldown' else 'dashboard_admin_live_query' end
  when 'catalog' then 'dashboard_admin_live_query'
  when 'query' then 'dashboard_admin_live_query'
  when 'details' then 'dashboard_admin_live_query' end;
 if rpc is null then raise exception using errcode='42501',message='page_action_denied';end if;
 args:=case when rpc in ('dashboard_admin_live_query','dashboard_admin_live_drilldown') then p_request else p_request-'action' end;
 payload:=jsonb_build_object('uid',auth.uid(),'txid',pg_current_xact_id()::text,'pid',pg_backend_pid()::text,
  'roleId',a->>'roleId','roleVersion',a->>'version','assignmentVersion',a->>'assignmentVersion','page',p_page,'rpc',rpc,'action',action,'capability',capability);
 select secret into k from private.dashboard_role_context_secret where singleton;
 signature:=private.dashboard_role_hmac(payload::text,k);prior:=current_setting('hensem.dashboard_role_context',true);
 perform set_config('hensem.dashboard_role_context',jsonb_build_object('payload',payload,'signature',signature)::text,true);
 begin
  execute format('select private.%I($1)',rpc) into result using args;
 exception when others then
  perform set_config('hensem.dashboard_role_context',coalesce(prior,''),true);raise;
 end;
 perform set_config('hensem.dashboard_role_context',coalesce(prior,''),true);
 return result;
end;$$;
revoke all on function public.dashboard_admin_execute(text,jsonb) from public,anon,service_role;
grant execute on function public.dashboard_admin_execute(text,jsonb) to authenticated;

do $guard$
declare p record;v_new text:=$body$
declare v_user uuid := (select auth.uid()); v_profile public.dashboard_profiles%rowtype;
begin
  perform private.dashboard_role_require_gateway(); -- assigned-role signed gateway
  if v_user is null then raise exception using errcode='28000',message='login_required'; end if;
  select * into v_profile from public.dashboard_profiles where auth_user_id=v_user;
  if not found or v_profile.active is not true or coalesce(v_profile.role,'') not in ('owner','admin','viewer') then
    raise exception using errcode='42501',message='preview_denied';
  end if;
  if v_profile.role<>'owner' and not exists(select 1 from public.dashboard_admin_preview_grants
      where auth_user_id=v_user and can_view is true) then
    raise exception using errcode='42501',message='preview_denied';
  end if;
  -- Fresh production scope, independent of the old third_party module grant.
  return private.dashboard_current_data_scope();
end;
$body$;
begin
 select f.*,l.lanname,r.rolname owner_name into p from pg_proc f join pg_language l on l.oid=f.prolang join pg_roles r on r.oid=f.proowner where f.oid=to_regprocedure('private.dashboard_admin_live_scope()');
 if not found or p.owner_name<>current_user or not p.prosecdef or p.provolatile<>'s' or p.proretset or p.prorettype<>'jsonb'::regtype
  or p.lanname<>'plpgsql' or md5(p.prosrc) not in ('8da251f3e94344ff4f5d6a09b717e603','c5435702b62b973e11effbe7a3c0ec76') then raise exception 'dashboard_role_existing_function_drift: private.dashboard_admin_live_scope()';end if;
 if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.privilege_type<>'EXECUTE' or x.is_grantable
  or x.grantee<>p.proowner and not false) then raise exception 'dashboard_role_existing_acl_drift: private.dashboard_admin_live_scope()';end if;
 if md5(p.prosrc)='8da251f3e94344ff4f5d6a09b717e603' then execute replace(pg_get_functiondef(p.oid),p.prosrc,v_new);end if;
end;$guard$;

do $guard$
declare p record;v_new text:=$body$
  select private.dashboard_role_legacy_allowed() and (select exists (
    select 1
    from public.dashboard_profiles p
    where p.auth_user_id = auth.uid()
      and p.active = true
      and (
        p.role = 'owner'
        or coalesce((p.permissions ->> permission_key)::boolean, false) = true
      )
  ));
$body$;
begin
 select f.*,l.lanname,r.rolname owner_name into p from pg_proc f join pg_language l on l.oid=f.prolang join pg_roles r on r.oid=f.proowner where f.oid=to_regprocedure('public.dashboard_has_permission(text)');
 if not found or p.owner_name<>current_user or not p.prosecdef or p.provolatile<>'s' or p.proretset or p.prorettype<>'boolean'::regtype
  or p.lanname<>'sql' or md5(p.prosrc) not in ('510830b791906653360ef35e5d493b85','50bcbef71ccf15b6912135d10e8a37f8') then raise exception 'dashboard_role_existing_function_drift: public.dashboard_has_permission(text)';end if;
 if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.privilege_type<>'EXECUTE' or x.is_grantable
  or x.grantee<>p.proowner and not x.grantee in (select oid from pg_roles where rolname in ('anon','authenticated','service_role'))) then raise exception 'dashboard_role_existing_acl_drift: public.dashboard_has_permission(text)';end if;
 if md5(p.prosrc)='510830b791906653360ef35e5d493b85' then execute replace(pg_get_functiondef(p.oid),p.prosrc,v_new);end if;
end;$guard$;

notify pgrst,'reload schema';
commit;
