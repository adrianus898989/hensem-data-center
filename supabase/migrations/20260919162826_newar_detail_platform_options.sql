begin;
alter table public.newar_detail_platforms add column launch_at timestamptz;
update public.newar_detail_platforms set launch_at='2026-09-21T19:00:00Z' where platform='92BLAZE';

create function private.newar_detail_launch_guard() returns trigger
language plpgsql set search_path='' as $$
declare boundary timestamptz;
begin
  select launch_at into boundary from public.newar_detail_platforms where platform=new.platform;
  if boundary is not null and (new.created_at<boundary or new.captured_at<boundary) then
    raise exception using errcode='22023',message='NEWAR_INVALID_PRELAUNCH';
  end if;
  return new;
end;
$$;
revoke all on function private.newar_detail_launch_guard() from public,anon,authenticated;
create trigger newar_detail_launch_guard before insert or update on public.newar_detail_records
for each row execute function private.newar_detail_launch_guard();

create function private.dashboard_newar_detail_platforms() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare scope jsonb; charge_access boolean; workorder_access boolean; platforms jsonb;
begin
  if (select auth.uid()) is null then raise exception using errcode='28000',message='请先登录'; end if;
  charge_access:=public.dashboard_has_permission('third_party') is true;
  workorder_access:=public.dashboard_has_permission('work_orders') is true;
  if not charge_access and not workorder_access then raise exception using errcode='42501',message='没有查询权限'; end if;
  scope:=private.dashboard_current_data_scope();
  select coalesce(jsonb_agg(jsonb_build_object('platform',p.platform,'country_code',p.country_code,
    'country',p.country,'timezone',p.timezone,'launch_at',p.launch_at,
    'datasets',case when charge_access then '["charge","withdraw"]'::jsonb else '[]'::jsonb end
      ||case when workorder_access then '["workorder"]'::jsonb else '[]'::jsonb end) order by p.platform),'[]'::jsonb)
  into platforms from public.newar_detail_platforms p where p.enabled
    and private.dashboard_scope_allows(scope,p.country_code,p.platform);
  return jsonb_build_object('platforms',platforms);
end;
$$;
create function public.dashboard_newar_detail_platforms() returns jsonb
language sql stable security invoker set search_path='' as $$select private.dashboard_newar_detail_platforms()$$;
revoke all on function private.dashboard_newar_detail_platforms(),public.dashboard_newar_detail_platforms() from public,anon;
grant execute on function private.dashboard_newar_detail_platforms(),public.dashboard_newar_detail_platforms() to authenticated;
commit;
