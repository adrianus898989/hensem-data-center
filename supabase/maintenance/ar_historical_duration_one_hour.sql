-- ONE exact native hour per owner transaction. Change platform/day/hour together.
-- Existing whole-day maintenance is still allowed for a small partition; do not retry a failed whole-day scan.
begin isolation level read committed;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $guard$
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed'
  or md5((select prosrc from pg_proc where oid='private.refresh_ar_historical_duration_hour(text,date,integer)'::regprocedure))<>'e2ef925cccf651717fc387264ee7aac0'
  or md5((select prosrc from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure))<>'0f46df284b4ad2feb4ffb0f6a0393d10'
  or private.ar_historical_duration_generation() is null then raise exception 'AR_HISTORY_DURATION_HOUR_MAINTENANCE_DRIFT';end if;
end;$guard$;
select private.refresh_ar_historical_duration_hour('91CLUB',date '2026-10-09',0) as verified_native_hour;
commit;
