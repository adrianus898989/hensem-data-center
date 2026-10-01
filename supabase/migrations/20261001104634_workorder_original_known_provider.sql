-- Correct original-order provider attribution only; raw ticket attribution and financial metrics remain unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $install$
declare
  target regprocedure:='private.dashboard_admin_live_workorder_analysis(jsonb)'::regprocedure;
  p record; authenticated_role oid; candidate text; change record;
begin
  perform pg_advisory_xact_lock(hashtext('WORKORDER_ORIGINAL_KNOWN_PROVIDER_V1'));
  select * into p from pg_proc where oid=target;
  select oid into authenticated_role from pg_roles where rolname='authenticated';
  if authenticated_role is null or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
    or p.pronargdefaults<>0 or not p.prosecdef
    or p.proconfig is distinct from array['search_path=""','statement_timeout=20s']
    or p.prolang<>(select oid from pg_language where lanname='plpgsql') then
    raise exception 'Workorder provider attribution execution metadata changed; review before applying';
  end if;
  if not exists(select 1 from aclexplode(p.proacl) a where a.grantee=authenticated_role and a.privilege_type='EXECUTE' and not a.is_grantable)
    or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.privilege_type='EXECUTE' and (a.grantee not in(p.proowner,authenticated_role) or a.grantee=authenticated_role and a.is_grantable)) then
    raise exception 'Workorder provider attribution ACL changed; review before applying';
  end if;
  if md5(p.prosrc)='57937cdc782d6186b976ee1beebc84bc' then return;end if;
  if md5(p.prosrc)<>'f61cb5749b6d091f50383ac53d35a71c' then
    raise exception 'Workorder provider attribution baseline changed; review before applying';
  end if;
  candidate:=p.prosrc;
  for change in select * from (values
($old$  select d.*,coalesce(nullif(p.provider,''),'未填写三方') provider from filtered d$old$,$new$  -- Unknown labels are absence of attribution, not competing providers.
  select d.*,coalesce(nullif(p.provider,''),'未填写三方') provider,
   case when regexp_replace(lower(btrim(coalesce(p.provider,''))),'[[:space:]_-]+','','g')
    in ('','未填写三方','未标记三方','未识别三方','未识别通道','未分类三方','未提供','unknown','unmarked')
    then null else p.provider end known_provider
  from filtered d$new$),
($old$   case when count(distinct provider)=1 then min(provider) else '三方归属待核对' end provider,$old$,$new$   -- WORKORDER_ORIGINAL_KNOWN_PROVIDER_V1: retain one known attribution.
   case when count(distinct known_provider)=1 then min(known_provider)
    when count(distinct known_provider)>1 then '三方归属待核对'
    when count(distinct provider)=1 then min(provider) else '未标记三方' end provider,$new$)
  ) changes(old_text,new_text) loop
    if (length(candidate)-length(replace(candidate,change.old_text,'')))/length(change.old_text)<>1 then
      raise exception 'Workorder provider attribution fragment changed: %',left(change.old_text,100);
    end if;
    candidate:=replace(candidate,change.old_text,change.new_text);
  end loop;
  if md5(candidate)<>'57937cdc782d6186b976ee1beebc84bc' then raise exception 'Workorder provider attribution candidate changed';end if;
  execute 'create or replace function private.dashboard_admin_live_workorder_analysis(p_query jsonb) returns jsonb language plpgsql stable security definer set search_path='''' set statement_timeout=''20s'' as '||quote_literal(candidate);
  if (select proacl is distinct from p.proacl from pg_proc where oid=target) then
    raise exception 'Workorder provider attribution ACL unexpectedly changed';
  end if;
end;
$install$;
notify pgrst,'reload schema';
commit;
