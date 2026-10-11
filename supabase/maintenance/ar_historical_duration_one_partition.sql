-- Explicit owner maintenance example: ONE native platform/day per transaction.
-- Replace only the two marked literals after reviewing the exact native partition.
-- No automatic loop, timeout increase, or retry after a failure.
begin isolation level read committed;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $guard$
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed'
  or md5((select prosrc from pg_proc where oid='private.refresh_ar_historical_duration(text,date)'::regprocedure))<>'c1ca787546f804af858c5316305b7f70'
  or md5((select prosrc from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure))<>'059d6bd465ec451839f0db41aad2ea0e'
  or private.ar_historical_duration_generation() is null then
  raise exception 'AR_HISTORY_DURATION_MAINTENANCE_DRIFT';end if;
end;$guard$;
-- NATIVE_PLATFORM and NATIVE_DAY. The function acquires source SHARE NOWAIT before reading.
select private.refresh_ar_historical_duration('91CLUB',date '2026-10-09') as verified_native_duration;
commit;
