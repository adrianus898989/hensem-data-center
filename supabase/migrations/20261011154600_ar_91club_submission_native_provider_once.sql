-- Reduce the proved AR/IN/91CLUB summary+charts=false branch by one
-- complete typed-order scan and one per-order canonical-provider join.
-- Preserve all whole-day raw names, canonical alias merging, bigint counters,
-- native money/qualification/date semantics and all 24 execution bindings.
-- This does not change application timeouts, scope, readiness or permissions.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
lock table public.ar_collected_orders in access share mode;
lock table private.ar_91club_submission_facts in access share mode;
do $patch$
declare p record;f record;spec record;v_before jsonb;v_after jsonb;v_body text;v_definition text;
begin
 if current_user<>'postgres' then raise exception 'ar91_provider_once_actor_drift';end if;
 for spec in select * from(values ('private.ar_91club_submission_generation()','acd188a5da0cb2f63381bd5922e3a1cf','sql','text'),
('private.ar_91club_submission_can_read(date,date)','7252e3966d916239a3ce212ba91dc763','plpgsql','boolean'))v(signature,hash,language,return_type)loop
 select q.*,l.lanname into f from pg_proc q join pg_language l on l.oid=q.prolang where q.oid=to_regprocedure(spec.signature);
 if not found or md5(f.prosrc)<>spec.hash or f.proowner<>'postgres'::regrole or f.prosecdef or f.provolatile<>'s' or f.proparallel<>'u' or f.prorettype<>spec.return_type::regtype or f.proretset or f.proisstrict or f.proleakproof or f.lanname<>spec.language or f.proconfig is distinct from array['search_path=""']::text[] or f.proacl::text is distinct from '{postgres=X/postgres}'then raise exception 'ar91_provider_once_readiness_prerequisite_drift';end if;
 end loop;
 if private.ar_91club_submission_generation()is null then raise exception 'ar91_provider_once_projection_generation_invalid';end if;
 select q.*,l.lanname into p from pg_proc q join pg_language l on l.oid=q.prolang
 where q.oid=to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or p.proowner<>'postgres'::regrole or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u'
  or p.prorettype<>'jsonb'::regtype or p.proretset or p.proisstrict or p.proleakproof or p.lanname<>'plpgsql'
  or p.prokind<>'f' or p.pronargs<>1 or p.pronargdefaults<>0 or p.provariadic<>0
  or pg_get_function_arguments(p.oid)<>'p_request jsonb' or pg_get_function_result(p.oid)<>'jsonb'
  or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or md5(p.prosrc)not in('d5fbb1bec39eb927dd923e0d1cc6e115','cec54aaab8bdc72881a200c1d4973c81')then
  raise exception 'ar91_provider_once_metadata_drift';
 end if;
 v_before:=to_jsonb(p)-'prosrc'-'lanname';
 if md5(p.prosrc)='d5fbb1bec39eb927dd923e0d1cc6e115'then
  v_body:=replace(p.prosrc,$old_canonical$), canonical as materialized (
 select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider
 from (select distinct raw_provider from typed_orders) names
$old_canonical$,$new_canonical$), native_provider_summary as materialized (
 -- One native-provider pass supplies both canonical names and selected coverage.
 -- Preserve every whole-day provider here; filtering happens after canonicalization.
 select o.raw_provider,
  count(*) filter(where o.selected_clock and $17::text is not null) selected_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null) missing_member_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_level is null) missing_level_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.recharge_count is null) missing_recharge_count,
  count(*) filter(where o.selected_clock and $17::text is not null and o.member_id is null and not o.status_known) missing_member_unknown_count
 from typed_orders o group by o.raw_provider
), canonical as materialized (
 select raw_provider,private.dashboard_admin_live_provider_canonical($7,$3,raw_provider) provider
 from native_provider_summary
$new_canonical$);
  v_body:=replace(v_body,$old_selected$), selected_provider_summary as materialized (
 -- Only the provider-level coverage/dimensions are needed here. Member selection
 -- is counted in the existing whole-day aggregate, avoiding a second wide
 -- day/member/provider sort and materialization of nearly 100k groups.
 select c.provider,count(*) selected_count,
  count(*) filter(where o.member_id is null) missing_member_count,
  count(*) filter(where o.member_level is null) missing_level_count,
  count(*) filter(where o.recharge_count is null) missing_recharge_count,
  count(*) filter(where o.member_id is null and not o.status_known) missing_member_unknown_count
 from typed_orders o join canonical c using(raw_provider)
 where ($8::text[] is null or c.provider=any($8)) and o.selected_clock and $17::text is not null
 group by c.provider
$old_selected$,$new_selected$), selected_provider_summary as materialized (
 -- Merge native aliases only after the existing canonical helper. Count sums
 -- retain bigint types and exclude zero selected rows exactly as the old WHERE.
 select c.provider,sum(n.selected_count)::bigint selected_count,
  sum(n.missing_member_count)::bigint missing_member_count,
  sum(n.missing_level_count)::bigint missing_level_count,
  sum(n.missing_recharge_count)::bigint missing_recharge_count,
  sum(n.missing_member_unknown_count)::bigint missing_member_unknown_count
 from native_provider_summary n join canonical c using(raw_provider)
 where n.selected_count>0 and ($8::text[] is null or c.provider=any($8))
 group by c.provider
$new_selected$);
  if md5(v_body)<>'cec54aaab8bdc72881a200c1d4973c81'then raise exception 'ar91_provider_once_afterhash_mismatch';end if;
  v_definition:=pg_get_functiondef(p.oid);
  if position(p.prosrc in v_definition)=0 then raise exception 'ar91_provider_once_definition_drift';end if;
  execute replace(v_definition,p.prosrc,v_body);
 end if;
 select to_jsonb(q)-'prosrc' into v_after from pg_proc q where q.oid=p.oid;
 if v_after is distinct from v_before or(select md5(prosrc)from pg_proc where oid=p.oid)<>'cec54aaab8bdc72881a200c1d4973c81'then
  raise exception 'ar91_provider_once_post_metadata_drift';
 end if;
end;$patch$;
commit;
