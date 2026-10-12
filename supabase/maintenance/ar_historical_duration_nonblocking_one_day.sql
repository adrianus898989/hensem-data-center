-- ONE small native-day aggregate. A partition which already timed out must use reviewed hourly staging instead.
begin isolation level read committed;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $guard$
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed'
  or md5((select prosrc from pg_proc where oid='private.refresh_ar_historical_duration(text,date)'::regprocedure))<>'bc6b303925ab3eda045c3f3725220c89'
  or md5((select prosrc from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure))<>'a6f3c885ea14511edb6fcf48ee32113c'
  or private.ar_historical_duration_generation() is null then raise exception 'AR_HISTORY_DURATION_BARRIER_MAINTENANCE_DRIFT';end if;
end;$guard$;
select private.refresh_ar_historical_duration('55CLUB',date '2026-10-09') as verified_native_day;
commit;
