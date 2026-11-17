-- Keep the current job, Vault authentication and five-minute interval. The
-- final JSON in a slow HTTP 207 contains both source results and finalHttpStatus.
set local lock_timeout = '2s';
do $change$
declare
  current_job cron.job%rowtype;
  new_command text;
begin
  select * into strict current_job from cron.job where jobname='deposit-issue-sheet-sync';
  if md5(current_job.command)='4ad8e420dc795f3de9c09d2e671881b3' then return; end if;
  if md5(current_job.command)<>'de4c3351734a2ba64be1dcd68e758d2a' or current_job.schedule<>'*/5 * * * *' then
    raise exception 'deposit_issue_sync_cron_changed';
  end if;
  new_command := replace(replace(current_job.command,'{"action":"sync"}','{"action":"sync","receipt":"final_multi_status"}'),
                         'timeout_milliseconds := 150000','timeout_milliseconds := 230000');
  if md5(new_command)<>'4ad8e420dc795f3de9c09d2e671881b3' then raise exception 'deposit_issue_sync_cron_invalid'; end if;
  perform cron.alter_job(current_job.jobid,command:=new_command);
end;
$change$;
