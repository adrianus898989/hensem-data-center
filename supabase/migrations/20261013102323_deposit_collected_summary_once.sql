-- Evaluate the existing collected-summary JSON once per aggregate and once per group.
-- Keep the deployed reader's function-local custom plan, source semantics and authorization.
begin;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $patch$
declare f record;r record;definition text;before_meta jsonb;
 old_stats constant text:=$old_stats$ stats as ($old_stats$;
 new_stats constant text:=$new_stats$ stats as materialized ($new_stats$;
 old_summary constant text:=$old_summary$(select private.dashboard_admin_deposit_kyc_summary_v2(p_rows) value)$old_summary$;
 new_summary constant text:=$new_summary$(select private.dashboard_admin_deposit_kyc_summary_v2(p_rows) value offset 0)$new_summary$;
begin
 if current_user<>'postgres' then raise exception 'deposit_collected_summary_once_owner_required';end if;
 for r in select * from(values
 ('private.dashboard_admin_deposit_collected_statistics(jsonb)','plpgsql','p_request jsonb','e6f8a15952fc7549654332e401f29500','47a0a1b59aa96bda3ee6e91e5fe022b1',array['search_path=""','plan_cache_mode=force_custom_plan']::text[]),
 ('private.dashboard_admin_deposit_collected_summary(jsonb)','sql','p_rows jsonb','cb0533ace99068c66a22ffe563914280','e7e1ba1ca1d4af4f39918283c215b125',array['search_path=""']::text[])
 )x(identity,language,args,before_hash,after_hash,config) loop
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(r.identity);
  if not found or f.proowner<>'postgres'::regrole or f.lanname<>r.language or f.prokind<>'f' or f.prosecdef or f.provolatile<>'s'
   or f.proparallel<>'u' or f.proretset or f.proisstrict or f.proleakproof or f.prorettype<>'jsonb'::regtype or f.pronargs<>1
   or f.pronargdefaults<>0 or f.provariadic<>0 or f.procost<>100 or f.prorows<>0
   or pg_get_function_arguments(f.oid)<>r.args or f.proconfig is distinct from r.config or f.proacl::text is distinct from '{postgres=X/postgres}'
   then raise exception 'deposit_collected_summary_once_metadata_drift';end if;
  if md5(f.prosrc) not in(r.before_hash,r.after_hash) then raise exception 'deposit_collected_summary_once_body_drift';end if;
 end loop;
 for r in select * from(values
 ('private.dashboard_admin_deposit_collected_statistics(jsonb)','e6f8a15952fc7549654332e401f29500','47a0a1b59aa96bda3ee6e91e5fe022b1',old_stats,new_stats),
 ('private.dashboard_admin_deposit_collected_summary(jsonb)','cb0533ace99068c66a22ffe563914280','e7e1ba1ca1d4af4f39918283c215b125',old_summary,new_summary)
 )x(identity,before_hash,after_hash,old_anchor,new_anchor) loop
  select to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid) into before_meta,definition from pg_proc p where p.oid=to_regprocedure(r.identity);
  -- Re-read the body by identity; keep all pg_get_functiondef configuration clauses.
  if(select md5(prosrc)from pg_proc where oid=to_regprocedure(r.identity))=r.before_hash then
   if(length(definition)-length(replace(definition,r.old_anchor,'')))/length(r.old_anchor)<>1 then raise exception 'deposit_collected_summary_once_anchor_drift';end if;
   execute replace(definition,r.old_anchor,r.new_anchor);
  end if;
  if(select to_jsonb(p)-'prosrc'from pg_proc p where p.oid=to_regprocedure(r.identity)) is distinct from before_meta
   or(select md5(prosrc)from pg_proc where oid=to_regprocedure(r.identity)) is distinct from r.after_hash then raise exception 'deposit_collected_summary_once_postcondition_drift';end if;
 end loop;
end;$patch$;
commit;
