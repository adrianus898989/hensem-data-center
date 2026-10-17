-- Add this family to the existing provider/prepared fairness lane without
-- changing any prepared_aggregate_* function or its semantic dependency token.
CREATE FUNCTION private.withdraw_prepared_provider_gate()RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path=''AS $$
DECLARE t private.prepared_aggregate_worker_turn%rowtype;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_worker_denied';END IF;
 -- Caller has selected a provider job and holds provider_snapshot_claim_v1.
 SELECT *INTO t FROM private.prepared_aggregate_worker_turn WHERE singleton FOR UPDATE;
 IF t.next_kind='prepared'AND EXISTS(SELECT 1 FROM private.withdraw_prepared_jobs WHERE status IN('queued','failed')AND attempts<3 AND not_before<=clock_timestamp())
  AND(t.waiting_since IS NULL OR t.waiting_since>clock_timestamp()-interval'3seconds')THEN
  UPDATE private.prepared_aggregate_worker_turn SET waiting_since=coalesce(waiting_since,clock_timestamp())WHERE singleton;RETURN false;
 END IF;
 RETURN true;
END;$$;
REVOKE ALL ON FUNCTION private.withdraw_prepared_provider_gate()FROM public,anon,authenticated,service_role;
DO $coordinate$
DECLARE p record;d text;a text;before_meta jsonb;
BEGIN
 IF current_user<>'postgres'THEN RAISE EXCEPTION USING errcode='42501',message='withdraw_prepared_installer_denied';END IF;
 SELECT *INTO p FROM pg_proc WHERE oid='private.provider_snapshot_claim(text,integer)'::regprocedure;
 IF md5(p.prosrc)<>'e80a93aa8c6540b51cb086ee9d70b669'OR p.prosecdef OR p.provolatile<>'v'OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']OR pg_get_userbyid(p.proowner)<>'postgres'OR p.proacl::text IS DISTINCT FROM'{postgres=X/postgres}'THEN RAISE EXCEPTION 'withdraw_prepared_provider_contract_drift';END IF;
 before_meta:=to_jsonb(p)-'prosrc';d:=pg_get_functiondef(p.oid);
 a:=$a$if exists(select 1 from private.prepared_aggregate_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;$a$;
 IF(length(d)-length(replace(d,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'withdraw_prepared_provider_lease_anchor';END IF;
 d:=replace(d,a,a||E'\n if exists(select 1 from private.withdraw_prepared_jobs where status=''running''and lease_until>clock_timestamp())then return null;end if;');
 a:=$a$if not private.prepared_aggregate_take_turn('provider')then return null;end if;$a$;
 IF(length(d)-length(replace(d,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'withdraw_prepared_provider_turn_anchor';END IF;
 d:=replace(d,a,$a$if not private.withdraw_prepared_provider_gate()then return null;end if;
 if not private.prepared_aggregate_take_turn('provider')then return null;end if;$a$);EXECUTE d;
 IF(SELECT to_jsonb(q)-'prosrc'FROM pg_proc q WHERE oid=p.oid)IS DISTINCT FROM before_meta THEN RAISE EXCEPTION 'withdraw_prepared_provider_metadata_changed';END IF;
END;$coordinate$;
