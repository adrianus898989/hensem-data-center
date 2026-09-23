-- Independent preview access only. Does not alter existing dashboard permissions.
begin;
create table if not exists public.dashboard_admin_preview_grants (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  can_view boolean not null default false,
  granted_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.dashboard_admin_preview_grants enable row level security;
revoke all on public.dashboard_admin_preview_grants from public, anon, authenticated;
grant select on public.dashboard_admin_preview_grants to authenticated;
grant all on public.dashboard_admin_preview_grants to service_role;
drop policy if exists dashboard_admin_preview_own_grant on public.dashboard_admin_preview_grants;
create policy dashboard_admin_preview_own_grant
  on public.dashboard_admin_preview_grants for select to authenticated
  using ((select auth.uid()) = auth_user_id);
comment on table public.dashboard_admin_preview_grants is
  'Independent preview access. Own grant is readable through RLS; writes require the fresh-Owner-checked preview Edge endpoint.';
commit;
