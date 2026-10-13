-- Function definitions only; all fixture identities are synthetic.
CREATE OR REPLACE FUNCTION private.workorder_portal_account_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.workorder_portal_account_audit(actor_id,action,target_id,before_value,after_value)
  values(new.updated_by,case when tg_op='INSERT' then 'create-account' else 'update-account' end,new.auth_user_id,
    case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.workorder_portal_account_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION private.workorder_permissions_valid(p_role text, p_permissions jsonb)
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
    when 'agent' then array['case.view','case.create','case.follow','case.close','case.link','proof.read','proof.upload','proof.remove']::text[]
    when 'supervisor' then array['case.view','case.view_team','case.create','case.follow','case.close','case.approve','case.reopen','case.link','case.assign','proof.read','proof.upload','proof.remove','report.view','activity.view','audit.view']::text[]
    when 'auditor' then array['case.view','case.view_team','proof.read','report.view','activity.view','audit.view']::text[]
    else array[]::text[] end;
  return not exists(select 1 from jsonb_each(p_permissions) e(key,value)
    where not(e.key=any(array['case.view','case.view_team','case.create','case.follow','case.close','case.approve','case.reopen','case.link','case.assign','proof.read','proof.upload','proof.remove','report.view','activity.view','audit.view']::text[])) or jsonb_typeof(e.value)<>'boolean'
       or(e.value='true'::jsonb and not(e.key=any(permitted))));
end;
$function$
;
