-- Future-only repair of three confirmed IN source spellings.
-- No credential scope, archived identity, receipt, business order, or currency
-- is rewritten. The existing exact resolver remains unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
set local timezone='UTC';

create temporary table pending_native_spelling_targets (
 source_system text, old_platform text, native_platform text, row_hash text,
 mapping_id uuid, platform_id uuid, currency text,
 primary key(source_system,old_platform)
) on commit drop;
insert into pending_native_spelling_targets(source_system,old_platform,native_platform,row_hash,currency) values
 ('NEW_AR','DHANIWIN','DhaniWin','e1bdaed762d94d2811c1bc6a1712f8db','INR'),
 ('AR','SHREE.WIN','Shree.Win','8205133f2e564ec476c3a9615a2b36d2',null),
 ('AR','VEER.GAME','Veer.Game','d02a0000d2a9e0a7bc5cd2dc7b24869b',null);

do $guard$
declare t record;m public.dashboard_platform_team_map%rowtype;f pg_proc%rowtype;n integer;
begin
 select * into f from pg_proc where oid=to_regprocedure('private.archive_withdraw_pending_capture(text,text,text,timestamptz)');
 if not found or md5(pg_get_functiondef(f.oid))<>'910817e22b37c139e75295e5c2bba402'
  or md5(f.prosrc)<>'3cd18ce2314ce10e0c16b4829c06567b'
  or pg_get_userbyid(f.proowner)<>'postgres' or not f.prosecdef or f.provolatile<>'v'
  or f.proconfig is distinct from array['search_path=""']::text[]
  or f.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' then
  raise exception 'pending_spelling_archive_contract_drift';end if;
 if to_regclass('private.collector_platform_identities')is null
  or to_regclass('private.collector_exact_scope_bindings')is null then
  raise exception 'pending_spelling_identity_registry_required';end if;
 for t in select * from pending_native_spelling_targets order by source_system,old_platform loop
  select count(*) into n from public.dashboard_platform_team_map x where x.active and x.source_system=t.source_system
   and x.country_code='IN' and upper(btrim(x.source_platform))=t.old_platform;
  if n<>1 then raise exception 'pending_spelling_mapping_ambiguous: %',t.old_platform;end if;
  select * into m from public.dashboard_platform_team_map x where x.active and x.source_system=t.source_system
   and x.country_code='IN' and x.source_country='印度' and x.source_platform=t.old_platform for update;
  if not found or md5(to_jsonb(m)::text)<>t.row_hash or m.team_name<>'M8' then
   raise exception 'pending_spelling_full_mapping_drift: %',t.old_platform;end if;
  if exists(select 1 from private.collector_platform_identities i where i.mapping_id=m.id
   or i.platform_id=md5(case t.source_system when 'NEW_AR' then 'newar' else 'ar' end||':IN:'||t.native_platform)::uuid) then
   raise exception 'pending_spelling_identity_already_enrolled: %',t.old_platform;end if;
  if t.source_system='AR' then
   select count(*) into n from public.ar_config_targets x where x.source_system='AR' and x.country_code='IN'
    and x.platform=t.native_platform and x.country_name='印度' and x.timezone='Asia/Kolkata'
    and x.currency is not distinct from t.currency;
  else
   select count(*) into n from public.newar_detail_platforms x where x.enabled and x.country_code='IN'
    and x.platform=t.native_platform and x.country='印度' and x.timezone='Asia/Kolkata'
    and x.currency is not distinct from t.currency;
  end if;
  if n<>1 then raise exception 'pending_spelling_native_registry_drift: %',t.old_platform;end if;
  update pending_native_spelling_targets set mapping_id=m.id,
   platform_id=md5(case t.source_system when 'NEW_AR' then 'newar' else 'ar' end||':IN:'||t.native_platform)::uuid
   where source_system=t.source_system and old_platform=t.old_platform;
 end loop;
end $guard$;

-- Retain the existing mapping ID/display label/team/country. Only spelling is
-- aligned with the physical native key; updated_at is an actual new change.
update public.dashboard_platform_team_map m set source_platform=t.native_platform,updated_at=clock_timestamp()
 from pending_native_spelling_targets t where m.id=t.mapping_id;
insert into private.collector_platform_identities
 (platform_id,mapping_id,source_system,source_country,source_platform,team_name,country_code,timezone,currency)
select t.platform_id,t.mapping_id,t.source_system,m.source_country,t.native_platform,m.team_name,m.country_code,
 'Asia/Kolkata',t.currency from pending_native_spelling_targets t
 join public.dashboard_platform_team_map m on m.id=t.mapping_id;

