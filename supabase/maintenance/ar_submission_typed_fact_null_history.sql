-- Owner-only, one bounded missing-only batch. NO upstream completeness claim.
-- Confirmed inserted_rows=0 is NOT a proof (SKIP LOCKED/source changes possible).
-- Only change the explicit stream/native half-open timestamps below; maximum
-- one hour, Oct10/11, and 1000 rows. Any timeout/unknown result STOP, do not raise
-- budget or automatically retry. No source orders are written.
begin;set local lock_timeout='1s';set local statement_timeout='3s';
do $guard$
declare f record;
begin
 if current_user<>'postgres'then raise exception 'AR_SUB_FACT_MAINTENANCE_OWNER_REQUIRED';end if;
 select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.backfill_ar_submission_fact(text,text,text,timestamp,timestamp,integer)');
 if not found or md5(f.prosrc)<>'df7dd3ca8d84d01993d400359ed600e2'or f.proowner<>'postgres'::regrole or f.prosecdef or f.provolatile<>'v'or f.proparallel<>'u'or f.lanname<>'plpgsql'or f.prorettype<>'bigint'::regtype or f.proretset or f.proisstrict or f.proleakproof or f.pronargdefaults<>1 or f.proconfig is distinct from array['search_path=""']::text[]or f.proacl::text is distinct from '{postgres=X/postgres}'then raise exception 'AR_SUB_FACT_MAINTENANCE_FUNCTION_DRIFT';end if;
 select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('private.ar_submission_fact_generation(text,text)');
 if not found or md5(f.prosrc)<>'44e726b77cdbb15c8db7b0af81346a1b'or f.proowner<>'postgres'::regrole or f.prosecdef or f.provolatile<>'s'or f.proparallel<>'u'or f.lanname<>'plpgsql'or f.prorettype<>'text'::regtype or f.proretset or f.proisstrict or f.proleakproof or f.proconfig is distinct from array['search_path=""']::text[]or f.proacl::text is distinct from '{postgres=X/postgres}'then raise exception 'AR_SUB_FACT_MAINTENANCE_GENERATION_DRIFT';end if;
 if private.ar_submission_fact_generation('IN','OKWIN')is null then raise exception 'AR_SUB_FACT_MAINTENANCE_LAYOUT_DRIFT';end if;
end;$guard$;
-- Required sparse native applied_at IS NULL set, never clipped by date.
-- Root must confirm indexed no-ANALYZE plan before executing this maintenance.
select private.backfill_ar_submission_fact('IN','OKWIN','null',null,null,1000)as inserted_rows;
commit;
