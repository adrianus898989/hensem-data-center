-- These four AR workorder form names differ from the payment uploader's name.
-- Bind them only through the existing enabled country/platform/tenant registry
-- and existing dashboard scope rules. Do not alias any other platform or tenant.
do $upgrade$
declare reader text;
begin
  if (select md5(prosrc) from pg_proc where oid='private.dashboard_admin_deposit_ticket_list(jsonb)'::regprocedure)
    is distinct from '041069c7f61bdc2bb46e99366829a388' then raise exception 'deposit ticket platform reader drift';end if;
  select pg_get_functiondef('private.dashboard_admin_deposit_ticket_list(jsonb)'::regprocedure) into reader;
  reader:=replace(reader,$old$select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into catalog from private.dashboard_admin_live_platforms() p
    where p.scope_group=country_code$old$,$new$select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
        'ticket_name',coalesce(binding.ticket_name,p.source_name),'ticket_tenant',binding.ticket_tenant) order by p.id),'[]')
    into catalog from private.dashboard_admin_live_platforms() p
    left join lateral (
      select alias.ticket_name,min(reg.source_tenant_id)::text as ticket_tenant
      from (values ('OKWIN','OK.WIN'),('Shree.Win','SHREEWIN'),('82LOTTERY','82BET'),('Veer.Game','VEER.GAME')) alias(payment_name,ticket_name)
      join private.ar_middle_channel_platforms reg on reg.enabled and reg.country_code=p.scope_group
         and reg.dashboard_platform_id=p.id and reg.native_platform=p.source_name and reg.source_tenant_id is not null
      where p.source='ar' and p.scope_group='IN' and p.source_name=alias.payment_name
        and private.dashboard_scope_platform_identity(p.scope_group,alias.ticket_name)=private.dashboard_scope_platform_identity(p.scope_group,p.source_name)
        and private.dashboard_scope_allows(account_scope,p.scope_group,alias.ticket_name)
      group by alias.ticket_name having count(*)=1
    ) binding on true
    where p.scope_group=country_code$new$);
  reader:=replace(reader,'in (x->>''name'',x->>''source_name'')','in (x->>''name'',x->>''source_name'',x->>''ticket_name'')');
  reader:=replace(reader,'scope_group text,timezone text)','scope_group text,timezone text,ticket_name text,ticket_tenant text)');
  reader:=replace(reader,'in(x.name,x.source_name)','in(x.name,x.source_name,x.ticket_name)');
  reader:=replace(reader,'d.country_code=t.scope_group and d.platform=t.source_name and (',
      'd.country_code=t.scope_group and d.platform=t.ticket_name and (t.ticket_tenant is null or d.tenant_id=t.ticket_tenant) and (');
  reader:=replace(reader,'l.platform=t.source_name and (l.source_record_id=',
      'l.platform=t.ticket_name and (t.ticket_tenant is null or l.tenant_id=t.ticket_tenant) and (l.source_record_id=');
  reader:=replace(reader,'private.dashboard_deposit_ticket_ar_slice(t.scope_group,t.source_name,',
      'private.dashboard_deposit_ticket_ar_slice(t.scope_group,t.ticket_name,');
  reader:=replace(reader,'d.country_code=t.scope_group and d.platform=t.source_name
        and d.issue_kind=', 'd.country_code=t.scope_group and d.platform=t.ticket_name
        and (t.ticket_tenant is null or d.tenant_id=t.ticket_tenant)
        and d.issue_kind=');
  reader:=replace(reader,$old$'sourcePlatform',w.source_name$old$,
      $new$'sourcePlatform',case when w.source='ar' then (w.ar).platform else w.source_name end$new$);
  -- w.source_name stays the authorized payment-native name for exact financial lookup.
  if strpos(reader,'into catalog from private.dashboard_admin_live_platforms() p
    left join lateral')=0 or strpos(reader,'t.ticket_tenant is null or d.tenant_id=t.ticket_tenant')=0
    or strpos(reader,'t.ticket_tenant is null or l.tenant_id=t.ticket_tenant')=0
    or strpos(reader,'private.dashboard_deposit_ticket_ar_slice(t.scope_group,t.ticket_name,')=0
    or strpos(reader,'private.dashboard_deposit_ticket_ar_slice(t.scope_group,t.source_name,')>0
    or strpos(reader,'ticket_name text,ticket_tenant text)')=0 then raise exception 'deposit ticket platform patch incomplete';end if;
  execute reader;
end;
$upgrade$;
