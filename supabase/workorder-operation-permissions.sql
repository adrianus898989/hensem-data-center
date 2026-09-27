-- Independent operation permissions; existing null rows retain their role template.
begin;
alter table public.workorder_portal_accounts add column if not exists permissions jsonb;
create or replace function private.workorder_permissions_valid(p_role text,p_permissions jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare permitted text[];
begin
  if p_permissions is null then return true; end if;
  if jsonb_typeof(p_permissions)<>'object' then return false; end if;
  permitted:=case p_role
    when 'agent' then array['case.view','case.create','case.follow','case.close','case.link','proof.read','proof.upload','proof.remove']::text[]
    when 'supervisor' then array['case.view','case.view_team','case.create','case.follow','case.close','case.approve','case.reopen','case.link','case.assign','proof.read','proof.upload','proof.remove','report.view','activity.view','audit.view']::text[]
    when 'auditor' then array['case.view','case.view_team','proof.read','report.view','activity.view','audit.view']::text[]
    else array[]::text[] end;
  return not exists(select 1 from jsonb_each(p_permissions) e(key,value)
    where not(e.key=any(array['case.view','case.view_team','case.create','case.follow','case.close','case.approve','case.reopen','case.link','case.assign','proof.read','proof.upload','proof.remove','report.view','activity.view','audit.view']::text[])) or jsonb_typeof(e.value)<>'boolean'
       or(e.value='true'::jsonb and not(e.key=any(permitted))));
end;
$$;
revoke all on function private.workorder_permissions_valid(text,jsonb) from public,anon,authenticated;
grant execute on function private.workorder_permissions_valid(text,jsonb) to service_role;
alter table public.workorder_portal_accounts drop constraint if exists workorder_permissions_valid;
alter table public.workorder_portal_accounts add constraint workorder_permissions_valid check(private.workorder_permissions_valid(role,permissions));
commit;