-- Bind only exact selectors already authorized by existing live credentials.
-- No new source instances, credentials or allowed_scopes are created/expanded.
create temporary table pending_native_spelling_bindings on commit drop as
with raw_scopes as (
 select i.id source_instance_id,i.credential_kind,s.value scope_key from private.collector_source_instances i
 join public.ar_business_direct_credentials c on i.credential_kind='ar_business_direct' and c.token_hash=i.credential_token_hash
 cross join lateral jsonb_array_elements(c.allowed_scopes)s where i.active and not c.revoked and c.expires_at>clock_timestamp()
 union all select i.id,i.credential_kind,s.value from private.collector_source_instances i
 join public.collection_success_credentials c on i.credential_kind='collection_success' and c.token_hash=i.credential_token_hash
 cross join lateral jsonb_array_elements(c.allowed_scopes)s where i.active and not c.revoked and c.expires_at>clock_timestamp()
 union all select i.id,i.credential_kind,s.value from private.collector_source_instances i
 join public.workorder_issue_credentials c on i.credential_kind='workorder_issue' and c.token_hash=i.credential_token_hash
 cross join lateral jsonb_array_elements(c.allowed_scopes)s where i.active and not c.revoked and c.expires_at>clock_timestamp()
 union all select i.id,i.credential_kind,s.value from private.collector_source_instances i
 join private.newar_detail_credentials c on i.credential_kind='newar_detail' and c.token_hash=i.credential_token_hash
 cross join lateral jsonb_array_elements(c.allowed_scopes)s where i.active and not c.revoked and c.expires_at>clock_timestamp()
 union all select i.id,i.credential_kind,s.value from private.collector_source_instances i
 join private.newar_business_credentials c on i.credential_kind='newar_business' and c.token_hash=i.credential_token_hash
 cross join lateral jsonb_array_elements(c.allowed_scopes)s where i.active and not c.revoked and c.expires_at>clock_timestamp()
), scopes as (
 select source_instance_id,credential_kind,case credential_kind
 when 'ar_business_direct' then jsonb_build_object('country_code',scope_key->>'country_code','platform',scope_key->>'platform')
 when 'newar_detail' then jsonb_build_object('platform',scope_key->>'platform','dataset',scope_key->>'dataset')
 when 'newar_business' then jsonb_build_object('platform',scope_key->>'platform','kind',scope_key->>'kind')
 else jsonb_build_object('country_code',scope_key->>'country_code','platform',scope_key->>'platform','timezone',scope_key->>'timezone') end scope_key
 from raw_scopes
), matches as (
 select distinct s.source_instance_id,s.scope_key,p.platform_id from scopes s
 join private.collector_platform_identities p on p.source_platform=s.scope_key->>'platform'
 and(s.credential_kind in('newar_detail','newar_business')or p.country_code=s.scope_key->>'country_code')
 and(not(s.scope_key?'timezone')or p.timezone=s.scope_key->>'timezone')
 and case s.credential_kind when 'ar_business_direct'then p.source_system='AR'
 when 'collection_success'then p.source_system in('AR','NEW_AR')else p.source_system='NEW_AR'end
), unique_matches as (
 select source_instance_id,scope_key,min(platform_id::text)::uuid platform_id from matches group by 1,2 having count(*)=1
)
select u.source_instance_id,u.scope_key,u.platform_id from unique_matches u
join pending_native_spelling_targets t on t.platform_id=u.platform_id;
do $binding_guard$
begin
 if exists(select 1 from pending_native_spelling_bindings u
  join private.collector_exact_scope_bindings b using(source_instance_id,scope_key)
  where b.platform_id is distinct from u.platform_id) then
  raise exception 'pending_spelling_existing_binding_conflict';end if;
end $binding_guard$;
insert into private.collector_exact_scope_bindings(source_instance_id,scope_key,platform_id)
select u.source_instance_id,u.scope_key,u.platform_id from pending_native_spelling_bindings u
where not exists(select 1 from private.collector_exact_scope_bindings b
 where b.source_instance_id=u.source_instance_id and b.scope_key=u.scope_key);

-- Future observations may use these newly verified identities. A delayed old
-- observation cannot retroactively acquire today's mapping/identity evidence.
do $future_only$
declare original text;needle text;replacement text;metadata jsonb;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into original,metadata from pg_proc p
 where p.oid='private.archive_withdraw_pending_capture(text,text,text,timestamptz)'::regprocedure;
 needle:=E'where i.country_code=h.country_code and i.source_platform=h.platform and i.timezone=h.snapshot->>\'timezone\'';
 replacement:=needle||E'\n      and (not(i.country_code=\'IN\' and ((i.source_system=\'AR\' and i.source_platform in(\'Shree.Win\',\'Veer.Game\'))\n        or (i.source_system=\'NEW_AR\' and i.source_platform=\'DhaniWin\')))\n        or (i.verified_at<=h.snapshot_at and m.updated_at<=h.snapshot_at))';
 if(length(original)-length(replace(original,needle,'')))/length(needle)<>1 then
  raise exception 'pending_spelling_archive_patch_drift';end if;
 execute replace(original,needle,replacement);
 if(select to_jsonb(p)-'prosrc'from pg_proc p where p.oid='private.archive_withdraw_pending_capture(text,text,text,timestamptz)'::regprocedure)
  is distinct from metadata then raise exception 'pending_spelling_archive_metadata_drift';end if;
end $future_only$;
notify pgrst,'reload schema';
commit;
