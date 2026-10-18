-- Necessary head-prefix and English-phrase guards only; original taxonomy internals and later classifiers are unchanged.
begin;set local lock_timeout='3s';set local statement_timeout='15s';
do $patch$declare p pg_proc%rowtype;definition text;patched text;before_meta jsonb;begin
 if current_user<>'postgres'then raise exception 'OWNER_REQUIRED';end if;
 select *into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_blocking_details_cleaned(text)');
 if p.oid is null or md5(p.prosrc)<>'52a10daaff99baee34b0c9dab647f4a9' or md5(pg_get_functiondef(p.oid))<>'6809fb732886d835d234c136f6cbf89d'
  or p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.proconfig is distinct from array['search_path=""']::text[] or p.prosecdef or p.proisstrict or p.proleakproof
  or p.provolatile<>'i' or p.proparallel<>'s' or p.prokind<>'f' or p.proretset
  or p.prolang<>(select oid from pg_language where lanname='plpgsql')then raise exception 'REASON_TAX_HEAD_PREFIX_BASELINE_DRIFT';end if;
 before_meta:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(p.oid);patched:=definition;
 if (length(patched)-length(replace(patched,$old$ if left(tax_note,1) in ('免','用','充','领') then
 for tax_rec in select * from (values$old$,'')))/length($old$ if left(tax_note,1) in ('免','用','充','领') then
 for tax_rec in select * from (values$old$)<>1 then raise exception 'REASON_TAX_HEAD_PREFIX_ANCHOR_DRIFT';end if;
 patched:=replace(patched,$old$ if left(tax_note,1) in ('免','用','充','领') then
 for tax_rec in select * from (values$old$,$new$ for tax_rec in select * from (values$new$);
 if (length(patched)-length(replace(patched,$old$ end loop;
 end if; -- necessary-only taxonomy head first-character guard
 -- Unknown clauses$old$,'')))/length($old$ end loop;
 end if; -- necessary-only taxonomy head first-character guard
 -- Unknown clauses$old$)<>1 then raise exception 'REASON_TAX_HEAD_PREFIX_ANCHOR_DRIFT';end if;
 patched:=replace(patched,$old$ end loop;
 end if; -- necessary-only taxonomy head first-character guard
 -- Unknown clauses$old$,$new$ end loop;
 -- Unknown clauses$new$);
 if (length(patched)-length(replace(patched,$old$note ~* '(available[[:space:]]+channels|amount[[:space:]]+is[[:space:]]+not|insufficient[[:space:]]+balance)'$old$,'')))/length($old$note ~* '(available[[:space:]]+channels|amount[[:space:]]+is[[:space:]]+not|insufficient[[:space:]]+balance)'$old$)<>1 then raise exception 'REASON_TAX_HEAD_PREFIX_ANCHOR_DRIFT';end if;
 patched:=replace(patched,$old$note ~* '(available[[:space:]]+channels|amount[[:space:]]+is[[:space:]]+not|insufficient[[:space:]]+balance)'$old$,$new$note ~* '(available|amount|insufficient)'$new$);
 if md5(patched)<>'6c2d173b5dfa6da54e1a8642b3dcbbfb'then raise exception 'REASON_TAX_HEAD_PREFIX_CONSTRUCTION_DRIFT';end if;execute patched;
 select *into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_blocking_details_cleaned(text)');
 if md5(p.prosrc)<>'3126b453070a6d7e0b3ddca6e0eb9a24' or md5(pg_get_functiondef(p.oid))<>'6c2d173b5dfa6da54e1a8642b3dcbbfb'or(to_jsonb(p)-'prosrc')is distinct from before_meta then raise exception 'REASON_TAX_HEAD_PREFIX_POST_MISMATCH';end if;
end;$patch$;
commit;
