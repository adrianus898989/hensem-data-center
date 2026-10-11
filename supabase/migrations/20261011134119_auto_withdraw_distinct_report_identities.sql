-- Memoize exact raw country/platform interpretation once per selected date
-- window; no source, amount, duration, classification, scope or order change.
-- Window CTEs remain NOT MATERIALIZED; only narrow identities are materialized.
begin;
set local lock_timeout='2s';set local statement_timeout='20s';
do $patch$
declare f oid:=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');
 definition text;body_hash text;before_meta jsonb;after_meta jsonb;p record;spec record;
begin
 if f is null then raise exception 'WITHDRAW_IDENTITY_BASELINE_MISSING';end if;
 select md5(prosrc),pg_get_functiondef(oid),to_jsonb(q)-'prosrc' into body_hash,definition,before_meta from pg_proc q where oid=f;
 if not exists(select 1 from pg_proc q join pg_roles r on r.oid=q.proowner join pg_language l on l.oid=q.prolang
  where q.oid=f and r.rolname='postgres' and l.lanname='plpgsql' and q.provolatile='s' and q.prosecdef
   and q.proconfig=array['search_path=""']::text[] and q.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
   and q.proparallel='u' and not q.proretset and not q.proisstrict and not q.proleakproof and q.prorettype='jsonb'::regtype
   and q.pronargdefaults=1 and pg_get_function_identity_arguments(q.oid)='p_request jsonb')then
  raise exception 'WITHDRAW_IDENTITY_METADATA_MISMATCH';end if;
 for spec in select *from(values
  ('private.dashboard_admin_live_report_country(text,text)','74d85bb2dba1eb0789225883caa922b1','s','text','p_country text, p_platform text'),
  ('private.dashboard_admin_live_withdraw_key(text)','440671f01a670ad05695e9b8692888a3','u','text','p_name text'),
  ('private.dashboard_admin_live_is_panghu_platform(text)','58bf8e9909145a4fc20287cf1962298f','s','boolean','p_name text'))v(signature,hash,parallel,return_type,arguments)loop
  select q.*,l.lanname into p from pg_proc q join pg_language l on l.oid=q.prolang where q.oid=to_regprocedure(spec.signature);
  if not found or md5(p.prosrc)<>spec.hash or p.proowner<>'postgres'::regrole or p.prosecdef or p.provolatile<>'i'
   or p.proparallel<>spec.parallel or p.lanname<>'sql' or p.proretset or p.proisstrict or p.proleakproof
   or p.prorettype<>spec.return_type::regtype or p.pronargdefaults<>0
   or pg_get_function_identity_arguments(p.oid)<>spec.arguments
   or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'then
   raise exception 'WITHDRAW_IDENTITY_HELPER_MISMATCH';end if;
 end loop;
 if body_hash='5969967b0e0e25511c43a5df5e25ec6f' then return;end if;
 if body_hash<>'2938e5c2257e166c2c98f607de7b51e0' then raise exception 'WITHDRAW_IDENTITY_BODY_MISMATCH';end if;
 if(length(definition)-length(replace(definition,$old1$ ), registered_game66 as materialized (
$old1$,'')))/length($old1$ ), registered_game66 as materialized (
$old1$)<>1 then raise exception 'WITHDRAW_IDENTITY_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old1$ ), registered_game66 as materialized (
$old1$,$new1$ ), snapshot_window as not materialized (
  select s.* from public.newar_business_snapshots s
  where s.kind='auto_withdraw_bundle' and s.direction='all' and s.stat_date between v_before and v_end
 ), daily_window as not materialized (
  select a.data_date,a.country,a.platform,a.total,a.success,a.rejected,a.auto_count,a.manual_count,a.avg_seconds,a.source_updated_at,a.updated_at
  from public.auto_withdraw_daily a where a.data_date between v_before and v_end
 ), operator_window as not materialized (
  select o.data_date,o.country,o.platform,o.account,o.processed,o.rejected,o.avg_seconds,o.source_updated_at,o.updated_at
  from public.withdraw_operator_daily o where o.data_date between v_before and v_end
 ), notes_window as not materialized (
  select n.* from public.auto_withdraw_notes n where n.data_date between v_start and v_end
 ), raw_identities as materialized (
  select country,platform from snapshot_window
  union select country,platform from daily_window
  union select country,platform from operator_window
  union select country,platform from notes_window
 ), mapped_identities as materialized (
  select i.country as source_country,i.platform as source_platform,
   case when upper(btrim(i.country)) in ('巴西','BR','BRAZIL') and upper(btrim(i.platform))=any(v_panghu)
    then '胖虎巴西' else private.dashboard_admin_live_report_country(i.country,i.platform) end as target_country,
   private.dashboard_admin_live_withdraw_key(i.platform) as platform_key
  from raw_identities i
 ), selected_identities as materialized (
  select i.source_country,i.source_platform,i.platform_key,t.country
  from mapped_identities i join selected_targets t on i.target_country=t.country
   and (t.platforms is null or i.platform_key=any(t.platforms))
 ), registered_game66 as materialized (
$new1$);
 if(length(definition)-length(replace(definition,$old2$  select s.*,private.dashboard_admin_live_withdraw_key(s.platform) as platform_key,t.country as target_country from public.newar_business_snapshots s
  join selected_targets t on (case when upper(btrim(s.country)) in ('巴西','BR','BRAZIL') and upper(btrim(s.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(s.country,s.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(s.platform)=any(t.platforms))
$old2$,'')))/length($old2$  select s.*,private.dashboard_admin_live_withdraw_key(s.platform) as platform_key,t.country as target_country from public.newar_business_snapshots s
  join selected_targets t on (case when upper(btrim(s.country)) in ('巴西','BR','BRAZIL') and upper(btrim(s.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(s.country,s.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(s.platform)=any(t.platforms))
$old2$)<>1 then raise exception 'WITHDRAW_IDENTITY_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old2$  select s.*,private.dashboard_admin_live_withdraw_key(s.platform) as platform_key,t.country as target_country from public.newar_business_snapshots s
  join selected_targets t on (case when upper(btrim(s.country)) in ('巴西','BR','BRAZIL') and upper(btrim(s.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(s.country,s.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(s.platform)=any(t.platforms))
$old2$,$new2$  select s.*,t.platform_key as platform_key,t.country as target_country from snapshot_window s
  join selected_identities t on coalesce(s.country,'')=coalesce(t.source_country,'') and coalesce(s.platform,'')=coalesce(t.source_platform,'') and s.country is not distinct from t.source_country and s.platform is not distinct from t.source_platform
$new2$);
 if(length(definition)-length(replace(definition,$old3$  select distinct on(a.data_date,t.country,private.dashboard_admin_live_withdraw_key(a.platform))
   a.data_date,t.country as country,a.platform,private.dashboard_admin_live_withdraw_key(a.platform) as platform_key,
$old3$,'')))/length($old3$  select distinct on(a.data_date,t.country,private.dashboard_admin_live_withdraw_key(a.platform))
   a.data_date,t.country as country,a.platform,private.dashboard_admin_live_withdraw_key(a.platform) as platform_key,
$old3$)<>1 then raise exception 'WITHDRAW_IDENTITY_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old3$  select distinct on(a.data_date,t.country,private.dashboard_admin_live_withdraw_key(a.platform))
   a.data_date,t.country as country,a.platform,private.dashboard_admin_live_withdraw_key(a.platform) as platform_key,
$old3$,$new3$  select distinct on(a.data_date,t.country,t.platform_key)
   a.data_date,t.country as country,a.platform,t.platform_key as platform_key,
$new3$);
 if(length(definition)-length(replace(definition,$old4$  from public.auto_withdraw_daily a join selected_targets t on (case when upper(btrim(a.country)) in ('巴西','BR','BRAZIL') and upper(btrim(a.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(a.country,a.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(a.platform)=any(t.platforms)) where a.data_date between v_before and v_end
$old4$,'')))/length($old4$  from public.auto_withdraw_daily a join selected_targets t on (case when upper(btrim(a.country)) in ('巴西','BR','BRAZIL') and upper(btrim(a.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(a.country,a.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(a.platform)=any(t.platforms)) where a.data_date between v_before and v_end
$old4$)<>1 then raise exception 'WITHDRAW_IDENTITY_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old4$  from public.auto_withdraw_daily a join selected_targets t on (case when upper(btrim(a.country)) in ('巴西','BR','BRAZIL') and upper(btrim(a.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(a.country,a.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(a.platform)=any(t.platforms)) where a.data_date between v_before and v_end
$old4$,$new4$  from daily_window a join selected_identities t on coalesce(a.country,'')=coalesce(t.source_country,'') and coalesce(a.platform,'')=coalesce(t.source_platform,'') and a.country is not distinct from t.source_country and a.platform is not distinct from t.source_platform where a.data_date between v_before and v_end
$new4$);
 if(length(definition)-length(replace(definition,$old5$   and not exists(select 1 from direct n where n.stat_date=a.data_date and n.target_country=t.country and n.platform_key=private.dashboard_admin_live_withdraw_key(a.platform) and n.payload ? 'rows')
  order by a.data_date,t.country,private.dashboard_admin_live_withdraw_key(a.platform),coalesce(a.updated_at,a.source_updated_at) desc
$old5$,'')))/length($old5$   and not exists(select 1 from direct n where n.stat_date=a.data_date and n.target_country=t.country and n.platform_key=private.dashboard_admin_live_withdraw_key(a.platform) and n.payload ? 'rows')
  order by a.data_date,t.country,private.dashboard_admin_live_withdraw_key(a.platform),coalesce(a.updated_at,a.source_updated_at) desc
$old5$)<>1 then raise exception 'WITHDRAW_IDENTITY_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old5$   and not exists(select 1 from direct n where n.stat_date=a.data_date and n.target_country=t.country and n.platform_key=private.dashboard_admin_live_withdraw_key(a.platform) and n.payload ? 'rows')
  order by a.data_date,t.country,private.dashboard_admin_live_withdraw_key(a.platform),coalesce(a.updated_at,a.source_updated_at) desc
$old5$,$new5$   and not exists(select 1 from direct n where n.stat_date=a.data_date and n.target_country=t.country and n.platform_key=t.platform_key and n.payload ? 'rows')
  order by a.data_date,t.country,t.platform_key,coalesce(a.updated_at,a.source_updated_at) desc
$new5$);
 if(length(definition)-length(replace(definition,$old6$  select distinct on(o.data_date,t.country,private.dashboard_admin_live_withdraw_key(o.platform),o.account)
   o.data_date,t.country as country,o.platform,private.dashboard_admin_live_withdraw_key(o.platform) as platform_key,o.account,
$old6$,'')))/length($old6$  select distinct on(o.data_date,t.country,private.dashboard_admin_live_withdraw_key(o.platform),o.account)
   o.data_date,t.country as country,o.platform,private.dashboard_admin_live_withdraw_key(o.platform) as platform_key,o.account,
$old6$)<>1 then raise exception 'WITHDRAW_IDENTITY_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old6$  select distinct on(o.data_date,t.country,private.dashboard_admin_live_withdraw_key(o.platform),o.account)
   o.data_date,t.country as country,o.platform,private.dashboard_admin_live_withdraw_key(o.platform) as platform_key,o.account,
$old6$,$new6$  select distinct on(o.data_date,t.country,t.platform_key,o.account)
   o.data_date,t.country as country,o.platform,t.platform_key as platform_key,o.account,
$new6$);
 if(length(definition)-length(replace(definition,$old7$  from public.withdraw_operator_daily o join selected_targets t on (case when upper(btrim(o.country)) in ('巴西','BR','BRAZIL') and upper(btrim(o.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(o.country,o.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(o.platform)=any(t.platforms)) where o.data_date between v_before and v_end
$old7$,'')))/length($old7$  from public.withdraw_operator_daily o join selected_targets t on (case when upper(btrim(o.country)) in ('巴西','BR','BRAZIL') and upper(btrim(o.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(o.country,o.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(o.platform)=any(t.platforms)) where o.data_date between v_before and v_end
$old7$)<>1 then raise exception 'WITHDRAW_IDENTITY_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old7$  from public.withdraw_operator_daily o join selected_targets t on (case when upper(btrim(o.country)) in ('巴西','BR','BRAZIL') and upper(btrim(o.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(o.country,o.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(o.platform)=any(t.platforms)) where o.data_date between v_before and v_end
$old7$,$new7$  from operator_window o join selected_identities t on coalesce(o.country,'')=coalesce(t.source_country,'') and coalesce(o.platform,'')=coalesce(t.source_platform,'') and o.country is not distinct from t.source_country and o.platform is not distinct from t.source_platform where o.data_date between v_before and v_end
$new7$);
 if(length(definition)-length(replace(definition,$old8$   and not exists(select 1 from direct n where n.stat_date=o.data_date and n.target_country=t.country and n.platform_key=private.dashboard_admin_live_withdraw_key(o.platform) and n.payload ? 'operator_rows')
  order by o.data_date,t.country,private.dashboard_admin_live_withdraw_key(o.platform),o.account,coalesce(o.updated_at,o.source_updated_at) desc
$old8$,'')))/length($old8$   and not exists(select 1 from direct n where n.stat_date=o.data_date and n.target_country=t.country and n.platform_key=private.dashboard_admin_live_withdraw_key(o.platform) and n.payload ? 'operator_rows')
  order by o.data_date,t.country,private.dashboard_admin_live_withdraw_key(o.platform),o.account,coalesce(o.updated_at,o.source_updated_at) desc
$old8$)<>1 then raise exception 'WITHDRAW_IDENTITY_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old8$   and not exists(select 1 from direct n where n.stat_date=o.data_date and n.target_country=t.country and n.platform_key=private.dashboard_admin_live_withdraw_key(o.platform) and n.payload ? 'operator_rows')
  order by o.data_date,t.country,private.dashboard_admin_live_withdraw_key(o.platform),o.account,coalesce(o.updated_at,o.source_updated_at) desc
$old8$,$new8$   and not exists(select 1 from direct n where n.stat_date=o.data_date and n.target_country=t.country and n.platform_key=t.platform_key and n.payload ? 'operator_rows')
  order by o.data_date,t.country,t.platform_key,o.account,coalesce(o.updated_at,o.source_updated_at) desc
$new8$);
 if(length(definition)-length(replace(definition,$old9$    'version',md5(jsonb_build_array(extract(epoch from n.updated_at),n.reason)::text)) || case when p_request ? 'scopeTargets' then jsonb_build_object('sourceCountry',t.country) else '{}'::jsonb end) from public.auto_withdraw_notes n join selected_targets t on (case when upper(btrim(n.country)) in ('巴西','BR','BRAZIL') and upper(btrim(n.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(n.country,n.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(n.platform)=any(t.platforms)) where n.data_date between v_start and v_end
    and (v_platforms is null or private.dashboard_admin_live_withdraw_key(n.platform)=any(v_platforms)) and private.dashboard_scope_allows(v_scope,n.country,n.platform)),'[]'::jsonb)
$old9$,'')))/length($old9$    'version',md5(jsonb_build_array(extract(epoch from n.updated_at),n.reason)::text)) || case when p_request ? 'scopeTargets' then jsonb_build_object('sourceCountry',t.country) else '{}'::jsonb end) from public.auto_withdraw_notes n join selected_targets t on (case when upper(btrim(n.country)) in ('巴西','BR','BRAZIL') and upper(btrim(n.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(n.country,n.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(n.platform)=any(t.platforms)) where n.data_date between v_start and v_end
    and (v_platforms is null or private.dashboard_admin_live_withdraw_key(n.platform)=any(v_platforms)) and private.dashboard_scope_allows(v_scope,n.country,n.platform)),'[]'::jsonb)
$old9$)<>1 then raise exception 'WITHDRAW_IDENTITY_PATCH_FRAGMENT_MISMATCH';end if;
 definition:=replace(definition,$old9$    'version',md5(jsonb_build_array(extract(epoch from n.updated_at),n.reason)::text)) || case when p_request ? 'scopeTargets' then jsonb_build_object('sourceCountry',t.country) else '{}'::jsonb end) from public.auto_withdraw_notes n join selected_targets t on (case when upper(btrim(n.country)) in ('巴西','BR','BRAZIL') and upper(btrim(n.platform))=any(v_panghu) then '胖虎巴西' else private.dashboard_admin_live_report_country(n.country,n.platform) end)=t.country and (t.platforms is null or private.dashboard_admin_live_withdraw_key(n.platform)=any(t.platforms)) where n.data_date between v_start and v_end
    and (v_platforms is null or private.dashboard_admin_live_withdraw_key(n.platform)=any(v_platforms)) and private.dashboard_scope_allows(v_scope,n.country,n.platform)),'[]'::jsonb)
$old9$,$new9$    'version',md5(jsonb_build_array(extract(epoch from n.updated_at),n.reason)::text)) || case when p_request ? 'scopeTargets' then jsonb_build_object('sourceCountry',t.country) else '{}'::jsonb end) from notes_window n join selected_identities t on coalesce(n.country,'')=coalesce(t.source_country,'') and coalesce(n.platform,'')=coalesce(t.source_platform,'') and n.country is not distinct from t.source_country and n.platform is not distinct from t.source_platform where n.data_date between v_start and v_end
    and (v_platforms is null or t.platform_key=any(v_platforms)) and private.dashboard_scope_allows(v_scope,n.country,n.platform)),'[]'::jsonb)
$new9$);
 execute definition;
 select to_jsonb(q)-'prosrc' into after_meta from pg_proc q where oid=f;
 if before_meta is distinct from after_meta or(select md5(prosrc)from pg_proc where oid=f)<>'5969967b0e0e25511c43a5df5e25ec6f'then
  raise exception 'WITHDRAW_IDENTITY_POSTCHECK_MISMATCH';end if;
end;
$patch$;
commit;
