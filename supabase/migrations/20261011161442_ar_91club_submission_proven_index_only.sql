-- Enable true covering-index reads only in the proved AR/IN/91CLUB facts
-- summary branch. Its validated, exact population CHECK already forces the
-- four native identity values, and unchanged generation/can_read checks reprove
-- that CHECK on every read. Removing redundant identity-column filters avoids
-- heap access for applied/paid/NULL scans; constant IN/91CLUB fences remain.
-- The eligible-row five-key money lookup, scope/session/catalog authorization,
-- runtime proof/fallback, timezone, qualifications and 24 binds are unchanged.
-- No data, permissions, application timeout or memory settings are changed.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
lock table public.ar_collected_orders in access share mode;
lock table private.ar_91club_submission_facts in access share mode;
do $patch$
declare p record;f record;spec record;v_before jsonb;v_after jsonb;v_body text;v_definition text;
begin
 if current_user<>'postgres' then raise exception 'ar91_proven_index_only_actor_drift';end if;
 for spec in select * from(values ('private.ar_91club_submission_generation()','acd188a5da0cb2f63381bd5922e3a1cf','sql','text'),
('private.ar_91club_submission_can_read(date,date)','7252e3966d916239a3ce212ba91dc763','plpgsql','boolean'))v(signature,hash,language,return_type)loop
 select q.*,l.lanname into f from pg_proc q join pg_language l on l.oid=q.prolang where q.oid=to_regprocedure(spec.signature);
 if not found or md5(f.prosrc)<>spec.hash or f.proowner<>'postgres'::regrole or f.prosecdef or f.provolatile<>'s' or f.proparallel<>'u' or f.prorettype<>spec.return_type::regtype or f.proretset or f.proisstrict or f.proleakproof or f.lanname<>spec.language or f.proconfig is distinct from array['search_path=""']::text[] or f.proacl::text is distinct from '{postgres=X/postgres}'then raise exception 'ar91_proven_index_only_readiness_prerequisite_drift';end if;
 end loop;
 if private.ar_91club_submission_generation()is null then raise exception 'ar91_proven_index_only_projection_generation_invalid';end if;
 select q.*,l.lanname into p from pg_proc q join pg_language l on l.oid=q.prolang
 where q.oid=to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or p.proowner<>'postgres'::regrole or not p.prosecdef or p.provolatile<>'s' or p.proparallel<>'u'
  or p.prorettype<>'jsonb'::regtype or p.proretset or p.proisstrict or p.proleakproof or p.lanname<>'plpgsql'
  or p.prokind<>'f' or p.pronargs<>1 or p.pronargdefaults<>0 or p.provariadic<>0
  or pg_get_function_arguments(p.oid)<>'p_request jsonb' or pg_get_function_result(p.oid)<>'jsonb'
  or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or md5(p.prosrc)not in('cec54aaab8bdc72881a200c1d4973c81','a8f8bb5de7d906675f5176c5eb4fcb70')then
  raise exception 'ar91_proven_index_only_metadata_drift';
 end if;
 v_before:=to_jsonb(p)-'prosrc'-'lanname';
 if md5(p.prosrc)='cec54aaab8bdc72881a200c1d4973c81'then
  v_body:=p.prosrc;
  v_body:=replace(v_body,$old0$from private.ar_91club_submission_facts a where a.source_system='AR' and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'$old0$,$new0$from private.ar_91club_submission_facts a where $2::text='IN' and $3::text='91CLUB'$new0$);
  v_body:=replace(v_body,$old1$where a.source_system='AR'and a.country_code=$2 and a.platform=$3 and a.order_kind='recharge'and a.status='已支付'$old1$,$new1$where $2::text='IN'and $3::text='91CLUB'and a.status='已支付'$new1$);
  v_body:=replace(v_body,$old2$where a.source_system='AR' and a.country_code=$2 and a.platform=$3
  and a.order_kind='recharge' and a.applied_at is null$old2$,$new2$where $2::text='IN' and $3::text='91CLUB'
  and a.applied_at is null$new2$);
  if md5(v_body)<>'a8f8bb5de7d906675f5176c5eb4fcb70'then raise exception 'ar91_proven_index_only_afterhash_mismatch';end if;
  v_definition:=pg_get_functiondef(p.oid);
  if position(p.prosrc in v_definition)=0 then raise exception 'ar91_proven_index_only_definition_drift';end if;
  execute replace(v_definition,p.prosrc,v_body);
 end if;
 select to_jsonb(q)-'prosrc' into v_after from pg_proc q where q.oid=p.oid;
 if v_after is distinct from v_before or(select md5(prosrc)from pg_proc where oid=p.oid)<>'a8f8bb5de7d906675f5176c5eb4fcb70'then
  raise exception 'ar91_proven_index_only_post_metadata_drift';
 end if;
end;$patch$;
commit;
