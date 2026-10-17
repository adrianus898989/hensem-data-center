-- Exact request contract repair for the existing overview and merchant member counts.
-- No account, role, grant, permission key, source scope, reader or prepared head changes.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $member_page_contract$
declare prior text;patched text;catalog jsonb;next_catalog jsonb;metadata jsonb;
begin
 select pg_get_functiondef(p.oid),jsonb_build_array(p.proowner,p.proacl::text,p.proconfig,p.prosecdef,p.provolatile) into prior,metadata from pg_proc p where p.oid='private.dashboard_role_catalog()'::regprocedure;
 if md5(prior)='e8e1aefc19f0e333340d5d5df0e7ce04' then return;end if;
 if md5(prior)<>'ffef17dac382480e3e3c08a09943a040' then raise exception 'member_page_catalog_drift';end if;
 catalog:=private.dashboard_role_catalog();
 if (select count(*) from jsonb_array_elements(catalog->'pages') p where p->>'id' in ('overview','merchants'))<>2 then raise exception 'member_page_catalog_shape';end if;
 next_catalog:=jsonb_set(catalog,'{pages}',(select jsonb_agg(case when p->>'id' in ('overview','merchants') then jsonb_set(p,'{requests}',(p->'requests')||'"memberDaily"'::jsonb) else p end order by ord) from jsonb_array_elements(catalog->'pages') with ordinality r(p,ord)));
 if next_catalog=catalog or next_catalog-'pages'<>catalog-'pages' then raise exception 'member_page_catalog_delta';end if;
 patched:=replace(prior,quote_literal(catalog::text),quote_literal(next_catalog::text));
 if patched=prior then raise exception 'member_page_catalog_literal';end if;
 execute patched;
 if (select md5(pg_get_functiondef(p.oid))<> 'e8e1aefc19f0e333340d5d5df0e7ce04' or jsonb_build_array(p.proowner,p.proacl::text,p.proconfig,p.prosecdef,p.provolatile)<>metadata from pg_proc p where p.oid='private.dashboard_role_catalog()'::regprocedure) then raise exception 'member_page_catalog_verification';end if;
end;$member_page_contract$;
commit;
