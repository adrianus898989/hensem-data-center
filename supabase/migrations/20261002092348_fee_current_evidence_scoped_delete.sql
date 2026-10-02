-- Forward-only compatibility with production safe-update enforcement.
-- Keep the applied effective-version migration immutable. Only retire current
-- evidence belonging to this same, already-validated complete source capture.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $fee_scoped_delete$
declare
 target regprocedure:='public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
 p pg_proc%rowtype; metadata jsonb;
 old_statement text:='delete from private.fee_rate_current_evidence;';
 new_statement text:='delete from private.fee_rate_current_evidence c where exists (select 1 from private.fee_rate_generations g where g.id=c.generation_id and g.source_key=p_source_key);';
begin
 select * into p from pg_proc where oid=target;
 if md5(p.prosrc)<>'1d6457629706f191dc55dcc8b323b849' then raise exception 'fee_publisher_baseline_drift';end if;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
 or not p.prosecdef or p.provolatile<>'v' or p.proconfig is distinct from array['search_path=""']
 then raise exception 'fee_publisher_metadata_drift';end if;
 if (length(p.prosrc)-length(replace(p.prosrc,old_statement,'')))/length(old_statement)<>1
 then raise exception 'fee_publisher_delete_contract_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';
 execute replace(pg_get_functiondef(target),old_statement,new_statement);
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target) is distinct from metadata
 then raise exception 'fee_publisher_metadata_changed';end if;
 if (select md5(prosrc) from pg_proc where oid=target)<>'5e7f94ebc83434433ee589fce7ae3df4'
 then raise exception 'fee_publisher_candidate_hash';end if;
end $fee_scoped_delete$;
commit;
