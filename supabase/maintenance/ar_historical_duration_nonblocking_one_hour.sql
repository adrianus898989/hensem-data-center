-- ONE reviewed native hour. Maintenance never queues behind the historical writer barrier.
begin isolation level read committed;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $guard$
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed'
  or md5((select prosrc from pg_proc where oid='private.refresh_ar_historical_duration_hour(text,date,integer)'::regprocedure))<>'d8fc73594da699c74c13afddd8d9ed70'
  or md5((select prosrc from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure))<>'a6f3c885ea14511edb6fcf48ee32113c'
  or private.ar_historical_duration_generation() is null then raise exception 'AR_HISTORY_DURATION_BARRIER_MAINTENANCE_DRIFT';end if;
end;$guard$;
select private.refresh_ar_historical_duration_hour('91CLUB',date '2026-10-09',0) as verified_native_hour;
commit;
