-- Operational notes live separately so automatic source refreshes cannot overwrite them.
create table public.auto_withdraw_notes (
  data_date date not null,
  country text not null check (country = btrim(country) and length(country) between 1 and 100),
  platform text not null check (platform = btrim(platform) and length(platform) between 1 and 100),
  reason text not null default '' check (length(reason) <= 1000),
  updated_by uuid not null,
  updated_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (data_date, country, platform)
);

alter table public.auto_withdraw_notes enable row level security;
revoke all on public.auto_withdraw_notes from anon, authenticated;
grant select, insert, update on public.auto_withdraw_notes to authenticated;
grant all on public.auto_withdraw_notes to service_role;

create policy auto_withdraw_notes_read on public.auto_withdraw_notes
for select to authenticated
using ((select public.dashboard_has_permission('auto_withdraw')));

create policy auto_withdraw_notes_insert on public.auto_withdraw_notes
for insert to authenticated
with check (
  (select public.dashboard_has_permission('auto_withdraw'))
  and exists (
    select 1 from public.dashboard_profiles p
    where p.auth_user_id = (select auth.uid()) and p.active and p.role in ('owner', 'admin')
  )
  and updated_by = (select auth.uid())
  and exists (
    select 1 from public.auto_withdraw_daily d
    where d.data_date = auto_withdraw_notes.data_date
      and d.country = auto_withdraw_notes.country and d.platform = auto_withdraw_notes.platform
  )
);

create policy auto_withdraw_notes_update on public.auto_withdraw_notes
for update to authenticated
using (
  (select public.dashboard_has_permission('auto_withdraw'))
  and exists (
    select 1 from public.dashboard_profiles p
    where p.auth_user_id = (select auth.uid()) and p.active and p.role in ('owner', 'admin')
  )
)
with check (
  (select public.dashboard_has_permission('auto_withdraw'))
  and exists (
    select 1 from public.dashboard_profiles p
    where p.auth_user_id = (select auth.uid()) and p.active and p.role in ('owner', 'admin')
  )
  and updated_by = (select auth.uid())
);

create function public.stamp_auto_withdraw_note()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  editor_name text;
begin
  select p.username into editor_name from public.dashboard_profiles p
  where p.auth_user_id = auth.uid() and p.active and p.role in ('owner', 'admin');
  if editor_name is null or not public.dashboard_has_permission('auto_withdraw') then
    raise exception '没有自动出款备注编辑权限' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.data_date, new.country, new.platform) is distinct from (old.data_date, old.country, old.platform) then
    raise exception '备注日期、国家和平台不可变更' using errcode = '23514';
  end if;
  new.reason := btrim(new.reason);
  new.updated_by := auth.uid();
  new.updated_by_name := editor_name;
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then new.created_at := old.created_at; else new.created_at := clock_timestamp(); end if;
  return new;
end;
$$;

revoke all on function public.stamp_auto_withdraw_note() from public, anon, authenticated;
create trigger stamp_auto_withdraw_note before insert or update on public.auto_withdraw_notes
for each row execute function public.stamp_auto_withdraw_note();

comment on table public.auto_withdraw_notes is '按日期、国家、平台记录人工占比原因；留空代表清除备注，不随出款数据同步重建。';
