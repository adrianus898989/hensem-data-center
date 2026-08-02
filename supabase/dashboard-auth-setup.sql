-- Hensem Dashboard 登录/权限表
-- Admin 可以通过 dashboard-user-admin Edge Function 建立 Viewer；Viewer 只有查看权限。

create table if not exists public.dashboard_profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  role text not null default 'viewer' check (role in ('admin','viewer')),
  active boolean not null default true,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_profiles_role_idx on public.dashboard_profiles(role, active);

alter table public.dashboard_profiles enable row level security;

-- 登录用户只能读取自己的账号资料；Admin 的建立账号动作由 Edge Function + Service Role 完成。
drop policy if exists dashboard_profile_read_self on public.dashboard_profiles;
create policy dashboard_profile_read_self
on public.dashboard_profiles
for select
to authenticated
using (auth.uid() = auth_user_id);

-- 三方数据只允许已经通过 Supabase Auth 登录的用户读取。
-- 同步 Edge Function 使用 Service Role，不受这些 RLS policy 影响。
alter table public.third_party_volume enable row level security;
alter table public.third_party_rates enable row level security;
alter table public.third_party_platform_status enable row level security;
alter table public.sync_status enable row level security;

drop policy if exists dashboard_read_third_party_volume on public.third_party_volume;
create policy dashboard_read_third_party_volume
on public.third_party_volume for select to authenticated using (true);

drop policy if exists dashboard_read_third_party_rates on public.third_party_rates;
create policy dashboard_read_third_party_rates
on public.third_party_rates for select to authenticated using (true);

drop policy if exists dashboard_read_third_party_platform_status on public.third_party_platform_status;
create policy dashboard_read_third_party_platform_status
on public.third_party_platform_status for select to authenticated using (true);

drop policy if exists dashboard_read_sync_status on public.sync_status;
create policy dashboard_read_sync_status
on public.sync_status for select to authenticated using (true);

-- 不创建任何 authenticated INSERT / UPDATE / DELETE policy。
-- 所以 Viewer 和 Admin 在浏览器端都只能读数据；Admin 建账号必须走受保护的 Edge Function。
