-- V249：总管理员 / 小管理员 / 查看账号 分级权限升级
-- 只需要执行一次。
-- 当前 username='admin' 会提升为唯一 owner（总管理员）。

alter table public.dashboard_profiles
  add column if not exists management_permissions jsonb not null default '{"manage_viewers":false,"refresh_data":false,"view_audit":false}'::jsonb;

-- 放宽旧 role 约束：owner > admin > viewer
alter table public.dashboard_profiles
  drop constraint if exists dashboard_profiles_role_check;

alter table public.dashboard_profiles
  add constraint dashboard_profiles_role_check
  check (role in ('owner','admin','viewer'));

-- 现有主账号 admin 升级为唯一总管理员。
update public.dashboard_profiles
set
  role = 'owner',
  active = true,
  permissions = jsonb_build_object(
    'home', true,
    'third_party', true,
    'auto_withdraw', true,
    'work_orders', true,
    'customer_service', true
  ),
  management_permissions = jsonb_build_object(
    'manage_viewers', true,
    'refresh_data', true,
    'view_audit', true
  ),
  updated_at = now()
where username = 'admin';

-- 数据库层保证只能有一个 owner。
create unique index if not exists dashboard_profiles_single_owner_idx
  on public.dashboard_profiles ((role))
  where role = 'owner';

-- 已有普通 admin 默认保留完整业务模块，但管理能力由 owner 后续调整。
update public.dashboard_profiles
set
  permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
    'home', true,
    'third_party', coalesce((permissions->>'third_party')::boolean, true),
    'auto_withdraw', coalesce((permissions->>'auto_withdraw')::boolean, true),
    'work_orders', coalesce((permissions->>'work_orders')::boolean, true),
    'customer_service', coalesce((permissions->>'customer_service')::boolean, true)
  ),
  management_permissions = case
    when role = 'admin' and management_permissions = '{"manage_viewers":false,"refresh_data":false,"view_audit":false}'::jsonb
      then '{"manage_viewers":true,"refresh_data":true,"view_audit":true}'::jsonb
    else management_permissions
  end,
  updated_at = now()
where role = 'admin';

-- 只读检查
select
  username,
  role,
  active,
  permissions,
  management_permissions
from public.dashboard_profiles
order by
  case role when 'owner' then 1 when 'admin' then 2 else 3 end,
  username;

-- 更新业务数据 RLS：Owner 永远全部可读；Admin / Viewer 按模块权限读取。
create or replace function public.dashboard_has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.dashboard_profiles p
    where p.auth_user_id = auth.uid()
      and p.active = true
      and (
        p.role = 'owner'
        or coalesce((p.permissions ->> permission_key)::boolean, false) = true
      )
  );
$$;

revoke all on function public.dashboard_has_permission(text) from public;
grant execute on function public.dashboard_has_permission(text) to authenticated;
