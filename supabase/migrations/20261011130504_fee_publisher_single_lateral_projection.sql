-- Offline candidate: convert each JSON object once when publishing typed rows.
-- Only the two INSERT source projections change. Validation, receipt/hash logic,
-- conflict updates, deletes, versioning, atomicity and permissions remain intact.
-- This is not evidence that the live fee reader failed because of the publisher.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $fee_lateral_projection$
declare
 target regprocedure:='public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
 p pg_proc%rowtype; metadata jsonb; definition text; old_fragment text; new_fragment text;
begin
 select * into p from pg_proc where oid=target;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
 or not p.prosecdef or p.provolatile<>'v' or p.proconfig is distinct from array['search_path=""']
 or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.prokind<>'f' or p.proretset or p.prorettype<>'jsonb'::regtype
 or p.proisstrict or p.proleakproof or p.proparallel<>'u' or p.pronargdefaults<>0
 or p.proargnames is distinct from array['p_generation_id','p_source_key','p_observed_at','p_rates','p_platform_statuses','p_evidence','p_manifest']
 then raise exception 'fee_lateral_metadata_drift';end if;
 if md5(p.prosrc)='e8138a9e0026e2b1fca10181abe34bee' then return;end if;
 if md5(p.prosrc)<>'1da790f7dc39d5f58d7444dc1fcff4bc' then raise exception 'fee_lateral_baseline_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';
 definition:=pg_get_functiondef(target);
 old_fragment:=$old_0$insert into public.third_party_rates select (jsonb_populate_record(null::public.third_party_rates,x||jsonb_build_object('created_at',v_now,'updated_at',v_now))).* from jsonb_array_elements(p_rates) x$old_0$;
 new_fragment:=$new_0$insert into public.third_party_rates select rate_row.* from jsonb_array_elements(p_rates) x
 cross join lateral jsonb_populate_record(null::public.third_party_rates,x||jsonb_build_object('created_at',v_now,'updated_at',v_now)) rate_row$new_0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 then raise exception 'fee_lateral_anchor_drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old_1$insert into public.third_party_platform_status select (jsonb_populate_record(null::public.third_party_platform_status,x||jsonb_build_object('created_at',v_now,'updated_at',v_now))).* from jsonb_array_elements(p_platform_statuses) x$old_1$;
 new_fragment:=$new_1$insert into public.third_party_platform_status select status_row.* from jsonb_array_elements(p_platform_statuses) x
 cross join lateral jsonb_populate_record(null::public.third_party_platform_status,x||jsonb_build_object('created_at',v_now,'updated_at',v_now)) status_row$new_1$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 then raise exception 'fee_lateral_anchor_drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target) is distinct from metadata
 then raise exception 'fee_lateral_metadata_changed';end if;
 if (select md5(prosrc) from pg_proc where oid=target)<>'e8138a9e0026e2b1fca10181abe34bee'
 then raise exception 'fee_lateral_candidate_hash';end if;
end $fee_lateral_projection$;
commit;
