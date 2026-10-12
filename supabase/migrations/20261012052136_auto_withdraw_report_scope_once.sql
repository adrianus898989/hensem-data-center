-- Authorize each selected native report identity once instead of every snapshot/day/operator row.
-- Keep the fresh actor scope, exact mapped-country/native-platform arguments, NULL-safe joins,
-- source precedence, operator-only platform directory and raw-country note authorization unchanged.
begin;
set local lock_timeout='2s';set local statement_timeout='15s';
do $report_scope_once$
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
  then raise exception 'WITHDRAW_REPORT_SCOPE_HELPER_DRIFT: %',f.sig;end if;
 end loop;
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_auto_withdraw(jsonb)');
 if not found or md5(p.prosrc) not in('4984364f524c3d3b5bf73d87ab69f0d2','a967a7ef42a61789e09b9ea3b11223bb')
  or pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.proisstrict or p.proleakproof or p.provolatile<>'s' or p.proparallel<>'u'
  or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.prorettype<>'jsonb'::regtype or p.proretset or p.pronargs<>1
  or p.proallargtypes is not null or p.proargmodes is not null or p.proargnames is distinct from array['p_request']::text[]
  or p.pronargdefaults<>1 or pg_get_expr(p.proargdefaults,0) is distinct from '''{}''::jsonb'
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
 then raise exception 'WITHDRAW_REPORT_SCOPE_MAIN_DRIFT';end if;
 if md5(p.prosrc)='a967a7ef42a61789e09b9ea3b11223bb' then return;end if;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 if (length(d)-length(replace(d,$old0$ ), registered_game66 as materialized ($old0$,'')))/length($old0$ ), registered_game66 as materialized ($old0$)<>1 then raise exception 'WITHDRAW_REPORT_SCOPE_ANCHOR_DRIFT_0';end if;
 d:=replace(d,$old0$ ), registered_game66 as materialized ($old0$,$new0$ ), authorized_report_identities as materialized (
  -- Exact same target-country/native-platform grant as each report lane, evaluated once per identity.
  -- Notes retain their original raw-country authorization below.
  select i.* from selected_identities i
  where private.dashboard_scope_allows(v_scope,i.country,i.source_platform)
 ), registered_game66 as materialized ($new0$);
 if (length(d)-length(replace(d,$old1$join selected_identities t on coalesce(s.country$old1$,'')))/length($old1$join selected_identities t on coalesce(s.country$old1$)<>1 then raise exception 'WITHDRAW_REPORT_SCOPE_ANCHOR_DRIFT_1';end if;
 d:=replace(d,$old1$join selected_identities t on coalesce(s.country$old1$,$new1$join authorized_report_identities t on coalesce(s.country$new1$);
 if (length(d)-length(replace(d,$old2$
   and private.dashboard_scope_allows(v_scope,t.country,s.platform)$old2$,'')))/length($old2$
   and private.dashboard_scope_allows(v_scope,t.country,s.platform)$old2$)<>1 then raise exception 'WITHDRAW_REPORT_SCOPE_ANCHOR_DRIFT_2';end if;
 d:=replace(d,$old2$
   and private.dashboard_scope_allows(v_scope,t.country,s.platform)$old2$,$new2$$new2$);
 if (length(d)-length(replace(d,$old3$from daily_window a join selected_identities t$old3$,'')))/length($old3$from daily_window a join selected_identities t$old3$)<>1 then raise exception 'WITHDRAW_REPORT_SCOPE_ANCHOR_DRIFT_3';end if;
 d:=replace(d,$old3$from daily_window a join selected_identities t$old3$,$new3$from daily_window a join authorized_report_identities t$new3$);
 if (length(d)-length(replace(d,$old4$
   and private.dashboard_scope_allows(v_scope,t.country,a.platform)$old4$,'')))/length($old4$
   and private.dashboard_scope_allows(v_scope,t.country,a.platform)$old4$)<>1 then raise exception 'WITHDRAW_REPORT_SCOPE_ANCHOR_DRIFT_4';end if;
 d:=replace(d,$old4$
   and private.dashboard_scope_allows(v_scope,t.country,a.platform)$old4$,$new4$$new4$);
 if (length(d)-length(replace(d,$old5$from operator_window o join selected_identities t$old5$,'')))/length($old5$from operator_window o join selected_identities t$old5$)<>1 then raise exception 'WITHDRAW_REPORT_SCOPE_ANCHOR_DRIFT_5';end if;
 d:=replace(d,$old5$from operator_window o join selected_identities t$old5$,$new5$from operator_window o join authorized_report_identities t$new5$);
 if (length(d)-length(replace(d,$old6$
   and private.dashboard_scope_allows(v_scope,t.country,o.platform)$old6$,'')))/length($old6$
   and private.dashboard_scope_allows(v_scope,t.country,o.platform)$old6$)<>1 then raise exception 'WITHDRAW_REPORT_SCOPE_ANCHOR_DRIFT_6';end if;
 d:=replace(d,$old6$
   and private.dashboard_scope_allows(v_scope,t.country,o.platform)$old6$,$new6$$new6$);
 execute d;
 select * into p from pg_proc where oid='private.dashboard_admin_live_auto_withdraw(jsonb)'::regprocedure;
 if md5(p.prosrc)<>'a967a7ef42a61789e09b9ea3b11223bb' or (to_jsonb(p)-'prosrc') is distinct from before_meta then raise exception 'WITHDRAW_REPORT_SCOPE_POSTCHECK';end if;
end;$report_scope_once$;
commit;
