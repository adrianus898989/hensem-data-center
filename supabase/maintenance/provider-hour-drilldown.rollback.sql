-- Revert only the verified hourly drill. Leave a newer production definition intact.
set local lock_timeout = '2s';
do $rollback$
declare
  target regprocedure := 'private.dashboard_admin_live_drilldown_raw(jsonb)'::regprocedure;
  previous constant text := 'bf64643fc384bd0679c29e6b69601599';
  candidate constant text := '120a5932b5302ff9fab97d5440023672';
  fingerprint text;
  definition text := pg_get_functiondef(target);
  start_mark text;
  end_mark text;
  first_at integer;
  end_offset integer;
begin
  select md5(prosrc) into fingerprint from pg_proc where oid=target;
  if fingerprint=previous then return; end if;
  if fingerprint<>candidate then raise exception 'provider_hour_drilldown_rollback_baseline_changed'; end if;
  definition := replace(definition,'''hourRange'',''providerHourMatrix'',''amountBands''','''hourRange'',''amountBands''');
  for start_mark,end_mark in values
    ('  if p_request ? ''providerHourMatrix'' then','  if p_request?''amountMaxExclusive'' then'),
    ('  elsif p_request ? ''providerHourMatrix'' then',$anchor$  else
    v_sql:=v_prefix||$q$, segment as ($anchor$),
    ('  if p_request ? ''providerHourMatrix'' and v_platform.source in (','  return v_result||case when v_duration_version=2 then')
  loop
    first_at := strpos(definition,start_mark);
    end_offset := strpos(substr(definition,first_at),end_mark);
    if first_at=0 or end_offset=0 then raise exception 'provider_hour_drilldown_rollback_anchor_missing'; end if;
    definition := left(definition,first_at-1)||substr(definition,first_at+end_offset-1);
  end loop;
  execute definition;
  if (select md5(prosrc) from pg_proc where oid=target) is distinct from previous then
    raise exception 'provider_hour_drilldown_rollback_incomplete';
  end if;
end
$rollback$;
