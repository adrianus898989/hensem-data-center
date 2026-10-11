-- Explicit, owner-confirmed country aliases only. Source orders and IDs stay native.
-- ThirdPartyPlatform + workorder identity rules + confirmed MAAN.WIN compatibility.
begin;
set local lock_timeout='2s';set local statement_timeout='20s';
do $guard$
begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.dashboard_account_data_scope_catalog()')) is distinct from '95d21968d198b8d8deb100df7600d199' then raise exception 'confirmed_scope_alias_baseline_drift: dashboard_account_data_scope_catalog()';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_current_data_scope()')) is distinct from '9bc39b26c5d9796e35f6122e7d903a59' then raise exception 'confirmed_scope_alias_baseline_drift: private.dashboard_current_data_scope()';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_data_scope_subset(jsonb,jsonb)')) is distinct from '4a6b295a0b5e8219ca68d367523543a2' then raise exception 'confirmed_scope_alias_baseline_drift: private.dashboard_data_scope_subset(jsonb,jsonb)';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_data_scope_valid(jsonb)')) is distinct from 'f4907d924afc6cb9021f5380bfe9df3c' then raise exception 'confirmed_scope_alias_baseline_drift: private.dashboard_data_scope_valid(jsonb)';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_scope_allows(jsonb,text,text)')) is distinct from '1142f29305ed59ffc23c53799ef10043' then raise exception 'confirmed_scope_alias_baseline_drift: private.dashboard_scope_allows(jsonb,text,text)';end if;
 if exists(select 1 from pg_proc p where oid=any(array['private.dashboard_scope_allows(jsonb,text,text)'::regprocedure,'public.dashboard_account_data_scope_catalog()'::regprocedure]) and (pg_get_userbyid(proowner)<>'postgres' or proconfig is distinct from array['search_path=""']::text[] or (oid='private.dashboard_scope_allows(jsonb,text,text)'::regprocedure and (prosecdef or provolatile<>'i' or proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')) or (oid='public.dashboard_account_data_scope_catalog()'::regprocedure and (not prosecdef or provolatile<>'s' or proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}')))) then raise exception 'confirmed_scope_alias_metadata_drift';end if;
 if to_regprocedure('private.dashboard_scope_platform_identity(text,text)') is not null then raise exception 'confirmed_scope_alias_helper_exists';end if;
end $guard$;
create function private.dashboard_scope_platform_identity(p_country text,p_platform text)
returns text language sql immutable set search_path='' as $identity$
 select coalesce((select a.canonical from (values
  ('IN','BIG','BIGMUMBAI'),
  ('IN','INDIA82','82LOTTERY'),
  ('IN','82BET','82LOTTERY'),
  ('IN','OK.WIN','OKWIN'),
  ('IN','VEERGAME','VEER.GAME'),
  ('IN','SHREE.WIN','SHREEWIN'),
  ('IN','DHANI.WIN','DHANIWIN'),
  ('IN','DHANIWIN(新AR)','DHANIWIN'),
  ('IN','MAAN.WIN','MAANWIN'),
  ('IN','RAJALOTTERY','RAJA'),
  ('IN','RAJAGAME','RAJA'),
  ('IN','RAJAGAMES','RAJA'),
  ('PK','3PATISUPER','3PATTI-SUPER'),
  ('PK','92.GAME','92GAME')
 ) a(country,alias,canonical) where a.country=private.dashboard_data_group(p_country,p_platform)
  and a.alias=private.dashboard_scope_platform_key(p_platform)),private.dashboard_scope_platform_key(p_platform));
$identity$;
revoke all on function private.dashboard_scope_platform_identity(text,text) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_scope_platform_identity(text,text) to authenticated,service_role;
do $patch$
declare d text;metadata jsonb;target regprocedure:='private.dashboard_scope_allows(jsonb,text,text)'::regprocedure;
 old_text text:=$old$  v_key:=private.dashboard_scope_platform_key(p_platform);
  return v_key is not null and (jsonb_array_length(p_scope->'countries')=0 or (p_scope->'countries') ? v_group)
   and (p_scope->'platforms') @> jsonb_build_array(jsonb_build_object('country',v_group,'platform',v_key));$old$;
 new_text text:=$new$  v_key:=private.dashboard_scope_platform_identity(v_group,p_platform);
  return v_key is not null and (jsonb_array_length(p_scope->'countries')=0 or (p_scope->'countries') ? v_group)
   and exists(select 1 from jsonb_array_elements(p_scope->'platforms') e
    where e->>'country'=v_group and private.dashboard_scope_platform_identity(v_group,e->>'platform')=v_key);$new$;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into d,metadata from pg_proc p where p.oid=target;
 if (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 then raise exception 'confirmed_scope_alias_anchor_drift';end if;
 execute replace(d,old_text,new_text);
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target) is distinct from metadata
  or (select md5(prosrc) from pg_proc where oid=target)<>'87042edcedc3200c559a821250de831e' then raise exception 'confirmed_scope_alias_post_drift';end if;
end $patch$;
do $patch$
declare d text;metadata jsonb;target regprocedure:='public.dashboard_account_data_scope_catalog()'::regprocedure;
 old_text text:=$old$private.dashboard_scope_platform_key(n.platform) platform,n.name,n.source,$old$;
 new_text text:=$new$private.dashboard_scope_platform_identity(n.country,n.platform) platform,
   case when private.dashboard_data_group(n.country,n.platform)='IN' and private.dashboard_scope_platform_identity(n.country,n.platform) in('BIGMUMBAI','82LOTTERY','OKWIN','VEER.GAME','SHREEWIN','DHANIWIN','MAANWIN','RAJA')
    or private.dashboard_data_group(n.country,n.platform)='PK' and private.dashboard_scope_platform_identity(n.country,n.platform) in('3PATTI-SUPER','92GAME')
    then private.dashboard_scope_platform_identity(n.country,n.platform) else n.name end name,n.source,$new$;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into d,metadata from pg_proc p where p.oid=target;
 if (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 then raise exception 'confirmed_scope_alias_anchor_drift';end if;
 execute replace(d,old_text,new_text);
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target) is distinct from metadata
  or (select md5(prosrc) from pg_proc where oid=target)<>'a756992f2f1b6aa5a5b9c608c006ffc4' then raise exception 'confirmed_scope_alias_post_drift';end if;
end $patch$;
notify pgrst,'reload schema';
commit;
