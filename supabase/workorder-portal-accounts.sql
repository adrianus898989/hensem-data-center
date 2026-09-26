-- Independent employee identity/permissions. Review and apply before deploying
-- workorder-account-admin. No existing backend roles, data, or policies change.
begin;
create table if not exists public.workorder_portal_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete restrict,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name text not null check(length(btrim(display_name)) between 1 and 100),
  role text not null check(role in ('supervisor','agent','auditor')),
  team text not null check(length(btrim(team)) between 1 and 100),
  platforms text[] not null check(cardinality(platforms) between 1 and 200),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.workorder_portal_account_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  action text not null check(action in ('create-account','update-account','reset-password')),
  target_id uuid not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);
alter table public.workorder_portal_accounts enable row level security;
alter table public.workorder_portal_account_audit enable row level security;
revoke all on public.workorder_portal_accounts,public.workorder_portal_account_audit from public,anon,authenticated;
grant select,insert,update on public.workorder_portal_accounts to service_role;
grant select,insert on public.workorder_portal_account_audit to service_role;
grant usage,select on sequence public.workorder_portal_account_audit_id_seq to service_role;

create or replace function private.workorder_portal_account_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.dashboard_profiles where auth_user_id=new.auth_user_id) then
    raise exception using errcode='42501',message='Workorder accounts must not be backend accounts';
  end if;
  if not exists(select 1 from auth.users u where u.id=new.auth_user_id and lower(u.email)=new.username||'@workorder.hensem.local') then
    raise exception using errcode='42501',message='Workorder Auth identity mismatch';
  end if;
  if not exists(select 1 from public.dashboard_profiles p where p.auth_user_id=new.updated_by and p.active and p.role='owner') then
    raise exception using errcode='42501',message='Active backend owner required';
  end if;
  if tg_op='UPDATE' and (new.auth_user_id<>old.auth_user_id or new.username<>old.username or new.created_by<>old.created_by or new.created_at<>old.created_at) then
    raise exception using errcode='42501',message='Account identity is immutable';
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;
revoke all on function private.workorder_portal_account_guard() from public,anon,authenticated;
drop trigger if exists workorder_portal_account_guard on public.workorder_portal_accounts;
create trigger workorder_portal_account_guard before insert or update on public.workorder_portal_accounts
  for each row execute function private.workorder_portal_account_guard();

create or replace function private.workorder_portal_account_audit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.workorder_portal_account_audit(actor_id,action,target_id,before_value,after_value)
  values(new.updated_by,case when tg_op='INSERT' then 'create-account' else 'update-account' end,new.auth_user_id,
    case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
  return new;
end;
$$;
revoke all on function private.workorder_portal_account_audit() from public,anon,authenticated;
drop trigger if exists workorder_portal_account_audit on public.workorder_portal_accounts;
create trigger workorder_portal_account_audit after insert or update on public.workorder_portal_accounts
  for each row execute function private.workorder_portal_account_audit();
commit;
