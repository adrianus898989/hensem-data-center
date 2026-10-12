-- Publish only after 24 successful hourly receipts still belong to the current source generation.
-- This reads 24 private receipts; it does not rescan native orders or replace missing receipts with zero.
begin isolation level read committed;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $guard$
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed'
  or md5((select prosrc from pg_proc where oid='private.finalize_ar_historical_duration_day(text,date)'::regprocedure))<>'bc79b2a57df0df1bd80258a821d51755'
  or md5((select prosrc from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure))<>'0f46df284b4ad2feb4ffb0f6a0393d10'
  or private.ar_historical_duration_generation() is null then raise exception 'AR_HISTORY_DURATION_HOUR_MAINTENANCE_DRIFT';end if;
end;$guard$;
select private.finalize_ar_historical_duration_day('91CLUB',date '2026-10-09') as verified_native_day;
commit;
