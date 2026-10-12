-- Select India LOTTERY7 historical reports when its fresh authorized AR display alias LOTTERY77 is selected.
-- Selection aliases never replace grants. Preserve report keys/counts/precedence and raw-country note authorization.
begin;
set local lock_timeout='1s';set local statement_timeout='3s';
do $selected_report_aliases$
declare p record;f record;d text;before_meta jsonb;
begin
 for f in select * from(values
  ('private.dashboard_scope_allows(jsonb,text,text)','87042edcedc3200c559a821250de831e',3),
  ('private.dashboard_data_scope_valid(jsonb)','f4907d924afc6cb9021f5380bfe9df3c',1)
 ) v(sig,hash,nargs) loop
  select * into p from pg_proc where oid=to_regprocedure(f.sig);
  if not found or md5(p.prosrc) is distinct from f.hash or pg_get_userbyid(p.proowner)<>'postgres'
   or p.prosecdef or p.proisstrict or p.proleakproof or p.provolatile<>'i' or p.proparallel<>'u' or p.prolang<>(select oid from pg_language where lanname='plpgsql')
   or p.prorettype<>'boolean'::regtype or p.proretset or p.pronargs<>f.nargs
   or p.proallargtypes is not null or p.proargmodes is not null
   or p.proargnames is distinct from (case when f.nargs=3 then array['p_scope','p_country','p_platform']::text[] else array['p_scope']::text[] end)
   or p.pronargdefaults<>(case when f.nargs=3 then 1 else 0 end)
   or p.proconfig is distinct from array['search_path=""']::text[]
   or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  then raise exception 'WITHDRAW_REPORT_ALIAS_HELPER_DRIFT: %',f.sig;end if;
 end loop;
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');
 if not found or md5(p.prosrc) not in('a967a7ef42a61789e09b9ea3b11223bb','5965cb8899f0717678aaf7da6195c1c1')
  or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.proisstrict or p.proleakproof or p.provolatile<>'s' or p.proparallel<>'u'
  or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.prorettype<>'jsonb'::regtype or p.proretset or p.pronargs<>1
  or p.proallargtypes is not null or p.proargmodes is not null or p.proargnames is distinct from array['p_request']::text[]
  or p.pronargdefaults<>1 or pg_get_expr(p.proargdefaults,0) is distinct from '''{}''::jsonb'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
 then raise exception 'WITHDRAW_REPORT_ALIAS_MAIN_DRIFT';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)');
 if not found or md5(p.prosrc)<>'1bfc6398524bc3194b91f1d411960425'
  or p.proowner<>'postgres'::regrole or p.prosecdef or p.proisstrict or p.proleakproof or p.provolatile<>'s' or p.proparallel<>'u'
  or p.prolang<>(select oid from pg_language where lanname='plpgsql') or not p.proretset or p.prorettype<>'record'::regtype
  or pg_get_function_arguments(p.oid) is distinct from 'p_request jsonb, p_scope jsonb, p_start date, p_end date'
  or pg_get_function_result(p.oid) is distinct from $out$TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])$out$
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
 then raise exception 'WITHDRAW_REPORT_ALIAS_AR_DRIFT';end if;
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_withdraw_key(text)');
 if not found or md5(p.prosrc)<>'440671f01a670ad05695e9b8692888a3' or p.proowner<>'postgres'::regrole or p.prosecdef
  or p.provolatile<>'i' or p.proparallel<>'u' or p.proisstrict or p.proleakproof or p.proretset or p.prorettype<>'text'::regtype
  or p.prolang<>(select oid from pg_language where lanname='sql') or pg_get_function_arguments(p.oid) is distinct from 'p_name text'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl::text is distinct from '{postgres=X/postgres}'
 then raise exception 'WITHDRAW_REPORT_ALIAS_KEY_DRIFT';end if;
 select * into p from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if md5(p.prosrc)='5965cb8899f0717678aaf7da6195c1c1' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 if (length(d)-length(replace(d,$old0$ ), snapshot_window as not materialized ($old0$,'')))/length($old0$ ), snapshot_window as not materialized ($old0$)<>1 then raise exception 'WITHDRAW_REPORT_ALIAS_ANCHOR_0_DRIFT';end if;
 d:=replace(d,$old0$ ), snapshot_window as not materialized ($old0$,$new0$ ), selected_ar_report_aliases as materialized (
  -- Reuse the already fresh, scoped AR catalog mapping. Only the confirmed
  -- India LOTTERY7/LOTTERY77 family may expand a user's selected report names.
  -- A second native AR identity occupying either name disables this expansion.
  select distinct a.country,a.platform_key,a.alias_keys
  from jsonb_to_recordset(v_ar_days) a(country text,platform_key text,alias_keys text[])
  where a.country='印度' and a.platform_key='LOTTERY7'
   and a.alias_keys @> array['LOTTERY7','LOTTERY77']::text[]
   and a.alias_keys <@ array['LOTTERY7','LOTTERY77']::text[]
   and not exists(select 1 from jsonb_to_recordset(v_ar_days) z(country text,platform_key text,alias_keys text[])
    where z.country=a.country and z.platform_key is distinct from a.platform_key and z.alias_keys&&a.alias_keys)
 ), snapshot_window as not materialized ($new0$);
 if (length(d)-length(replace(d,$old1$   and (t.platforms is null or i.platform_key=any(t.platforms))$old1$,'')))/length($old1$   and (t.platforms is null or i.platform_key=any(t.platforms))$old1$)<>1 then raise exception 'WITHDRAW_REPORT_ALIAS_ANCHOR_1_DRIFT';end if;
 d:=replace(d,$old1$   and (t.platforms is null or i.platform_key=any(t.platforms))$old1$,$new1$   and (t.platforms is null or i.platform_key=any(t.platforms)
    or exists(select 1 from selected_ar_report_aliases a where a.country=t.country
     and i.platform_key=any(a.alias_keys) and a.alias_keys&&t.platforms))$new1$);
 if (length(d)-length(replace(d,$old2$   or exists(select 1 from ar_days a where a.country=d.country and a.platform_key=d.platform_key and a.data_date=d.data_date and a.alias_keys&&v_platforms)$old2$,'')))/length($old2$   or exists(select 1 from ar_days a where a.country=d.country and a.platform_key=d.platform_key and a.data_date=d.data_date and a.alias_keys&&v_platforms)$old2$)<>1 then raise exception 'WITHDRAW_REPORT_ALIAS_ANCHOR_2_DRIFT';end if;
 d:=replace(d,$old2$   or exists(select 1 from ar_days a where a.country=d.country and a.platform_key=d.platform_key and a.data_date=d.data_date and a.alias_keys&&v_platforms)$old2$,$new2$   or exists(select 1 from ar_days a where a.country=d.country and a.platform_key=d.platform_key and a.data_date=d.data_date and a.alias_keys&&v_platforms)
   or exists(select 1 from selected_ar_report_aliases a where a.country=d.country
    and d.platform_key=any(a.alias_keys) and a.alias_keys&&v_platforms)$new2$);
 if (length(d)-length(replace(d,$old3$   or exists(select 1 from ar_days a where a.country=o.country and a.platform_key=o.platform_key and a.data_date=o.data_date and a.alias_keys&&v_platforms))$old3$,'')))/length($old3$   or exists(select 1 from ar_days a where a.country=o.country and a.platform_key=o.platform_key and a.data_date=o.data_date and a.alias_keys&&v_platforms))$old3$)<>1 then raise exception 'WITHDRAW_REPORT_ALIAS_ANCHOR_3_DRIFT';end if;
 d:=replace(d,$old3$   or exists(select 1 from ar_days a where a.country=o.country and a.platform_key=o.platform_key and a.data_date=o.data_date and a.alias_keys&&v_platforms))$old3$,$new3$   or exists(select 1 from ar_days a where a.country=o.country and a.platform_key=o.platform_key and a.data_date=o.data_date and a.alias_keys&&v_platforms)
   or exists(select 1 from selected_ar_report_aliases a where a.country=o.country
    and o.platform_key=any(a.alias_keys) and a.alias_keys&&v_platforms))$new3$);
 execute d;
 select * into p from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'5965cb8899f0717678aaf7da6195c1c1' or (to_jsonb(p)-'prosrc') is distinct from before_meta then raise exception 'WITHDRAW_REPORT_ALIAS_POSTCHECK';end if;
end;$selected_report_aliases$;
commit;
