-- Forward-only category matching after the separately reviewed AR dual-amount patch.
-- Keep all scope/security checks and non-fee output unchanged. Distinct channel
-- subjects price separately, then sum into the original provider/currency group.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $fee_channel_query$
declare target regprocedure:='private.dashboard_admin_live_query_raw(jsonb)'::regprocedure;
 p pg_proc%rowtype;dependency record;metadata jsonb;definition text;old_statement text;new_statement text;
begin
 select * into p from pg_proc where oid=target;
 if md5(p.prosrc)<>'bc573374d820305f3fad2b8ed230f5ae' then raise exception 'fee_channel_query_baseline_drift';end if;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres}' or not p.prosecdef
 or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""','jit=off'] then raise exception 'fee_channel_query_metadata_drift';end if;
 if to_regprocedure('private.dashboard_admin_fee_category(text,text)') is null
 or to_regprocedure('private.dashboard_admin_fee_intervals(text,text,text,text,text,text)') is null
 or to_regprocedure('private.dashboard_admin_fee_quote(text,text,text,text,text,timestamptz,numeric,text)') is null
 then raise exception 'fee_channel_helpers_missing';end if;
 metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 for dependency in select * from (values ('private.dashboard_admin_fee_category(text,text)','56bfaf0a3a2503f6bb2de67b1723150f'),
('private.dashboard_admin_fee_intervals(text,text,text,text,text,text)','aae3bbd7f30461571d671739f96dffd0'),
('private.dashboard_admin_fee_quote(text,text,text,text,text,timestamptz,numeric,text)','938791c20941a14d55da8ae06fa4d7ad')) v(signature,body_hash) loop
  if not exists(select 1 from pg_proc d where d.oid=dependency.signature::regprocedure and md5(d.prosrc)=dependency.body_hash
   and d.proowner='postgres'::regrole and d.proacl::text='{postgres=X/postgres}' and d.prosecdef
   and d.provolatile='s' and d.proconfig=array['search_path=""']) then raise exception 'fee_channel_helper_drift';end if;
 end loop;
 old_statement:=$old_0$case when $19<>'aggregate' then channel_type end as channel_type,direction,$old_0$;
 new_statement:=$new_0$channel_type,direction,$new_0$;
 if (length(p.prosrc)-length(replace(p.prosrc,old_statement,'')))/length(old_statement)<>1 then raise exception 'fee_channel_query_contract_drift_0';end if;
 definition:=replace(definition,old_statement,new_statement);
 old_statement:=$old_1$select direction,currency,provider,status_group,created_at,success_at,$old_1$;
 new_statement:=$new_1$select direction,currency,provider,channel_type,status_group,created_at,success_at,$new_1$;
 if (length(p.prosrc)-length(replace(p.prosrc,old_statement,'')))/length(old_statement)<>1 then raise exception 'fee_channel_query_contract_drift_1';end if;
 definition:=replace(definition,old_statement,new_statement);
 old_statement:=$old_2$select distinct direction,currency,provider from filtered$old_2$;
 new_statement:=$new_2$select distinct direction,currency,provider,channel_type from filtered$new_2$;
 if (length(p.prosrc)-length(replace(p.prosrc,old_statement,'')))/length(old_statement)<>2 then raise exception 'fee_channel_query_contract_drift_2';end if;
 definition:=replace(definition,old_statement,new_statement);
 old_statement:=$old_3$select s.direction,s.currency,s.provider,v.* from fee_subjects s$old_3$;
 new_statement:=$new_3$select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s$new_3$;
 if (length(p.prosrc)-length(replace(p.prosrc,old_statement,'')))/length(old_statement)<>2 then raise exception 'fee_channel_query_contract_drift_3';end if;
 definition:=replace(definition,old_statement,new_statement);
 old_statement:=$old_4$private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency) v$old_4$;
 new_statement:=$new_4$private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v$new_4$;
 if (length(p.prosrc)-length(replace(p.prosrc,old_statement,'')))/length(old_statement)<>2 then raise exception 'fee_channel_query_contract_drift_4';end if;
 definition:=replace(definition,old_statement,new_statement);
 old_statement:=$old_5$v.currency=f.currency and v.provider=f.provider
      and f.amount>=0$old_5$;
 new_statement:=$new_5$v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0$new_5$;
 if (length(p.prosrc)-length(replace(p.prosrc,old_statement,'')))/length(old_statement)<>2 then raise exception 'fee_channel_query_contract_drift_5';end if;
 definition:=replace(definition,old_statement,new_statement);
 old_statement:=$old_6$(x->>'created_at')::timestamptz,(x->>'amount')::numeric) order by n)$old_6$;
 new_statement:=$new_6$(x->>'created_at')::timestamptz,(x->>'amount')::numeric,private.dashboard_admin_fee_category(v_fee_country,x->>'channel_type')) order by n)$new_6$;
 if (length(p.prosrc)-length(replace(p.prosrc,old_statement,'')))/length(old_statement)<>1 then raise exception 'fee_channel_query_contract_drift_6';end if;
 definition:=replace(definition,old_statement,new_statement);
 execute definition;
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target) is distinct from metadata then raise exception 'fee_channel_query_metadata_changed';end if;
 if (select md5(prosrc) from pg_proc where oid=target)<>'7b096f2ec23ad7bc280675351224cb9c' then raise exception 'fee_channel_query_candidate_hash';end if;
end $fee_channel_query$;
commit;
