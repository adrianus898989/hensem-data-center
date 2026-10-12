-- Publish exactly24 current-generation native-hour receipts without a whole-day rescan.
begin isolation level read committed;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $guard$
begin
 if current_user<>'postgres' or current_setting('transaction_isolation')<>'read committed'
  or md5((select prosrc from pg_proc where oid='private.finalize_ar_historical_duration_day(text,date)'::regprocedure))<>'17811807bf452cd1675d7ce54487c145'
  or md5((select prosrc from pg_proc where oid='private.ar_historical_duration_generation()'::regprocedure))<>'a6f3c885ea14511edb6fcf48ee32113c'
  or private.ar_historical_duration_generation() is null then raise exception 'AR_HISTORY_DURATION_BARRIER_MAINTENANCE_DRIFT';end if;
end;$guard$;
select private.finalize_ar_historical_duration_day('91CLUB',date '2026-10-09') as verified_native_day;
commit;
